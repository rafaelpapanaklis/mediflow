/**
 * `crear_factura` — una factura nueva, por uno de sus dos caminos de la pantalla:
 *
 *   con conceptos     → POST /api/invoices               (el editor «Nueva factura»)
 *   con presupuesto   → POST /api/quotes/[id]/invoice    («Generar factura» de un presupuesto aceptado)
 *
 * Es una sola herramienta porque las dos dan lo mismo —una factura PENDIENTE,
 * cobrable al instante y que no se borra, solo se anula— y cada herramienta se
 * paga en cada llamada al modelo. (Hasta sep-2026 la del presupuesto nacía en
 * borrador; ya no.) Lo que cambia entre las dos es de dónde salen los conceptos.
 *
 * 🔴 LA TARJETA NO MIENTE (regla 5 del contrato; MAPA-dinero §1)
 *  · El total se calcula con `computeInvoiceTotal` sobre LAS LÍNEAS —nunca su
 *    suma—, normalizadas igual que el editor (`computeTotals` y el tope del
 *    descuento de línea), y se mandan ESAS MISMAS líneas.
 *  · El IVA va explícito, de `clinicInvoiceTaxDefaults(Clinic.cfdiTaxMode)`. Sin
 *    él, el servidor pone 16 % incluido por su cuenta y la tarjeta habría dicho
 *    otra cosa.
 *  · En `ejecutar` se compara el total que devolvió el servidor con el de la
 *    tarjeta, y si no coinciden SE DICE.
 *  · Del presupuesto, el total es `invoiceFieldsFromQuote(...).total`, la misma
 *    función que usa el servidor al crear la factura.
 *
 * Lo que la tarjeta avisa, en los dos caminos: el folio MF que se va a gastar
 * y que una factura pendiente no se borra, solo se anula (F1 y F3).
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { clinicInvoiceTaxDefaults, computeInvoiceTotal, round2 } from "@/lib/invoice-totals";
import { nextInvoiceNumber } from "@/lib/invoices/next-invoice-number";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { computeTotals } from "@/lib/quotes/compute";
import { invoiceFieldsFromQuote } from "@/lib/quotes/invoice-from-quote-core";
import {
  definirAccion,
  type LlaveEscritura,
  type ManejadorRuta,
  type SabinaDeshacer,
  type SabinaEjecucion,
  type SabinaPreparacion,
  type SabinaTabla,
} from "../engine-acciones";
import { soloLectura } from "../engine-solo-lectura";
import { visorDe } from "../tools/base";
import { nombreDe } from "../tools/agenda-comun";
import type { SabinaCtx } from "../tipos";
import {
  ID_SEGURO,
  dbDineroDe,
  dinero,
  estadoDe,
  folioTecleado,
  foliosCandidatos,
  leerFacturaPorId,
  pacienteConFolio,
  resolverPacienteDinero,
  rutaComprobante,
  sinVerFacturacion,
} from "./comun";
import { errorDelCuerpo, falloIncierto, rechazoDeDinero } from "./respuestas";

const MAX_CONCEPTOS = 30;
/** Lo que cabe en la tabla de la tarjeta (`leerTabla`). Más, y la tarjeta callaría conceptos. */
const MAX_FILAS_TARJETA = 40;
const MAX_TEXTO_CELDA = 180;

const parametros = z.object({
  paciente: z.string().max(120).optional().describe("Nombre, teléfono o folio del paciente."),
  conceptos: z
    .array(
      z.object({
        concepto: z.string().min(1).max(200),
        cantidad: z.number().int().min(1).max(999).optional(),
        precio: z.number().min(0).max(10_000_000).describe("Precio unitario en pesos, tal como lo dijo el usuario."),
        descuento: z.number().min(0).optional().describe("Pesos de descuento de esa línea."),
      }),
    )
    .max(MAX_CONCEPTOS)
    .optional(),
  descuento: z.number().min(0).optional().describe("Descuento de toda la factura, en pesos."),
  presupuesto: z.string().max(40).optional().describe("Folio de un presupuesto aceptado (P-0003), en vez de conceptos."),
});

