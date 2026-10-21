// La NOTA DE COBRO del plan (ws1-t12 · P6) — qué se cobra y dónde, en funciones puras.
//
// Decisión de Rafael (20-oct-2026): UNA nota de cobro (Invoice) por plan, ligada por
// `invoices."treatmentPlanId"`; el anticipo y los pagos son ABONOS a esa nota. Si el plan crece y la
// nota sigue por cobrar, la nota recibe la línea; si ya está pagada (o timbrada), nace una nota
// ADICIONAL ligada al mismo plan.
//
// Lo que aquí se decide, para que el ejecutor (`cobro.server.ts`) solo escriba:
//  · NUNCA dos notas por la misma fila: una fila con nota viva no se vuelve a cobrar; una fila ya
//    cobrada por su presupuesto («Se cobrará hoy» / «Generar factura») se LIGA a esa factura;
//  · lo que el paciente FIRMÓ manda: si el plan tiene un presupuesto aceptado, cada fila se cobra al
//    importe de su concepto (con su descuento y su parte del descuento global); una fila que estaba
//    en el plan al aceptar y no se aceptó, no se cobra;
//  · un concepto aceptado que ya no está en ninguna fila (lo agregaron en el editor) se cobra igual;
//  · una fila en $0 (cortesía) no lleva línea.

import { round2 } from "@/lib/invoice-totals";
import { conceptosGenerales } from "@/lib/quotes/ortodoncia";
import { aPesos, dientesCsv, filasVivas, importeCentavos, ordenarParaElPapel, type FilaDelPlan } from "./items";

/** Una factura ligada al plan (la nota y sus adicionales). */
export interface NotaDelPlan {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  paid: number;
  cfdiUuid: string | null;
  createdAt: Date;
}

/** Los estados en los que una nota todavía recibe líneas y abonos. */
export const ESTADOS_POR_COBRAR = ["PENDING", "PARTIAL", "OVERDUE"] as const;

const porCobrar = (status: string) => (ESTADOS_POR_COBRAR as readonly string[]).indexOf(status) !== -1;

/**
 * La nota que recibe las líneas nuevas: la más reciente que sigue por cobrar y NO está timbrada
 * (con CFDI de la factura completa ya no se le cambian conceptos). null = hace falta una nueva.
 */
export function notaAbierta(notas: NotaDelPlan[]): NotaDelPlan | null {
  const abiertas = notas.filter((n) => porCobrar(n.status) && !n.cfdiUuid);
  abiertas.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return abiertas[0] ?? null;
}

/** El concepto aceptado del presupuesto del plan (`RenglonAceptado` de lib/quotes/aceptacion.ts). */
export interface ConceptoFirmado {
  quoteItemId: string;
  aceptado: boolean;
  nombre: string;
  toothFdi: string | null;
  cantidad: number;
  precio: number;
  descuento: number;
  descuentoGlobal: number;
  procedureId?: string | null;
}

export interface PresupuestoDelPlan {
  id: string;
  folio: string;
  aceptadoEn: Date | null;
  conceptos: ConceptoFirmado[];
  /** quoteItemId → factura viva que ya lo cobró (quote_charges). */
  cargos: Array<{ quoteItemId: string | null; invoiceId: string }>;
  /** `quotes.invoiceId` cuando no hay cargos anotados: la factura «de siempre» que cobró TODO lo aceptado. */
  facturaVieja: string | null;
}

export interface LineaDeNota {
  /** La fila del plan; null = concepto del presupuesto sin fila. */
  filaId: string | null;
  quoteItemId: string | null;
  name: string;
  toothFdi: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  procedureId: string | null;
  /** Lo que suma la línea: cantidad × precio − descuento. */
  neto: number;
}

export type MotivoOmitida = "sin_precio" | "no_aceptada" | "nota_cancelada";

