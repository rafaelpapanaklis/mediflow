/**
 * `presupuestos` — los presupuestos de un paciente, uno concreto por su folio
 * (P-0007), o los que la clínica tiene abiertos.
 *
 *   «¿qué presupuestos tiene Ana?» · «enséñame el P-0007» · «¿cuántos presupuestos
 *   tengo abiertos?»
 *
 * 🔴 SOLO LECTURA. No presenta, no acepta, no manda el link por WhatsApp y no
 * genera la factura: da el enlace a la pestaña Presupuestos de la ficha.
 *
 * ── MISMAS CIFRAS Y MISMO ESTADO QUE LA PANTALLA ───────────────────────
 * Los totales son los guardados (`quotes.total`, que calcula `computeQuoteTotals`
 * al guardar; aquí no se recalcula) y los conceptos, los de `quote_items`. El
 * estado es el de la pestaña Presupuestos, con una regla: la pantalla pasa un
 * PRESENTED con la vigencia pasada a EXPIRED cuando alguien abre la ficha
 * (`GET /api/quotes`, vencimiento perezoso); aquí se aplica esa MISMA regla al
 * leer, sin escribir, porque la base guarda PRESENTED hasta que alguien la abre y
 * dos respuestas distintas según quién abrió qué pantalla sería una contradicción.
 *
 * ── PERMISO Y VISIBILIDAD ──────────────────────────────────────────────
 * `billing.view`, como el resto del dinero de Sabina. El paciente se resuelve con
 * el buscador de «Nueva cita» (dos «María García» se preguntan), la visibilidad
 * por paciente es la del panel (`relatedPatientVisibilityAnd`) y un paciente
 * archivado por ARCO no sale en ninguna lista. `clinicId` siempre de la sesión.
 *
 * Para «¿qué dinero se me escapa?» (presupuestos sin respuesta, aceptados sin
 * agendar…) está `oportunidades_perdidas`; esta herramienta es el listado.
 */

import { z } from "zod";
import { round2 } from "@/lib/invoice-totals";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { dbDineroDe, dinero, foliosCandidatos, folioTecleado, pacienteConFolio, resolverPacienteDinero } from "../dinero/comun";
import { definirHerramienta, fraseRecorte, lineasDeLista, plural, recortar, visorDe, type Lista } from "./base";
import { fechaDe } from "./fechas";
import { diaDeVigencia, estaVencida } from "@/lib/quotes/vigencia";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  paciente: z.string().max(120).optional().describe("Nombre, teléfono o folio del paciente."),
  presupuesto: z.string().max(40).optional().describe("Folio del presupuesto (P-0007)."),
  abiertos: z.boolean().optional().describe("true = resumen de los presupuestos abiertos de toda la clínica."),
});

export type ParamsPresupuestos = z.infer<typeof parametros>;

/** Las palabras de la pestaña (quotes.status.*), en minúscula. */
const ESTADO: Record<string, string> = {
  DRAFT: "borrador",
  PRESENTED: "presentado",
  ACCEPTED: "aceptado",
  REJECTED: "rechazado",
  EXPIRED: "vencido",
};
const etiquetaDe = (clave: string) => ESTADO[clave] ?? clave.toLowerCase();

export interface ConceptoPresupuesto {
  descripcion: string;
  diente: string | null;
  cantidad: number;
  precio: number;
  descuento: number;
  total: number;
}

export interface FilaPresupuesto {
  folio: string;
  titulo: string;
  /** Ya con la regla de la pantalla: un presentado con la vigencia pasada es «vencido». Con las palabras de la pestaña. */
  estado: string;
  /** El estado como clave (DRAFT, PRESENTED…): para decidir, no para decir. */
  clave: string;
  fecha: string;
  vigencia: string | null;
  total: number;
  /** El primer concepto y «y N más». */
  conceptos: string;
  /** Solo en el detalle de uno: línea por línea. */
  detalle?: {
    items: ConceptoPresupuesto[];
    subtotal: number;
    descuento: number;
    presentado: string | null;
    aceptado: string | null;
    rechazado: string | null;
    /** Ya generó su factura. */
    facturado: boolean;
  };
}

export interface FilaAbierto {
  paciente: string;
  folio: string;
  titulo: string;
  estado: string;
  total: number;
  vigencia: string | null;
}

export type DatosPresupuestos =
  | {
      tipo: "paciente";
      paciente: string;
      presupuestos: Lista<FilaPresupuesto>;
      /** Σ de los que siguen vivos (borrador y presentado vigente). */
      vivos: number;
      /** Σ de los aceptados. */
      aceptados: number;
      /** El detalle de UNO por folio. */
      porFolio: boolean;
      enlace: string;
    }
  | {
      tipo: "abiertos";
      borradores: { cantidad: number; total: number };
      esperando: { cantidad: number; total: number };
      vencidos: { cantidad: number; total: number };
      /** Los más grandes primero. */
      filas: Lista<FilaAbierto>;
      /** `true` = hubo más de las que se leen de un golpe: las cifras son un mínimo. */
      aproximado: boolean;
    }
  | { tipo: "falta_aclarar"; pregunta: string; opciones: string[] }
  | { tipo: "no_encontrado"; frase: string };

