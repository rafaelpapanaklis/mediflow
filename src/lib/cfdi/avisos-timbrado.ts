// Avisos del timbrado (ws1-t4, vuelta 2: F-21 y F-24). PURO (client-safe).
//
// F-21 · El CFDI sale con la fecha de HOY. Si el dinero entró en otro mes, el
// SAT ve el ingreso en el mes del CFDI, no en el del cobro (y el RESICO tributa
// por lo efectivamente cobrado, art. 113-E LISR). No se bloquea nada: se avisa
// para que la clínica lo vea con su contador. CONFIRMAR CON CONTADOR.
//
// F-24 · Los rechazos del PAC llegaban técnicos («El campo DomicilioFiscalReceptor
// del receptor debe pertenecer…»). Se les añade qué revisar, sin esconder el
// texto original (soporte lo necesita tal cual).

function en(locale?: string | null): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en");
}

/** "2026-09" del instante en la zona de la clínica. */
export function mesEnZona(fecha: Date | string, timeZone?: string | null): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  try {
    const partes = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "America/Mexico_City", year: "numeric", month: "2-digit" }).formatToParts(d);
    const y = partes.find((p) => p.type === "year")?.value;
    const m = partes.find((p) => p.type === "month")?.value;
    return `${y}-${m}`;
  } catch {
    return d.toISOString().slice(0, 7);
  }
}

const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function nombreMes(ym: string, locale?: string | null): string {
  const [y, m] = ym.split("-").map(Number);
  const nombre = (en(locale) ? MESES_EN : MESES_ES)[(m || 1) - 1];
  return `${nombre} ${y}`;
}

/**
 * F-21 · ¿Algún cobro de lo que se va a timbrar entró en otro mes que el de hoy?
 * Devuelve el aviso (o null). Los reembolsos no cuentan.
 */
export function avisoMesDeCobro(args: {
  pagos: readonly { paidAt: Date | string | null | undefined; method?: string | null; amount?: number }[];
  ahora: Date;
  timeZone?: string | null;
  locale?: string | null;
}): { mesesDeCobro: string[]; mesDelCfdi: string; mensaje: string } | null {
  const mesDelCfdi = mesEnZona(args.ahora, args.timeZone);
  const meses = new Set<string>();
  for (const p of args.pagos) {
    if (!p?.paidAt || p.method === "refund" || (typeof p.amount === "number" && p.amount <= 0)) continue;
    meses.add(mesEnZona(p.paidAt, args.timeZone));
  }
  const otros = Array.from(meses).filter((m) => m !== mesDelCfdi).sort();
  if (otros.length === 0) return null;
  const lista = otros.map((m) => nombreMes(m, args.locale)).join(", ");
  const hoy = nombreMes(mesDelCfdi, args.locale);
  return {
    mesesDeCobro: otros,
    mesDelCfdi,
    mensaje: en(args.locale)
      ? `This was collected in ${lista}, but the CFDI is dated ${hoy}: the SAT will see the income in ${hoy}. Check with your accountant if it matters for that month's return.`
      : `Esto se cobró en ${lista}, pero el CFDI sale con fecha de ${hoy}: el SAT verá el ingreso en ${hoy}. Revísalo con tu contador si afecta la declaración de ese mes.`,
  };
}

// ── C-49 (auditoría de uso, 4-oct-2026): ¿ese cobro ya fue en la factura global? ──────────────
//
// Lo cobrado sin CFDI propio lo mete el contador en la factura global del periodo (RMF 2026,
// regla 2.7.1.21; «Cobrado sin CFDI» es su lista). Si después se timbra la nota sola, ese
// ingreso queda DOS veces ante el SAT. El panel no sabe si la global ya se emitió (la hace el
// contador por fuera), así que con cobros de un mes ANTERIOR no se timbra sin que quien timbra
// confirme que no entraron en la global de ese mes. La global es por lo menos mensual en la
// práctica; si la clínica la hace diaria o semanal, el riesgo también existe dentro del mes
// (CONFIRMAR CON CONTADOR).

export const CFDI_CONFIRMAR_GLOBAL = "CFDI_CONFIRMAR_GLOBAL";