export type ParamsCrearFactura = z.infer<typeof parametros>;

/** Una línea tal como la manda el editor a POST /api/invoices. */
export interface LineaFactura {
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  total: number;
}

export type DatosCrearFactura =
  | {
      tipo: "conceptos";
      patientId: string;
      paciente: string;
      /** El cuerpo EXACTO de POST /api/invoices. */
      cuerpo: { patientId: string; items: LineaFactura[]; discount: number; taxRate: number; taxIncluded: boolean };
      total: number;
    }
  | { tipo: "presupuesto"; quoteId: string; presupuesto: string; patientId: string; paciente: string; total: number };

const esquemaLinea = z
  .object({
    description: z.string().min(1),
    quantity: z.number().int().min(1),
    unitPrice: z.number().min(0),
    discount: z.number().positive().optional(),
    total: z.number(),
  })
  .strict();

const esquemaDatos = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("conceptos"),
    patientId: z.string().regex(ID_SEGURO),
    paciente: z.string(),
    cuerpo: z
      .object({
        patientId: z.string().regex(ID_SEGURO),
        items: z.array(esquemaLinea).min(1).max(MAX_CONCEPTOS),
        discount: z.number().min(0),
        taxRate: z.union([z.literal(0), z.literal(16)]),
        taxIncluded: z.boolean(),
      })
      .strict(),
    total: z.number(),
  }),
  z.object({
    tipo: z.literal("presupuesto"),
    quoteId: z.string().regex(ID_SEGURO),
    presupuesto: z.string(),
    patientId: z.string().regex(ID_SEGURO),
    paciente: z.string(),
    total: z.number(),
  }),
]) as unknown as z.ZodType<DatosCrearFactura>;

const DESHACER_PENDIENTE: SabinaDeshacer = {
  reversible: false,
  aviso: "Una factura pendiente no se borra: solo se anula, y su folio queda usado.",
};

/* ═══════════════════════════════════════════════════════════════════════
   LAS CUENTAS — las del editor, sin copiarlas
   ═══════════════════════════════════════════════════════════════════════ */

export type Calculo =
  | { ok: true; items: LineaFactura[]; subtotal: number; discount: number; total: number }
  | { ok: false; frase: string };

/**
 * Las líneas y el total, como `invoice-editor-modal.tsx` → `save()`: normaliza
 * con `computeTotals`, acota el descuento de línea a su importe, y el total sale
 * de `computeInvoiceTotal` con las líneas. Donde el editor recorta en silencio
 * (un descuento mayor que la línea o que la factura), Sabina NO recorta: lo dice,
 * porque la tarjeta enseñaría un descuento que no es el que se guarda.
 */
export function calcularFactura(
  conceptos: NonNullable<ParamsCrearFactura["conceptos"]>,
  descuentoGlobal: number | undefined,
  impuestos: { taxRate: number; taxIncluded: boolean },
): Calculo {
  const normal = computeTotals(
    conceptos.map((c) => ({ name: c.concepto.trim(), quantity: c.cantidad ?? 1, unitPrice: c.precio, discount: c.descuento ?? 0 })),
    { discountAmount: descuentoGlobal ?? 0 },
  );
  const items: LineaFactura[] = [];
  for (const it of normal.items) {
    const importe = round2(it.unitPrice * it.quantity);
    if (it.discount > importe) {
      return { ok: false, frase: `El descuento de «${it.name}» (${dinero(it.discount)}) es mayor que su importe (${dinero(importe)}).` };
    }
    items.push({
      description: String(it.name).trim(),
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      ...(it.discount > 0 ? { discount: it.discount } : {}),
      total: round2(it.lineTotal),
    });
  }
  const pedido = round2(descuentoGlobal ?? 0);
  if (pedido > normal.subtotal) {
    return { ok: false, frase: `El descuento (${dinero(pedido)}) es mayor que la suma de los conceptos (${dinero(normal.subtotal)}).` };
  }
  const discount = round2(normal.discountAmount);
  const { total } = computeInvoiceTotal(items, discount, impuestos.taxRate, impuestos.taxIncluded);
  return { ok: true, items, subtotal: normal.subtotal, discount, total };
}