/** Lo máximo que se lee para el resumen de abiertos. */
const TOPE_ABIERTOS = 500;

const SELECT_ITEMS = {
  select: { name: true, toothFdi: true, quantity: true, unitPrice: true, discount: true, lineTotal: true, sortOrder: true },
  orderBy: { sortOrder: "asc" },
} as const;

/**
 * La regla de vencimiento de `GET /api/quotes`: PRESENTED cuyo día de vigencia
 * ya terminó en la zona de la clínica es EXPIRED (vigencia.ts).
 */
export function estadoEfectivo(status: string, validUntil: Date | null, ahora: Date, zona?: string | null): string {
  if (status === "PRESENTED" && estaVencida(validUntil, zona, ahora)) return "EXPIRED";
  return status;
}

const num = (x: unknown) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
};

function conceptosCortos(items: any[]): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const primero = String(items[0]?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return items.length === 1 ? primero : `${primero} y ${items.length - 1} más`;
}

function aFila(q: any, ctx: SabinaCtx, ahora: Date, conDetalle: boolean): FilaPresupuesto {
  const vence = q.validUntil ? new Date(q.validUntil) : null;
  const dia = (d: unknown) => (d ? fechaDe(new Date(d as string), ctx.timezone) : null);
  const items: any[] = Array.isArray(q.items) ? q.items : [];
  return {
    folio: q.folio,
    titulo: String(q.title ?? "").slice(0, 80),
    estado: etiquetaDe(estadoEfectivo(String(q.status), vence, ahora, ctx.timezone)),
    clave: estadoEfectivo(String(q.status), vence, ahora, ctx.timezone),
    fecha: fechaDe(new Date(q.createdAt), ctx.timezone),
    // El día de vigencia que pintan la tarjeta y la liga (medianoche UTC = ese día).
    vigencia: diaDeVigencia(q.validUntil, ctx.timezone),
    total: round2(num(q.total)),
    conceptos: conceptosCortos(items),
    ...(conDetalle
      ? {
          detalle: {
            items: items.slice(0, 30).map((it) => ({
              descripcion: String(it.name ?? "Concepto").replace(/\s+/g, " ").trim().slice(0, 120),
              diente: it.toothFdi ? String(it.toothFdi) : null,
              cantidad: Math.floor(num(it.quantity)) || 1,
              precio: round2(num(it.unitPrice)),
              descuento: round2(num(it.discount)),
              total: round2(num(it.lineTotal)),
            })),
            subtotal: round2(num(q.subtotal)),
            descuento: round2(num(q.discountAmount)),
            presentado: dia(q.presentedAt),
            aceptado: dia(q.acceptedAt),
            rechazado: dia(q.rejectedAt),
            facturado: typeof q.invoiceId === "string" && q.invoiceId.length > 0,
          },
        }
      : {}),
  };
}

