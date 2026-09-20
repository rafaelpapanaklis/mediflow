// ═══════════════════════════════════════════════════════════════════════════
// EL BARRIDO DEL AVISO DE MENSUALIDAD (ws1-t3) — shell con I/O.
//
// Corre una vez al día desde /api/cron/payment-reminders. Para cada clínica que
// lo tenga ENCENDIDO, encola un WhatsAppReminder por cada mensualidad que está
// por vencer. El envío real lo hace la cola de siempre
// (/api/cron/whatsapp-queue → queue-worker), que ya sabe de la ventana de 24 h
// de Meta y de las plantillas: aquí no se manda ni un mensaje.
//
// ── Apagado por defecto ───────────────────────────────────────────────────
// Sin `reminderSettings.cobranza.enabled` guardado, esta clínica no aparece en
// el barrido y no sale NI UNO. No es un detalle de implementación: cada
// plantilla fuera de la ventana de 24 h cuesta dinero, y una mensualidad por
// vencer casi nunca cae dentro de esa ventana.
//
// ── Idempotencia, que es el otro requisito duro ───────────────────────────
// Si el cron corre dos veces, el paciente recibe UN mensaje. Cómo:
//   1. Cada aviso lleva una llave determinista (factura|cuota|vencimiento) que
//      viaja en `payload.dedupeKey` — el mismo sitio y el mismo espíritu que
//      `dedupeKey` en las notificaciones del portal (@@unique([patientId,
//      dedupeKey])).
//   2. ANTES de encolar se leen las llaves ya encoladas de esa clínica y se
//      descartan en `core.ts` (`yaAvisado`).
//   3. Dentro de la misma corrida tampoco se repite (`core.ts` lo controla).
//
// ⚠️ La garantía es por CONSULTA PREVIA, no por restricción de la base:
// `whatsapp_reminders` no tiene un índice único sobre esa llave y añadirlo
// sería tocar el schema, que está fuera de esta tarea. Dos corridas
// EXACTAMENTE simultáneas del mismo cron podrían colarse entre la lectura y el
// insert. En la práctica Vercel no dispara el mismo cron dos veces a la vez, y
// el `claim-then-send` del queue-worker tapa el otro lado; queda anotado en el
// reporte como lo que falta para que sea una garantía de base de datos.
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  COBRANZA_MAX_PER_CLINIC,
  getCobranzaSettings,
  renderCobranzaMessage,
} from "@/lib/reminders/config";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import { dinero } from "@/lib/quotes/condiciones-pago";
import { avisosDeCobranza, type MotivoDescarte } from "./core";
import { cargarFacturasCandidatas } from "./datos";

/** Tipo de WhatsAppReminder de este aviso. La cola lo envía como texto legacy. */
export const COBRANZA_TYPE = "PAYMENT_DUE";

/**
 * Hasta dónde mira atrás el dedupe. Seis meses: el aviso sale días antes del
 * vencimiento, así que nada que importe queda fuera, y la consulta deja de
 * crecer sin límite con los años.
 */
export const DEDUPE_VENTANA_MS = 180 * 24 * 60 * 60 * 1000;

export interface CobranzaClinicResult {
  clinicId: string;
  candidatas: number;
  encolados: number;
  descartados: number;
  /** Cuántos cayeron por cada motivo (para que el log diga algo útil). */
  motivos: Partial<Record<MotivoDescarte, number>>;
}

export interface CobranzaSweepSummary {
  clinics: number;
  candidatas: number;
  encolados: number;
  descartados: number;
  perClinic: CobranzaClinicResult[];
}

interface SweepClinic {
  id: string;
  name: string;
  timezone: string;
  reminderSettings: unknown;
}

/** "YYYY-MM-DD" en el día de la CLÍNICA, no en el del servidor. */
export function hoyEnZona(now: Date, timezone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return p; // en-CA da directamente "YYYY-MM-DD"
}

/** «3 de marzo de 2026», para que lo lea un paciente en el teléfono. */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(a, (m || 1) - 1, d || 1)));
}

