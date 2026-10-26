// La NOTA DE COBRO del plan (ws1-t12 · P6) — el ejecutor. Las decisiones están en `cobro.ts`.
//
//  · `asegurarNotaDelPlan`: crea la nota (Invoice PENDIENTE ligada por `invoices."treatmentPlanId"`)
//    con una línea por fila, o le agrega las filas nuevas, o abre una nota ADICIONAL si la de antes
//    ya está pagada o timbrada. Idempotente: con el plan BLOQUEADO (FOR UPDATE) relee qué filas ya
//    tienen nota viva, así que dos clics a la vez (o la aceptación por la liga y el panel) no
//    cobran dos veces la misma fila. El anticipo / saldo a favor se aplica como hoy
//    (`aplicarSaldoAFavor`, origen «creada»), solo a la nota que nace.
//  · `leerCuentaDelPlan`: total / pagado / saldo del plan (lo que fue `pagosDelPlan`, commit
//    36c1cbf5), ahora sobre la nota ligada y, para planes de antes, sobre las facturas de sus
//    presupuestos.
//
// Sin el SQL (tabla de filas o columna de la nota) no hace nada: el plan cobra como hoy.
// Toda consulta lleva el `clinicId` de quien llama (sesión, o el del presupuesto leído por su liga).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { clinicInvoiceTaxDefaults, computeInvoiceTotal, round2, sumInvoiceItems } from "@/lib/invoice-totals";
import { nextInvoiceNumber, withInvoiceNumberRetry } from "@/lib/invoices/next-invoice-number";
import { aplicarSaldoAFavor } from "@/lib/patient-credit-aplicar";
import { invoiceFieldsFromQuote } from "@/lib/quotes/invoice-from-quote-core";
import { aceptacionEncendida, insertarCargos, leerCargos } from "@/lib/quotes/aceptacion-db";
import { leerEstado } from "@/lib/quotes/cargos.server";
import { aPesos, totalCentavos } from "./items";
import { bloquearPlan, columnaNotaDelPlanExiste, repoFilas, tablaDeFilasExiste, FilaError } from "./items-db";
import { cuentaDelPlan, planearNota, type CuentaDelPlan, type FacturaDeLaCuenta, type LineaDeNota, type NotaDelPlan, type PresupuestoDelPlan } from "./cobro";
import { corteDeVencido, deudaDeNotaDelPlan } from "./por-cobrar";
import { leerNotasDePlan } from "./por-cobrar-db";
import { DEFAULT_INVOICE_TZ } from "@/lib/invoices/due-date";
import { medianocheAnterior } from "@/lib/dinero/caja-core";
import { leerPlan } from "./leer-plan";

const dinero = (v: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);

export type OrigenDeLaNota = "aceptacion" | "plan_crece" | "panel" | "desde_presupuesto";

export interface ResultadoNota {
  /**
   * `abono_viejo`: el presupuesto del plan trae un «Abono al presupuesto» de antes del 4-oct sin
   * aplicar; esa cuenta la sigue llevando el presupuesto («Generar factura» lo aplica como pago) y la
   * nota del plan no se arma sola, para no cobrar ese abono dos veces.
   */
  estado: "sin_sql" | "sin_plan" | "nada" | "creada" | "agregada" | "abono_viejo";
  nota: { id: string; invoiceNumber: string; total: number } | null;
  /** Líneas nuevas en la nota. */
  lineas: number;
  /** Filas que ya cobró el presupuesto y solo se ligaron. */
  ligadas: number;
  omitidas: Array<{ filaId: string; motivo: string }>;
  /** Saldo a favor aplicado a la nota recién creada. */
  saldoAplicado: number;
}

const NADA: Omit<ResultadoNota, "estado"> = { nota: null, lineas: 0, ligadas: 0, omitidas: [], saldoAplicado: 0 };

interface FilaNotaSql {
  id: string;
  invoiceNumber: string;
  status: string;
  total: unknown;
  paid: unknown;
  cfdiUuid: string | null;
  createdAt: Date | string;
}