/** Meses ANTERIORES al del CFDI (hoy) en que entró algún cobro de lo que se va a timbrar. */
export function mesesAnterioresDeCobro(args: {
  pagos: readonly { paidAt: Date | string | null | undefined; method?: string | null; amount?: number }[];
  ahora: Date;
  timeZone?: string | null;
}): string[] {
  const hoy = mesEnZona(args.ahora, args.timeZone);
  const meses = new Set<string>();
  for (const p of args.pagos) {
    if (!p?.paidAt || p.method === "refund" || (typeof p.amount === "number" && p.amount <= 0)) continue;
    const m = mesEnZona(p.paidAt, args.timeZone);
    if (m < hoy) meses.add(m);
  }
  return Array.from(meses).sort();
}

/** El texto de la casilla (y del 409 si no se marcó). */
export function textoConfirmarGlobal(meses: readonly string[], locale?: string | null): string {
  const lista = meses.map((m) => nombreMes(m, locale)).join(", ");
  return en(locale)
    ? `I confirm this was NOT included in the global invoice of ${lista} (the one your accountant issues with «Collected without CFDI»). If it was, don't stamp it: it would count twice with the SAT.`
    : `Confirmo que esto NO entró en la factura global de ${lista} (la que hace tu contador con «Cobrado sin CFDI»). Si entró, no lo timbres: quedaría dos veces ante el SAT.`;
}

/** El 409 del servidor cuando hay cobros de meses anteriores y no llegó la confirmación. null = puede seguir. */
export function bloqueoPorGlobal(args: {
  pagos: readonly { paidAt: Date | string | null | undefined; method?: string | null; amount?: number }[];
  ahora: Date;
  timeZone?: string | null;
  confirmado: unknown;
  locale?: string | null;
}): { code: string; error: string; meses: string[] } | null {
  if (args.confirmado === true) return null;
  const meses = mesesAnterioresDeCobro(args);
  if (meses.length === 0) return null;
  return { code: CFDI_CONFIRMAR_GLOBAL, error: textoConfirmarGlobal(meses, args.locale), meses };
}

/**
 * F-24 · Lo que hay que revisar ante un rechazo del PAC por los datos del
 * receptor (CFDI 4.0 los valida contra la lista del SAT). Devuelve el mensaje
 * original con la pista al final; si no reconoce el rechazo, lo deja igual.
 */
export function explicarRechazoPac(mensaje: string, locale?: string | null): string {
  const m = String(mensaje ?? "");
  const t = m.toLowerCase();
  const ing = en(locale);
  let pista: string | null = null;
  if (t.includes("domiciliofiscalreceptor") || t.includes("código postal") || t.includes("codigo postal") || /\bzip\b/.test(t)) {
    pista = ing
      ? "Check the patient's ZIP code against their tax status certificate (constancia de situación fiscal)."
      : "Revisa el código postal del paciente contra su constancia de situación fiscal.";
  } else if (t.includes("regimenfiscalreceptor") || t.includes("régimen") || t.includes("regimen")) {
    pista = ing
      ? "Check the patient's tax regime against their tax status certificate."
      : "Revisa el régimen fiscal del paciente contra su constancia de situación fiscal.";
  } else if (t.includes("usocfdi") || t.includes("uso del cfdi") || t.includes("uso de cfdi")) {
    pista = ing
      ? "The CFDI use doesn't match the patient's tax regime: choose another (G03 is valid for almost everyone except 616)."
      : "El uso del CFDI no corresponde al régimen del paciente: elige otro (G03 sirve para casi todos, salvo 616).";
  } else if (t.includes("lista de rfc") || t.includes("rfc inscritos") || t.includes("no se encuentra")) {
    pista = ing
      ? "The SAT doesn't have that RFC as active: check it letter by letter with the patient."
      : "El SAT no tiene ese RFC como activo: revísalo letra por letra con el paciente.";
  } else if (t.includes("nombre") && t.includes("receptor")) {
    pista = ing
      ? "The name must be exactly as on the tax status certificate (no «S.A. de C.V.» for companies, no accents added or missing)."
      : "El nombre tiene que ser exactamente el de su constancia de situación fiscal (sin «S.A. de C.V.» en empresas y con los mismos acentos).";
  }
  return pista ? `${m} — ${pista}` : m;
}
