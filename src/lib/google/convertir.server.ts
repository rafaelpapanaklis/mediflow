/**
 * «CONVERTIR EN CITA» y el aviso de la cita convertida (WS1-T9).
 *
 * La cita se crea con la ruta NORMAL (`POST /api/appointments`: choques,
 * permisos, visibilidad, auditoría, WhatsApp, recordatorios por cron…). Esa
 * ruta solo hace dos cosas más cuando le llega `googleBloqueoId`:
 *
 *   1. `prepararConversionGoogle` — comprueba que el bloqueo es GOOGLE, de la
 *      clínica de la sesión, sigue activo y no está convertido; y le dice a la
 *      ruta que ESE bloqueo no cuenta como «hora bloqueada» (es justo el hueco
 *      que se está ocupando).
 *   2. Dentro de la MISMA transacción del alta: la cita nace con
 *      `googleCalendarEventId` = el evento de Google, y `marcarBloqueoConvertido`
 *      deja el bloqueo retirado y el vínculo con `convertedAt` + `appointmentId`.
 *      Si otro lo convirtió a la vez, lanza y el alta se deshace entera.
 *
 * Con el id del evento ya en la cita, la sincronización de salida de siempre
 * (`sincronizarCitaEnSegundoPlano`) hace `events.patch` sobre ESE evento: no
 * crea uno nuevo, no hay duplicado en Google.
 */

import { prisma } from "@/lib/prisma";
import { tablasGoogleListas } from "./tablas.server";
import { avisoVigente, type AvisoVigente } from "./entrante-core";

const idValido = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

/** Lo que la ruta necesita saber. Un solo tipo con campos anulables (strict:false no estrecha uniones). */
export interface ConversionPreparada {
  ok: boolean;
  bloqueoId: string | null;
  googleEventId: string | null;
  /** Para el 4xx cuando `ok` es false. */
  status: number;
  error: string | null;
}

export async function prepararConversionGoogle(
  clinicId: string,
  bloqueoId: unknown,
  quien?: { userId: string; role: string },
): Promise<ConversionPreparada> {
  const no = (status: number, error: string): ConversionPreparada => ({ ok: false, bloqueoId: null, googleEventId: null, status, error });
  if (!idValido(clinicId)) return no(401, "unauthorized");
  if (!idValido(bloqueoId)) return no(400, "google_block_invalid");
  if (!(await tablasGoogleListas({ forzar: true }))) return no(409, "google_block_unavailable");
  const imp = await prisma.googleAgendaImport.findUnique({ where: { clinicId }, select: { enabled: true } });
  if (!imp?.enabled) return no(409, "google_block_unavailable");

  const [bloque, vinculo] = await Promise.all([
    prisma.agendaBlock.findFirst({
      where: { id: bloqueoId, clinicId },
      select: { id: true, kind: true, deletedAt: true, doctorId: true },
    }),
    prisma.agendaBlockGoogle.findFirst({
      where: { blockId: bloqueoId, clinicId },
      select: { googleEventId: true, appointmentId: true },
    }),
  ]);
  if (!bloque || bloque.kind !== "GOOGLE" || !vinculo) return no(404, "google_block_not_found");
  // Un DOCTOR solo ve (y convierte) los suyos y los de toda la clínica, como en `listarBloqueos`.
  if (quien?.role === "DOCTOR" && bloque.doctorId !== null && bloque.doctorId !== quien.userId) {
    return no(404, "google_block_not_found");
  }
  if (vinculo.appointmentId) return no(409, "google_block_already_converted");
  if (bloque.deletedAt) return no(409, "google_block_inactive");
  return { ok: true, bloqueoId: bloque.id, googleEventId: vinculo.googleEventId, status: 200, error: null };
}

export class ConversionYaHecha extends Error {
  constructor() {
    super("google_block_already_converted");
  }
}

/** La rendija de transacción que hace falta (un `tx` de Prisma la cumple). */
export interface TxConversion {
  agendaBlockGoogle: { updateMany(args: any): Promise<{ count: number }> };
  agendaBlock: { updateMany(args: any): Promise<{ count: number }> };
}

/**
 * Dentro de la transacción del alta. Condicional: solo si nadie lo convirtió
 * antes; si no, lanza `ConversionYaHecha` y la transacción se deshace.
 */
export async function marcarBloqueoConvertido(
  tx: TxConversion,
  d: { clinicId: string; bloqueoId: string; appointmentId: string; userId: string; startsAt: Date; endsAt: Date; ahora?: Date },
): Promise<void> {
  const ahora = d.ahora ?? new Date();
  const r = await tx.agendaBlockGoogle.updateMany({
    where: { blockId: d.bloqueoId, clinicId: d.clinicId, appointmentId: null },
    data: {
      convertedAt: ahora,
      convertedById: d.userId,
      appointmentId: d.appointmentId,
      // Punto de partida del aviso: la hora que tendrá el evento tras el parche.
      eventStartsAt: d.startsAt,
      eventEndsAt: d.endsAt,
    },
  });
  if (r.count === 0) throw new ConversionYaHecha();
  // El bloqueo queda RETIRADO (no borrado): ahora ocupa la cita. Solo si
  // seguía activo: si la sincronización lo retiró entre la comprobación y aquí
  // (el evento se borró en Google), la cita no se crea sobre un evento muerto.
  const b = await tx.agendaBlock.updateMany({
    where: { id: d.bloqueoId, clinicId: d.clinicId, kind: "GOOGLE", deletedAt: null },
    data: { deletedAt: ahora, deletedById: d.userId },
  });
  if (b.count === 0) throw new ConversionYaHecha();
}

