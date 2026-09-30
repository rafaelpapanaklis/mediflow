import "server-only";
// Ortodoncia — la tabla de alertas pospuestas (fila 22, ws1-t4 ronda 6).
// SQL crudo y sin modelo de Prisma: la tabla nace con
// `sql/ortodoncia-alertas-pospuestas.sql`, que pega Rafael, y el código
// tiene que funcionar antes de que exista (dev.108 usa la base real).
//
// `clinicId` y el usuario SIEMPRE de la sesión, nunca del cliente.

import { prisma } from "@/lib/prisma";
import { esTipoPosponible, type Posposicion, type TipoPosponible } from "./alertas-pospuestas";

/** La tabla todavía no existe (Postgres 42P01, o Prisma envolviéndolo). */
export function faltaLaTabla(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  if (err.code === "P2010" && err.meta?.code === "42P01") return true;
  if (err.code === "42P01" || err.meta?.code === "42P01" || err.code === "P2021") return true;
  return typeof err.message === "string" && /ortho_alert_snoozes.*does not exist|42P01/i.test(err.message);
}

/** Posposiciones vigentes de la clínica. Nunca lanza: sin tabla o con error, ninguna. */
export async function cargarPosposiciones(clinicId: string, ahora: Date): Promise<Posposicion[]> {
  if (!clinicId) return [];
  try {
    const filas = await prisma.$queryRaw<{ patientId: string; tipo: string; hasta: Date }[]>`
      SELECT "patientId", "tipo", "hasta"
      FROM "ortho_alert_snoozes"
      WHERE "clinicId" = ${clinicId} AND "hasta" > ${ahora}
      LIMIT 2000`;
    return filas
      .filter((f) => esTipoPosponible(f.tipo))
      .map((f) => ({ patientId: f.patientId, tipo: f.tipo as TipoPosponible, hasta: new Date(f.hasta) }));
  } catch (e) {
    if (!faltaLaTabla(e)) console.error("[ortodoncia/alertas-pospuestas] no se pudieron leer:", e);
    return [];
  }
}

/**
 * Guarda (o renueva) la posposición. Lanza si la tabla no existe o la base
 * falla: quien llama decide el mensaje.
 */
export async function guardarPosposicion(args: {
  clinicId: string;
  patientId: string;
  tipo: TipoPosponible;
  hasta: Date;
  userId: string | null;
}): Promise<void> {
  if (!args.clinicId) throw new Error("clinicId requerido");
  await prisma.$executeRaw`
    INSERT INTO "ortho_alert_snoozes" ("clinicId", "patientId", "tipo", "hasta", "userId")
    VALUES (${args.clinicId}, ${args.patientId}, ${args.tipo}, ${args.hasta}, ${args.userId})
    ON CONFLICT ("clinicId", "patientId", "tipo")
    DO UPDATE SET "hasta" = EXCLUDED."hasta", "userId" = EXCLUDED."userId", "createdAt" = now()`;
}

/**
 * «Deshacer»: la posposición deja de estar vigente ahora mismo (no se borra
 * nada: se vence). Lanza si la tabla no existe o la base falla.
 */
export async function terminarPosposicion(args: {
  clinicId: string;
  patientId: string;
  tipo: TipoPosponible;
}): Promise<void> {
  if (!args.clinicId) throw new Error("clinicId requerido");
  // «Ahora» de la base y «ahora» del servidor de la app pueden diferir unos segundos: con `now()` a secas, la fila
  // seguía «pospuesta» para el servidor hasta que sus relojes se alcanzaban y la lista no se actualizaba al deshacer
  // (ws1-t9 #10). Se vence en el pasado de AMBOS relojes.
  await prisma.$executeRaw`
    UPDATE "ortho_alert_snoozes"
    SET "hasta" = LEAST(now(), ${new Date()}::timestamptz) - interval '1 minute'
    WHERE "clinicId" = ${args.clinicId} AND "patientId" = ${args.patientId} AND "tipo" = ${args.tipo}`;
}
