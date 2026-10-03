// Reglas fiscales del timbrado dental (ws1-t4, tanda 0 de facturación, 3-oct-2026).
//
// PURO y client-safe (sin Prisma, sin fetch): lo usan las dos rutas de timbrado
// (`/api/cfdi`, `/api/payments/[id]/cfdi`) y los tres formularios (Facturación,
// detalle de factura y «Facturar este pago"), para que el formulario proponga lo
// mismo que el servidor acepta. Lo prueba src/lib/invoices/__tests__/cfdi-reglas.test.ts.
//
// Fuentes (auditoría ws1-t4 del 3-oct-2026):
//   · Retención ISR: art. 113-J LISR (RESICO PF → persona moral, 1.25%) y art. 106,
//     último párrafo, LISR (612 → persona moral, 10%).
//   · PUE solo con la operación pagada: RMF 2026, regla 2.7.1.39.
//   · Forma de pago: Anexo 20, Guía de llenado — «la forma de pago con la que se
//     liquida la mayor cantidad del pago»; con importes iguales, a consideración.
//   · Uso del CFDI: matriz c_UsoCFDI / régimen del receptor (D01 solo para
//     personas físicas 605, 606, 607, 608, 611, 612, 614, 615 y 625).

export type Idioma = "es" | "en";

function idioma(locale: string | null | undefined): Idioma {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en") ? "en" : "es";
}

function centavos(x: number): number {
  return Math.round((Number(x) || 0) * 100);
}

