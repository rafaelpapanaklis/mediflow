// El PDF del plan de tratamiento (ws1-t12): QUÉ lleva, en funciones puras.
//
// El plan dental guarda sus procedimientos como TEXTO en `description`
// (`plan-tratamiento-rediseno/plan-clinico.ts`). Se leen con el mismo lector que
// usa «Convertir en presupuesto» (`armarPresupuestoDePlan`, `lib/quotes/desde-plan.ts`),
// así que el PDF y el presupuesto que nace del plan dicen los mismos conceptos y
// los mismos precios (el exacto del tarifario cuando el texto lo redondeó).
//
// ⛔ Lo que NUNCA sale: las notas del plan. Ni el bloque «▸ Notas: …» de la ventana
// nueva ni la descripción libre de un plan de los de antes (que ES la nota). Por eso
// aquí no se copia `description` a ninguna parte: solo los renglones que el lector
// reconoce como procedimientos. Diagnóstico, pronóstico y alternativa tampoco salen
// (no los pidió el encargo; ver «DECISIONES PARA RAFAEL» del reporte ws1-t12).
//
// Dinero (revisión t4, P1–P3):
//  · cada precio sale TAL CUAL está en el plan: con centavos si los tiene, y un
//    procedimiento sin precio en el plan (cortesía) sale en $0 — el tarifario NO lo
//    rellena (eso es cosa de «Convertir en presupuesto», que avisa «sin precio»).
//    Si NINGÚN renglón trae precio (el plan solo tiene costo total), la columna dice «—»
//    y no hay subtotal;
//  · el TOTAL es siempre el costo del plan (`totalCost`), el mismo que enseña la ficha;
//  · si el costo no cuadra con la suma, la diferencia se explica con su nombre:
//    «Redondeo» cuando cabe en el redondeo a pesos que hacían los planes viejos (el texto
//    escribía $501 por $500.50: hasta 50 centavos por unidad de cada precio leído así),
//    «Descuento» cuando el costo es menor, «Ajuste» cuando es mayor. Nunca un descuento
//    que nadie dio;
//  · el plan no tiene IVA ni descuentos propios (`model TreatmentPlan` no tiene dónde);
//  · lo pagado solo se sabe por los presupuestos ligados al plan (`quotes.treatmentPlanId`)
//    y sus facturas. El SALDO solo sale cuando es seguro: lo facturado de esos presupuestos
//    es exactamente el costo del plan, y entonces es lo que falta pagar de esas facturas. Con
//    un descuento del presupuesto, un presupuesto que mezcla otros conceptos o una parte sin
//    facturar, no se puede saber: sale «Pagado» y nada más. Nunca un saldo que no se debe.

import { armarPresupuestoDePlan, leerRenglonesDelPlan, type ProcedimientoTarifario } from "@/lib/quotes/desde-plan";

/** Diferencias menores a medio centavo no son diferencias. */
const CENTAVO = 0.005;

export interface PlanParaPdf {
  name: string;
  description: string | null;
  totalCost: number;
}

export interface RenglonPdf {
  nombre: string;
  /** «16, 26 (MO)» o "" si el renglón no va a una pieza. */
  zona: string;
  /** Nombre de la fase tal como lo escribió la ventana; "" si el plan no tiene fases. */
  fase: string;
  /** El hallazgo que lo justifica («Caries»), o "". */
  motivo: string;
  cantidad: number;
  /** null = el plan no trae precios por renglón (solo costo total): se pinta «—». */
  precioUnitario: number | null;
  importe: number | null;
}

export interface GrupoPdf {
  fase: string;
  renglones: RenglonPdf[];
  /** null = sin precios por renglón. */
  subtotal: number | null;
}

export interface PagosDelPlan {
  /** Σ `paid` de las facturas vivas que salieron de los presupuestos del plan. */
  pagado: number;
  /** Facturas encontradas. 0 = el sistema no sabe de pagos de este plan. */
  facturas: number;
  /** Σ `total` de esas facturas (ya con el descuento del presupuesto, si lo hubo). */
  facturado: number;
  /** Σ lo que falta pagar de cada una (total − pagado, nunca negativo). */
  porPagar: number;
}

export type TipoAjuste = "redondeo" | "descuento" | "ajuste";

