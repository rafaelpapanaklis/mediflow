// ═══════════════════════════════════════════════════════════════════════════
// Aceptar un presupuesto por concepto y CARGAR desde él (ws1-t6). Los usan:
//   · POST /api/quotes/[id]/status  action "accept" + itemIds  (panel)
//   · POST /api/presupuesto/[token]  + itemIds                 (liga pública)
//   · POST /api/quotes/[id]/cargos                             («Se cobrará hoy»)
//   · POST /api/quotes/[id]/invoice                            («Generar factura»
//     de siempre y Sabina: con la función encendida, carga lo pendiente)
// Las reglas viven en aceptacion.ts; aquí solo la transacción y la bitácora.
// clinicId SIEMPRE de la sesión (o del presupuesto leído por su token público).
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { clinicInvoiceTaxDefaults } from "@/lib/invoice-totals";
import {
  InvoiceNumberExhaustedError,
  nextInvoiceNumber,
  withInvoiceNumberRetry,
} from "@/lib/invoices/next-invoice-number";
import { aplicarSaldoAFavor } from "@/lib/patient-credit-aplicar";
import { invoiceFieldsFromQuote } from "./invoice-from-quote-core";
import { doctorDeLaFactura } from "./doctor-de-la-factura";
import { InvoiceFolioError, serializeInvoice } from "./create-invoice-from-quote";
import {
  aceptacionImplicita,
  armarAceptacion,
  cargosDeFacturaVieja,
  conceptosParaFactura,
  elegirConceptos,
  estadoDeCobro,
  netoDe,
  planearCargo,
  resumirAceptacion,
  type CargoVivo,
  type CobroDePresupuesto,
  type PlanDeCargo,
  type RenglonAceptado,
  type ViaAceptacion,
} from "./aceptacion";
import {
  aceptacionEncendida,
  guardarAceptacion,
  insertarCargos,
  leerAceptaciones,
  leerCargos,
} from "./aceptacion-db";
import type { BillingInvoiceLite } from "./types";

type Tx = Prisma.TransactionClient;

/** Error con el código HTTP que debe devolver la ruta. */
export class PresupuestoError extends Error {
  readonly http: number;
  constructor(mensaje: string, http = 409) {
    super(mensaje);
    this.name = "PresupuestoError";
    this.http = http;
  }
}

const dinero = (v: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);

/* ── Aceptar ──────────────────────────────────────────────────────────── */

/**
 * Pasa el presupuesto a ACEPTADO con los conceptos elegidos. Con la función
 * apagada (sin el SQL) solo admite «todos» —lo de siempre— y rechaza una
 * selección parcial con un mensaje claro en vez de aceptar de más.
 *
 * Re-lee el presupuesto con FOR UPDATE: dos «Aceptar» a la vez (panel y liga)
 * no dejan dos aceptaciones distintas; el segundo ve ACCEPTED y recibe 409.
 */
