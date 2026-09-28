// ═══════════════════════════════════════════════════════════════════════════
// De la base de datos a lo que entienden los núcleos puros (ws1-t3).
//
// UNA sola puerta para las dos mitades del encargo —el aviso que sale solo y el
// saldo que contesta el bot— para que no puedan discrepar: si el WhatsApp dice
// «cuota 7, $2,000», el bot dice exactamente lo mismo cuando le preguntan.
//
// Aquí no se decide nada: se lee. Quién merece aviso lo decide `core.ts`; qué
// se le contesta al paciente, `bot/saldo-core.ts`. La aritmética de plazos
// entera es de `lib/invoices/plan-de-pagos.ts` (ws1-t2).
//
// Multi-tenant: `clinicId` va en TODAS las consultas y sale siempre del
// contexto de servidor (cron o webhook resuelto), nunca de un cliente. Sin él
// no se consulta — `clinicId: undefined` no filtra nada.
// ═══════════════════════════════════════════════════════════════════════════

import { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import {
  calendarioDeCuotas,
  estadoDelPlan,
  pagosDesdeFilas,
} from "@/lib/invoices/plan-de-pagos";
import type { FacturaCandidata } from "./core";
import type { ResumenSaldo } from "@/lib/whatsapp/bot/saldo-core";

/**
 * Estados que ni se traen de la base. CANCELLED y PAID no se cobran, y DRAFT
 * todavía no se le ha enseñado al paciente. `core.ts` los vuelve a descartar
 * por su cuenta (con motivo) si llegan por otra vía: el filtro de aquí es
 * rendimiento, la regla vive allá.
 */
const ESTADOS_VIVOS: InvoiceStatus[] = [
  InvoiceStatus.PENDING,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
];

/** Tope de facturas por clínica y corrida: el pooler no es infinito. */
const MAX_FACTURAS = 500;

/**
 * Las facturas de la clínica que PODRÍAN generar aviso, ya con sus condiciones
 * y sus pagos. `patientId` acota a un solo paciente (lo usa el bot).
 */
export async function cargarFacturasCandidatas(
  clinicId: string,
  opts?: {
    patientId?: string;
    limite?: number;
    /**
     * ws1-t10 (H·F "Pausa"/"Abandono") — el barrido AUTOMÁTICO no debe seguir
     * insistiendo con la mensualidad de un caso pausado o abandonado. El bot
     * (`resumenDeSaldoDePaciente`, quien PREGUNTÓ) sigue sin este filtro: si
     * el paciente pregunta cuánto debe, la deuda real no se le esconde
     * porque la clínica dejó de perseguirla.
     */
    excluirPausadosOAbandonados?: boolean;
  },
): Promise<FacturaCandidata[]> {
  if (!clinicId) return [];

  const facturas = await prisma.invoice.findMany({
    where: {
      clinicId,
      status: { in: ESTADOS_VIVOS },
      ...(opts?.patientId ? { patientId: opts.patientId } : {}),
      // El paciente borrado no se cobra: se filtra EN LA BASE para no
      // arrastrar sus facturas por toda la corrida.
      patient: { deletedAt: null },
    },
    select: {
      id: true,
      status: true,
      total: true,
      patientId: true,
      patient: {
        select: { firstName: true, lastName: true, phone: true, status: true, deletedAt: true },
      },
      payments: { select: { amount: true, method: true } },
    },
    take: opts?.limite ?? MAX_FACTURAS,
    orderBy: { createdAt: "asc" },
  });
  if (facturas.length === 0) return [];

  // Las condiciones van en UNA consulta para todas (la tabla no está en Prisma;
  // se lee por SQL crudo y vuelve a cruzar contra invoices."clinicId").
  const [{ porFactura }, casosOrtoPorInvoiceId] = await Promise.all([
    leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds: facturas.map((f) => f.id) }),
    casosDeOrtodonciaPorInvoiceId(clinicId, facturas.map((f) => f.id)),
  ]);

  return facturas
    // ws1-t10 (H·F "Pausa"/"Abandono") — mientras el caso está PAUSADO o en
    // ABANDONO, el barrido automático no genera aviso de esta factura: antes
    // "las mensualidades siguen venciendo... y el aviso automático le sigue
    // llegando" aunque la clínica ya hubiera detenido la cobranza en la
    // pantalla del caso. Solo cubre la factura PRINCIPAL del plan (modo
    // PRECIO_TOTAL); las de «pago por control» no pasan por aquí.
    .filter((f) => {
      if (!opts?.excluirPausadosOAbandonados) return true;
      const estadoCaso = casosOrtoPorInvoiceId.get(f.id)?.status;
      return estadoCaso !== "ON_HOLD" && estadoCaso !== "DROPPED_OUT";
    })
    .map((f) => ({
      invoiceId: f.id,
      status: String(f.status),
      total: f.total,
      condiciones: porFactura.get(f.id) ?? null,
      // `pagosDesdeFilas` le pone el signo al reembolso: en `payments` un
      // reembolso es method "refund" con amount POSITIVO.
      pagos: pagosDesdeFilas(f.payments),
      patientId: f.patientId,
      patientNombre: (f.patient?.firstName || "").trim() || "paciente",
      // ws1-t10 (H·F "Menor con tutor") — si esta factura es la de un caso de
      // ortodoncia CON responsable de pago (Guardian, A11), el aviso de
      // cobranza va a SU teléfono, no al del niño: antes "los WhatsApp de
      // cobro van al teléfono del niño" pase lo que pase. Sin responsable (o
      // sin módulo de ortodoncia), tal cual como siempre: el teléfono del
      // paciente.
      patientPhone: casosOrtoPorInvoiceId.get(f.id)?.guardianPhone ?? f.patient?.phone ?? null,
      pacienteActivo: f.patient?.status === "ACTIVE",
      pacienteBorrado: !!f.patient?.deletedAt,
    }));
}

