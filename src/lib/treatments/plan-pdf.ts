// El PDF del plan de tratamiento (ws1-t12): QUÉ lleva, en funciones puras.
//
// REGLA (gerente, revisión t8): el papel nunca dice algo que no sea cierto; lo que no se
// puede saber con certeza, no se imprime.
//
// El plan dental guarda sus procedimientos como TEXTO en `description`
// (`plan-tratamiento-rediseno/plan-clinico.ts`) y se leen con el mismo lector que usa
// «Convertir en presupuesto» (`leerRenglonesDelPlan`, `lib/quotes/desde-plan.ts`).
//
// ⛔ Lo que NUNCA sale: las notas del plan. Ni el bloque «▸ Notas: …» de la ventana
// nueva ni la descripción libre de un plan de los de antes (que ES la nota). Por eso
// aquí no se copia `description` a ninguna parte: solo los renglones que el lector
// reconoce como procedimientos. Diagnóstico, pronóstico y alternativa tampoco salen.
//
// Dinero (revisiones t4 y t8):
//  · cada precio y cada cantidad salen TAL CUAL están en el plan ($449.60 es $449.60;
//    «1.5 ×» es 1.5). El tarifario NUNCA pisa un precio del plan, y una cortesía sin
//    precio sale en $0. Si NINGÚN renglón trae precio (el plan solo tiene costo total),
//    la columna dice «—» y no hay subtotal;
//  · el TOTAL es siempre el costo del plan (`totalCost`), el mismo que enseña la ficha;
//  · si el costo no cuadra con la suma de los renglones, la diferencia lleva el nombre que
//    se puede asegurar (`nombreDeLaDiferencia`): «Descuento»/«Ajuste» cuando el texto es
//    exacto (lo dice la marca de la ventana, `textoEsExacto`); «Redondeo de precios» solo en
//    un plan VIEJO (sin marca) cuyo costo coincide con el total de procedimientos que él mismo
//    escribió (la diferencia es solo el redondeo a pesos del texto); y si en un plan viejo no
//    se puede separar redondeo de descuento, el neutro «Ajuste» con su signo — que nunca
//    esconde la cifra ni inventa un descuento;
//  · el plan no tiene IVA ni descuentos propios (`model TreatmentPlan` no tiene dónde);
//  · NI «Pagado» NI «Saldo» (decisión del gerente, tercera vuelta t8): dieron un hallazgo alto
//    en tres revisiones seguidas y Rafael pidió el plan «con precios». Lo pagado se consulta en
//    el estado de cuenta del paciente, no en este papel.

import { leerRenglonesDelPlan, leerTotalDelPlan, textoPuedeEstarRedondeado } from "@/lib/quotes/desde-plan";

/** Diferencias menores a medio centavo no son diferencias. */
const CENTAVO = 0.005;

/**
 * Un renglón con más letras que esto (nombre + motivo + zona) puede no caber junto con los
 * totales y las firmas en una hoja: deja de viajar con ellos y se puede partir entre hojas
 * (revisión t8, N-P7). Son ~14 líneas de texto en la columna del procedimiento.
 */
export const LETRAS_DE_RENGLON_GRANDE = 600;

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
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function zonaDe(dientes: string, caras: string): string {
  const lista = dientes ? dientes.split(",").map((d) => d.trim()).filter(Boolean).join(", ") : "";
  if (!lista) return "";
  return caras ? `${lista} (${caras})` : lista;
}

/**
 * El nombre que se puede asegurar para la diferencia entre la suma de los renglones y el costo.
 *
 *  · texto exacto (plan nuevo o con centavos): «Descuento» si el costo es menor, «Ajuste» si es mayor;
 *  · texto que pudo redondear (plan viejo): «Redondeo de precios» solo si la diferencia cabe en ese
 *    redondeo (50 ¢ por unidad de cada precio) Y el costo es el total de procedimientos que el
 *    propio plan escribió (redondeado igual): nadie tecleó otro costo. Si no, no se puede separar
 *    cuánto es redondeo y cuánto descuento: «Ajuste», con su signo.
 */
export function nombreDeLaDiferencia(args: {
  diferencia: number;
  textoRedondeado: boolean;
  toleranciaRedondeo: number;
  total: number;
  totalEscrito: number | null;
}): TipoAjuste | null {
  const { diferencia } = args;
  if (Math.abs(diferencia) < CENTAVO) return null;
  if (!args.textoRedondeado) return diferencia < 0 ? "descuento" : "ajuste";
  const costoSinTocar = args.totalEscrito != null && Math.abs(Math.round(args.total) - args.totalEscrito) < CENTAVO;
  if (costoSinTocar && Math.abs(diferencia) <= args.toleranciaRedondeo + CENTAVO) return "redondeo";
  return "ajuste";
}