const aNota = (r: FilaNotaSql): NotaDelPlan => ({
  id: r.id,
  invoiceNumber: r.invoiceNumber,
  status: r.status,
  total: Number(r.total) || 0,
  paid: Number(r.paid) || 0,
  cfdiUuid: r.cfdiUuid ?? null,
  createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
});

type Tx = Prisma.TransactionClient;

async function notasDelPlan(db: Tx | typeof prisma, clinicId: string, planId: string): Promise<NotaDelPlan[]> {
  const filas = await db.$queryRaw<FilaNotaSql[]>`
    SELECT "id", "invoiceNumber", "status", "total", "paid", "cfdiUuid", "createdAt"
      FROM "invoices"
     WHERE "clinicId" = ${clinicId} AND "treatmentPlanId" = ${planId}
     ORDER BY "createdAt", "id"`;
  return filas.map(aNota);
}

/** El presupuesto ACEPTADO del plan, con lo que firmó el paciente y lo que ya se cobró de él. */
async function presupuestoAceptado(tx: Tx, clinicId: string, planId: string): Promise<(PresupuestoDelPlan & { abonoViejo: number; invoiceId: string | null }) | null> {
  const cual = await tx.quote.findFirst({
    where: { clinicId, treatmentPlanId: planId, status: "ACCEPTED" },
    orderBy: { acceptedAt: "desc" },
    select: { id: true },
  });
  if (!cual) return null;
  // Mismo candado que «Se cobrará hoy» y «Generar factura» (plan → presupuesto, nunca al revés), y
  // ANTES de leer su factura: si «Generar factura» confirmó en medio, aquí ya se ve.
  await tx.$queryRaw`SELECT id FROM "quotes" WHERE id = ${cual.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
  const q = await tx.quote.findFirst({
    where: { id: cual.id, clinicId, status: "ACCEPTED" },
    select: {
      id: true, folio: true, patientId: true, status: true, invoiceId: true, createdById: true, total: true,
      discountAmount: true, acceptedAt: true,
      items: {
        select: { id: true, name: true, toothFdi: true, quantity: true, unitPrice: true, discount: true, lineTotal: true, procedureId: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!q) return null;
  const { renglones, vivos } = await leerEstado(tx, clinicId, q);
  // Abono de antes (renglón sin concepto): positivo el cobrado, negativo el ya aplicado.
  const abonoViejo = round2(vivos.filter((v) => !v.quoteItemId).reduce((a, v) => a + (Number(v.monto) || 0), 0));
  const procedimiento = new Map(q.items.map((it) => [it.id, it.procedureId ?? null] as const));
  return {
    id: q.id,
    folio: q.folio,
    aceptadoEn: q.acceptedAt ?? null,
    conceptos: renglones.map((r) => ({ ...r, procedureId: procedimiento.get(r.quoteItemId) ?? null })),
    // `leerEstado` ya convierte la factura «de siempre» (sin cargos anotados) en cargos de todo lo aceptado.
    cargos: vivos.map((v) => ({ quoteItemId: v.quoteItemId, invoiceId: v.invoiceId })),
    facturaVieja: null,
    abonoViejo,
    invoiceId: q.invoiceId ?? null,
  };
}

function itemsDeLaNota(lineas: LineaDeNota[]) {
  const { items } = invoiceFieldsFromQuote({
    discountAmount: 0,
    items: lineas.map((l) => ({
      name: l.name,
      toothFdi: l.toothFdi,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      procedureId: l.procedureId,
    })),
  });
  // Cada línea dice de qué fila del plan salió (las de un concepto sin fila, no).
  return items.map((it, i) => (lineas[i].filaId ? { ...it, planItemId: lineas[i].filaId } : it));
}

/**
 * Crea / amplía la nota de cobro del plan. Lanza `FilaError("fila_doble")` si, aun con el candado,
 * una fila ya no se pudo ligar (alguien la cobró en medio): la transacción se deshace entera.
 */
export async function asegurarNotaDelPlan(args: {
  clinicId: string;
  planId: string;
  userId: string | null;
  origen: OrigenDeLaNota;
  /**
   * Solo si el plan ya está aceptado (tiene nota viva o un presupuesto aceptado). Lo usa «Editar
   * plan»: una fila nueva de un plan aceptado va a su nota; la de un plan sin aceptar, a ninguna.
   */
  soloSiAceptado?: boolean;
}): Promise<ResultadoNota> {
  const { clinicId, planId, userId } = args;
  if (!clinicId || !planId) throw new Error("plan:nota: clinicId o planId ausente — se corta antes de consultar");
  if (!(await tablaDeFilasExiste()) || !(await columnaNotaDelPlanExiste())) return { estado: "sin_sql", ...NADA };

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: planId, clinicId },
    select: { id: true, patientId: true, doctorId: true, name: true },
  });
  if (!plan) return { estado: "sin_plan", ...NADA };

  const clinica = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { cfdiTaxMode: true } });
  const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(clinica?.cfdiTaxMode);
  const encendida = await aceptacionEncendida();

  type Hecho = Omit<ResultadoNota, "saldoAplicado"> & { folio: string | null; montoNuevo: number };
  const hecho: Hecho = await withInvoiceNumberRetry(() =>
    prisma.$transaction(
      async (tx): Promise<Hecho> => {
        if (!(await bloquearPlan(tx, clinicId, planId))) return { estado: "sin_plan", ...NADA, folio: null, montoNuevo: 0 };
        const filas = await repoFilas.leer(clinicId, planId, { db: tx });
        if (filas.length === 0) return { estado: "nada", ...NADA, folio: null, montoNuevo: 0 };

        const notas = await notasDelPlan(tx, clinicId, planId);
        const apuntadas = Array.from(new Set(filas.map((f) => f.invoiceId).filter((x): x is string => !!x)));
        const vivas = apuntadas.length
          ? (await tx.invoice.findMany({ where: { clinicId, id: { in: apuntadas }, status: { not: "CANCELLED" } }, select: { id: true } })).map((i) => i.id)
          : [];
        const presupuesto = await presupuestoAceptado(tx, clinicId, planId);
        if (args.soloSiAceptado && !presupuesto && !notas.some((n) => n.status !== "CANCELLED")) {
          return { estado: "nada", ...NADA, folio: null, montoNuevo: 0 };
        }
        if (presupuesto && presupuesto.abonoViejo > 0.005) return { estado: "abono_viejo", ...NADA, folio: presupuesto.folio, montoNuevo: 0 };
        // Al crecer el plan no se reabre lo que Facturación canceló; aceptar o pedirlo a mano, sí.
        const planeo = planearNota({ filas, notas, facturasVivas: vivas, presupuesto, noReemplazar: args.origen === "plan_crece" });

        if (planeo.religar.length) await repoFilas.ligarAConceptos(tx, { clinicId, planId, ligas: planeo.religar });
        if (planeo.ligarExistentes.length) {
          const n = await repoFilas.ligarANota(tx, {
            clinicId, planId, reemplazar: planeo.reemplazar,
            ligas: planeo.ligarExistentes.map((l) => ({ filaId: l.filaId, invoiceId: l.invoiceId, linea: null })),
          });
          if (n !== planeo.ligarExistentes.length) throw new FilaError("fila_doble");
        }
        // Conceptos cuya fila ya estaba en una nota (el plan se aceptó antes de presentarse): quedan
        // anotados como cobrados por esa nota, también cuando hoy no nace ninguna línea.
        if (presupuesto && planeo.anotarCargos.length) {
          if (encendida) {
            const porNota = new Map<string, typeof planeo.anotarCargos>();
            for (const c of planeo.anotarCargos) porNota.set(c.invoiceId, [...(porNota.get(c.invoiceId) ?? []), c]);
            for (const [invoiceId, lista] of porNota) {
              await insertarCargos(tx, {
                clinicId, quoteId: presupuesto.id, invoiceId, userId,
                lineas: lista.map((c) => ({ tipo: "concepto" as const, quoteItemId: c.quoteItemId, monto: c.monto })),
              });
            }
          }
          if (!presupuesto.invoiceId) {
            await tx.quote.updateMany({ where: { id: presupuesto.id, clinicId, invoiceId: null }, data: { invoiceId: planeo.anotarCargos[0].invoiceId } });
            presupuesto.invoiceId = planeo.anotarCargos[0].invoiceId;
          }
        }
        const base = { ligadas: planeo.ligarExistentes.length, omitidas: planeo.omitidas };
        if (!planeo.destino) return { estado: "nada", ...NADA, ...base, folio: null, montoNuevo: 0 };

        const nuevos = itemsDeLaNota(planeo.lineas);
        const montoNuevo = round2(planeo.lineas.reduce((s, l) => s + l.neto, 0));
        let nota: { id: string; invoiceNumber: string; total: number };
        let desde = 0;
        let estado: "creada" | "agregada" = "creada";

        // ¿Sigue abierta la nota de antes ya con su fila bloqueada? (un pago pudo cerrarla en medio)
        let abierta: { id: string; invoiceNumber: string; items: unknown; discount: number; paid: number; taxRate: number; taxIncluded: boolean } | null = null;
        if (planeo.destino.tipo === "agregar") {
          await tx.$queryRaw`SELECT id FROM "invoices" WHERE id = ${planeo.destino.nota.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
          const inv = await tx.invoice.findFirst({
            where: { id: planeo.destino.nota.id, clinicId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] }, cfdiUuid: null },
            select: { id: true, invoiceNumber: true, items: true, discount: true, paid: true, taxRate: true, taxIncluded: true },
          });
          if (inv) abierta = inv;
        }

        if (abierta) {
          const viejos = Array.isArray(abierta.items) ? (abierta.items as unknown[]) : [];
          const items = [...viejos, ...nuevos];
          const subtotal = sumInvoiceItems(items);
          const discount = round2(Math.min(Math.max(0, Number(abierta.discount) || 0), subtotal));
          // Con la lista de conceptos (no con la suma): el IVA se redondea por concepto, como el timbrado.
          const { total } = computeInvoiceTotal(items, discount, abierta.taxRate, abierta.taxIncluded);
          const paid = Number(abierta.paid) || 0;
          await tx.invoice.updateMany({
            where: { id: abierta.id, clinicId },
            data: { items: items as unknown as Prisma.InputJsonValue, subtotal, discount, total, balance: Math.max(0, round2(total - paid)) },
          });
          nota = { id: abierta.id, invoiceNumber: abierta.invoiceNumber, total };
          desde = viejos.length;
          estado = "agregada";
        } else {
          const subtotal = sumInvoiceItems(nuevos);
          const { total } = computeInvoiceTotal(nuevos, 0, 0, true);
          const creada = await tx.invoice.create({
            data: {
              clinicId,
              patientId: plan.patientId,
              invoiceNumber: await nextInvoiceNumber(clinicId, tx),
              items: nuevos as unknown as Prisma.InputJsonValue,
              subtotal,
              discount: 0,
              total,
              paid: 0,
              balance: total,
              status: "PENDING",
              notes: `Nota de cobro del plan de tratamiento «${plan.name}»`.slice(0, 500),
              taxRate,
              taxIncluded,
              doctorId: plan.doctorId,
            },
            select: { id: true, invoiceNumber: true, total: true },
          });
          await tx.$executeRaw`
            UPDATE "invoices" SET "treatmentPlanId" = ${planId}
             WHERE "id" = ${creada.id} AND "clinicId" = ${clinicId}`;
          nota = { id: creada.id, invoiceNumber: creada.invoiceNumber, total: Number(creada.total) || 0 };
        }

        const conFila = planeo.lineas.map((l, i) => ({ l, i })).filter((x) => x.l.filaId);
        if (conFila.length) {
          const n = await repoFilas.ligarANota(tx, {
            clinicId, planId, reemplazar: planeo.reemplazar,
            ligas: conFila.map((x) => ({ filaId: x.l.filaId!, invoiceId: nota.id, linea: desde + x.i })),
          });
          if (n !== conFila.length) throw new FilaError("fila_doble");
        }

        // El presupuesto del plan también sabe que esto ya se cobró: «Se cobrará hoy» / «Generar factura»
        // no lo vuelven a cargar (cargos anotados; y la factura en quotes.invoiceId, como hace cargos.server.ts).
        if (presupuesto) {
          const delPresupuesto = planeo.lineas.filter((l) => l.quoteItemId);
          if (encendida && delPresupuesto.length) {
            await insertarCargos(tx, {
              clinicId, quoteId: presupuesto.id, invoiceId: nota.id, userId,
              lineas: delPresupuesto.map((l) => ({ tipo: "concepto" as const, quoteItemId: l.quoteItemId, monto: l.neto })),
            });
          }
          await tx.quote.updateMany({ where: { id: presupuesto.id, clinicId, invoiceId: null }, data: { invoiceId: nota.id } });
        }

        return { estado, nota, lineas: planeo.lineas.length, ...base, folio: presupuesto?.folio ?? null, montoNuevo };
      },
      { maxWait: 10_000, timeout: 15_000 },
    ),
  );

  let saldoAplicado = 0;
  if (hecho.estado === "creada" && hecho.nota) {
    const s = await aplicarSaldoAFavor({ clinicId, invoiceId: hecho.nota.id, userId, origen: "creada" });
    saldoAplicado = s.aplicado;
  }

  // Sin usuario (el paciente aceptó por la liga pública) no hay fila de bitácora: AuditLog exige un
  // usuario de la clínica (FK), como en /api/presupuesto/[token]. El rastro queda en la nota misma
  // (su concepto dice de qué plan es) y en la aceptación del presupuesto.
  if ((hecho.estado === "creada" || hecho.estado === "agregada") && hecho.nota && userId) {
    const cuantos = `${hecho.lineas} procedimiento${hecho.lineas === 1 ? "" : "s"}`;
    await logAudit({
      clinicId,
      userId,
      patientId: plan.patientId,
      texto:
        hecho.estado === "creada"
          ? `Creó la nota de cobro ${hecho.nota.invoiceNumber} del plan de tratamiento «${plan.name}» (${cuantos}, ${dinero(hecho.montoNuevo)})`
          : `Agregó ${cuantos} (${dinero(hecho.montoNuevo)}) del plan de tratamiento «${plan.name}» a la nota ${hecho.nota.invoiceNumber}`,
      entityType: "invoice",
      entityId: hecho.nota.id,
      action: hecho.estado === "creada" ? "create" : "update",
      changes: {
        treatmentPlanId: { before: null, after: planId },
        lineasDelPlan: { before: null, after: hecho.lineas },
        monto: { before: null, after: hecho.montoNuevo },
        origen: { before: null, after: args.origen },
        ...(hecho.folio ? { fromQuote: { before: null, after: hecho.folio } } : {}),
        ...(saldoAplicado > 0 ? { anticipoAplicado: { before: null, after: saldoAplicado } } : {}),
      },
    });
  }

  const { folio: _f, montoNuevo: _m, ...resto } = hecho;
  return { ...resto, saldoAplicado };
}