/** Procesa UNA clínica. Devuelve el conteo de la corrida. */
export async function sweepCobranzaClinica(
  clinic: SweepClinic,
  opts?: { now?: Date; cap?: number },
): Promise<CobranzaClinicResult> {
  const now = opts?.now ?? new Date();
  const res: CobranzaClinicResult = {
    clinicId: clinic.id,
    candidatas: 0,
    encolados: 0,
    descartados: 0,
    motivos: {},
  };

  const settings = getCobranzaSettings(clinic);
  // El interruptor, otra vez, y aquí es donde de verdad corta.
  if (!settings.enabled) return res;

  const hoy = hoyEnZona(now, clinic.timezone || "America/Mexico_City");
  const facturas = await cargarFacturasCandidatas(clinic.id);
  res.candidatas = facturas.length;
  if (facturas.length === 0) return res;

  // Las llaves que ya salieron (o están esperando su turno) de ESTA clínica.
  //
  // ⚠️ Solo cuentan PENDING y SENT. Una fila FAILED —el caso típico: la ventana
  // de 24 h estaba cerrada cuando la cola intentó enviarla— NO puede suprimir
  // el aviso para siempre: si mañana el paciente escribe a la clínica y la
  // ventana se abre, ese aviso tiene que poder volver a intentarse. Contar los
  // fallos como «ya avisado» dejaba el aviso muerto sin que nadie se enterara.
  //
  // Y se acota por fecha, como hace el barrido de recall: sin corte, esta
  // consulta se traería a memoria todos los avisos históricos de la clínica en
  // cada corrida. La ventana es holgada —el aviso sale pocos días antes del
  // vencimiento— y la llave lleva el vencimiento dentro, así que no se pierde
  // idempotencia real.
  const previos = await prisma.whatsAppReminder.findMany({
    where: {
      clinicId: clinic.id,
      type: COBRANZA_TYPE,
      status: { in: [WA_REMINDER_STATUS.PENDING, WA_REMINDER_STATUS.SENT] },
      createdAt: { gte: new Date(now.getTime() - DEDUPE_VENTANA_MS) },
    },
    select: { payload: true },
  });
  const yaAvisado = new Set<string>();
  previos.forEach((p) => {
    const k = (p.payload as Record<string, unknown> | null)?.dedupeKey;
    if (typeof k === "string") yaAvisado.add(k);
  });

  const { avisos, descartes } = avisosDeCobranza(facturas, {
    hoy,
    diasAntes: settings.diasAntes,
    yaAvisado,
    tope: opts?.cap ?? COBRANZA_MAX_PER_CLINIC,
  });

  res.descartados = descartes.length;
  descartes.forEach((d) => {
    res.motivos[d.motivo] = (res.motivos[d.motivo] ?? 0) + 1;
  });
  if (avisos.length === 0) return res;

  const filas = avisos.map((a) => ({
    clinicId: clinic.id,
    appointmentId: null,
    patientPhone: a.patientPhone,
    message: renderCobranzaMessage(settings.message, {
      nombre: a.patientNombre,
      clinica: clinic.name,
      importe: dinero(a.importe),
      fecha: fechaLarga(a.vencimiento),
      cuota: a.esEnganche ? "enganche" : String(a.numeroCuota),
      total: String(a.totalCuotas),
    }),
    type: COBRANZA_TYPE,
    status: WA_REMINDER_STATUS.PENDING,
    scheduledFor: now,
    // `dedupeKey` es lo que hace idempotente la corrida siguiente.
    // `installmentNumber` es el nombre que el propio schema puso de ejemplo
    // para este payload; se respeta para que la fila se lea igual desde fuera.
    payload: {
      kind: "cobranza",
      dedupeKey: a.dedupeKey,
      patientId: a.patientId,
      invoiceId: a.invoiceId,
      installmentNumber: a.numeroCuota,
      dueDate: a.vencimiento,
      amount: a.importe,
    },
  }));

  // Sin transacción (PgBouncer), en trozos, igual que el barrido de recall.
  const CHUNK = 500;
  for (let i = 0; i < filas.length; i += CHUNK) {
    await prisma.whatsAppReminder.createMany({ data: filas.slice(i, i + CHUNK) as never });
  }
  res.encolados = filas.length;
  return res;
}

/**
 * Barre TODAS las clínicas con el aviso encendido.
 *
 * Solo carga las que tienen `reminderSettings` y filtra en JS por
 * `cobranza.enabled` — mismo criterio que el barrido de recall, robusto ante la
 * semántica de los filtros JSON-path de Prisma.
 */
export async function sweepTodaLaCobranza(opts?: { now?: Date }): Promise<CobranzaSweepSummary> {
  const summary: CobranzaSweepSummary = {
    clinics: 0,
    candidatas: 0,
    encolados: 0,
    descartados: 0,
    perClinic: [],
  };

  const candidatas = await prisma.clinic.findMany({
    where: { reminderSettings: { not: Prisma.DbNull } },
    select: { id: true, name: true, timezone: true, reminderSettings: true },
  });
  const clinics = candidatas.filter((c) => getCobranzaSettings(c).enabled);
  summary.clinics = clinics.length;

  // Secuencial a propósito: una clínica rota no frena a las demás y el pooler
  // no ve más de una tanda a la vez.
  for (const c of clinics) {
    try {
      const r = await sweepCobranzaClinica(c, { now: opts?.now });
      summary.perClinic.push(r);
      summary.candidatas += r.candidatas;
      summary.encolados += r.encolados;
      summary.descartados += r.descartados;
    } catch (e) {
      console.error("[cobranza-sweep] clínica falló", c.id, e);
    }
  }
  return summary;
}
