import { NextResponse, type NextRequest } from "next/server";
import { prismaAdmin } from "@/lib/prisma-admin";
import { env } from "@/env";
import {
  EVENT_RETENTION_DAYS,
  SESSION_RETENTION_DAYS,
  cutoffFor,
  purgeInBatches,
  type BatchDeleter,
} from "./purge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/analytics-retention
 *
 * Vercel cron schedule: diario 09:30 UTC. Vercel programa en UTC y México está
 * en UTC-6 todo el año, así que son las 03:30 de CDMX — de madrugada de verdad,
 * con las clínicas cerradas. Misma convención que /api/cron/retention, que usa
 * "0 9 * * *" para sus 03:00 CDMX.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Qué arregla: la analítica de primera parte no tenía NINGUNA limpieza. Medido
 * el 21-sep-2026 en producción: analytics_events, 27 MB y 51 480 filas con 15
 * clínicas, creciendo ~3 300 filas al día y sin que nada borre nunca nada.
 *
 * Política (los porqués, y el efecto colateral del corte a 90 días, están
 * documentados en ./purge.ts):
 *  - analytics_events   > EVENT_RETENTION_DAYS (90)   → borrar
 *  - analytics_sessions > SESSION_RETENTION_DAYS (365) → borrar
 *
 * Por LOTES, nunca de un golpe: es la tabla donde escribe el panel de todas las
 * clínicas en cada click. Ver el comentario de cabecera de ./purge.ts.
 *
 * Idempotente: los dos cortes son umbrales absolutos, no cursores. Correrlo dos
 * veces seguidas no falla; la segunda borra 0.
 *
 * Multi-tenant: esto es mantenimiento de plataforma, no una consulta de
 * clínica. No lleva filtro por clinicId a propósito —borra por edad, para
 * todas— y no toca ningún id que venga del cliente: la única entrada es el
 * CRON_SECRET de la cabecera. Mismo patrón que /api/cron/retention.
 *
 * prismaAdmin (sin contexto RLS) porque un cron no tiene sesión de usuario, y
 * porque es el mismo cliente con el que /api/track escribe estas dos tablas.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAtMs = Date.now();
  // 4 de los 5 minutos de maxDuration: deja margen para cerrar y responder.
  const deadlineAt = startedAtMs + 240_000;
  const now = new Date(startedAtMs);

  const eventDeleter: BatchDeleter = {
    pickOldest: async (cutoff, take) => {
      const rows = await prismaAdmin.analyticsEvent.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" }, // usa @@index([createdAt])
        take,
      });
      return rows.map((r) => r.id);
    },
    deleteByIds: async (ids) =>
      (await prismaAdmin.analyticsEvent.deleteMany({ where: { id: { in: ids } } })).count,
  };

  const sessionDeleter: BatchDeleter = {
    pickOldest: async (cutoff, take) => {
      const rows = await prismaAdmin.analyticsSession.findMany({
        where: { startedAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { startedAt: "asc" }, // usa @@index([startedAt])
        take,
      });
      return rows.map((r) => r.id);
    },
    deleteByIds: async (ids) =>
      (await prismaAdmin.analyticsSession.deleteMany({ where: { id: { in: ids } } })).count,
  };

  const summary = {
    startedAt: now.toISOString(),
    eventCutoff: cutoffFor(EVENT_RETENTION_DAYS, now).toISOString(),
    sessionCutoff: cutoffFor(SESSION_RETENTION_DAYS, now).toISOString(),
    events: { deleted: 0, batches: 0, done: false },
    sessions: { deleted: 0, batches: 0, done: false },
    /** Por qué no se tocaron las sesiones, si no se tocaron. No es un error:
     *  una corrida de puesta al día que se queda sin lotes es lo esperado. */
    sessionsSkipped: null as string | null,
    errors: [] as string[],
  };

  // Eventos primero: son el 99 % del volumen. Si se come el presupuesto de
  // tiempo, las sesiones esperan a mañana sin pasar nada — son 36 filas al día.
  try {
    summary.events = await purgeInBatches(
      eventDeleter,
      cutoffFor(EVENT_RETENTION_DAYS, now),
      { deadlineAt },
    );
  } catch (e) {
    summary.errors.push(`events: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Las sesiones van después, y SÓLO si la purga de eventos terminó limpia.
  //
  // Esto no es prudencia de más: la FK analytics_events.sessionId es
  // ON DELETE CASCADE (sql/analytics.sql), así que borrar 2 000 sesiones arrastra
  // en la MISMA transacción todos sus eventos — con ~90 eventos por sesión, unas
  // 180 000 filas y sus cinco índices de un golpe. Es exactamente el DELETE largo
  // que los lotes existen para evitar. En el camino feliz no pasa, porque los
  // eventos se purgan primero y en orden createdAt asc: cuando le toca a una
  // sesión de 365 días, sus eventos se fueron hace 275. Pero si la purga de
  // eventos murió a medias, esa garantía ya no vale — así que se espera a mañana.
  if (!summary.events.done) {
    summary.sessionsSkipped = summary.errors.length
      ? "la purga de eventos falló"
      : "la purga de eventos no terminó (quedan filas para la corrida de mañana)";
  } else {
    try {
      summary.sessions = await purgeInBatches(
        sessionDeleter,
        cutoffFor(SESSION_RETENTION_DAYS, now),
        { deadlineAt },
      );
    } catch (e) {
      summary.errors.push(`sessions: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log("[cron/analytics-retention]", JSON.stringify(summary));

  return NextResponse.json({
    ok: summary.errors.length === 0,
    ...summary,
    elapsedMs: Date.now() - startedAtMs,
  });
}
