import "server-only";
// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA — EL TOPE DE GASTO. Es la pieza obligatoria del módulo.
//
// Sin tope, UNA inmobiliaria vacía el presupuesto de IA de todas en una
// tarde. El patrón es el del bot de barber (spentMicros por día y por
// tenant), con DOS diferencias que importan:
//
//   1. NO HAY TABLA NUEVA. El schema no se toca en esta ola, así que la
//      bitácora vive en `RealtyAdminAction` — la misma mesa que ya usan T2
//      (config de ruteo) y T3 (idempotencia del correo entrante). Tiene
//      accountId, un `action` para filtrar, un `payload` Json y
//      @@index([accountId, createdAt]), que es justo la consulta que hace
//      falta: "cuánto gastó esta cuenta hoy".
//
//   2. 🔴 SE RESERVA ANTES DE GASTAR. El bot de barber lee el gasto, llama
//      al modelo y apunta después. Esa ventana es inofensiva a fracciones
//      de centavo por turno; a ~$0.19 por imagen NO lo es: diez pestañas
//      apretando "generar" a la vez pasan las diez la misma comprobación y
//      gastan diez veces. Aquí se apunta el cargo ANTES de llamar al
//      proveedor y luego se corrige con el costo real. Si la llamada
//      truena, la reserva se libera.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import { startOfDayInTz } from "@/lib/realty/whatsapp-core";
import {
  buildStudioSpend,
  dailyCapMicros,
  monthAnchorUtc,
  studioFits,
  type Micros,
  type StudioSpendDTO,
} from "@/lib/realty/studio/pricing";
import type { RealtyStudioKind } from "@/lib/realty/studio/types";

/**
 * El `action` con el que se marcan las filas del estudio. Prefijo propio
 * para no chocar con las de T2/T3 en la misma tabla.
 */
export const STUDIO_USAGE_ACTION = "realty_studio_usage";

interface UsagePayload {
  kind: RealtyStudioKind;
  micros: number;
  propertyId?: string | null;
  propertyTitle?: string | null;
  detail?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** true mientras es una reserva sin confirmar. */
  pending?: boolean;
}

/** Medianoche de HOY en la zona de la CUENTA, no la del servidor. */
function dayStartFor(timezone: string): Date {
  // En Vercel el servidor corre en UTC: con su medianoche, el tope de una
  // inmobiliaria de Guadalajara se reiniciaría a las 6 de la tarde.
  return startOfDayInTz(new Date(), timezone || "America/Mexico_City");
}

/** Medianoche del día 1 del mes, también en la zona de la CUENTA. */
function monthStartFor(timezone: string): Date {
  const tz = timezone || "America/Mexico_City";
  // El ancla (mediodía UTC del día 1 local) y luego la misma bajada a
  // medianoche que usa el día. Ver monthAnchorUtc para el porqué.
  return startOfDayInTz(monthAnchorUtc(new Date(), tz), tz);
}

async function sumMicrosSince(accountId: string, since: Date): Promise<Micros> {
  const rows = await prisma.realtyAdminAction.findMany({
    where: { accountId, action: STUDIO_USAGE_ACTION, createdAt: { gte: since } },
    select: { payload: true },
    take: 5000,
  });
  let total = 0;
  for (const r of rows) {
    const p = r.payload as unknown as UsagePayload | null;
    const m = Number(p?.micros);
    if (Number.isFinite(m) && m > 0) total += m;
  }
  return Math.round(total);
}

/**
 * Cuánto lleva gastado la cuenta hoy y cuánto le queda.
 *
 * 🔴 SI NO SE PUEDE LEER, NO SE GASTA. Un fallo de base devuelve el tope
 * como gastado, no cero. Devolver cero dejaría la IA sin freno justo cuando
 * el sistema está peor — la misma asimetría que el bot de barber (su
 * `readSpendMicros` devuelve Infinity si no hay tabla).
 */
export async function getStudioSpend(
  accountId: string,
  timezone: string,
): Promise<StudioSpendDTO> {
  const cap = dailyCapMicros();
  const dayStart = dayStartFor(timezone);
  const resetsAt = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  try {
    const [spent, month] = await Promise.all([
      sumMicrosSince(accountId, dayStart),
      sumMicrosSince(accountId, monthStartFor(timezone)),
    ]);
    return buildStudioSpend({ spentMicros: spent, capMicros: cap, monthMicros: month, resetsAt });
  } catch (e) {
    console.error("[realty/studio] no se pudo leer el gasto:", e);
    return buildStudioSpend({
      spentMicros: cap, // fail-closed: sin medición, no se gasta
      capMicros: cap,
      monthMicros: 0,
      resetsAt,
    });
  }
}

export interface StudioReservation {
  /** Id de la fila de reserva. Se confirma o se libera con él. */
  id: string;
}

/**
 * Reserva presupuesto ANTES de llamar al proveedor.
 *
 * Devuelve null si la cuenta ya está en el tope. El cargo se apunta con el
 * costo ESTIMADO; después se corrige al real con `settleStudioSpend` (el de
 * texto se sabe por los tokens que devuelve el modelo; el de imagen no se
 * sabe nunca, así que se queda el estimado).
 *
 * Esto NO es un candado: dos peticiones simultáneas pueden reservar a la vez
 * y pasarse del tope por el costo de UNA generación. Lo que sí impide —y es
 * lo que importa— es que diez simultáneas se pasen por diez, porque la
 * segunda ya ve la reserva de la primera.
 */