// ═══════════════════════════════════════════════════════════════════════
// LO QUE VE EL PANEL DEL BLOQUEO
// ═══════════════════════════════════════════════════════════════════════

export interface DetalleBloqueoGoogle {
  id: string;
  titulo: string;
  inicio: string;
  fin: string;
  diaCompleto: boolean;
  doctorId: string | null;
  doctorNombre: string | null;
  activo: boolean;
  citaId: string | null;
}

/**
 * El detalle de un bloqueo GOOGLE para quien ve la agenda. Un DOCTOR solo ve
 * los suyos y los de toda la clínica (mismo criterio que `listarBloqueos`).
 */
export async function detalleBloqueoGoogle(
  ctx: { clinicId: string; userId: string; role: string },
  bloqueoId: string,
): Promise<DetalleBloqueoGoogle | null> {
  if (!idValido(ctx.clinicId) || !idValido(bloqueoId)) return null;
  if (!(await tablasGoogleListas())) return null;
  const [b, v] = await Promise.all([
    prisma.agendaBlock.findFirst({
      where: { id: bloqueoId, clinicId: ctx.clinicId, kind: "GOOGLE" },
      select: {
        id: true, doctorId: true, startsAt: true, endsAt: true, deletedAt: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.agendaBlockGoogle.findFirst({
      where: { blockId: bloqueoId, clinicId: ctx.clinicId },
      select: { title: true, allDay: true, appointmentId: true },
    }),
  ]);
  if (!b || !v) return null;
  if (ctx.role === "DOCTOR" && b.doctorId !== null && b.doctorId !== ctx.userId) return null;
  return {
    id: b.id,
    titulo: v.title,
    inicio: b.startsAt.toISOString(),
    fin: b.endsAt.toISOString(),
    diaCompleto: v.allDay,
    doctorId: b.doctorId,
    doctorNombre: b.doctor ? `${b.doctor.firstName ?? ""} ${b.doctor.lastName ?? ""}`.trim() || null : null,
    activo: b.deletedAt === null,
    citaId: v.appointmentId ?? null,
  };
}

/** Los títulos de varios bloqueos GOOGLE (para pintar la rejilla). Nunca lanza. */
export async function titulosDeBloqueosGoogle(clinicId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!idValido(clinicId) || ids.length === 0) return out;
  try {
    if (!(await tablasGoogleListas())) return out;
    const filas = await prisma.agendaBlockGoogle.findMany({
      where: { clinicId, blockId: { in: ids } },
      select: { blockId: true, title: true },
    });
    for (const f of filas) out.set(f.blockId, f.title);
  } catch (e) {
    console.error("[google-entrante] no se pudieron leer los títulos:", (e as any)?.message ?? e);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// EL AVISO DE LA CITA CONVERTIDA
// ═══════════════════════════════════════════════════════════════════════

export interface AvisoCitaDTO {
  tipo: "movido" | "eliminado";
  /** Solo en «movido»: la hora nueva del evento en Google (ISO). */
  inicio: string | null;
  fin: string | null;
}

/** El aviso vigente de la cita, o null. Nunca lanza. */
export async function avisoDeCitaGoogle(clinicId: string, appointmentId: string): Promise<AvisoCitaDTO | null> {
  if (!idValido(clinicId) || !idValido(appointmentId)) return null;
  try {
    if (!(await tablasGoogleListas())) return null;
    const v = await prisma.agendaBlockGoogle.findFirst({
      where: { clinicId, appointmentId },
      select: { avisoTipo: true, avisoStartsAt: true, avisoEndsAt: true, avisoDescartadoAt: true },
    });
    if (!v?.avisoTipo) return null;
    const cita = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: { status: true, startsAt: true, endsAt: true },
    });
    const a: AvisoVigente | null = avisoVigente(v, cita);
    if (!a) return null;
    return a.tipo === "movido"
      ? { tipo: "movido", inicio: a.inicio.toISOString(), fin: a.fin.toISOString() }
      : { tipo: "eliminado", inicio: null, fin: null };
  } catch (e) {
    console.error("[google-entrante] no se pudo leer el aviso:", (e as any)?.message ?? e);
    return null;
  }
}

/**
 * «Mantener la cita»: el aviso se descarta y la cita se vuelve a copiar a
 * Google con SU hora (el evento movido vuelve a la hora de la cita; el
 * eliminado se restaura). DaleControl manda. Devuelve si había aviso.
 */
export async function descartarAvisoDeCitaGoogle(clinicId: string, appointmentId: string): Promise<boolean> {
  if (!idValido(clinicId) || !idValido(appointmentId)) return false;
  if (!(await tablasGoogleListas())) return false;
  const r = await prisma.agendaBlockGoogle.updateMany({
    where: { clinicId, appointmentId, avisoTipo: { not: null }, avisoDescartadoAt: null },
    data: { avisoDescartadoAt: new Date() },
  });
  return r.count > 0;
}