export interface PlaneoDeNota {
  /** Filas que ya cobró una factura del presupuesto: se ligan a ella, sin línea nueva. */
  ligarExistentes: Array<{ filaId: string; invoiceId: string }>;
  lineas: LineaDeNota[];
  /** null = no hay nada que cobrar. */
  destino: { tipo: "agregar"; nota: NotaDelPlan } | { tipo: "nueva" } | null;
  omitidas: Array<{ filaId: string; motivo: MotivoOmitida }>;
  /** Notas canceladas (o que ya no existen) que tenían filas: esas filas se vuelven a cobrar. */
  reemplazar: string[];
  /** Filas que se reconocieron en un concepto por nombre (el editor rehízo los conceptos): se reanotan. */
  religar: Array<{ filaId: string; quoteItemId: string }>;
  /**
   * Conceptos del presupuesto cuya fila YA estaba en una nota viva (el plan se aceptó sin presupuesto
   * y luego se presentó y firmó): se anotan como cobrados por esa nota, para que «Generar factura» /
   * «Se cobrará hoy» no los vuelvan a cobrar.
   */
  anotarCargos: Array<{ quoteItemId: string; invoiceId: string; monto: number }>;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const claveDe = (nombre: string, dientes: string, cantidad: number) => `${normalizar(nombre)}|${dientes.replace(/\s+/g, "")}|${cantidad}`;

const netoDeConcepto = (c: ConceptoFirmado) => round2(Math.max(0, c.cantidad * c.precio - c.descuento - c.descuentoGlobal));

function lineaDeConcepto(c: ConceptoFirmado, fila: FilaDelPlan | null): LineaDeNota {
  return {
    filaId: fila?.id ?? null,
    quoteItemId: c.quoteItemId,
    name: fila?.nombre ?? c.nombre,
    toothFdi: c.toothFdi ?? (fila && fila.dientes.length ? dientesCsv(fila.dientes) : null),
    quantity: c.cantidad,
    unitPrice: round2(c.precio),
    discount: round2(c.descuento + c.descuentoGlobal),
    procedureId: fila?.procedureId ?? c.procedureId ?? null,
    neto: netoDeConcepto(c),
  };
}

function lineaDeFila(f: FilaDelPlan): LineaDeNota {
  return {
    filaId: f.id,
    quoteItemId: null,
    name: f.nombre,
    toothFdi: f.dientes.length ? dientesCsv(f.dientes) : null,
    quantity: f.cantidad,
    unitPrice: aPesos(f.precioCentavos),
    discount: 0,
    procedureId: f.procedureId,
    neto: aPesos(importeCentavos(f)),
  };
}

/**
 * Qué se cobra ahora y en qué nota.
 *
 * `facturasVivas`: de las facturas a las que apuntan las filas, las que existen y no están
 * canceladas (las lee el ejecutor bajo el candado del plan).
 */
export function planearNota(args: {
  filas: FilaDelPlan[];
  notas: NotaDelPlan[];
  facturasVivas: string[];
  presupuesto: PresupuestoDelPlan | null;
  /**
   * No volver a cobrar filas cuya nota se canceló (cancelar una nota es a propósito). Lo usa «el plan
   * crece»: una edición del plan no reabre lo que Facturación canceló.
   */
  noReemplazar?: boolean;
}): PlaneoDeNota {
  const vivasFact = new Set(args.facturasVivas);
  const p = args.presupuesto;
  const conceptos = p?.conceptos ?? [];
  const porId = new Map(conceptos.map((c) => [c.quoteItemId, c] as const));
  const cargoDe = new Map<string, string>();
  for (const c of p?.cargos ?? []) if (c.quoteItemId) cargoDe.set(c.quoteItemId, c.invoiceId);
  const sinCargos = (p?.cargos ?? []).length === 0;
  const usados = new Set<string>();

  const ligarExistentes: PlaneoDeNota["ligarExistentes"] = [];
  const lineas: LineaDeNota[] = [];
  const omitidas: PlaneoDeNota["omitidas"] = [];
  const reemplazar = new Set<string>();
  const religar: PlaneoDeNota["religar"] = [];
  const anotarCargos: PlaneoDeNota["anotarCargos"] = [];

  /** ¿Quién cobró ya ese concepto? (cargo anotado o la factura de siempre) */
  const cobradoPor = (quoteItemId: string): string | null =>
    cargoDe.get(quoteItemId) ?? (sinCargos && p?.facturaVieja ? p.facturaVieja : null);

  // En el orden del papel (el del presupuesto y el PDF): así se leen también las líneas de la nota.
  const filas = ordenarParaElPapel(filasVivas(args.filas));

  // Cada fila con su concepto firmado: por su liga, o (si el editor rehízo los conceptos) por
  // nombre + dientes + cantidad con uno que nadie más tomó.
  const libres = (c: ConceptoFirmado) => !usados.has(c.quoteItemId);
  const conceptoDe = (f: FilaDelPlan): ConceptoFirmado | null => {
    const ligado = f.quoteItemId ? porId.get(f.quoteItemId) : undefined;
    if (ligado && libres(ligado)) return ligado;
    const clave = claveDe(f.nombre, dientesCsv(f.dientes), f.cantidad);
    return conceptos.find((c) => libres(c) && claveDe(c.nombre, c.toothFdi ?? "", c.cantidad) === clave) ?? null;
  };

  // 1) Lo que ya tiene nota viva no se vuelve a cobrar; su concepto (si el plan se presentó después)
  //    queda tomado y anotado como cobrado por esa nota. Lo que apunta a una nota muerta se vuelve a
  //    cobrar, salvo `noReemplazar`.
  const porCobrarFilas: FilaDelPlan[] = [];
  for (const f of filas) {
    if (f.invoiceId && vivasFact.has(f.invoiceId)) {
      const c = p ? conceptoDe(f) : null;
      if (c) {
        usados.add(c.quoteItemId);
        if (f.quoteItemId !== c.quoteItemId) religar.push({ filaId: f.id, quoteItemId: c.quoteItemId });
        if (c.aceptado && !cobradoPor(c.quoteItemId)) anotarCargos.push({ quoteItemId: c.quoteItemId, invoiceId: f.invoiceId, monto: netoDeConcepto(c) });
      }
      continue;
    }
    if (f.invoiceId && args.noReemplazar) {
      // Su concepto también queda tomado: si no, el paso 3 lo cobraría como «concepto sin fila».
      const c = p ? conceptoDe(f) : null;
      if (c) usados.add(c.quoteItemId);
      omitidas.push({ filaId: f.id, motivo: "nota_cancelada" });
      continue;
    }
    if (f.invoiceId) reemplazar.add(f.invoiceId);
    porCobrarFilas.push(f);
  }

  // 2) Lo que falta cobrar.
  for (const f of porCobrarFilas) {
    const c = p ? conceptoDe(f) : null;
    if (c) {
      usados.add(c.quoteItemId);
      if (f.quoteItemId !== c.quoteItemId) religar.push({ filaId: f.id, quoteItemId: c.quoteItemId });
      if (!c.aceptado) {
        omitidas.push({ filaId: f.id, motivo: "no_aceptada" });
        continue;
      }
      const ya = cobradoPor(c.quoteItemId);
      if (ya) {
        ligarExistentes.push({ filaId: f.id, invoiceId: ya });
        continue;
      }
      const l = lineaDeConcepto(c, f);
      if (l.neto <= 0) omitidas.push({ filaId: f.id, motivo: "sin_precio" });
      else lineas.push(l);
      continue;
    }
    // Sin concepto: si ya estaba en el plan cuando se aceptó el presupuesto, el paciente no la aceptó.
    if (p && p.aceptadoEn && f.createdAt.getTime() <= p.aceptadoEn.getTime()) {
      omitidas.push({ filaId: f.id, motivo: "no_aceptada" });
      continue;
    }
    const l = lineaDeFila(f);
    if (l.neto <= 0) omitidas.push({ filaId: f.id, motivo: "sin_precio" });
    else lineas.push(l);
  }

  // 3) Conceptos aceptados sin fila y sin cobrar (agregados en el editor del presupuesto). Los de
  //    ortodoncia no: en un presupuesto mixto los cobra el caso de ortodoncia, no el plan general.
  for (const c of conceptosGenerales(conceptos.map((x) => ({ ...x, name: x.nombre })))) {
    if (usados.has(c.quoteItemId) || !c.aceptado || cobradoPor(c.quoteItemId)) continue;
    const l = lineaDeConcepto(c, null);
    if (l.neto > 0) lineas.push(l);
  }

  const abierta = notaAbierta(args.notas);
  return {
    ligarExistentes,
    lineas,
    destino: lineas.length === 0 ? null : abierta ? { tipo: "agregar", nota: abierta } : { tipo: "nueva" },
    omitidas,
    reemplazar: Array.from(reemplazar),
    religar,
    anotarCargos,
  };
}

// ── La cuenta del plan (lo que enseña la ficha) ─────────────────────────────

export interface FacturaDeLaCuenta {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  paid: number;
  /** ISO. Para abonar de la más vieja a la más nueva («Cobrar hoy»). */
  createdAt?: string;
}

export interface CuentaDelPlan {
  /** Lo que cuesta el plan: suma de sus filas vivas (o `totalCost` si es un plan de texto). */
  total: number;
  /** Σ total de las notas vivas. */
  facturado: number;
  /** Σ pagado (incluye el anticipo aplicado: es un pago). */
  pagado: number;
  /** Σ lo que falta pagar de cada nota viva. */
  saldo: number;
  /** Lo del plan que todavía no está en ninguna nota (filas sin nota, o el plan sin aceptar). */
  porFacturar: number;
  notas: FacturaDeLaCuenta[];
  /**
   * El dinero es de ESTE plan sin duda. Con la nota ligada por columna, sí. Por la vía vieja
   * (facturas de los presupuestos del plan) solo si sus conceptos son todos del plan y no hay
   * abonos viejos aplicados por saldo a favor (contarían dos veces) — `pagosDelPlan`, commit 36c1cbf5.
   */
  soloDelPlan: boolean;
}

/** Arma la cuenta. Las notas canceladas no cuentan. */
export function cuentaDelPlan(args: { total: number; facturas: FacturaDeLaCuenta[]; soloDelPlan?: boolean }): CuentaDelPlan {
  const vivas = args.facturas.filter((f) => f.status !== "CANCELLED");
  const facturado = round2(vivas.reduce((s, f) => s + (Number(f.total) || 0), 0));
  const pagado = round2(vivas.reduce((s, f) => s + (Number(f.paid) || 0), 0));
  const saldo = round2(vivas.reduce((s, f) => s + Math.max(0, (Number(f.total) || 0) - (Number(f.paid) || 0)), 0));
  const total = round2(Math.max(0, Number(args.total) || 0));
  return {
    total,
    facturado,
    pagado,
    saldo,
    porFacturar: round2(Math.max(0, total - facturado)),
    notas: vivas,
    soloDelPlan: args.soloDelPlan ?? true,
  };
}