export async function reserveStudioSpend(args: {
  accountId: string;
  timezone: string;
  kind: RealtyStudioKind;
  estimatedMicros: Micros;
  propertyId?: string | null;
  propertyTitle?: string | null;
  detail?: string;
}): Promise<StudioReservation | null> {
  const spend = await getStudioSpend(args.accountId, args.timezone);
  if (!studioFits(spend.spentMicros, spend.capMicros)) return null;

  const payload: UsagePayload = {
    kind: args.kind,
    micros: Math.max(0, Math.round(args.estimatedMicros)),
    propertyId: args.propertyId ?? null,
    propertyTitle: args.propertyTitle ?? null,
    detail: args.detail ?? "",
    pending: true,
  };

  try {
    const row = await prisma.realtyAdminAction.create({
      data: {
        accountId: args.accountId,
        action: STUDIO_USAGE_ACTION,
        payload: payload as unknown as object,
      },
      select: { id: true },
    });
    return { id: row.id };
  } catch (e) {
    // Si no se puede apuntar la reserva, NO se gasta: sin registro no hay
    // tope, y sin tope no hay módulo.
    console.error("[realty/studio] no se pudo reservar el gasto:", e);
    return null;
  }
}

/**
 * Confirma la reserva con el costo REAL. Si no llega `actualMicros` se deja
 * el estimado. Nunca lanza: el trabajo ya se hizo y ya se pagó, así que un
 * fallo aquí no puede tumbar la respuesta.
 */
export async function settleStudioSpend(args: {
  reservation: StudioReservation;
  actualMicros?: Micros;
  detail?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  try {
    const row = await prisma.realtyAdminAction.findUnique({
      where: { id: args.reservation.id },
      select: { payload: true },
    });
    const prev = (row?.payload as unknown as UsagePayload | null) ?? null;
    if (!prev) return;
    const next: UsagePayload = {
      ...prev,
      pending: false,
      micros:
        args.actualMicros != null && Number.isFinite(args.actualMicros)
          ? Math.max(0, Math.round(args.actualMicros))
          : prev.micros,
      ...(args.detail ? { detail: args.detail } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.inputTokens != null ? { inputTokens: args.inputTokens } : {}),
      ...(args.outputTokens != null ? { outputTokens: args.outputTokens } : {}),
    };
    await prisma.realtyAdminAction.update({
      where: { id: args.reservation.id },
      data: { payload: next as unknown as object },
    });
  } catch (e) {
    console.error("[realty/studio] no se pudo confirmar el gasto:", e);
  }
}

/**
 * Libera una reserva cuando la generación FALLÓ.
 *
 * Se borra la fila: cobrarle a la cuenta un intento que no le dio nada es
 * la clase de detalle que hace que alguien deje de usar la función.
 */
export async function releaseStudioSpend(reservation: StudioReservation): Promise<void> {
  try {
    await prisma.realtyAdminAction.delete({ where: { id: reservation.id } });
  } catch (e) {
    console.error("[realty/studio] no se pudo liberar la reserva:", e);
  }
}

/**
 * Lo generado por esta cuenta, para el panel. Lo más nuevo primero.
 *
 * Con `propertyId` se recorta a UN inmueble, que es como el asesor lo mira:
 * "¿qué le he hecho ya a esta casa?". El filtro se aplica en memoria y NO en
 * la consulta porque el propertyId vive DENTRO del payload Json, y filtrar
 * por una ruta de Json ata esta lectura a Postgres y a la forma exacta del
 * objeto. Para eso se leen más filas y se recortan aquí: son 400 filas de un
 * `action` propio, con el índice ([accountId, createdAt]) haciendo el
 * trabajo, y el tope diario impide de raíz que una cuenta genere miles.
 */
export async function listStudioItems(accountId: string, limit = 40, propertyId?: string | null) {
  try {
    const rows = await prisma.realtyAdminAction.findMany({
      where: { accountId, action: STUDIO_USAGE_ACTION },
      orderBy: { createdAt: "desc" },
      take: propertyId ? 400 : Math.min(Math.max(1, limit), 200),
      select: { id: true, payload: true, createdAt: true },
    });
    const vistos = propertyId
      ? rows.filter((r) => {
          const p = r.payload as unknown as UsagePayload | null;
          return p?.propertyId === propertyId;
        })
      : rows;
    return vistos.slice(0, Math.min(Math.max(1, limit), 200)).map((r) => {
      const p = (r.payload as unknown as UsagePayload | null) ?? ({} as UsagePayload);
      return {
        id: r.id,
        kind: (p.kind ?? "description") as RealtyStudioKind,
        propertyId: p.propertyId ?? null,
        propertyTitle: p.propertyTitle ?? null,
        micros: Number(p.micros) || 0,
        createdAt: r.createdAt.toISOString(),
        detail: p.detail ?? "",
      };
    });
  } catch (e) {
    console.error("[realty/studio] no se pudo leer el historial:", e);
    return [];
  }
}