export async function aceptarPresupuesto(args: {
  quoteId: string;
  clinicId: string;
  userId: string | null;
  via: ViaAceptacion;
  itemIds: unknown;
  /** Solo la liga pública: path de la firma ya subida. */
  signatureUrl?: string | null;
  /** Estados desde los que se acepta (el panel admite DRAFT y EXPIRED; la liga solo PRESENTED). */
  desde: string[];
}): Promise<{ status: string; renglones: RenglonAceptado[] | null }> {
  const encendida = await aceptacionEncendida();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "quotes" WHERE id = ${args.quoteId} AND "clinicId" = ${args.clinicId} FOR UPDATE`;
    const q = await tx.quote.findFirst({
      where: { id: args.quoteId, clinicId: args.clinicId },
      select: {
        status: true, discountAmount: true,
        items: { select: { id: true, name: true, toothFdi: true, quantity: true, unitPrice: true, discount: true, lineTotal: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!q) throw new PresupuestoError("Presupuesto no encontrado", 404);
    if (q.status === "ACCEPTED") throw new PresupuestoError("El presupuesto ya fue aceptado");
    if (q.status === "REJECTED") throw new PresupuestoError("El presupuesto fue rechazado");
    if (args.desde.indexOf(q.status) === -1) {
      throw new PresupuestoError("El presupuesto no está disponible para aceptar");
    }

    const eleccion = elegirConceptos(q.items, args.itemIds);
    if (!eleccion.ok) throw new PresupuestoError(eleccion.error, 400);
    const parcial = eleccion.ids.length < q.items.length;
    if (parcial && !encendida) {
      throw new PresupuestoError(
        "La aceptación por concepto todavía no está disponible en esta clínica. Acepta el presupuesto completo o edítalo para dejar solo lo que se acepta.",
      );
    }

    await tx.quote.update({
      where: { id: args.quoteId },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        ...(args.signatureUrl !== undefined ? { signatureUrl: args.signatureUrl } : {}),
      },
    });
    if (!encendida) return { status: q.status, renglones: null };
    const renglones = armarAceptacion(q, eleccion.ids);
    await guardarAceptacion(tx, {
      quoteId: args.quoteId,
      clinicId: args.clinicId,
      renglones,
      via: args.via,
      userId: args.userId,
    });
    return { status: q.status, renglones };
  });
}

/** Frase de Movimientos al aceptar. */
export function fraseDeAceptacion(renglones: RenglonAceptado[] | null, total: number): string {
  if (!renglones) return "Marcó el presupuesto como aceptado";
  const r = resumirAceptacion(renglones, total);
  return r.alcance === "total"
    ? `Marcó el presupuesto como aceptado completo (${dinero(r.total)})`
    : `Marcó el presupuesto como aceptado en parte: ${r.aceptados} de ${r.conceptos} conceptos, ${dinero(r.total)} de ${dinero(total)}`;
}

/* ── Estado de cobro de un presupuesto (lectura) ─────────────────────── */

export interface QuoteParaCobro {
  id: string;
  folio: string;
  patientId: string;
  status: string;
  invoiceId: string | null;
  createdById?: string | null;
  total: unknown;
  discountAmount: unknown;
  items: Array<{ id: string; name: string; toothFdi: string | null; quantity: unknown; unitPrice: unknown; discount?: unknown; lineTotal?: unknown }>;
}

/**
 * Renglones + cargos vivos de UN presupuesto, con el cliente que se pase (la
 * tx al cargar). Sin renglones guardados → aceptación implícita completa.
 * Factura vieja sin cargos anotados → cuenta como todo cargado.
 */
export async function leerEstado(db: Tx | typeof prisma, clinicId: string, q: QuoteParaCobro) {
  const [acc, cargos] = [
    await leerAceptaciones(db, clinicId, [q.id]),
    await leerCargos(db, clinicId, [q.id]),
  ];
  if (acc.fallo || cargos.fallo) {
    throw new PresupuestoError("No se pudo leer qué se ha cargado de este presupuesto. Intenta de nuevo.", 503);
  }
  const renglones = acc.porQuote.get(q.id)?.renglones ?? aceptacionImplicita(q);
  let vivos: CargoVivo[] = cargos.porQuote.get(q.id) ?? [];
  if (vivos.length === 0 && q.invoiceId) {
    const vieja = await db.invoice.findFirst({
      where: { id: q.invoiceId, clinicId, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (vieja) vivos = cargosDeFacturaVieja(renglones, vieja.id);
  }
  return { renglones, vivos };
}

/* ── Cargar ───────────────────────────────────────────────────────────── */

export interface ResultadoCargo {
  invoice: BillingInvoiceLite;
  plan: PlanDeCargo;
}

/**
 * Crea UNA factura PENDIENTE con los conceptos aceptados elegidos y/o el abono,
 * y anota sus renglones en quote_charges. Todo en una transacción con el
 * presupuesto bloqueado: dos «Cargar» a la vez (dos pestañas, Sabina) no cargan
 * dos veces el mismo concepto — el segundo re-lee los cargos y recibe 409.
 *
 * `todoLoPendiente`: el «Generar factura» de siempre (y Sabina) con la función
 * encendida — carga todos los conceptos aceptados que falten, nada más.
 */
export async function cargarDesdePresupuesto(args: {
  quote: QuoteParaCobro;
  clinicId: string;
  userId: string;
  itemIds?: unknown;
  abono?: unknown;
  todoLoPendiente?: boolean;
}): Promise<ResultadoCargo> {
  const { quote: q, clinicId, userId } = args;
  if (q.status !== "ACCEPTED") throw new PresupuestoError("Solo se carga un presupuesto aceptado");

  const clinicTax = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { cfdiTaxMode: true } });
  const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(clinicTax?.cfdiTaxMode);
  const creadorEsDoctor = q.createdById
    ? (await prisma.user.findFirst({
        where: { id: q.createdById, clinicId, role: "DOCTOR" },
        select: { id: true },
      })) !== null
    : false;
  const doctor = doctorDeLaFactura(q.createdById ?? null, creadorEsDoctor);

  let resultado: { row: any; plan: PlanDeCargo };
  try {
    resultado = await withInvoiceNumberRetry(() =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "quotes" WHERE id = ${q.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
        const fresco = await tx.quote.findFirst({
          where: { id: q.id, clinicId },
          select: { invoiceId: true, status: true },
        });
        if (!fresco) throw new PresupuestoError("Presupuesto no encontrado", 404);
        if (fresco.status !== "ACCEPTED") throw new PresupuestoError("Solo se carga un presupuesto aceptado");
        const { renglones, vivos } = await leerEstado(tx, clinicId, { ...q, invoiceId: fresco.invoiceId });

        const itemIds = args.todoLoPendiente
          ? estadoDeCobro(renglones, vivos).pendientes.map((r) => r.quoteItemId)
          : args.itemIds;
        const plan = planearCargo(renglones, vivos, {
          itemIds,
          abono: args.todoLoPendiente ? 0 : args.abono,
          etiquetaAbono: `Abono al presupuesto ${q.folio}`,
        });
        if (!plan.ok) throw new PresupuestoError(plan.error);

        const { items, subtotal, discount, total } = invoiceFieldsFromQuote(conceptosParaFactura(plan.plan));
        const creada = await tx.invoice.create({
          data: {
            clinicId,
            patientId: q.patientId,
            invoiceNumber: await nextInvoiceNumber(clinicId, tx),
            items: items as unknown as Prisma.InputJsonValue,
            subtotal,
            discount,
            total,
            paid: 0,
            balance: total,
            status: "PENDING",
            notes: `Cargo del presupuesto ${q.folio}`,
            taxRate,
            taxIncluded,
            doctorId: doctor,
          },
        });
        await insertarCargos(tx, {
          clinicId,
          quoteId: q.id,
          invoiceId: creada.id,
          userId,
          lineas: plan.plan.lineas,
        });
        // La primera factura queda también en quotes.invoiceId: así «Facturado»,
        // Sabina y la tarjeta de siempre siguen viendo el vínculo.
        if (!fresco.invoiceId) {
          await tx.quote.updateMany({ where: { id: q.id, clinicId }, data: { invoiceId: creada.id } });
        }
        return { row: { ...creada, payments: [] }, plan: plan.plan };
      }),
    );
  } catch (e) {
    if (e instanceof InvoiceNumberExhaustedError) throw new InvoiceFolioError();
    throw e;
  }

  let row = resultado.row;
  const saldo = await aplicarSaldoAFavor({ clinicId, invoiceId: row.id, userId, origen: "creada" });
  if (saldo.aplicado > 0) {
    const releida = await prisma.invoice.findFirst({ where: { id: row.id, clinicId }, include: { payments: true } });
    if (releida) row = releida;
  }

  const conceptos = resultado.plan.lineas.filter((l) => l.tipo === "concepto").map((l) => l.name);
  const abono = resultado.plan.lineas.find((l) => l.tipo === "abono");
  const que = [
    conceptos.length ? conceptos.join(", ") : "",
    abono ? `abono de ${dinero(abono.monto)}` : "",
  ].filter(Boolean).join(" y ");
  await logAudit({
    clinicId,
    userId,
    patientId: q.patientId,
    texto: `Cargó ${dinero(resultado.plan.total)} del presupuesto ${q.folio} (${que}) en la factura ${row.invoiceNumber}; quedan ${dinero(resultado.plan.quedaPorCargar)} por cargar`,
    entityType: "invoice",
    entityId: row.id,
    action: "create",
    changes: {
      fromQuote: { before: null, after: q.folio },
      cargo: { before: null, after: resultado.plan.total },
      ...(saldo.aplicado > 0 ? { anticipoAplicado: { before: null, after: saldo.aplicado } } : {}),
    },
  });

  return { invoice: serializeInvoice(row), plan: resultado.plan };
}

/* ── Resumen para la lista del panel ─────────────────────────────────── */


/**
 * El resumen de aceptación y cobro de varios presupuestos para GET
 * /api/quotes, en DOS consultas (no una por presupuesto). Solo los ACEPTADOS
 * lo llevan. Sin la función, mapa vacío.
 */
export async function cobrosDePresupuestos(
  clinicId: string,
  quotes: QuoteParaCobro[],
): Promise<Map<string, CobroDePresupuesto>> {
  const salida = new Map<string, CobroDePresupuesto>();
  const aceptados = quotes.filter((q) => q.status === "ACCEPTED");
  if (aceptados.length === 0 || !(await aceptacionEncendida())) return salida;
  const ids = aceptados.map((q) => q.id);
  const acc = await leerAceptaciones(prisma, clinicId, ids);
  const cargos = await leerCargos(prisma, clinicId, ids);
  // Sin poder leer, mejor no decir nada que decir «nada cargado»: la tarjeta
  // queda como siempre y el diálogo de cargo vuelve a leer al abrir.
  if (acc.fallo || cargos.fallo) return salida;
  const viejas = aceptados.filter((q) => q.invoiceId && !(cargos.porQuote.get(q.id)?.length));
  const vivasViejas = viejas.length
    ? new Set(
        (await prisma.invoice.findMany({
          where: { clinicId, id: { in: viejas.map((q) => q.invoiceId!) }, status: { not: "CANCELLED" } },
          select: { id: true },
        })).map((i) => i.id),
      )
    : new Set<string>();
  for (const q of aceptados) {
    const guardada = acc.porQuote.get(q.id);
    const renglones = guardada?.renglones ?? aceptacionImplicita(q);
    const lista = cargos.porQuote.get(q.id) ?? [];
    const vivos: CargoVivo[] = lista.length
      ? lista
      : q.invoiceId && vivasViejas.has(q.invoiceId) ? cargosDeFacturaVieja(renglones, q.invoiceId) : [];
    const est = estadoDeCobro(renglones, vivos);
    const res = resumirAceptacion(renglones, Number(q.total) || 0);
    salida.set(q.id, {
      encendida: true,
      alcance: res.alcance,
      via: guardada?.via ?? null,
      aceptados: renglones.filter((r) => r.aceptado).map((r) => r.quoteItemId),
      totalAceptado: est.totalAceptado,
      noAceptado: res.noAceptado,
      cargado: est.cargado,
      porCargar: est.porCargar,
      cargados: est.cargados,
      cargos: lista.map((c) => ({
        invoiceId: c.invoiceId, invoiceNumber: c.invoiceNumber, status: c.status,
        monto: c.monto, tipo: c.tipo, quoteItemId: c.quoteItemId,
      })),
      renglones: renglones.map((r) => ({
        quoteItemId: r.quoteItemId,
        aceptado: r.aceptado,
        nombre: r.nombre,
        neto: r.aceptado ? netoDe(r) : r.importe,
      })),
    });
  }
  return salida;
}

/**
 * Conceptos que de verdad aceptó el paciente, para quien arma algo a partir del
 * presupuesto (plan de tratamiento, alta de ortodoncia). Sin renglones = todos.
 */
export async function conceptosAceptados<T extends { id: string }>(
  clinicId: string,
  quoteId: string,
  items: T[],
): Promise<T[]> {
  const acc = await leerAceptaciones(prisma, clinicId, [quoteId]);
  const guardada = acc.porQuote.get(quoteId);
  if (!guardada) return items;
  const si = new Set(guardada.renglones.filter((r) => r.aceptado).map((r) => r.quoteItemId));
  return items.filter((i) => si.has(i.id));
}