// ── La cuenta del plan ──────────────────────────────────────────────────────

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Total / facturado / pagado / saldo del plan. Junta las notas ligadas por columna y, como hacía
 * `pagosDelPlan` (commit 36c1cbf5), las facturas de los presupuestos del plan (`quotes.invoiceId` y
 * `quote_charges`), sin repetir ninguna. null si el plan no es de esta clínica.
 */
export async function leerCuentaDelPlan(args: {
  clinicId: string;
  planId: string;
  /** Zona de la clínica si quien llama ya la tiene (varias cuentas en una petición: se lee una vez). */
  timezone?: string | null;
}): Promise<CuentaDelPlan | null> {
  const { clinicId, planId } = args;
  if (!clinicId || !planId) return null;
  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: planId, clinicId },
    select: { id: true, name: true, description: true, totalCost: true },
  });
  if (!plan) return null;

  const filas = await repoFilas.leer(clinicId, planId);

  const ids = new Set<string>();
  if (await columnaNotaDelPlanExiste()) for (const n of await notasDelPlan(prisma, clinicId, planId)) ids.add(n.id);
  const porColumna = ids.size;
  const deColumna = new Set(ids);

  // La vía de antes: facturas de los presupuestos del plan.
  const quotes = await prisma.quote.findMany({
    where: { clinicId, treatmentPlanId: planId },
    select: { id: true, invoiceId: true, items: { select: { name: true } } },
    take: 50,
  });
  let soloDelPlan = true;
  if (quotes.length) {
    const conceptosDelPlan = new Set(leerPlan(plan, filas).renglones.map((r) => normalizar(r.nombre)));
    const antes = ids.size;
    for (const q of quotes) if (q.invoiceId) ids.add(q.invoiceId);
    const cargos = await leerCargos(prisma, clinicId, quotes.map((q) => q.id));
    let abonoViejo = false;
    for (const lista of cargos.porQuote.values()) {
      for (const c of lista) {
        ids.add(c.invoiceId);
        if (c.tipo === "abono" && c.monto < 0) abonoViejo = true;
      }
    }
    // Solo la vía vieja puede mezclar dinero ajeno; si todo vino ya por la nota ligada, nada que dudar.
    if (ids.size > antes || porColumna === 0) {
      soloDelPlan =
        !cargos.fallo && !abonoViejo && quotes.every((q) => q.items.every((it) => conceptosDelPlan.has(normalizar(it.name))));
    }
  }

  const facturas: FacturaDeLaCuenta[] = ids.size
    ? (
        await prisma.invoice.findMany({
          where: { clinicId, id: { in: Array.from(ids) }, status: { not: "CANCELLED" } },
          select: { id: true, invoiceNumber: true, status: true, total: true, paid: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      ).map((f) => ({
        id: f.id, invoiceNumber: f.invoiceNumber, status: f.status, total: Number(f.total) || 0, paid: Number(f.paid) || 0,
        createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt ?? ""),
      }))
    : [];
  // Notas ligadas por columna: lo hecho de cada una (26-oct). Las de la vía vieja cuentan enteras.
  if (porColumna > 0 && facturas.length > 0) {
    const leidas = await leerNotasDePlan(clinicId, facturas.map((f) => f.id));
    if (leidas.size > 0) {
      const zona = args.timezone
        || (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }).catch(() => null))?.timezone
        || DEFAULT_INVOICE_TZ;
      const corte = corteDeVencido(medianocheAnterior(new Date(), zona));
      for (const f of facturas) {
        const l = leidas.get(f.id);
        if (!l || l.planId !== planId) continue;
        const d = deudaDeNotaDelPlan(l.nota, l.filas, corte);
        f.hecho = d.hecho;
        f.vencido = d.vencido;
      }
    }
  }
  // Plan con filas: lo que falta por facturar son las filas sin nota viva (a su precio), y el total es
  // lo facturado más eso — así un descuento firmado no sale como «por facturar» (revisión ws1-t12).
  // Plan de texto: su costo, como siempre.
  const vivas = new Set(facturas.map((f) => f.id));
  const sinNota = filas.filter((f) => !(f.invoiceId && vivas.has(f.invoiceId)));
  const facturado = facturas.filter((f) => f.status !== "CANCELLED").reduce((a, f) => a + f.total, 0);
  const total = filas.length ? round2(facturado + aPesos(totalCentavos(sinNota))) : Number(plan.totalCost) || 0;
  // Facturas de la vía de antes (presupuesto) que aún deben: «Cerrar plan» no las toca (revisión t5, A5).
  const facturasDeAntes = facturas
    .filter((f) => !deColumna.has(f.id) && f.status !== "CANCELLED" && f.total - f.paid > 0.005)
    .map((f) => f.invoiceNumber);
  return { ...cuentaDelPlan({ total, facturas, soloDelPlan }), facturasDeAntes };
}
