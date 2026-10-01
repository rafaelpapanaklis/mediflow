/**
 * `facturas_de_paciente` — las facturas de UN paciente (o una por su folio), con
 * lo que hace falta para cobrarlas: estado, total, pagado, saldo, si está
 * timbrada, sus pagos, el enlace al comprobante y los presupuestos aceptados.
 *
 * ── POR QUÉ NO BASTA `pacientes_con_deuda` ─────────────────────────────
 * MAPA-dinero C5: esa herramienta contesta «¿quién me debe?» agrupando por
 * paciente, no dice qué factura, cuenta los borradores como deuda y usa la
 * columna `balance` en vez de `total − pagado`. Para «¿cuánto debe Ana?» y para
 * cobrar hace falta el detalle por factura. Aquí va, y el saldo es el del cobro.
 *
 * ── PERMISO Y VISIBILIDAD ──────────────────────────────────────────────
 * `billing.view`, como `GET /api/invoices`, con la misma visibilidad por paciente.
 * El paciente se resuelve con el buscador de «Nueva cita» (el de agenda), así que
 * dos «María García» se preguntan en vez de elegirse.
 */

import { z } from "zod";
import { itemLineTotal, itemQuantity, itemUnitPrice, round2 } from "@/lib/invoice-totals";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { definirHerramienta, fraseRecorte, lineasDeLista, plural, recortar, visorDe, type Lista } from "../tools/base";
import { fechaDe } from "../tools/fechas";
import type { SabinaCtx } from "../tipos";
import {
  ETIQUETA_METODO,
  dbDineroDe,
  dinero,
  esMetodoCobro,
  estadoDe,
  pacienteConFolio,
  resolverFactura,
  resolverPacienteDinero,
  rutaComprobante,
  saldoDe,
} from "./comun";

const parametros = z.object({
  paciente: z.string().max(120).optional().describe("Nombre, teléfono o folio del paciente."),
  factura: z.string().max(40).optional().describe("Folio de la factura (MF-0042)."),
});

export type ParamsFacturas = z.infer<typeof parametros>;

export interface FilaFactura {
  folio: string;
  estado: string;
  fecha: string;
  /** El concepto de la factura: el primero y «y N más». Vacío si no tiene conceptos. */
  concepto: string;
  /** Solo cuando se pide UNA factura por folio: sus conceptos, línea por línea (hasta 30). */
  conceptos?: Array<{ descripcion: string; cantidad: number; precio: number; total: number }>;
  descuento: number;
  total: number;
  pagado: number;
  /** total − pagado: lo que se puede cobrar. */
  saldo: number;
  vence: string | null;
  timbrada: boolean;
  pagos: Array<{ fecha: string; monto: number; metodo: string }>;
  /** Ruta del comprobante PDF (no fiscal). Dásela al usuario como enlace. */
  comprobante: string;
}

export type DatosFacturas =
  | {
      estado: "ok";
      paciente: string;
      /** `true` = pidieron UNA factura por su folio: va con el detalle de conceptos y pagos. */
      porFolio: boolean;
      facturas: Lista<FilaFactura>;
      /** Σ saldo de las facturas cobrables (sin borradores ni canceladas). */
      saldoPorCobrar: number;
      /** Σ saldo de los borradores: no se cobran hasta confirmarlos. */
      enBorrador: number;
      presupuestosAceptados: Array<{ folio: string; titulo: string; total: number; factura: string | null }>;
    }
  | { estado: "falta_aclarar"; pregunta: string; opciones: string[] }
  | { estado: "no_encontrado"; frase: string };

const SELECT = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  paid: true,
  dueDate: true,
  cfdiUuid: true,
  items: true,
  discount: true,
  createdAt: true,
  patientId: true,
  patient: { select: { firstName: true, lastName: true, patientNumber: true } },
  payments: { select: { amount: true, method: true, paidAt: true }, orderBy: { paidAt: "asc" } },
} as const;

/** Los conceptos de la factura tal como los lee el resto del panel (`itemQuantity`, `itemUnitPrice`, `itemLineTotal`). */
function conceptosDe(items: unknown): Array<{ descripcion: string; cantidad: number; precio: number; total: number }> {
  if (!Array.isArray(items)) return [];
  return items.map((it: any) => ({
    descripcion: String(it?.description ?? it?.name ?? "Concepto").replace(/\s+/g, " ").trim().slice(0, 120) || "Concepto",
    cantidad: itemQuantity(it),
    precio: round2(itemUnitPrice(it)),
    total: round2(itemLineTotal(it)),
  }));
}

function conceptoCorto(items: unknown): string {
  const c = conceptosDe(items);
  if (c.length === 0) return "";
  return c.length === 1 ? c[0].descripcion : `${c[0].descripcion} y ${c.length - 1} más`;
}