function nombreDe(p: any): string {
  const n = `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim() || "Paciente";
  return p?.patientNumber ? `${n} (${p.patientNumber})` : n;
}

export const presupuestos = definirHerramienta<ParamsPresupuestos, DatosPresupuestos>({
  nombre: "presupuestos",
  descripcion:
    "Presupuestos (cotizaciones): los de un paciente (`paciente`), uno concreto por su folio (`presupuesto`: P-0007, con " +
    "conceptos, descuento y fechas) o el resumen de los abiertos de toda la clínica (`abiertos`: borradores, esperando " +
    "respuesta y vencidos, con su dinero). Estados de la pantalla: borrador, presentado, aceptado, rechazado, vencido. " +
    "Solo lee: no presenta, no acepta y no factura. Para «¿qué dinero se me escapa?» usa oportunidades_perdidas.",
  parametros,
  permiso: "billing.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosPresupuestos> {
    const db = dbDineroDe(ctx);
    const ahora = new Date();
    const vis = relatedPatientVisibilityAnd(visorDe(ctx));
    // 🔴 clinicId de la sesión en TODOS los where; la visibilidad y el ARCO, en AND.
    const AND = [...vis, { patient: { is: { deletedAt: null } } }];
    const base = { clinicId: ctx.clinicId, AND };
    const folio = (params.presupuesto ?? "").trim();

    // ── uno por folio ───────────────────────────────────────────────
    if (folio) {
      const filas = await db.quote.findMany({
        where: { ...base, folio: { in: foliosCandidatos(folio, "P") } },
        select: {
          id: true, folio: true, title: true, status: true, validUntil: true, subtotal: true, discountAmount: true, total: true,
          presentedAt: true, acceptedAt: true, rejectedAt: true, invoiceId: true, createdAt: true, patientId: true,
          patient: { select: { firstName: true, lastName: true, patientNumber: true } },
          items: SELECT_ITEMS,
        },
        take: 5,
      });
      if (filas.length === 0) return { tipo: "no_encontrado", frase: `No encuentro el presupuesto «${folio}» entre los que puedes ver.` };
      const exacta = filas.filter((q: any) => String(q.folio).toUpperCase() === folioTecleado(folio));
      const q = (exacta.length === 1 ? exacta : filas)[0];
      if ((exacta.length === 1 ? exacta : filas).length > 1) {
        return {
          tipo: "falta_aclarar",
          pregunta: `«${folio}» puede ser más de un presupuesto. ¿Cuál?`,
          opciones: filas.map((x: any) => `${x.folio} — ${nombreDe(x.patient)}`),
        };
      }
      const fila = aFila(q, ctx, ahora, true);
      return {
        tipo: "paciente",
        paciente: nombreDe(q.patient),
        presupuestos: recortar([fila]),
        vivos: fila.clave === "DRAFT" || fila.clave === "PRESENTED" ? fila.total : 0,
        aceptados: fila.clave === "ACCEPTED" ? fila.total : 0,
        porFolio: true,
        enlace: `/dashboard/patients/${encodeURIComponent(q.patientId)}?tab=presupuestos`,
      };
    }

    // ── los de un paciente ──────────────────────────────────────────
    if (!params.abiertos && (params.paciente ?? "").trim()) {
      const r = await resolverPacienteDinero(ctx, params.paciente);
      if (r.tipo === "aclarar") return { tipo: "falta_aclarar", pregunta: r.pregunta, opciones: r.opciones };
      if (r.tipo === "no") return { tipo: "no_encontrado", frase: r.frase };
      const where = { ...base, patientId: r.valor.id };
      const filas = await db.quote.findMany({
        where,
        select: {
          folio: true, title: true, status: true, validUntil: true, total: true, createdAt: true,
          items: SELECT_ITEMS,
        },
        orderBy: { createdAt: "desc" },
        take: 51,
      });
      const lista = filas.map((q: any) => aFila(q, ctx, ahora, false));
      const suma = (f: (x: FilaPresupuesto) => boolean) => round2(lista.filter(f).reduce((s, x) => s + x.total, 0));
      return {
        tipo: "paciente",
        paciente: pacienteConFolio(r.valor),
        presupuestos: recortar(lista, filas.length > 50 ? undefined : filas.length),
        vivos: suma((x) => x.clave === "DRAFT" || x.clave === "PRESENTED"),
        aceptados: suma((x) => x.clave === "ACCEPTED"),
        porFolio: false,
        enlace: `/dashboard/patients/${encodeURIComponent(r.valor.id)}?tab=presupuestos`,
      };
    }

    // ── los abiertos de la clínica ──────────────────────────────────
    const crudas: any[] = await db.quote.findMany({
      where: { ...base, status: { in: ["DRAFT", "PRESENTED", "EXPIRED"] } },
      select: {
        folio: true, title: true, status: true, validUntil: true, total: true,
        patient: { select: { firstName: true, lastName: true, patientNumber: true } },
      },
      orderBy: { total: "desc" },
      take: TOPE_ABIERTOS + 1,
    });
    const aproximado = crudas.length > TOPE_ABIERTOS;
    const leidas = crudas.slice(0, TOPE_ABIERTOS).map((q) => ({
      paciente: nombreDe(q.patient),
      folio: String(q.folio),
      titulo: String(q.title ?? "").slice(0, 80),
      clave: estadoEfectivo(String(q.status), q.validUntil ? new Date(q.validUntil) : null, ahora, ctx.timezone),
      total: round2(num(q.total)),
      vigencia: diaDeVigencia(q.validUntil, ctx.timezone),
    }));
    const grupo = (estado: string) => {
      const l = leidas.filter((x) => x.clave === estado);
      return { cantidad: l.length, total: round2(l.reduce((s, x) => s + x.total, 0)) };
    };
    return {
      tipo: "abiertos",
      borradores: grupo("DRAFT"),
      esperando: grupo("PRESENTED"),
      vencidos: grupo("EXPIRED"),
      filas: recortar(leidas.map(({ clave, ...x }) => ({ ...x, estado: etiquetaDe(clave) })), leidas.length),
      aproximado,
    };
  },

  // «No tiene presupuestos» y «no hay abiertos» son respuestas, no «sin datos».
  vacio: () => false,

  resumir(d) {
    if (d.tipo === "falta_aclarar") {
      const opciones = lineasDeLista(d.opciones, (o) => o);
      return `Falta aclarar: ${d.pregunta}${opciones || (d.opciones[0] ? ` ${d.opciones[0]}.` : "")}\nPregúntaselo a quien escribe y NO elijas tú.`;
    }
    if (d.tipo === "no_encontrado") return d.frase;

    if (d.tipo === "abiertos") {
      const hay = d.borradores.cantidad + d.esperando.cantidad + d.vencidos.cantidad;
      const donde = " No hay una pantalla con todos: cada uno se ve en la pestaña Presupuestos de la ficha del paciente.";
      if (hay === 0) return `La clínica no tiene presupuestos abiertos (ni borradores, ni esperando respuesta, ni vencidos).${donde}`;
      const g = (x: { cantidad: number; total: number }, uno: string, muchos: string) => `${plural(x.cantidad, uno, muchos)} por ${dinero(x.total)}`;
      const minimo = d.aproximado ? " (hay más de los que leo de un golpe: son cifras mínimas)" : "";
      const monto = (n: number) => dinero(n);
      const lista = lineasDeLista(d.filas.filas, (f) => `${f.folio} — ${f.paciente}, ${f.titulo}: ${monto(f.total)}, ${f.estado}${f.vigencia ? `, vigencia ${f.vigencia}` : ""}`);
      return (
        `Presupuestos abiertos${minimo}: ${g(d.esperando, "esperando respuesta", "esperando respuesta")}; ${g(d.borradores, "borrador", "borradores")}; ` +
        `${g(d.vencidos, "vencido", "vencidos")}. El dinero de los presentados NO es venta: el paciente aún no dijo que sí; no lo sumes a nada.` +
        `${lista ? " Los más grandes:" : ""}${lista}${lista ? "\n" : ""}${donde.trim()}`
      );
    }

    const f0 = d.presupuestos.filas[0];
    const enlace = ` Se ve en [la pestaña Presupuestos](${d.enlace}).`;
    if (d.presupuestos.total === 0) return `${d.paciente} no tiene presupuestos.${enlace}`;

    if (d.porFolio && f0?.detalle) {
      const x = f0.detalle;
      const conceptos = lineasDeLista(x.items, (c) => `${c.descripcion}${c.diente ? ` (diente ${c.diente})` : ""} — ${c.cantidad} × ${dinero(c.precio)}${c.descuento > 0 ? `, descuento ${dinero(c.descuento)}` : ""} = ${dinero(c.total)}`);
      const unico = !conceptos && x.items[0] ? ` Concepto: ${x.items[0].descripcion} (${x.items[0].cantidad} × ${dinero(x.items[0].precio)}).` : "";
      const fechas = [
        x.presentado ? `presentado el ${x.presentado}` : null,
        x.aceptado ? `aceptado el ${x.aceptado}` : null,
        x.rechazado ? `rechazado el ${x.rechazado}` : null,
        f0.vigencia ? `vigencia hasta el ${f0.vigencia}` : null,
      ].filter(Boolean);
      return (
        `Presupuesto ${f0.folio} de ${d.paciente} «${f0.titulo}»: ${f0.estado}, creado el ${f0.fecha}` +
        `${fechas.length ? `; ${fechas.join(", ")}` : ""}. Total ${dinero(f0.total)}` +
        `${x.descuento > 0 ? ` (subtotal ${dinero(x.subtotal)}, descuento ${dinero(x.descuento)})` : ""}.` +
        `${x.facturado ? " Ya generó su factura." : ""}${conceptos ? " Conceptos:" : unico}${conceptos}${conceptos ? "\n" : ""}${enlace.trim()}`
      );
    }

    const monto = (n: number) => dinero(n);
    const fila = (f: FilaPresupuesto) =>
      `${f.folio} — ${f.fecha}${f.conceptos ? `, ${f.conceptos}` : ""}: ${monto(f.total)}, ${f.estado}${f.vigencia ? `, vigencia ${f.vigencia}` : ""}`;
    const lista = lineasDeLista(d.presupuestos.filas, fila);
    const uno = !lista && f0 ? ` ${fila(f0)}.` : "";
    const vivos = d.vivos > 0 ? ` Vivos (borrador o presentado): ${dinero(d.vivos)}.` : "";
    const acept = d.aceptados > 0 ? ` Aceptados: ${dinero(d.aceptados)}.` : "";
    return (
      `${d.paciente}: ${plural(d.presupuestos.total, "presupuesto", "presupuestos")}${fraseRecorte(d.presupuestos, "presupuestos")}.${vivos}${acept}` +
      `${lista ? " Del más reciente al más antiguo:" : uno}${lista}${lista ? "\n" : ""}${enlace.trim()}`
    );
  },
});