export interface DocumentoDelPlan {
  grupos: GrupoPdf[];
  /** El plan no traía procedimientos detallados: un solo renglón con su nombre y su costo. */
  sinDetalle: boolean;
  /** null = ningún renglón trae precio: no hay subtotal que enseñar. */
  subtotal: number | null;
  /** total − subtotal con su nombre; null si cuadra. */
  ajuste: { tipo: TipoAjuste; monto: number } | null;
  total: number;
  /** null = no se enseñan pagos (sin permiso o sin facturas del plan). `saldo` null = no se sabe con certeza. */
  pagos: { pagado: number; saldo: number | null } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const tieneCentavos = (n: number) => Math.round(Math.abs(n) * 100) % 100 !== 0;

function zonaDe(dientes: string, caras: string): string {
  const lista = dientes ? dientes.split(",").map((d) => d.trim()).filter(Boolean).join(", ") : "";
  if (!lista) return "";
  return caras ? `${lista} (${caras})` : lista;
}

/** Pagado y, solo si es seguro, saldo (ver arriba). */
export function pagosParaElPapel(total: number, pagos: PagosDelPlan | null): DocumentoDelPlan["pagos"] {
  if (!pagos || pagos.facturas <= 0) return null;
  const pagado = r2(Math.max(0, num(pagos.pagado)));
  const cuadra = Math.abs(r2(num(pagos.facturado)) - total) < CENTAVO;
  return { pagado, saldo: cuadra ? r2(Math.max(0, num(pagos.porPagar))) : null };
}

/** El nombre de la diferencia entre la suma de los renglones y el costo del plan. */
export function tipoDeAjuste(diferencia: number, toleranciaRedondeo: number): TipoAjuste | null {
  if (Math.abs(diferencia) < CENTAVO) return null;
  if (Math.abs(diferencia) <= toleranciaRedondeo + CENTAVO) return "redondeo";
  return diferencia < 0 ? "descuento" : "ajuste";
}

/**
 * Arma el contenido del PDF. `pagos` llega solo si quien descarga puede ver la
 * facturación; con `facturas: 0` es lo mismo que no saber nada.
 */
export function armarDocumentoDelPlan(
  plan: PlanParaPdf,
  tarifario: ProcedimientoTarifario[],
  pagos: PagosDelPlan | null = null,
): DocumentoDelPlan {
  // El total es el costo del plan, el que enseña la ficha (también un plan confirmado «sin costo»).
  const total = Math.max(0, r2(num(plan.totalCost)));
  const leidos = leerRenglonesDelPlan(plan.description);

  if (leidos.length === 0) {
    // Plan sin detalle (o de los de antes, cuya descripción es la nota): su nombre y su costo.
    const nombre = plan.name.trim() || "—";
    return {
      grupos: [{ fase: "", renglones: [{ nombre, zona: "", fase: "", motivo: "", cantidad: 1, precioUnitario: total, importe: total }], subtotal: total }],
      sinDetalle: true,
      subtotal: total,
      ajuste: null,
      total,
      pagos: pagosParaElPapel(total, pagos),
    };
  }

  // Los conceptos salen 1:1 y en orden de los renglones leídos. Del armado del presupuesto
  // solo se toma el precio EXACTO del tarifario cuando el texto lo traía redondeado.
  const conceptos = armarPresupuestoDePlan(plan, tarifario).conceptos;
  const conPrecio = leidos.some((l) => l.precio != null && l.precio > 0);
  let toleranciaRedondeo = 0;
  const renglones: RenglonPdf[] = leidos.map((leido, i) => {
    const c = conceptos[i];
    const cantidad = num(leido.cantidad) || 1;
    let precioUnitario: number | null;
    if (!conPrecio) precioUnitario = null;
    else if (leido.precio == null || leido.precio <= 0) precioUnitario = 0; // cortesía: $0, como en el plan
    else {
      precioUnitario = r2(c?.origen === "tarifario" ? num(c.unitPrice) : leido.precio);
      // Un precio entero leído del texto pudo ser $X.50 redondeado por la ventana vieja.
      if (c?.origen !== "tarifario" && !tieneCentavos(leido.precio)) toleranciaRedondeo += cantidad * 0.5;
    }
    return {
      nombre: leido.nombre,
      zona: zonaDe(leido.dientes, leido.caras),
      fase: leido.faseNombre,
      motivo: leido.motivo,
      cantidad,
      precioUnitario,
      importe: precioUnitario == null ? null : r2(cantidad * precioUnitario),
    };
  });

  const grupos: GrupoPdf[] = [];
  for (const r of renglones) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fase === r.fase) ultimo.renglones.push(r);
    else grupos.push({ fase: r.fase, renglones: [r], subtotal: null });
  }
  for (const g of grupos) g.subtotal = conPrecio ? r2(g.renglones.reduce((a, r) => a + (r.importe ?? 0), 0)) : null;

  const subtotal = conPrecio ? r2(renglones.reduce((a, r) => a + (r.importe ?? 0), 0)) : null;
  const diferencia = subtotal == null ? 0 : r2(total - subtotal);
  const tipo = subtotal == null ? null : tipoDeAjuste(diferencia, toleranciaRedondeo);

  return {
    grupos,
    sinDetalle: false,
    subtotal,
    ajuste: tipo ? { tipo, monto: diferencia } : null,
    total,
    pagos: pagosParaElPapel(total, pagos),
  };
}

// ── Texto que Helvetica sabe pintar (revisión t4, P5) ──────────────────────
//
// La Helvetica de @react-pdf solo trae WinAnsi (Windows-1252). Un emoji, el cirílico o el
// chino no lanzan: salen como basura («Zoë 🙂» → «Zoë =B»). Registrar otra fuente es otra
// tarea (lo vigila `tipografia-panel.test.ts`), así que se quitan limpiamente: acentos, ñ,
// ü, «» y € se quedan; lo demás se va y los espacios se recogen.

/** Los de 0x80–0x9F de Windows-1252 que sí tienen glifo. */
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function textoParaHelvetica(texto: string | null | undefined): string {
  if (!texto) return "";
  let salida = "";
  for (const ch of texto.normalize("NFC").replace(/[\u2212\u2010\u2011]/g, "-").replace(/[\t\r\n\u00a0\u2000-\u200a\u202f\u205f]/g, " ")) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRA.has(ch)) salida += ch;
  }
  return salida.replace(/ {2,}/g, " ").replace(/\s+([,.;:)])/g, "$1").trim();
}

/** «plan-de-tratamiento-ana-lopez-2026-10-20.pdf»: sin acentos, espacios ni símbolos. */
export function nombreDeArchivo(base: string, paciente: string, dia: string): string {
  const limpio = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [limpio(base) || "plan", limpio(paciente), dia].filter(Boolean).join("-").slice(0, 120) + ".pdf";
}