function metodoLegible(m: unknown): string {
  if (m === "refund") return "Reembolso";
  if (m === "anticipo") return "Anticipo (saldo a favor)";
  return esMetodoCobro(m) ? ETIQUETA_METODO[m] : String(m ?? "");
}

export const facturasDePaciente = definirHerramienta<ParamsFacturas, DatosFacturas>({
  nombre: "facturas_de_paciente",
  descripcion:
    "Facturas de un paciente (o UNA por su folio): folio, fecha, concepto, total, pagado, saldo, estado, si tiene CFDI, " +
    "pagos, comprobante PDF (dalo como [Comprobante MF-0042](ruta)) y presupuestos aceptados. Con `factura` (folio) " +
    "trae el detalle de conceptos y pagos. Para «¿cuánto debe Ana?», «enséñame la MF-0042» y antes de cobrar o facturar.",
  parametros,
  permiso: "billing.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosFacturas> {
    const db = dbDineroDe(ctx);
    const vis = relatedPatientVisibilityAnd(visorDe(ctx));
    // 🔴 clinicId de la sesión en TODOS los where, y la visibilidad en AND.
    const base = { clinicId: ctx.clinicId, ...(vis.length ? { AND: vis } : {}) };

    let patientId: string;
    let nombre: string;
    let facturaId: string | null = null;
    const folio = (params.factura ?? "").trim();
    if (folio) {
      // El mismo resolvedor que cobrar y avisar: gana el folio exacto, y si hay dos posibles, pregunta.
      const una = await resolverFactura(ctx, params, { filtro: () => true, queTiene: "" });
      if (una.tipo === "aclarar") return { estado: "falta_aclarar", pregunta: una.pregunta, opciones: una.opciones };
      if (una.tipo === "no") return { estado: "no_encontrado", frase: una.frase };
      patientId = una.valor.paciente.id;
      nombre = pacienteConFolio(una.valor.paciente);
      facturaId = una.valor.id;
    } else {
      const r = await resolverPacienteDinero(ctx, params.paciente);
      if (r.tipo === "aclarar") return { estado: "falta_aclarar", pregunta: r.pregunta, opciones: r.opciones };
      if (r.tipo === "no") return { estado: "no_encontrado", frase: r.frase };
      patientId = r.valor.id;
      nombre = pacienteConFolio(r.valor);
    }

    const whereFacturas = {
      ...base,
      patientId,
      ...(facturaId ? { id: facturaId } : {}),
    };
    // Dos consultas en paralelo, lejos del tope del pooler.
    const [filas, presupuestos] = await Promise.all([
      db.invoice.findMany({ where: whereFacturas, select: SELECT, orderBy: { createdAt: "desc" }, take: 51 }),
      folio
        ? Promise.resolve([])
        : db.quote.findMany({
            where: { clinicId: ctx.clinicId, patientId, status: "ACCEPTED" },
            select: { folio: true, title: true, total: true, invoiceId: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
    ]);

    // La factura ligada a cada presupuesto, si todavía existe (un borrador borrado deja el id colgando).
    const ligadas = presupuestos.map((q: any) => q.invoiceId).filter(Boolean);
    const facturasLigadas = ligadas.length
      ? await db.invoice.findMany({
          where: { clinicId: ctx.clinicId, id: { in: ligadas } },
          select: { id: true, invoiceNumber: true, status: true },
        })
      : [];
    const porId: Record<string, any> = {};
    for (const f of facturasLigadas) porId[f.id] = f;

    const facturas: FilaFactura[] = filas.map((f: any) => ({
      folio: f.invoiceNumber,
      estado: estadoDe(f.status),
      fecha: fechaDe(new Date(f.createdAt), ctx.timezone),
      concepto: conceptoCorto(f.items),
      ...(facturaId ? { conceptos: conceptosDe(f.items).slice(0, 30) } : {}),
      descuento: round2(Number(f.discount ?? 0)),
      total: round2(Number(f.total)),
      pagado: round2(Number(f.paid)),
      saldo: f.status === "CANCELLED" ? 0 : saldoDe(f),
      vence: f.dueDate ? fechaDe(new Date(f.dueDate), ctx.timezone) : null,
      timbrada: typeof f.cfdiUuid === "string" && f.cfdiUuid.length > 0,
      pagos: (f.payments ?? []).slice(0, 10).map((p: any) => ({
        fecha: fechaDe(new Date(p.paidAt), ctx.timezone),
        monto: round2(Number(p.amount)),
        metodo: metodoLegible(p.method),
      })),
      comprobante: rutaComprobante(f.id),
    }));

    // Más de 50: el total de verdad sale de un count sobre el MISMO where, no del recorte.
    const totalReal = filas.length > 50 ? await db.invoice.count({ where: whereFacturas }) : filas.length;
    const cobrables = filas.filter((f: any) => ["PENDING", "PARTIAL", "OVERDUE"].includes(f.status));
    const borradores = filas.filter((f: any) => f.status === "DRAFT");
    return {
      estado: "ok",
      paciente: nombre,
      porFolio: facturaId !== null,
      facturas: recortar(facturas, totalReal),
      saldoPorCobrar: round2(cobrables.reduce((s: number, f: any) => s + Math.max(0, saldoDe(f)), 0)),
      enBorrador: round2(borradores.reduce((s: number, f: any) => s + Math.max(0, saldoDe(f)), 0)),
      presupuestosAceptados: presupuestos.map((q: any) => {
        const inv = q.invoiceId ? porId[q.invoiceId] : null;
        return {
          folio: q.folio,
          titulo: q.title,
          total: round2(Number(q.total)),
          factura: inv ? `${inv.invoiceNumber} (${estadoDe(inv.status)})` : null,
        };
      }),
    };
  },

  vacio: () => false,

  resumir(d) {
    if (d.estado === "falta_aclarar") return `Falta aclarar: ${d.pregunta}`;
    if (d.estado === "no_encontrado") return d.frase;
    if (d.facturas.total === 0) return `${d.paciente} no tiene facturas.`;
    const borr = d.enBorrador > 0 ? `, más ${dinero(d.enBorrador)} en borradores sin confirmar` : "";
    const cabecera =
      `${d.paciente}: ${plural(d.facturas.total, "factura", "facturas")}${fraseRecorte(d.facturas, "facturas")}; ` +
      `saldo por cobrar ${dinero(d.saldoPorCobrar)}${borr}.`;
    const enlace = " Se ven en [Facturación](/dashboard/billing).";

    // UNA factura por folio: el detalle completo.
    if (d.porFolio && d.facturas.filas.length === 1) {
      const f = d.facturas.filas[0];
      const conceptos = lineasDeLista(f.conceptos ?? [], (c) => `${c.descripcion} — ${c.cantidad} × ${dinero(c.precio)} = ${dinero(c.total)}`);
      const unico = !conceptos && f.conceptos?.[0] ? ` Concepto: ${f.conceptos[0].descripcion} (${f.conceptos[0].cantidad} × ${dinero(f.conceptos[0].precio)}).` : "";
      const pagos = lineasDeLista(f.pagos, (p) => `${p.fecha} — ${dinero(p.monto)} (${p.metodo})`);
      const unPago = !pagos && f.pagos[0] ? ` Pago: ${f.pagos[0].fecha}, ${dinero(f.pagos[0].monto)} (${f.pagos[0].metodo}).` : "";
      return (
        `Factura ${f.folio} de ${d.paciente}: ${f.estado}, del ${f.fecha}. Total ${dinero(f.total)}, pagado ${dinero(f.pagado)}, ` +
        `saldo ${dinero(f.saldo)}${f.descuento > 0 ? `, con descuento de ${dinero(f.descuento)}` : ""}` +
        `${f.vence ? `, vence el ${f.vence}` : ""}. ${f.timbrada ? "Tiene CFDI timbrado." : "Sin CFDI."}` +
        `${conceptos ? " Conceptos:" : unico}${conceptos}` +
        `${pagos ? " Pagos:" : f.pagos.length === 0 ? " Sin pagos registrados." : unPago}${pagos}` +
        `${conceptos || pagos ? "\n" : " "}Comprobante: [${f.folio}](${f.comprobante}).${enlace}`
      );
    }

    const monto = (n: number) => dinero(n);
    const lista = lineasDeLista(
      d.facturas.filas,
      (f) =>
        `${f.folio} — ${f.fecha}${f.concepto ? `, ${f.concepto}` : ""}: total ${monto(f.total)}, pagado ${monto(f.pagado)}, ` +
        `saldo ${monto(f.saldo)}, ${f.estado}, ${f.timbrada ? "con CFDI" : "sin CFDI"}`,
    );
    const una = !lista && d.facturas.filas[0]
      ? ` ${d.facturas.filas[0].folio} — ${d.facturas.filas[0].fecha}${d.facturas.filas[0].concepto ? `, ${d.facturas.filas[0].concepto}` : ""}: total ${monto(d.facturas.filas[0].total)}, pagado ${monto(d.facturas.filas[0].pagado)}, saldo ${monto(d.facturas.filas[0].saldo)}, ${d.facturas.filas[0].estado}, ${d.facturas.filas[0].timbrada ? "con CFDI" : "sin CFDI"}.`
      : "";
    return `${cabecera}${lista ? " De la más reciente a la más antigua:" : una}${lista}${lista ? "\n" : ""}${lista ? enlace.trim() : enlace}`;
  },
});