/** Arma el contenido del PDF. */
export function armarDocumentoDelPlan(plan: PlanParaPdf): DocumentoDelPlan {
  // El total es el costo del plan, el que enseña la ficha (también un plan confirmado «sin costo»).
  const total = Math.max(0, r2(num(plan.totalCost)));
  const leidos = leerRenglonesDelPlan(plan.description);

  if (leidos.length === 0) {
    // Plan sin detalle (o de los de antes, cuya descripción es la nota): su nombre y su costo.
    return {
      grupos: [{ fase: "", renglones: [{ nombre: plan.name.trim(), zona: "", fase: "", motivo: "", cantidad: 1, precioUnitario: total, importe: total }], subtotal: total }],
      sinDetalle: true,
      subtotal: total,
      ajuste: null,
      total,
    };
  }

  const textoRedondeado = textoPuedeEstarRedondeado(plan);
  const conPrecio = leidos.some((l) => l.precio != null && l.precio > 0);
  let toleranciaRedondeo = 0;
  const renglones: RenglonPdf[] = leidos.map((leido) => {
    // Tal cual, también un «0 ×» de un plan de antes (importe $0; t8, N3-P3).
    const cantidad = leido.cantidad >= 0 ? leido.cantidad : 1;
    let precioUnitario: number | null;
    if (!conPrecio) precioUnitario = null;
    else if (leido.precio == null || leido.precio <= 0) precioUnitario = 0; // cortesía: $0, como en el plan
    else {
      precioUnitario = r2(leido.precio); // el del PLAN, nunca el del tarifario
      if (textoRedondeado) toleranciaRedondeo += cantidad * 0.5;
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
  const tipo =
    subtotal == null
      ? null
      : nombreDeLaDiferencia({ diferencia, textoRedondeado, toleranciaRedondeo, total, totalEscrito: leerTotalDelPlan(plan.description) });

  return {
    grupos,
    sinDetalle: false,
    subtotal,
    ajuste: tipo ? { tipo, monto: diferencia } : null,
    total,
  };
}

/** ¿Es un renglón demasiado grande para viajar con los totales y las firmas? (N-P7) */
export function esRenglonGrande(r: Pick<RenglonPdf, "nombre" | "motivo" | "zona">): boolean {
  return r.nombre.length + r.motivo.length + r.zona.length > LETRAS_DE_RENGLON_GRANDE;
}

// ── Texto que Helvetica sabe pintar (revisiones t4 P5 y t8 N-P6) ───────────
//
// La Helvetica de @react-pdf solo trae WinAnsi (Windows-1252). Un emoji, el cirílico o el
// chino no lanzan: salen como basura («Zoë 🙂» → «Zoë =B»). Registrar otra fuente es otra
// tarea (lo vigila `tipografia-panel.test.ts`). Así que:
//  · lo que WinAnsi trae (acentos del español, ñ, ü, «», €…) se queda tal cual;
//  · una letra latina que no está (Ł, ễ, Ș, ő…) pierde SOLO el acento: Ł→L, ễ→e, Ș→S;
//  · lo demás (emoji, otros alfabetos) se quita limpiamente y se recogen los espacios;
//  · si de un texto que sí traía algo no queda nada, se pinta «—» (`textoParaPintar`).

/** Los de 0x80–0x9F de Windows-1252 que sí tienen glifo. */
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Letras latinas sin descomposición Unicode: su letra base a mano. */
const LETRA_BASE: Record<string, string> = {
  Ł: "L", ł: "l", Đ: "D", đ: "d", Ħ: "H", ħ: "h", ı: "i", Ŀ: "L", ŀ: "l", Ŧ: "T", ŧ: "t",
  Ɓ: "B", ƀ: "b", Ɗ: "D", Ƒ: "F", Ɠ: "G", Ɨ: "I", ɨ: "i", Ƙ: "K", ƙ: "k", ƚ: "l", Ɲ: "N", ɲ: "n",
  Ƥ: "P", ƥ: "p", Ʈ: "T", Ʋ: "V", Ƴ: "Y", ƴ: "y", Ƶ: "Z", ƶ: "z", ĸ: "k", ŉ: "n", Ŋ: "N", ŋ: "n",
  ẞ: "SS", Ǆ: "DZ", ǅ: "Dz", ǆ: "dz", Ǉ: "LJ", ǈ: "Lj", ǉ: "lj", Ǌ: "NJ", ǋ: "Nj", ǌ: "nj", Ĳ: "IJ", ĳ: "ij",
};

const enWinAnsi = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRA.has(ch);
};

/** Marcas combinantes (acentos sueltos) de los bloques que usan las letras latinas. */
const MARCAS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

export function textoParaHelvetica(texto: string | null | undefined): string {
  if (!texto) return "";
  let salida = "";
  const limpio = texto
    .normalize("NFC")
    .replace(/[−‐‑]/g, "-")
    .replace(/[\t\r\n  -   ]/g, " ");
  for (const ch of limpio) {
    if (enWinAnsi(ch)) {
      salida += ch;
      continue;
    }
    if (LETRA_BASE[ch]) {
      salida += LETRA_BASE[ch];
      continue;
    }
    // Quitar SOLO el acento: la letra descompuesta sin sus marcas, si lo que queda se puede pintar.
    const base = ch.normalize("NFD").replace(MARCAS, "");
    if (base && base !== ch && [...base].every(enWinAnsi)) salida += base;
  }
  return salida.replace(/ {2,}/g, " ").replace(/\s+([,.;:)])/g, "$1").trim();
}

/** Para pintar: lo que Helvetica sabe, y «—» si de un texto que traía algo no quedó nada. */
export function textoParaPintar(texto: string | null | undefined): string {
  const limpio = textoParaHelvetica(texto);
  return limpio || (texto && texto.trim() ? "—" : "");
}

/** «plan-de-tratamiento-ana-lopez-2026-10-20.pdf»: sin acentos, espacios ni símbolos. */
export function nombreDeArchivo(base: string, paciente: string, dia: string): string {
  const limpio = (s: string) =>
    textoParaHelvetica(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [limpio(base) || "plan", limpio(paciente), dia].filter(Boolean).join("-").slice(0, 120) + ".pdf";
}
