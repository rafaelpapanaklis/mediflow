// ═══════════════════════════════════════════════════════════════════════════
// Cancelación ante el SAT, sincronía con Facturapi y nota de crédito — lo que
// habla con Facturapi y con la base (ws1-t3). Las reglas están en
// cfdi-cancelacion.ts; el SQL crudo en cfdi-cancelacion-db.ts.
//
// Modelo: la cancelación del instituto (src/lib/edu/facturacion.ts,
// `cancelEduInvoice`): reserva atómica ANTES de hablar con el SAT, «rechazó» y
// «no contestó» no son lo mismo, nada se borra y todo queda en la bitácora.
// Diferencia a propósito: aquí un `pending` NO se da por cancelado — el CFDI
// sigue vigente hasta que el receptor acepta (o vence el plazo).
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import {
  cancelInvoice, createInvoice, llaveQueVeElCfdi, FORMAS_PAGO_SAT,
  type FacturapiInvoiceState, type InvoiceResult,
} from "@/lib/facturapi";
import { pudoHaberTimbrado } from "@/lib/invoices/cfdi-timbre-incierto";
import { cfdiPeriodFor } from "@/lib/cfdi-quota";
import { round2 } from "@/lib/invoice-totals";
import {
  efectoDeEstado, soltarFacturaAlCancelar, validarCancelacion, validarNotaCredito,
  efectoNotaEnFactura, conceptoNotaDeCredito, modoIvaDeConceptos, usoParaEgreso,
  validarSustitucion, prediccionAceptacion, fueraDePlazoDeCancelacion, disponibleParaNota,
  MENSAJES_ERROR_CANCELACION, MENSAJES_ERROR_NOTA, MENSAJES_ERROR_SUSTITUCION,
  type MotivoCancelacion, type EfectoEstado,
} from "./cfdi-cancelacion";
import {
  columnasCfdi, leerCfdi, egresosVigentesDe, reservarCancelacion, soltarReserva,
  marcarIncierta, aplicarEstado, registrarRelacion, marcarRevisado, cfdisDeFactura, marcarSustituido,
  SQL_CANCELACION, type CfdiFila, type ResultadoAplicar,
} from "./cfdi-cancelacion-db";

export interface Respuesta<T = Record<string, unknown>> {
  status: number;
  body: T & { error?: string; code?: string };
}

const sqlPendiente = (): Respuesta => ({
  status: 503,
  body: {
    error: `Para cancelar CFDI o emitir notas de crédito desde DaleControl falta pegar ${SQL_CANCELACION} en la base. Mientras tanto, sigue el procedimiento manual (cancelar en el panel de Facturapi y luego «Consultar estado en el SAT» aquí).`,
    code: "SQL_PENDIENTE",
  },
});

// ── Dependencias (se doblan en las pruebas) ─────────────────────────────────

export interface DepsCancelacion {
  columnas: typeof columnasCfdi;
  leerCfdi: typeof leerCfdi;
  egresosVigentesDe: typeof egresosVigentesDe;
  reservar: typeof reservarCancelacion;
  soltarReserva: typeof soltarReserva;
  marcarIncierta: typeof marcarIncierta;
  aplicarEstado: typeof aplicarEstado;
  marcarRevisado: typeof marcarRevisado;
  llave: typeof llaveQueVeElCfdi;
  cancelar: typeof cancelInvoice;
  orgDeClinica: (clinicId: string) => Promise<{ orgId: string | null; timezone: string | null }>;
  cfdiUuidDeFactura: (clinicId: string, invoiceId: string) => Promise<{ cfdiUuid: string | null; patientId: string | null; invoiceNumber: string | null } | null>;
  ahora: () => Date;
}

