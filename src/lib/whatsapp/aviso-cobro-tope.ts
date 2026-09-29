// Avisos de cobro por WhatsApp — el TOPE de un aviso por teléfono cada 24 h (ws1-t10,
// pendientes del reporte). Dos piezas, sin cambio de esquema:
//
//  1. `ultimoAvisoDeCobro`: cuándo salió el último aviso de cobro a ese teléfono, venga de
//     donde venga — el aviso de la factura y el recordatorio de Alertas (`payment_notice`)
//     Y el aviso AUTOMÁTICO de mensualidad (fila `PAYMENT_DUE` de la cola de recordatorios,
//     que sale con `kind: "reminder"` y por eso el tope por tipo no lo veía).
//  2. `reservarAvisoDeCobro`: «comprobar y luego enviar» dejaba pasar dos envíos a la vez
//     (dos clics, dos pestañas). Aquí se RESERVA antes de enviar: un candado de Postgres
//     (`pg_advisory_xact_lock`, por clínica+teléfono) serializa la comprobación y deja una
//     marca en la bitácora (`audit_logs`); quien llegue mientras haya una reserva viva (90 s)
//     no envía. La transacción es CORTA (solo candado + lectura + escritura de la marca):
//     con `connection_limit=1` una transacción abierta durante el envío bloquearía las
//     demás consultas. La marca se libera con otra fila (la bitácora no se borra).
//     Es insert-only: nada se borra.

import { prisma } from "@/lib/prisma";
import { digitsLast10 } from "@/lib/inbox/send-core";
import { lastSentOfKind } from "@/lib/orthodontics/whatsapp-dedupe";

export const COBRANZA_AUTOMATICA_TYPE = "PAYMENT_DUE";
export const ENTIDAD_RESERVA = "aviso_cobro";
export const VIGENCIA_RESERVA_MS = 90_000;
const VENTANA_MS = 24 * 60 * 60 * 1000;

/** El aviso AUTOMÁTICO de mensualidad que ya salió a ese teléfono en las últimas 24 h, o null. Nunca lanza. */
export async function avisoAutomaticoDeCobroReciente(
  clinicId: string,
  phone: string,
  ahora: Date = new Date(),
  db: Pick<typeof prisma, "whatsAppReminder"> = prisma,
): Promise<Date | null> {
  const ultimos = digitsLast10(phone);
  if (!clinicId || ultimos.length < 7) return null;
  try {
    const fila = await db.whatsAppReminder.findFirst({
      where: {
        clinicId,
        type: COBRANZA_AUTOMATICA_TYPE,
        status: "SENT",
        patientPhone: { endsWith: ultimos },
        sentAt: { gte: new Date(ahora.getTime() - VENTANA_MS) },
      },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    return fila?.sentAt ?? null;
  } catch {
    return null;
  }
}

/** El más reciente de todos los avisos de cobro a ese teléfono (manual, de Alertas o automático). */
export async function ultimoAvisoDeCobro(clinicId: string, phone: string, ahora: Date = new Date()): Promise<Date | null> {
  const [manual, automatico] = await Promise.all([
    lastSentOfKind(clinicId, phone, "payment_notice", ahora).catch(() => null),
    avisoAutomaticoDeCobroReciente(clinicId, phone, ahora),
  ]);
  if (manual && automatico) return manual > automatico ? manual : automatico;
  return manual ?? automatico;
}

/** El más reciente entre varios teléfonos (paciente y responsable de pago). */
export async function ultimoAvisoDeCobroEnTelefonos(clinicId: string, telefonos: string[], ahora: Date = new Date()): Promise<Date | null> {
  const todos = await Promise.all(telefonos.map((t) => ultimoAvisoDeCobro(clinicId, t, ahora)));
  return todos.reduce<Date | null>((mas, d) => (d && (!mas || d > mas) ? d : mas), null);
}

/** La clave de un teléfono para el candado y la marca: los últimos 10 dígitos. */
export function clavePorTelefono(telefonos: string[]): string[] {
  return Array.from(new Set(telefonos.map((t) => digitsLast10(t)).filter((d) => d.length >= 7))).sort();
}

/** Lo mínimo de Prisma que usa la reserva (para probarla con un doble). */
export interface DbReserva {
  $transaction<T>(fn: (tx: TxReserva) => Promise<T>, opts?: { maxWait?: number; timeout?: number }): Promise<T>;
  auditLog: { createMany(args: any): Promise<unknown> };
}
export interface TxReserva {
  $executeRaw(query: any, ...values: any[]): Promise<unknown>;
  auditLog: {
    findFirst(args: any): Promise<{ action: string; createdAt: Date } | null>;
    createMany(args: any): Promise<unknown>;
  };
}

export type ResultadoReserva = { ok: true; liberar: () => Promise<void> } | { ok: false };

/**
 * Reserva el envío de UN aviso de cobro a esos teléfonos. `ok: false` = ya hay otro envío en
 * curso (reserva viva de menos de 90 s): quien llama NO envía. Si la bitácora o el candado
 * fallan, NO se bloquea el envío (mejor el tope de antes que dejar a la clínica sin cobrar):
 * devuelve `ok: true` sin marca.
 */
export async function reservarAvisoDeCobro(
  args: { clinicId: string; userId: string; telefonos: string[]; ahora?: Date },
  db: DbReserva = prisma as unknown as DbReserva,
): Promise<ResultadoReserva> {
  const claves = clavePorTelefono(args.telefonos);
  if (!args.clinicId || claves.length === 0) return { ok: true, liberar: async () => {} };
  const ahora = args.ahora ?? new Date();
  try {
    const libre = await db.$transaction(
      async (tx) => {
        // Orden fijo (claves ya ordenadas): dos avisos a los mismos teléfonos no se cruzan en un abrazo mortal.
        for (const k of claves) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`aviso-cobro:${args.clinicId}:${k}`}))`;
        }
        for (const k of claves) {
          const ultima = await tx.auditLog.findFirst({
            where: { clinicId: args.clinicId, entityType: ENTIDAD_RESERVA, entityId: k },
            orderBy: { createdAt: "desc" },
            select: { action: true, createdAt: true },
          });
          if (ultima && ultima.action === "reserva" && ahora.getTime() - ultima.createdAt.getTime() < VIGENCIA_RESERVA_MS) return false;
        }
        await tx.auditLog.createMany({
          data: claves.map((k) => ({ clinicId: args.clinicId, userId: args.userId, entityType: ENTIDAD_RESERVA, entityId: k, action: "reserva" })),
        });
        return true;
      },
      { maxWait: 8000, timeout: 8000 },
    );
    if (!libre) return { ok: false };
  } catch (e) {
    console.warn("[aviso-cobro] no se pudo reservar el envío (se envía sin reserva):", e);
    return { ok: true, liberar: async () => {} };
  }
  return {
    ok: true,
    liberar: async () => {
      try {
        await db.auditLog.createMany({
          data: claves.map((k) => ({ clinicId: args.clinicId, userId: args.userId, entityType: ENTIDAD_RESERVA, entityId: k, action: "libre" })),
        });
      } catch (e) {
        console.warn("[aviso-cobro] no se pudo liberar la reserva (caduca sola a los 90 s):", e);
      }
    },
  };
}