interface CasoOrtoDeInvoice {
  status: string;
  guardianPhone: string | null;
}

/**
 * `invoiceId` → estado del caso de ortodoncia y teléfono de su responsable de
 * pago, para las facturas que sean la principal de un plan. Best-effort: sin
 * el módulo de ortodoncia, sin caso ligado, o sin las columnas todavía
 * aplicadas, el mapa sale vacío y cada factura se trata como no-ortodoncia
 * (se avisa igual, y al teléfono del paciente).
 */
async function casosDeOrtodonciaPorInvoiceId(
  clinicId: string,
  invoiceIds: string[],
): Promise<Map<string, CasoOrtoDeInvoice>> {
  if (invoiceIds.length === 0) return new Map();
  try {
    const planes = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, invoiceId: { in: invoiceIds }, deletedAt: null },
      select: { invoiceId: true, status: true, responsibleGuardian: { select: { phone: true } } },
    });
    const salida = new Map<string, CasoOrtoDeInvoice>();
    for (const p of planes) {
      if (p.invoiceId) salida.set(p.invoiceId, { status: String(p.status), guardianPhone: p.responsibleGuardian?.phone ?? null });
    }
    return salida;
  } catch (e) {
    console.error("[whatsapp:cobranza] caso de ortodoncia no disponible todavía:", e);
    return new Map();
  }
}

/**
 * El resumen de dinero de UN paciente: la próxima cuota por vencer y lo que
 * falta. Es lo ÚNICO que el bot llega a decir.
 *
 * Con varios planes a plazos vivos (raro, pero pasa: dos tratamientos a
 * plazos), se anuncia la cuota que vence ANTES y se suma el pendiente de
 * todos: decir «te queda pendiente X en total» con el pendiente de un solo
 * plan sería mentir con la palabra «total» puesta.
 */
export async function resumenDeSaldoDePaciente(
  clinicId: string,
  patientId: string,
  hoy: string,
): Promise<ResumenSaldo | null> {
  if (!clinicId || !patientId) return null;

  const facturas = await cargarFacturasCandidatas(clinicId, { patientId });
  if (facturas.length === 0) return null;

  let mejor: ResumenSaldo | null = null;
  let pendienteTotal = 0;
  let algunaVencida = false;

  for (const f of facturas) {
    const cuotas = calendarioDeCuotas(f.condiciones, f.total);
    if (cuotas.length === 0) continue; // no es plan a plazos

    const estado = estadoDelPlan(cuotas, f.pagos, hoy);
    if (estado.pendiente <= 0) continue;

    pendienteTotal += estado.pendiente;
    if (estado.vencidas > 0) algunaVencida = true;

    const sig = estado.siguiente;
    if (!sig) continue;
    // Gana la que vence antes. Una cuota sin fecha no le gana a ninguna con
    // fecha, pero sirve si no hay ninguna otra.
    const mejorFecha = mejor?.vencimiento ?? null;
    const ganaPorFecha =
      mejor === null ||
      (sig.vencimiento !== null && (mejorFecha === null || sig.vencimiento < mejorFecha));
    if (ganaPorFecha) {
      mejor = {
        vencimiento: sig.vencimiento,
        importeCuota: sig.falta,
        numeroCuota: sig.numero,
        esEnganche: sig.esEnganche,
        totalCuotas: estado.totalCuotas,
        pendiente: 0, // se rellena abajo con la suma de todos
        tieneVencidas: false,
      };
    }
  }

  if (!mejor) {
    // Hay deuda pero ninguna cuota por vencer (todo vencido, o plan sin
    // fechas). No se inventa una próxima mensualidad que no existe.
    return null;
  }
  return { ...mejor, pendiente: redondea(pendienteTotal), tieneVencidas: algunaVencida };
}

/** Dos decimales: sumar pesos en coma flotante deja colas de centavos. */
function redondea(n: number): number {
  return Math.round(n * 100) / 100;
}