function textoIva(imp: { taxRate: number; taxIncluded: boolean }): string {
  if (imp.taxRate === 0) return "Exento (preferencia fiscal de la clínica)";
  return imp.taxIncluded ? "16 % incluido en los precios" : "16 % agregado sobre los precios";
}

function tablaDe(items: Array<{ description: string; quantity: number; unitPrice: number; discount?: number; total: number }>, pie: SabinaTabla["pie"]): SabinaTabla {
  const conDescuento = items.some((i) => (i.discount ?? 0) > 0);
  return {
    columnas: [
      { titulo: "Concepto" },
      { titulo: "Cant.", numerica: true },
      { titulo: "Precio", numerica: true },
      ...(conDescuento ? [{ titulo: "Desc.", numerica: true }] : []),
      { titulo: "Importe", numerica: true },
    ],
    filas: items.map((i) => [
      // Recortado a la vista, con «…»: la tabla no puede pasar de 200 caracteres por celda.
      i.description.length > MAX_TEXTO_CELDA ? `${i.description.slice(0, MAX_TEXTO_CELDA)}…` : i.description,
      String(i.quantity),
      dinero(i.unitPrice),
      ...(conDescuento ? [(i.discount ?? 0) > 0 ? `−${dinero(i.discount!)}` : "—"] : []),
      dinero(i.total),
    ]),
    pie,
  };
}

/** El siguiente folio libre, AHORA. Puede cambiar si alguien factura antes de confirmar: por eso se dice «ahora mismo». */
async function folioPrevisto(ctx: SabinaCtx): Promise<string | null> {
  try {
    return await nextInvoiceNumber(ctx.clinicId, dbDineroDe(ctx) as any);
  } catch {
    return null;
  }
}

async function impuestosDeClinica(ctx: SabinaCtx): Promise<{ taxRate: number; taxIncluded: boolean; exenta: boolean }> {
  const clinica = await dbDineroDe(ctx).clinic.findFirst({ where: { id: ctx.clinicId }, select: { cfdiTaxMode: true } });
  const modo = clinica?.cfdiTaxMode ?? null;
  return { ...clinicInvoiceTaxDefaults(modo), exenta: modo !== "iva16" };
}

/* ═══════════════════════════════════════════════════════════════════════
   FASE 1 — CON CONCEPTOS
   ═══════════════════════════════════════════════════════════════════════ */