const DEPS: DepsCancelacion = {
  columnas: columnasCfdi,
  leerCfdi,
  egresosVigentesDe,
  reservar: reservarCancelacion,
  soltarReserva,
  marcarIncierta,
  aplicarEstado,
  marcarRevisado,
  llave: llaveQueVeElCfdi,
  cancelar: cancelInvoice,
  orgDeClinica: async (clinicId) => {
    const c = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { facturApiOrgId: true, timezone: true } });
    return { orgId: c?.facturApiOrgId ?? null, timezone: c?.timezone ?? null };
  },
  cfdiUuidDeFactura: async (clinicId, invoiceId) => {
    const f = await prisma.invoice.findFirst({
      where: { id: invoiceId, clinicId },
      select: { cfdiUuid: true, patientId: true, invoiceNumber: true },
    });
    return f ? { cfdiUuid: f.cfdiUuid, patientId: f.patientId, invoiceNumber: f.invoiceNumber } : null;
  },
  ahora: () => new Date(),
};

function deps(over?: Partial<DepsCancelacion>): DepsCancelacion {
  return over ? { ...DEPS, ...over } : DEPS;
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Lo que la pantalla necesita para pintar el estado de un CFDI. */
export function vistaDeCfdi(c: CfdiFila, extra?: { timeZone?: string | null; ahora?: Date }) {
  const ahora = extra?.ahora ?? new Date();
  const tz = extra?.timeZone || "America/Mexico_City";
  return {
    id: c.id,
    uuid: c.uuid,
    tipoComprobante: c.tipoComprobante,
    total: c.total,
    status: c.status,
    paymentId: c.paymentId,
    createdAt: c.createdAt.toISOString(),
    cancelledAt: c.cancelledAt ? c.cancelledAt.toISOString() : null,
    cancellationStatus: c.cancellationStatus,
    cancelMotive: c.cancelMotive,
    cancelReason: c.cancelReason,
    cancelRequestedAt: c.cancelRequestedAt ? c.cancelRequestedAt.toISOString() : null,
    substitutedByUuid: c.substitutedByUuid,
    relatedUuid: c.relatedUuid,
    relationType: c.relationType,
    refundPaymentId: c.refundPaymentId,
    satCheckedAt: c.satCheckedAt ? c.satCheckedAt.toISOString() : null,
    receptorRfc: typeof c.receptor?.rfc === "string" ? c.receptor.rfc : null,
    aceptacion: prediccionAceptacion({
      total: c.total, tipoComprobante: c.tipoComprobante, receptorRfc: c.receptor?.rfc,
      emitidoEn: c.createdAt, ahora, timeZone: tz,
    }),
    fueraDePlazo: fueraDePlazoDeCancelacion(c.createdAt, ahora, tz),
  };
}

// ── Sincronizar un CFDI con Facturapi ───────────────────────────────────────

export interface ResultadoSincronia extends ResultadoAplicar {
  encontrado: boolean;
  efecto: EfectoEstado | null;
  ambiente: "live" | "test" | null;
}

/**
 * Lee el estado del CFDI en Facturapi y lo deja en `cfdi_records` (y suelta la
 * factura interna si quedó cancelado). Lo usan «Consultar estado en el SAT», el
 * webhook y el cron. Nunca confía en un estado que le pasen: siempre pregunta.
 */
export async function sincronizarCfdi(
  cfdi: CfdiFila,
  over?: Partial<DepsCancelacion>,
): Promise<ResultadoSincronia> {
  const d = deps(over);
  const org = await d.orgDeClinica(cfdi.clinicId);
  const nada: ResultadoSincronia = { encontrado: false, efecto: null, ambiente: null, recienCancelado: false, facturaLiberada: false };
  if (!org.orgId || !cfdi.facturapiId || cfdi.facturapiId.startsWith("reservando:")) return nada;
  const llave = await d.llave(org.orgId, cfdi.facturapiId);
  if (!llave) {
    await d.marcarRevisado(prisma, { clinicId: cfdi.clinicId, cfdiId: cfdi.id }).catch(() => undefined);
    return nada;
  }
  const efecto = efectoDeEstado(llave.estado);
  const factura = cfdi.invoiceId ? await d.cfdiUuidDeFactura(cfdi.clinicId, cfdi.invoiceId) : null;
  const r = await d.aplicarEstado({
    cfdi,
    efecto,
    soltarFactura: soltarFacturaAlCancelar({
      tipoComprobante: cfdi.tipoComprobante, paymentId: cfdi.paymentId, uuid: cfdi.uuid,
      invoiceCfdiUuid: factura?.cfdiUuid ?? null,
    }),
  });
  return { encontrado: true, efecto, ambiente: llave.ambiente, ...r };
}

// ── Pedir la cancelación ────────────────────────────────────────────────────

export interface PedirCancelacion {
  clinicId: string;
  userId: string;
  cfdiId: string;
  motive: unknown;
  reason: unknown;
  sustitutoCfdiId?: unknown;
}

export interface ResultadoCancelacion {
  cfdiId: string;
  uuid: string;
  invoiceId: string | null;
  patientId: string | null;
  invoiceNumber: string | null;
  motive: MotivoCancelacion;
  reason: string;
  sustitutoUuid: string | null;
  efecto: EfectoEstado;
  facturaLiberada: boolean;
}

/**
 * Pide al SAT (vía Facturapi) la cancelación de un CFDI de la clínica.
 * Devuelve el estado en el que quedó: cancelado ya, pendiente de que el
 * receptor acepte, o verificando.
 */
export async function pedirCancelacion(
  p: PedirCancelacion,
  over?: Partial<DepsCancelacion>,
): Promise<Respuesta<{ resultado?: ResultadoCancelacion }>> {
  const d = deps(over);
  if (!p.clinicId || !p.cfdiId) return { status: 400, body: { error: "Falta el CFDI que se va a cancelar." } };
  const col = await d.columnas(prisma);
  if (!col.cancelacion) return sqlPendiente();

  const cfdi = await d.leerCfdi(prisma, { clinicId: p.clinicId, cfdiId: p.cfdiId });
  if (!cfdi) return { status: 404, body: { error: "CFDI no encontrado." } };

  const org = await d.orgDeClinica(p.clinicId);
  if (!org.orgId) {
    return { status: 409, body: { error: "La clínica no tiene organización en Facturapi: no se puede cancelar desde aquí." } };
  }

  const sustitutoId = typeof p.sustitutoCfdiId === "string" && p.sustitutoCfdiId.trim() ? p.sustitutoCfdiId.trim() : null;
  const sustituto = p.motive === "01" && sustitutoId
    ? await d.leerCfdi(prisma, { clinicId: p.clinicId, cfdiId: sustitutoId })
    : null;
  const egresos = cfdi.tipoComprobante === "I" ? await d.egresosVigentesDe(prisma, { clinicId: p.clinicId, uuid: cfdi.uuid }) : [];

  const ahora = d.ahora();
  const err = validarCancelacion({
    motive: p.motive, reason: p.reason, cfdi: { ...cfdi, receptorRfc: cfdi.receptor?.rfc ?? null },
    sustituto, egresosVigentes: egresos.length, ahora,
  });
  if (err) {
    const status = err === "MOTIVO_INVALIDO" || err === "RAZON_CORTA" || err === "FALTA_SUSTITUTO" ? 400 : 409;
    return { status, body: { error: MENSAJES_ERROR_CANCELACION[err], code: err } };
  }
  const motive = p.motive as MotivoCancelacion;
  const reason = String(p.reason).trim().slice(0, 300);

  // ¿Quién lo ve, y cómo está HOY? Si ya se canceló desde el dashboard de
  // Facturapi (lo único posible hasta hoy), no se manda otra cancelación: se
  // sincroniza y se dice.
  let llave: Awaited<ReturnType<typeof llaveQueVeElCfdi>>;
  try {
    llave = await d.llave(org.orgId, cfdi.facturapiId);
  } catch (e) {
    return { status: 502, body: { error: `No se pudo consultar el CFDI en Facturapi: ${mensajeDe(e)}` } };
  }
  if (!llave) {
    return { status: 409, body: { error: "Facturapi no encuentra este CFDI con las llaves de la clínica. Revísalo con soporte antes de cancelarlo." } };
  }
  const yaHoy = efectoDeEstado(llave.estado);
  if (yaHoy.status === "cancelled" || yaHoy.cancellationStatus === "pending" || yaHoy.cancellationStatus === "verifying") {
    const factura = cfdi.invoiceId ? await d.cfdiUuidDeFactura(p.clinicId, cfdi.invoiceId) : null;
    const r = await d.aplicarEstado({
      cfdi, efecto: yaHoy,
      soltarFactura: soltarFacturaAlCancelar({ tipoComprobante: cfdi.tipoComprobante, paymentId: cfdi.paymentId, uuid: cfdi.uuid, invoiceCfdiUuid: factura?.cfdiUuid ?? null }),
    });
    return {
      status: 409,
      body: {
        error: yaHoy.status === "cancelled"
          ? "Este CFDI ya estaba cancelado ante el SAT (se canceló por fuera de DaleControl). Ya quedó al día aquí."
          : "Este CFDI ya tiene una cancelación en curso ante el SAT (pedida por fuera de DaleControl). Ya quedó al día aquí.",
        code: "YA_CANCELADO_FUERA",
        ...(r.facturaLiberada ? { facturaLiberada: true } : {}),
      },
    };
  }

  // ── El candado, ANTES de hablar con el SAT ──────────────────────────────
  const reservado = await d.reservar(prisma, {
    clinicId: p.clinicId, cfdiId: cfdi.id, motive, reason, userId: p.userId,
    sustitutoUuid: motive === "01" ? sustituto!.uuid : null,
  });
  if (!reservado) {
    return { status: 409, body: { error: MENSAJES_ERROR_CANCELACION.EN_CURSO, code: "EN_CURSO" } };
  }

  let resp: FacturapiInvoiceState;
  try {
    resp = await d.cancelar(llave.key, cfdi.facturapiId, motive, motive === "01" ? sustituto!.uuid : null);
  } catch (e) {
    if (pudoHaberTimbrado(e)) {
      await d.marcarIncierta(prisma, { clinicId: p.clinicId, cfdiId: cfdi.id }).catch((e2) =>
        console.error("[cfdi:cancelacion] no se pudo marcar incierta:", { cfdiId: cfdi.id, e2 }));
      return {
        status: 502,
        body: {
          error: `La cancelación se mandó y la conexión se cortó: NO se sabe si llegó al SAT. No la vuelvas a pedir: usa «Consultar estado en el SAT» en unos minutos. (${mensajeDe(e)})`,
          code: "CANCELACION_INCIERTA",
        },
      };
    }
    await d.soltarReserva(prisma, { clinicId: p.clinicId, cfdiId: cfdi.id }).catch((e2) =>
      console.error("[cfdi:cancelacion] rechazo y no se pudo soltar la reserva:", { cfdiId: cfdi.id, e2 }));
    return { status: 422, body: { error: `El SAT o Facturapi rechazaron la cancelación: ${mensajeDe(e)}`, code: "CANCELACION_RECHAZADA" } };
  }

  const efecto = efectoDeEstado(resp);
  const factura = cfdi.invoiceId ? await d.cfdiUuidDeFactura(p.clinicId, cfdi.invoiceId) : null;
  let aplicado: ResultadoAplicar = { recienCancelado: false, facturaLiberada: false };
  try {
    aplicado = await d.aplicarEstado({
      cfdi, efecto,
      soltarFactura: soltarFacturaAlCancelar({ tipoComprobante: cfdi.tipoComprobante, paymentId: cfdi.paymentId, uuid: cfdi.uuid, invoiceCfdiUuid: factura?.cfdiUuid ?? null }),
    });
  } catch (e) {
    // La cancelación YA se pidió ante el SAT. No se tumba la respuesta: el cron
    // y «Consultar estado» la dejan al día.
    console.error("[cfdi:cancelacion] cancelada ante el SAT pero no guardada:", { cfdiId: cfdi.id, uuid: cfdi.uuid, e });
  }

  return {
    status: 200,
    body: {
      resultado: {
        cfdiId: cfdi.id, uuid: cfdi.uuid, invoiceId: cfdi.invoiceId,
        patientId: factura?.patientId ?? null, invoiceNumber: factura?.invoiceNumber ?? null,
        motive, reason, sustitutoUuid: motive === "01" ? sustituto!.uuid : null,
        efecto, facturaLiberada: aplicado.facturaLiberada,
      },
    },
  };
}

// ── Sustitución (motivo 01): lo que necesita POST /api/cfdi ──────────────────

/**
 * Para timbrar el CFDI que SUSTITUYE a otro en la misma factura. POST /api/cfdi
 * lo llama solo cuando viene `sustituyeCfdiId`. Devuelve el CFDI viejo (cuyo
 * UUID va como relación 04 y es el `cfdiUuid` con el que se aparta la factura)
 * o la respuesta de error.
 */
export async function prepararSustitucion(args: {
  clinicId: string; invoiceId: string; invoiceCfdiUuid: string | null; sustituyeCfdiId: unknown;
}): Promise<
  | { ok: true; viejo: CfdiFila; status?: undefined; error?: undefined; code?: undefined }
  | { ok: false; viejo?: undefined; status: number; error: string; code: string }
> {
  const col = await columnasCfdi(prisma);
  if (!col.cancelacion) {
    const r = sqlPendiente();
    return { ok: false, status: r.status, error: r.body.error!, code: r.body.code! };
  }
  const id = typeof args.sustituyeCfdiId === "string" ? args.sustituyeCfdiId.trim() : "";
  const viejo = id ? await leerCfdi(prisma, { clinicId: args.clinicId, cfdiId: id }) : null;
  const err = validarSustitucion({ invoiceId: args.invoiceId, invoiceCfdiUuid: args.invoiceCfdiUuid, viejo });
  if (err) return { ok: false, status: 409, error: MENSAJES_ERROR_SUSTITUCION[err], code: `SUSTITUCION_${err}` };
  return { ok: true, viejo: viejo! };
}

/**
 * Con el sustituto YA timbrado y ANTES de guardar su fila: el viejo pasa a
 * 'sustituido' (sigue vigente ante el SAT hasta que se cancele con motivo 01).
 * Así el índice «un ingreso vigente por factura» deja guardar el nuevo. Nunca lanza.
 */
export async function antesDeGuardarSustituto(args: { clinicId: string; viejoCfdiId: string; nuevoUuid: string }): Promise<void> {
  await marcarSustituido(prisma, { clinicId: args.clinicId, cfdiId: args.viejoCfdiId, nuevoUuid: args.nuevoUuid });
}

/** Después de timbrar el sustituto: deja escrita la relación 04 (la exige la cancelación con motivo 01). */
export async function registrarSustituto(args: { clinicId: string; nuevoCfdiId: string; viejoUuid: string }): Promise<void> {
  const ok = await registrarRelacion(prisma, {
    clinicId: args.clinicId, cfdiId: args.nuevoCfdiId, relatedUuid: args.viejoUuid, relationType: "04",
  }).catch((e) => {
    console.error("[cfdi:sustitucion] no se pudo registrar la relación 04:", { ...args, e });
    return false;
  });
  if (!ok) console.error("[cfdi:sustitucion] relación 04 sin registrar:", args);
}

// ── Nota de crédito (CFDI de egreso, relación 01) ───────────────────────────

export interface PedirNotaCredito {
  clinicId: string;
  userId: string;
  cfdiId: string;
  monto: unknown;
  razon: unknown;
  devolverDinero: boolean;
  formaPago: unknown;
  metodoDevolucion?: unknown;
}

const CLAIM_NOTA = "reservando:nota:";

/**
 * Timbra una nota de crédito sobre un CFDI de ingreso vigente y deja la
 * factura interna coherente (total −monto y, si se devolvió dinero, un
 * reembolso por el monto). Ver `efectoNotaEnFactura`.
 *
 * Orden, como el timbrado de ingreso:
 *   1. validar todo sin hablar con nadie;
 *   2. APARTAR la nota (una fila 'apartado' con el monto) dentro de un candado
 *      de transacción por CFDI, para que dos notas a la vez no pasen las dos el
 *      «disponible»;
 *   3. timbrar en Facturapi (tipo E, relación 01 al UUID original);
 *   4. en UNA transacción: la fila pasa a 'valid', el reembolso, la factura y
 *      el cupo de timbres.
 */
export async function emitirNotaDeCredito(p: PedirNotaCredito): Promise<Respuesta<Record<string, unknown>>> {
  const col = await columnasCfdi(prisma);
  if (!col.cancelacion) return sqlPendiente();

  const cfdi = await leerCfdi(prisma, { clinicId: p.clinicId, cfdiId: p.cfdiId });
  if (!cfdi || !cfdi.invoiceId) return { status: 404, body: { error: "CFDI no encontrado." } };

  const factura = await prisma.invoice.findFirst({
    where: { id: cfdi.invoiceId, clinicId: p.clinicId },
    select: {
      id: true, status: true, subtotal: true, discount: true, total: true, paid: true, balance: true,
      taxRate: true, taxIncluded: true, patientId: true, invoiceNumber: true,
    },
  });
  if (!factura) return { status: 404, body: { error: "La factura de ese CFDI no existe." } };

  const formaPago = typeof p.formaPago === "string" ? p.formaPago.trim() : "";
  if (!FORMAS_PAGO_SAT.some((f) => f.clave === formaPago)) {
    return { status: 400, body: { error: "Elige la forma de pago de la nota de crédito (cómo se devolvió o aplicó el dinero)." } };
  }

  const egresos = await egresosVigentesDe(prisma, { clinicId: p.clinicId, uuid: cfdi.uuid });
  const monto = round2(Number(p.monto));
  const err = validarNotaCredito({
    monto, razon: p.razon, cfdi, egresosVigentes: egresos.map((e) => e.total),
    factura, devolverDinero: p.devolverDinero,
  });
  if (err) return { status: err === "MONTO_INVALIDO" || err === "RAZON_CORTA" ? 400 : 409, body: { error: MENSAJES_ERROR_NOTA[err], code: err } };
  const razon = String(p.razon).trim().slice(0, 300);

  const clinic = await prisma.clinic.findUnique({ where: { id: p.clinicId }, select: { facturApiOrgId: true, timezone: true } });
  if (!clinic?.facturApiOrgId) return { status: 409, body: { error: "La clínica no tiene organización en Facturapi." } };

  let llave: Awaited<ReturnType<typeof llaveQueVeElCfdi>>;
  try {
    llave = await llaveQueVeElCfdi(clinic.facturApiOrgId, cfdi.facturapiId);
  } catch (e) {
    return { status: 502, body: { error: `No se pudo consultar el CFDI en Facturapi: ${mensajeDe(e)}` } };
  }
  if (!llave?.estado.customerId) {
    return { status: 409, body: { error: "Facturapi no encuentra este CFDI (o su receptor) con las llaves de la clínica." } };
  }
  if (efectoDeEstado(llave.estado).status !== "valid" || llave.estado.cancellationStatus === "pending") {
    return { status: 409, body: { error: "Ese CFDI ya no está vigente en el SAT (o tiene una cancelación en curso). Usa «Consultar estado en el SAT».", code: "NO_VIGENTE" } };
  }

  // ── 2. Apartar, serializado por CFDI ────────────────────────────────────
  const claim = `${CLAIM_NOTA}${cfdi.id}:${crypto.randomUUID()}`;
  const notaId = crypto.randomUUID();
  const apartada = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cfdi-nota:" + cfdi.id}))`;
    const filas = await tx.$queryRaw<{ suma: unknown }[]>`
      SELECT COALESCE(SUM("total"), 0) AS suma FROM "cfdi_records"
       WHERE "clinicId" = ${p.clinicId} AND "tipoComprobante" = 'E'
         AND "relatedUuid" = ${cfdi.uuid} AND "status" IN ('valid', 'apartado')`;
    const usado = Number(filas[0]?.suma ?? 0);
    if (monto > disponibleParaNota(cfdi.total, [usado]) + 0.001) return false;
    await tx.$executeRaw`
      INSERT INTO "cfdi_records"
        ("id", "clinicId", "invoiceId", "facturapiId", "uuid", "tipoComprobante", "receptor", "conceptos",
         "total", "status", "createdAt", "relatedUuid", "relationType")
      VALUES (${notaId}, ${p.clinicId}, ${cfdi.invoiceId}, ${claim}, ${claim}, 'E',
              ${JSON.stringify(cfdi.receptor ?? {})}::jsonb, '[]'::jsonb, ${monto}, 'apartado',
              CURRENT_TIMESTAMP, ${cfdi.uuid}, '01')`;
    return true;
  });
  if (!apartada) return { status: 409, body: { error: MENSAJES_ERROR_NOTA.EXCEDE_CFDI, code: "EXCEDE_CFDI" } };

  // ── 3. Timbrar ───────────────────────────────────────────────────────────
  const concepto = conceptoNotaDeCredito({
    monto,
    modoIva: modoIvaDeConceptos(cfdi.conceptos),
    descripcion: `${p.devolverDinero ? "Devolución" : "Descuento / bonificación"}: ${razon}`,
  });
  let timbrado: InvoiceResult;
  try {
    timbrado = await createInvoice({
      orgApiKey: llave.key,
      customerId: llave.estado.customerId,
      usoCfdi: usoParaEgreso(cfdi.receptor?.regimenFiscal, llave.estado.use),
      paymentForm: formaPago,
      paymentMethod: "PUE",
      items: [concepto],
      tipo: "E",
      relatedDocuments: [{ relationship: "01", documents: [cfdi.uuid] }],
      exigirUuid: true,
    });
  } catch (e) {
    if (pudoHaberTimbrado(e)) {
      // El apartado SE QUEDA: no se sabe si la nota salió. Bloquea otra nota
      // por ese mismo dinero hasta que soporte lo revise en Facturapi.
      console.error("[cfdi:nota] no se sabe si la nota de crédito salió — el apartado se queda:", { notaId, cfdiId: cfdi.id, e: mensajeDe(e) });
      return { status: 503, body: { error: "No se sabe si la nota de crédito se timbró (la conexión se cortó). No la vuelvas a emitir: escríbenos a soporte con el folio de la factura.", code: "NOTA_INCIERTA" } };
    }
    await prisma.$executeRaw`DELETE FROM "cfdi_records" WHERE "id" = ${notaId} AND "status" = 'apartado' AND "uuid" = ${claim}`
      .catch((e2) => console.error("[cfdi:nota] no se pudo soltar el apartado:", { notaId, e2 }));
    return { status: 422, body: { error: `Facturapi rechazó la nota de crédito: ${mensajeDe(e)}`, code: "NOTA_RECHAZADA" } };
  }

  // ── 4. Guardar todo junto ───────────────────────────────────────────────
  // 🔴 Desde aquí la nota YA existe ante el SAT: nada puede tumbar la respuesta
  // sin dejar el UUID escrito.
  const period = cfdiPeriodFor(new Date(), clinic.timezone);
  const metodo = typeof p.metodoDevolucion === "string" && p.metodoDevolucion.trim() ? p.metodoDevolucion.trim().slice(0, 40) : null;
  let aviso: string | null = null;
  let refundPaymentId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "cfdi_records"
           SET "uuid" = ${timbrado.uuid}, "facturapiId" = ${timbrado.id},
               "conceptos" = ${JSON.stringify([concepto])}::jsonb, "total" = ${Number(timbrado.total ?? monto)},
               "status" = 'valid', "xmlUrl" = ${timbrado.xml_url ?? null}, "pdfUrl" = ${timbrado.pdf_url ?? null}
         WHERE "id" = ${notaId} AND "status" = 'apartado' AND "uuid" = ${claim}`;

      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${factura.id} FOR UPDATE`;
      const fresca = await tx.invoice.findFirst({
        where: { id: factura.id, clinicId: p.clinicId },
        select: { status: true, subtotal: true, discount: true, total: true, paid: true, balance: true, taxRate: true, taxIncluded: true },
      });
      const efecto = fresca ? efectoNotaEnFactura(fresca, monto, p.devolverDinero) : null;
      if (!efecto || !efecto.ok) {
        aviso = `La nota de crédito se timbró, pero la factura interna cambió mientras tanto y no se ajustó (${efecto && !efecto.ok ? MENSAJES_ERROR_NOTA[efecto.error] : "no se encontró"}). Revísala.`;
      } else {
        if (p.devolverDinero) {
          const pago = await tx.payment.create({
            data: {
              invoiceId: factura.id, amount: monto, method: "refund",
              notes: `Nota de crédito ${timbrado.uuid}: ${razon}${metodo ? ` · devuelto por ${metodo}` : ""}`.slice(0, 500),
            },
            select: { id: true },
          });
          refundPaymentId = pago.id;
          await tx.$executeRaw`UPDATE "cfdi_records" SET "refundPaymentId" = ${pago.id} WHERE "id" = ${notaId}`;
        }
        await tx.invoice.updateMany({
          where: { id: factura.id, clinicId: p.clinicId },
          data: {
            total: efecto.total, discount: efecto.discount, paid: efecto.paid, balance: efecto.balance,
            status: efecto.status,
            ...(efecto.status !== "PAID" ? { paidAt: null } : {}),
          },
        });
      }
      await tx.cfdiUsage.upsert({
        where: { clinicId_period: { clinicId: p.clinicId, period } },
        create: { clinicId: p.clinicId, period, stamped: 1 },
        update: { stamped: { increment: 1 } },
      });
    });
  } catch (e) {
    console.error("[cfdi:nota] nota de crédito timbrada pero no guardada completa:", {
      clinicId: p.clinicId, notaId, uuid: timbrado.uuid, facturapiId: timbrado.id, e,
    });
    await prisma.$executeRaw`
      UPDATE "cfdi_records" SET "uuid" = ${timbrado.uuid}, "facturapiId" = ${timbrado.id}, "status" = 'valid'
       WHERE "id" = ${notaId} AND "uuid" = ${claim}`.catch(() => undefined);
    return {
      status: 500,
      body: {
        error: `La nota de crédito SÍ se timbró (UUID ${timbrado.uuid}), pero no se pudo ajustar la factura interna. No la vuelvas a emitir: escríbenos a soporte con este UUID.`,
        code: "NOTA_TIMBRADA_SIN_GUARDAR", uuid: timbrado.uuid,
      },
    };
  }

  // El método por el que salió el dinero, si la columna de reembolsos ya existe
  // (sql/payment-refund-method.sql, de otra pantalla). Nunca tumba nada.
  if (refundPaymentId && metodo) await guardarMetodoDeReembolso(refundPaymentId, metodo);

  return {
    status: 200,
    body: {
      notaId, uuid: timbrado.uuid, total: timbrado.total ?? monto, refundPaymentId,
      invoiceId: factura.id, patientId: factura.patientId, invoiceNumber: factura.invoiceNumber,
      monto, razon, devolverDinero: p.devolverDinero, cfdiOriginalUuid: cfdi.uuid,
      ...(aviso ? { warning: aviso } : {}),
    },
  };
}

async function guardarMetodoDeReembolso(paymentId: string, metodo: string): Promise<void> {
  try {
    const f = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = current_schema() AND table_name = 'payments'
                        AND column_name = 'refundMethod') AS existe`;
    if (f[0]?.existe !== true) return;
    await prisma.$executeRaw`UPDATE "payments" SET "refundMethod" = ${metodo} WHERE "id" = ${paymentId}`;
  } catch (e) {
    console.warn("[cfdi:nota] no se pudo guardar el método del reembolso:", e);
  }
}

// ── Lo que pinta la pantalla de una factura ─────────────────────────────────

export async function cfdisDeLaFactura(args: { clinicId: string; invoiceId: string; timeZone?: string | null }) {
  const col = await columnasCfdi(prisma);
  const filas = await cfdisDeFactura(prisma, { clinicId: args.clinicId, invoiceId: args.invoiceId });
  const ahora = new Date();
  return {
    listo: col.cancelacion,
    sqlPendiente: col.cancelacion ? null : SQL_CANCELACION,
    cfdis: filas
      .filter((f) => f.status !== "apartado" && !f.uuid.startsWith("reservando:"))
      .map((f) => vistaDeCfdi(f, { timeZone: args.timeZone, ahora })),
  };
}

