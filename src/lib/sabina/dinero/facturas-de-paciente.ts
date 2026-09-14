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
import { round2 } from "@/lib/invoice-totals";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { definirHerramienta, fraseRecorte, plural, recortar, visorDe, type Lista } from "../tools/base";
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
  createdAt: true,
  patientId: true,
  patient: { select: { firstName: true, lastName: true, patientNumber: true } },
  payments: { select: { amount: true, method: true, paidAt: true }, orderBy: { paidAt: "asc" } },
} as const;

function metodoLegible(m: unknown): string {
  if (m === "refund") return "Reembolso";
  return esMetodoCobro(m) ? ETIQUETA_METODO[m] : String(m ?? "");
}

export const facturasDePaciente = definirHerramienta<ParamsFacturas, DatosFacturas>({
  nombre: "facturas_de_paciente",
  descripcion:
    "Facturas de un paciente (o una por su folio): estado, total, pagado, saldo, pagos, comprobante PDF (dalo como " +
    "[Comprobante MF-0042](ruta)) y presupuestos aceptados. Para «¿cuánto debe Ana?» y antes de cobrar o facturar.",
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
    return (
      `${d.paciente}: ${plural(d.facturas.total, "factura", "facturas")}${fraseRecorte(d.facturas, "facturas")}; ` +
      `saldo por cobrar ${dinero(d.saldoPorCobrar)}${borr}.`
    );
  },
});