function pesos(c: number, loc: Idioma): string {
  const v = (c / 100).toLocaleString(loc === "en" ? "en-US" : "es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${v}`;
}

// ── Receptor ────────────────────────────────────────────────────────────────

export const RFC_PUBLICO_EN_GENERAL = "XAXX010101000";
export const RFC_EXTRANJERO = "XEXX010101000";

/** El RFC como lo lee el SAT: mayúsculas y sin espacios. */
export function normalizarRfc(rfc: unknown): string {
  return typeof rfc === "string" ? rfc.replace(/\s+/g, "").toUpperCase() : "";
}

export type TipoDePersona = "fisica" | "moral" | "generico" | "desconocido";

/**
 * RFC de 12 caracteres = persona moral; de 13 = persona física. Los genéricos
 * (público en general y extranjero) tienen 13 pero no son nadie en concreto.
 */
export function tipoDePersona(rfc: unknown): TipoDePersona {
  const r = normalizarRfc(rfc);
  if (r === RFC_PUBLICO_EN_GENERAL || r === RFC_EXTRANJERO) return "generico";
  if (r.length === 12) return "moral";
  if (r.length === 13) return "fisica";
  return "desconocido";
}

// ── F-01a · Candado de retenciones ──────────────────────────────────────────

/** Regímenes del EMISOR persona física a los que una persona moral les retiene ISR. */
export const REGIMENES_EMISOR_CON_RETENCION: readonly string[] = ["612", "626"];

export const CFDI_RETENCION_PENDIENTE = "CFDI_RETENCION_PENDIENTE";

export interface Bloqueo {
  code: string;
  error: string;
}

/**
 * Emisor 612 o 626 + receptor persona moral → la empresa tiene que retener ISR
 * (10% o 1.25%) y DaleControl todavía no pone retenciones en el CFDI: un CFDI
 * sin retención sale mal y en dental no se puede cancelar desde el panel. Se
 * corta antes de hablar con Facturapi. XAXX/XEXX y RFC de 13 pasan.
 */
export function bloqueoPorRetencion(args: {
  regimenEmisor: string | null | undefined;
  rfcReceptor: unknown;
  locale?: string | null;
}): Bloqueo | null {
  const regimen = typeof args.regimenEmisor === "string" ? args.regimenEmisor.trim() : "";
  if (!REGIMENES_EMISOR_CON_RETENCION.includes(regimen)) return null;
  if (tipoDePersona(args.rfcReceptor) !== "moral") return null;
  return {
    code: CFDI_RETENCION_PENDIENTE,
    error: idioma(args.locale) === "en"
      ? "Invoices to companies (12-character RFC) that require an ISR withholding can't be issued from DaleControl yet. Issue this one outside the system while we enable it."
      : "Todavía no se pueden emitir desde DaleControl facturas a empresas (RFC de 12 caracteres) con retención de ISR; emítela por fuera mientras lo habilitamos.",
  };
}

// ── F-04 · PUE con saldo ────────────────────────────────────────────────────

export const CFDI_CON_SALDO = "CFDI_CON_SALDO";
export const CFDI_CON_SALDO_A_PLAZOS = "CFDI_CON_SALDO_A_PLAZOS";

/**
 * La factura COMPLETA sale como PUE («pagado en una sola exhibición»): con saldo
 * no se timbra, sin excepción ni «confirmar y timbrar igual».
 *   · A plazos (ortodoncia, enganche + mensualidades): cada pago ya cobrado se
 *     factura por su lado con «Facturar este pago».
 *   · Sin plan: se timbra cuando quede pagada.
 * Un centavo de holgura, igual que antes (`paid + 0.01 >= total`).
 */
export function bloqueoPorSaldo(args: {
  total: number;
  paid: number;
  esAPlazos: boolean;
  locale?: string | null;
}): Bloqueo | null {
  const saldoC = centavos(args.total) - centavos(args.paid);
  if (saldoC <= 1) return null;
  const loc = idioma(args.locale);
  const saldo = pesos(saldoC, loc);
  if (args.esAPlazos) {
    return {
      code: CFDI_CON_SALDO_A_PLAZOS,
      error: loc === "en"
        ? `This invoice still has a balance (${saldo}): invoice each payment already collected with "Invoice this payment", next to each payment under Payments.`
        : `Esta factura tiene saldo (${saldo}): factura cada pago cobrado con «Facturar este pago», junto a cada pago en «Movimientos».`,
    };
  }
  return {
    code: CFDI_CON_SALDO,
    error: loc === "en"
      ? `This invoice still has a balance (${saldo}). The CFDI for the whole invoice is issued once it is fully paid (PUE means "paid in a single payment").`
      : `Esta factura tiene saldo (${saldo}). El CFDI de la factura completa se emite cuando quede pagada (PUE quiere decir «pagado en una sola exhibición»).`,
  };
}

/**
 * Texto del aviso del formulario (sin cifra: el formulario ya la muestra).
 * `esAPlazos` null = el formulario no sabe si la factura es a plazos (la lista
 * de Facturación no trae las condiciones): se dicen los dos caminos.
 */
export function avisoDeSaldo(esAPlazos: boolean | null, locale?: string | null): string {
  const loc = idioma(locale);
  if (esAPlazos === null) {
    return loc === "en"
      ? 'This invoice still has a balance, so the whole invoice can\'t be stamped yet. If it is paid in installments, open the invoice and use "Invoice this payment" next to each payment already collected; otherwise, stamp it once it is fully paid.'
      : "Esta factura tiene saldo, así que todavía no se puede timbrar completa. Si es a plazos, abre la factura y usa «Facturar este pago» junto a cada pago cobrado; si no, se timbra cuando quede pagada.";
  }
  if (esAPlazos) {
    return loc === "en"
      ? 'This invoice still has a balance: invoice each payment already collected with "Invoice this payment", next to each payment under Payments. The whole invoice can be stamped only once it is fully paid.'
      : "Esta factura tiene saldo: factura cada pago cobrado con «Facturar este pago», junto a cada pago en «Movimientos». La factura completa solo se timbra cuando quede pagada.";
  }
  return loc === "en"
    ? "This invoice still has a balance. The CFDI is issued once it is fully paid: record the missing payment first."
    : "Esta factura tiene saldo. El CFDI se emite cuando quede pagada: registra primero el cobro que falta.";
}

// ── F-10 · Uso del CFDI según el régimen del receptor ───────────────────────

/** Personas físicas que pueden deducir honorarios dentales (D01). */
export const REGIMENES_CON_D01: readonly string[] = ["605", "606", "607", "608", "611", "612", "614", "615", "625"];

/**
 * Uso por defecto: 616 (sin obligaciones, público en general) → S01; persona
 * moral (RFC de 12) o RESICO 626 → G03; personas físicas con deducciones
 * personales → D01; el resto → G03 (siempre válido para quien no es 616).
 */
export function usoCfdiPorRegimen(regimen: string | null | undefined, rfc?: unknown): string {
  const r = typeof regimen === "string" ? regimen.trim() : "";
  if (r === "616" || tipoDePersona(rfc) === "generico") return "S01";
  if (tipoDePersona(rfc) === "moral") return "G03";
  if (REGIMENES_CON_D01.includes(r)) return "D01";
  return "G03";
}

// ── F-06 · Forma de pago (c_FormaPago) ──────────────────────────────────────

/**
 * Método interno → forma de pago SAT. `null` = el panel NO sabe con qué pagó el
 * paciente y recepción tiene que escogerlo: Mercado Pago (crédito, débito,
 * OXXO…), «tarjeta» sin decir de cuál, el pago en línea del portal y «otro».
 * `anticipo` no está: hereda la forma del dinero que formó el saldo a favor.
 */
export const METODO_A_FORMA_SAT: Readonly<Record<string, string | null>> = {
  cash: "01",
  efectivo: "01",
  oxxo: "01",
  check: "02",
  transfer: "03",
  transferencia: "03",
  spei: "03",
  credit: "04",
  debit: "28",
  card: null,
  online: null,
  stripe: null,
  mercadopago: null,
  other: null,
  manual: null,
};

export const METODO_ANTICIPO_SAT = "anticipo";

/** La forma SAT de un método (null = no se sabe). */
export function formaDeMetodo(method: string | null | undefined, formaDeAnticipo?: string | null): string | null {
  if (!method) return null;
  if (method === METODO_ANTICIPO_SAT) return formaDeAnticipo ?? null;
  return METODO_A_FORMA_SAT[method] ?? null;
}

export interface PagoParaForma {
  method: string | null | undefined;
  amount: number;
}

/**
 * La forma del pago de MAYOR importe, sumando por forma (dos pagos en efectivo
 * cuentan juntos). Los reembolsos no cuentan.
 *
 * Con pagos de forma desconocida (Mercado Pago…) solo se propone una forma si
 * gana PASE LO QUE PASE con lo desconocido: si eso pudo ser de otra forma y
 * cambiar el ganador, devuelve null y el formulario obliga a escoger.
 * Empate entre formas conocidas: la de clave menor, para que siempre salga lo
 * mismo (la Guía deja escoger cualquiera de las empatadas).
 */
export function formaDePagoSat(pagos: readonly PagoParaForma[], formaDeAnticipo?: string | null): string | null {
  const porForma = new Map<string, number>();
  let desconocidoC = 0;
  for (const p of pagos) {
    if (!p || p.method === "refund") continue;
    const c = centavos(p.amount);
    if (c <= 0) continue;
    const forma = formaDeMetodo(p.method, formaDeAnticipo);
    if (forma) porForma.set(forma, (porForma.get(forma) ?? 0) + c);
    else desconocidoC += c;
  }
  if (porForma.size === 0) return null;
  const orden = Array.from(porForma.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [ganadora, montoC] = orden[0];
  const segundoC = orden.length > 1 ? orden[1][1] : 0;
  // Lo desconocido pudo ser todo de la segunda forma, o de una forma nueva.
  if (montoC < segundoC + desconocidoC || montoC < desconocidoC) return null;
  return ganadora;
}

/**
 * La forma de un saldo a favor, a partir de las formas del dinero que lo formó
 * (`null` = un origen que no se sabe). Solo si TODO salió de la misma forma.
 */
export function formaDeOrigenes(origenes: readonly (string | null)[]): string | null {
  if (origenes.length === 0) return null;
  const formas = new Set<string>();
  for (const o of origenes) {
    if (!o) return null;
    formas.add(o);
  }
  return formas.size === 1 ? Array.from(formas)[0] : null;
}

export const CFDI_FORMA_PAGO_REQUERIDA = "CFDI_FORMA_PAGO_REQUERIDA";

export function errorFormaDePagoRequerida(locale?: string | null): Bloqueo {
  return {
    code: CFDI_FORMA_PAGO_REQUERIDA,
    error: idioma(locale) === "en"
      ? "Choose the payment form: the system doesn't know how the patient paid (card, debit, cash…)."
      : "Elige la forma de pago: el sistema no sabe con qué pagó el paciente (tarjeta de crédito, débito, efectivo…).",
  };
}

// ── F-13 · Límite de timbrado por clínica ───────────────────────────────────

/** Timbrados por clínica por hora (antes: 5 por IP). El cupo y el apartado ya frenan abusos. */
export const LIMITE_TIMBRADO_POR_HORA = 60;
export const VENTANA_TIMBRADO_MS = 60 * 60 * 1000;

export function llaveLimiteTimbrado(clinicId: string): string {
  return `cfdi-timbrado:${clinicId}`;
}

export function errorLimiteTimbrado(locale?: string | null): Bloqueo {
  return {
    code: "CFDI_LIMITE_POR_HORA",
    error: idioma(locale) === "en"
      ? `Your clinic reached ${LIMITE_TIMBRADO_POR_HORA} CFDIs in one hour. Wait a few minutes and try again.`
      : `Tu clínica llegó a ${LIMITE_TIMBRADO_POR_HORA} timbrados en una hora. Espera unos minutos y vuelve a intentarlo.`,
  };
}