async function prepararConConceptos(ctx: SabinaCtx, p: ParamsCrearFactura): Promise<SabinaPreparacion<DatosCrearFactura>> {
  const conceptos = p.conceptos ?? [];
  if (conceptos.length === 0) {
    return { tipo: "aclarar", pregunta: "¿Qué conceptos lleva la factura, y a qué precio cada uno?", opciones: [] };
  }
  const pac = await resolverPacienteDinero(ctx, p.paciente);
  if (pac.tipo === "aclarar") return { tipo: "aclarar", pregunta: pac.pregunta, opciones: pac.opciones };
  if (pac.tipo === "no") return { tipo: "no_se_puede", frase: pac.frase };
  const paciente = pac.valor;

  const imp = await impuestosDeClinica(ctx);
  const c = calcularFactura(conceptos, p.descuento, imp);
  // Sin strictNullChecks TS no estrecha por `ok` (booleano).
  if (c.ok === false) return { tipo: "no_se_puede", frase: (c as { frase: string }).frase };
  if (c.total <= 0) {
    // Una factura de $0 gasta un folio y casi siempre es un precio que faltó.
    return { tipo: "aclarar", pregunta: "Con esos datos la factura sale en $0. ¿Qué precio tiene cada concepto?", opciones: [] };
  }

  const folio = await folioPrevisto(ctx);
  const nombre = pacienteConFolio(paciente);
  const pie: SabinaTabla["pie"] = [
    ...(c.discount > 0 ? [{ etiqueta: "Subtotal", valor: dinero(c.subtotal) }, { etiqueta: "Descuento", valor: `−${dinero(c.discount)}` }] : []),
    { etiqueta: "Total", valor: dinero(c.total), fuerte: true },
  ];
  const avisos = [
    `Esto usa el folio ${folio ? `${folio} (el siguiente libre ahora mismo)` : "MF siguiente"} y no se puede borrar, solo anular.`,
    "Nace pendiente de cobro. No se timbra CFDI ni se le manda nada al paciente.",
  ];
  if (paciente.status === "ARCHIVED") avisos.unshift(`${paciente.nombre} está archivado.`);

  return {
    tipo: "propuesta",
    datos: {
      tipo: "conceptos",
      patientId: paciente.id,
      paciente: paciente.nombre,
      cuerpo: { patientId: paciente.id, items: c.items, discount: c.discount, taxRate: imp.taxRate, taxIncluded: imp.taxIncluded },
      total: c.total,
    },
    deshacer: DESHACER_PENDIENTE,
    tarjeta: {
      frase: `Crear una factura a ${paciente.nombre} por ${dinero(c.total)} (${c.items.length === 1 ? "1 concepto" : `${c.items.length} conceptos`}).`,
      detalles: [
        { etiqueta: "Paciente", valor: nombre },
        { etiqueta: "IVA", valor: textoIva(imp) },
        { etiqueta: "Total", valor: dinero(c.total) },
      ],
      tabla: tablaDe(c.items, pie),
      avisos,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   FASE 1 — DESDE UN PRESUPUESTO
   ═══════════════════════════════════════════════════════════════════════ */

interface PresupuestoLeido {
  id: string;
  folio: string;
  status: string;
  patientId: string;
  invoiceId: string | null;
  updatedAt: string;
  paciente: { id: string; nombre: string; folio: string | null } | null;
  factura: { folio: string; status: string } | null;
  total: number;
  items: ReturnType<typeof invoiceFieldsFromQuote>["items"];
}

/** El presupuesto, su paciente (si se puede ver) y la factura ligada (si todavía existe). */
async function leerPresupuesto(ctx: SabinaCtx, where: Record<string, unknown>, tecleado?: string): Promise<PresupuestoLeido | null> {
  const db = dbDineroDe(ctx);
  const filas = await db.quote.findMany({
    // 🔴 clinicId de la sesión.
    where: { ...where, clinicId: ctx.clinicId },
    select: {
      id: true,
      folio: true,
      status: true,
      patientId: true,
      invoiceId: true,
      discountAmount: true,
      updatedAt: true,
      items: { select: { name: true, toothFdi: true, quantity: true, unitPrice: true, discount: true, sortOrder: true } },
    },
    take: 2,
  });
  // Si lo tecleado existe tal cual, gana; dos que no lo son, no se adivinan.
  const q = filas.find((f: any) => tecleado && String(f.folio).toUpperCase() === tecleado) ?? (filas.length === 1 ? filas[0] : null);
  if (!q) return null;
  const [pacientes, facturas] = await Promise.all([
    // La visibilidad del paciente: la ruta del presupuesto la exige desde sep-2026
    // (antes no, N14), y Sabina la mira ya al preparar para no ofrecer una
    // tarjeta que el servidor va a rechazar. Lo que no puedes ver no se factura.
    db.patient.findMany({
      where: { id: q.patientId, clinicId: ctx.clinicId, deletedAt: null, AND: patientVisibilityAnd(visorDe(ctx)) },
      select: { id: true, firstName: true, lastName: true, patientNumber: true },
      take: 1,
    }),
    q.invoiceId
      ? db.invoice.findMany({ where: { id: q.invoiceId, clinicId: ctx.clinicId }, select: { invoiceNumber: true, status: true }, take: 1 })
      : Promise.resolve([]),
  ]);
  const items = [...(q.items ?? [])].sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const campos = invoiceFieldsFromQuote({ discountAmount: q.discountAmount, items });
  const p = pacientes[0];
  return {
    id: q.id,
    folio: q.folio,
    status: q.status,
    patientId: q.patientId,
    invoiceId: q.invoiceId ?? null,
    updatedAt: new Date(q.updatedAt ?? 0).toISOString(),
    paciente: p ? { id: p.id, nombre: nombreDe(p) || "Paciente", folio: p.patientNumber ?? null } : null,
    factura: facturas[0] ? { folio: facturas[0].invoiceNumber, status: facturas[0].status } : null,
    total: campos.total,
    items: campos.items,
  };
}

const ESTADO_PRESUPUESTO: Record<string, string> = {
  DRAFT: "en borrador",
  PRESENTED: "presentado, sin aceptar",
  REJECTED: "rechazado",
  EXPIRED: "vencido",
};

async function prepararDesdePresupuesto(ctx: SabinaCtx, p: ParamsCrearFactura): Promise<SabinaPreparacion<DatosCrearFactura>> {
  const texto = (p.presupuesto ?? "").trim();
  const q = await leerPresupuesto(ctx, { folio: { in: foliosCandidatos(texto, "P") } }, folioTecleado(texto));
  if (!q || !q.paciente) return { tipo: "no_se_puede", frase: `No encuentro el presupuesto «${texto}» entre los que puedes ver.` };
  if (q.status !== "ACCEPTED") {
    return {
      tipo: "no_se_puede",
      frase: `El presupuesto ${q.folio} está ${ESTADO_PRESUPUESTO[q.status] ?? q.status.toLowerCase()}: solo se factura un presupuesto aceptado.`,
    };
  }
  if (q.factura) {
    const extra =
      q.factura.status === "DRAFT"
        ? " Está en borrador: si quieres, pídeme cobrarla y la confirmo antes."
        : q.factura.status === "CANCELLED"
          ? " Está cancelada, y el sistema no deja volver a facturar ese presupuesto."
          : "";
    return {
      tipo: "no_se_puede",
      frase: `El presupuesto ${q.folio} ya tiene su factura, la ${q.factura.folio} (${estadoDe(q.factura.status)}). No hace falta crear otra.${extra}`,
    };
  }
  if (q.items.length === 0) return { tipo: "no_se_puede", frase: `El presupuesto ${q.folio} no tiene conceptos que facturar.` };
  if (q.items.length > MAX_FILAS_TARJETA) {
    return {
      tipo: "no_se_puede",
      frase: `El presupuesto ${q.folio} tiene ${q.items.length} conceptos y en la tarjeta no caben todos para revisarlos. Factúralo desde el presupuesto, en la pantalla.`,
    };
  }

  const [folio, imp] = await Promise.all([folioPrevisto(ctx), impuestosDeClinica(ctx)]);
  const avisos = [
    `Esto usa el folio ${folio ? `${folio} (el siguiente libre ahora mismo)` : "MF siguiente"} y no se puede borrar, solo anular.`,
    "Nace pendiente de cobro, como una factura normal. No se timbra CFDI ni se le manda nada al paciente.",
  ];
  // N29: la ruta del presupuesto no guarda el IVA de la clínica. El total no cambia; el desglose sí.
  if (imp.exenta) avisos.push("Nace marcada con IVA 16 % incluido aunque la clínica sea exenta: el total no cambia.");

  const subtotal = round2(q.items.reduce((s, i) => s + i.total, 0));
  const pie: SabinaTabla["pie"] = [
    ...(subtotal !== q.total ? [{ etiqueta: "Subtotal", valor: dinero(subtotal) }, { etiqueta: "Descuento", valor: `−${dinero(round2(subtotal - q.total))}` }] : []),
    { etiqueta: "Total", valor: dinero(q.total), fuerte: true },
  ];
  return {
    tipo: "propuesta",
    datos: { tipo: "presupuesto", quoteId: q.id, presupuesto: q.folio, patientId: q.patientId, paciente: q.paciente.nombre, total: q.total },
    deshacer: DESHACER_PENDIENTE,
    tarjeta: {
      frase: `Facturar el presupuesto ${q.folio} de ${q.paciente.nombre}: ${dinero(q.total)}, pendiente de cobro.`,
      detalles: [
        { etiqueta: "Paciente", valor: pacienteConFolio(q.paciente) },
        { etiqueta: "Presupuesto", valor: `${q.folio} · aceptado` },
        { etiqueta: "Total", valor: dinero(q.total) },
      ],
      tabla: tablaDe(q.items, pie),
      avisos,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   FASE 2
   ═══════════════════════════════════════════════════════════════════════ */

const IGUALES = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.005;

/**
 * Las facturas de ese paciente creadas desde `desde`. Es lo que se mira ANTES de
 * decir «no se creó» tras un fallo: `POST /api/invoices` convierte cualquier
 * excepción en 400 —también una que llega después del INSERT— y repetir a ciegas
 * gasta otro folio y duplica la deuda.
 */
async function facturasNuevas(
  ctx: SabinaCtx,
  patientId: string,
  desde: Date,
): Promise<Array<{ id: string; invoiceNumber: string; total: number; notes: string | null; items: unknown }>> {
  return soloLectura("buscar la factura tras un fallo", () =>
    dbDineroDe(ctx).invoice.findMany({
      where: { clinicId: ctx.clinicId, patientId, createdAt: { gte: new Date(desde.getTime() - 5_000) } },
      select: { id: true, invoiceNumber: true, total: true, notes: true, items: true },
      take: 10,
    }),
  );
}

/** Estos rechazos ocurren antes de tocar la base: no hace falta buscar nada. */
const RECHAZO_PREVIO = new Set([401, 403]);

async function ejecutarConConceptos(llave: LlaveEscritura, ctx: SabinaCtx, d: Extract<DatosCrearFactura, { tipo: "conceptos" }>): Promise<SabinaEjecucion> {
  const { POST } = await import("@/app/api/invoices/route");
  const t0 = new Date();
  let r;
  try {
    r = await llave.llamar(POST as ManejadorRuta, { metodo: "POST", ruta: "/api/invoices", cuerpo: d.cuerpo });
  } catch {
    r = { status: 0, cuerpo: null };
  }
  if (r.status === 201) {
    const creada = (r.cuerpo ?? {}) as { id?: unknown; invoiceNumber?: unknown; total?: unknown };
    const id = typeof creada.id === "string" ? creada.id : "";
    const folio = typeof creada.invoiceNumber === "string" ? creada.invoiceNumber : "nueva";
    const guardado = Number(creada.total);
    const base = `la factura ${folio} de ${d.paciente}`;
    const frase = IGUALES(guardado, d.total)
      ? `Listo: creé ${base} por ${dinero(d.total)}. Queda pendiente de cobro.`
      : `Creé ${base}, pero el sistema la guardó por ${dinero(guardado)} y en la tarjeta te dije ${dinero(d.total)}. Revísala antes de cobrarla.`;
    if (!IGUALES(guardado, d.total)) {
      console.error("[sabina/dinero] el total guardado no es el de la tarjeta", { folio, tarjeta: d.total, guardado });
    }
    return {
      ok: true,
      frase,
      ...(id ? { entidad: { tipo: "invoice", id }, enlace: { texto: `Comprobante ${folio}`, url: rutaComprobante(id) } } : {}),
    };
  }
  if (RECHAZO_PREVIO.has(r.status)) return rechazoDeDinero(r, "No se creó la factura", "crear facturas");

  let nuevas;
  try {
    nuevas = await facturasNuevas(ctx, d.patientId, t0);
  } catch {
    return { ok: false, tipo: "error", frase: `El sistema contestó con error y no pude revisar si la factura se creó. Revisa las facturas de ${d.paciente} antes de repetirlo.` };
  }
  // Mismo total Y mismos conceptos: otra factura de $500 que alguien hizo en pantalla en
  // esos segundos no es la nuestra, y darla por creada dejaría la nuestra sin crear.
  const firma = (items: unknown) =>
    JSON.stringify((Array.isArray(items) ? items : []).map((i: any) => [String(i?.description ?? ""), Number(i?.quantity), Number(i?.unitPrice)]));
  const mismas = nuevas.filter((f: any) => IGUALES(Number(f.total), d.total) && firma(f.items) === firma(d.cuerpo.items));
  const misma = mismas.length === 1 ? mismas[0] : null;
  if (misma) {
    return {
      ok: true,
      frase: `El sistema contestó con error, pero revisé: la factura ${misma.invoiceNumber} de ${d.paciente} por ${dinero(d.total)} SÍ se creó. No la repitas.`,
      entidad: { tipo: "invoice", id: misma.id },
      enlace: { texto: `Comprobante ${misma.invoiceNumber}`, url: rutaComprobante(misma.id) },
    };
  }
  if (falloIncierto(r.status)) {
    return { ok: false, tipo: "error", frase: `El sistema falló y no encuentro ninguna factura nueva de ${d.paciente}: no se creó. Puedes pedírmela otra vez.` };
  }
  const puedeReintentar = r.status === 409 && /folio/i.test(errorDelCuerpo(r)) ? " Se puede volver a intentar." : "";
  const rechazo = rechazoDeDinero(r, "No se creó la factura", "crear facturas");
  return rechazo.ok ? rechazo : { ...rechazo, frase: `${rechazo.frase}${puedeReintentar}` };
}

async function ejecutarDesdePresupuesto(llave: LlaveEscritura, ctx: SabinaCtx, d: Extract<DatosCrearFactura, { tipo: "presupuesto" }>): Promise<SabinaEjecucion> {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const t0 = new Date();
  let r;
  try {
    r = await llave.llamar(POST as ManejadorRuta, { metodo: "POST", ruta: `/api/quotes/${d.quoteId}/invoice`, params: { id: d.quoteId } });
  } catch {
    r = { status: 0, cuerpo: null };
  }
  const cuerpo = (r.cuerpo ?? {}) as { invoiceId?: unknown; invoiceNumber?: unknown; already?: unknown };
  const folio = typeof cuerpo.invoiceNumber === "string" ? cuerpo.invoiceNumber : "";
  const id = typeof cuerpo.invoiceId === "string" ? cuerpo.invoiceId : "";
  if (r.status === 200 && cuerpo.already === true) {
    return { ok: false, tipo: "conflicto", frase: `No creé nada: el presupuesto ${d.presupuesto} ya tenía la factura ${folio}.` };
  }
  if (r.status === 201 && id) {
    // La respuesta no trae el total: se relee lo guardado para compararlo con la tarjeta.
    let guardado: number | null = null;
    try {
      guardado = (await soloLectura("releer la factura del presupuesto", () => leerFacturaPorId(ctx, id)))?.total ?? null;
    } catch {
      guardado = null;
    }
    const base = `Listo: facturé el presupuesto ${d.presupuesto} de ${d.paciente} en la factura ${folio}`;
    const frase =
      guardado === null
        ? `${base}. Queda pendiente de cobro. No pude releer el total guardado: revísalo antes de cobrarla.`
        : IGUALES(guardado, d.total)
          ? `${base} por ${dinero(d.total)}. Queda pendiente de cobro.`
          : `${base}, pero quedó por ${dinero(guardado)} y en la tarjeta te dije ${dinero(d.total)}. Revísala antes de cobrarla.`;
    return { ok: true, frase, entidad: { tipo: "invoice", id }, enlace: { texto: `Comprobante ${folio}`, url: rutaComprobante(id) } };
  }
  if (RECHAZO_PREVIO.has(r.status) || r.status === 404 || (r.status === 409 && !/folio/i.test(errorDelCuerpo(r)))) {
    return rechazoDeDinero(r, "No se creó la factura", "crear facturas");
  }
  // Fallo que pudo dejar la factura creada y SIN ligar al presupuesto (el enlace se escribe
  // después, fuera de transacción): en ese caso «Ver factura» no aparecería y repetir duplica.
  let nuevas;
  try {
    nuevas = await facturasNuevas(ctx, d.patientId, t0);
  } catch {
    return { ok: false, tipo: "error", frase: `El sistema falló y no pude revisar si la factura se creó. Revisa las facturas de ${d.paciente} antes de repetirlo.` };
  }
  const creada = nuevas.find((f: any) => typeof f.notes === "string" && f.notes.includes(`presupuesto ${d.presupuesto}`));
  if (creada) {
    return {
      ok: true,
      frase: `El sistema contestó con error, pero revisé: la factura ${creada.invoiceNumber} del presupuesto ${d.presupuesto} SÍ se creó; puede que no haya quedado ligada al presupuesto. No la repitas.`,
      entidad: { tipo: "invoice", id: creada.id },
      enlace: { texto: `Comprobante ${creada.invoiceNumber}`, url: rutaComprobante(creada.id) },
    };
  }
  const error = errorDelCuerpo(r);
  return {
    ok: false,
    tipo: "error",
    frase: /folio/i.test(error)
      ? `No se creó la factura: ${error.replace(/\.?$/, ".")} Se puede volver a intentar.`
      : `El sistema falló al facturar el presupuesto ${d.presupuesto} y no encuentro ninguna factura nueva: no se creó. Puedes pedírmelo otra vez.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   LA ACCIÓN
   ═══════════════════════════════════════════════════════════════════════ */

export const accionCrearFactura = definirAccion<ParamsCrearFactura, DatosCrearFactura>({
  nombre: "crear_factura",
  descripcion:
    "Prepara una factura nueva: para un paciente con sus conceptos y precios (tal como los dijo el usuario; no los inventes), " +
    "o desde un presupuesto aceptado con su folio.",
  titulo: "Crear factura",
  boton: "Sí, crear la factura",
  queHace: "crear facturas",
  permiso: "billing.create",
  // Una factura pendiente, por los dos caminos (conceptos y presupuesto).
  deshacer: DESHACER_PENDIENTE,
  parametros,
  datos: esquemaDatos,

  async preparar(ctx, p) {
    const sinVer = sinVerFacturacion(ctx);
    if (sinVer) return sinVer;
    if ((p.presupuesto ?? "").trim()) {
      if ((p.conceptos ?? []).length > 0) {
        return { tipo: "aclarar", pregunta: "¿La factura sale del presupuesto o de los conceptos que me diste? Son dos cosas distintas.", opciones: [] };
      }
      return prepararDesdePresupuesto(ctx, p);
    }
    return prepararConConceptos(ctx, p);
  },

  /**
   * Conceptos: el paciente sigue visible y el IVA de la clínica da el mismo total.
   * Presupuesto: sigue aceptado, sin factura ligada, con el mismo total.
   */
  async huella(ctx, d) {
    if (d.tipo === "conceptos") {
      const pac = await dbDineroDe(ctx).patient.findMany({
        where: { id: d.patientId, clinicId: ctx.clinicId, deletedAt: null, AND: patientVisibilityAnd(visorDe(ctx)) },
        select: { id: true },
        take: 1,
      });
      if (pac.length === 0) return `ya_no:${randomUUID()}`;
      const imp = await impuestosDeClinica(ctx);
      const total = computeInvoiceTotal(d.cuerpo.items, d.cuerpo.discount, imp.taxRate, imp.taxIncluded).total;
      if (imp.taxRate !== d.cuerpo.taxRate || imp.taxIncluded !== d.cuerpo.taxIncluded || !IGUALES(total, d.total)) return `cambio:${randomUUID()}`;
      return `conceptos|${d.patientId}|${imp.taxRate}|${imp.taxIncluded}|${total}`;
    }
    const q = await leerPresupuesto(ctx, { id: d.quoteId });
    if (!q || !q.paciente) return `ya_no:${randomUUID()}`;
    return `presupuesto|${q.status}|${q.factura ? q.factura.folio : "-"}|${q.total}|${q.updatedAt}`;
  },

  async ejecutar(llave, ctx, d) {
    if (d.tipo === "conceptos") {
      if (d.cuerpo.patientId !== d.patientId) {
        console.error("[sabina/dinero] propuesta de factura con dos pacientes distintos");
        return { ok: false, tipo: "error", frase: "Esa propuesta no se pudo ejecutar tal como estaba. No se creó nada; pídemela otra vez." };
      }
      return ejecutarConConceptos(llave, ctx, d);
    }
    return ejecutarDesdePresupuesto(llave, ctx, d);
  },
});
