// El RECEPTOR del CFDI contra las reglas del SAT, antes de hablar con Facturapi (ws1-t4,
// auditoría de uso C-47, 4-oct-2026). Antes se aceptaba un RFC de 12 con 612 (o de 13 con 601),
// el RFC de público en general iba con el nombre y el CP que se tecleara, y el de extranjero
// salía como nacional desde el formulario de la lista. Todo eso lo rechaza el PAC al timbrar.
//
// Fuentes (Anexo 20, Guía de llenado del CFDI 4.0, nodo Receptor; catálogos c_RegimenFiscal y
// c_UsoCFDI):
//   · RegimenFiscalReceptor tiene que aplicar al tipo de persona del RFC (12 = moral, 13 = física).
//   · Rfc XAXX010101000 (público en general): Nombre «PUBLICO EN GENERAL», RegimenFiscalReceptor
//     616, UsoCFDI S01 y DomicilioFiscalReceptor = el CP del lugar de expedición (el del emisor).
//   · UsoCFDI D01…D10 (deducciones personales) solo para personas físicas con esos regímenes.
//   · Rfc XEXX010101000: residencia fiscal y NumRegIdTrib (lib/cfdi/extranjero.ts).
//
// PURO (client-safe): lo usan los dos timbrados y los formularios.

import { PERSONA_DEL_REGIMEN } from "@/lib/cfdi/emisor";
import { REGIMENES_CON_D01, RFC_EXTRANJERO, RFC_PUBLICO_EN_GENERAL, normalizarRfc, tipoDePersona } from "@/lib/invoices/cfdi-reglas";

export const NOMBRE_PUBLICO_EN_GENERAL = "PUBLICO EN GENERAL";
export const REGIMEN_PUBLICO_EN_GENERAL = "616";
export const USO_PUBLICO_EN_GENERAL = "S01";

function en(locale?: string | null): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en");
}

export function esPublicoEnGeneral(rfc: unknown): boolean {
  return normalizarRfc(rfc) === RFC_PUBLICO_EN_GENERAL;
}

/**
 * Con XAXX010101000 el receptor no es nadie: nombre, régimen y CP los fija el SAT (el CP es el
 * del emisor). Se rellenan aquí en vez de mandar lo que se haya tecleado. Sin CP del emisor se
 * deja el capturado (y Facturapi usa el de la organización).
 */
export function receptorDePublicoEnGeneral<T extends { rfc: string; nombre: string; regimenFiscal: string; cp: string }>(
  r: T,
  cpEmisor: string | null | undefined,
): T {
  if (!esPublicoEnGeneral(r.rfc)) return r;
  const cp = typeof cpEmisor === "string" && /^\d{5}$/.test(cpEmisor.trim()) ? cpEmisor.trim() : r.cp;
  return { ...r, rfc: RFC_PUBLICO_EN_GENERAL, nombre: NOMBRE_PUBLICO_EN_GENERAL, regimenFiscal: REGIMEN_PUBLICO_EN_GENERAL, cp };
}

/**
 * ¿El receptor (nacional) pasa las reglas del SAT? null = sí; si no, qué corregir. El extranjero
 * se valida aparte (errorDeReceptorExtranjero); aquí solo se avisa si llega XEXX sin marcarlo.
 */
export function errorDeReceptor(r: { rfc: unknown; regimenFiscal: unknown }, uso: unknown, locale?: string | null): string | null {
  const ing = en(locale);
  const rfc = normalizarRfc(r.rfc);
  if (rfc === RFC_EXTRANJERO) {
    return ing
      ? "XEXX010101000 is the RFC for foreigners: tick «Foreign patient» and enter their country and tax ID."
      : "XEXX010101000 es el RFC de extranjeros: marca «Paciente extranjero» y captura su país y su identificación fiscal.";
  }
  if (rfc === RFC_PUBLICO_EN_GENERAL) return null;
  const regimen = typeof r.regimenFiscal === "string" ? r.regimenFiscal.trim() : "";
  const aplica = PERSONA_DEL_REGIMEN[regimen];
  if (!aplica) {
    return ing
      ? `The patient's tax regime «${regimen || "—"}» is not in the SAT catalog.`
      : `El régimen fiscal del paciente «${regimen || "—"}» no está en el catálogo del SAT.`;
  }
  const persona = tipoDePersona(rfc);
  if (persona === "moral" && !aplica.includes("moral")) {
    return ing
      ? `Regime ${regimen} is only for individuals, and a 12-character RFC belongs to a company. Check the regime on the patient's tax certificate.`
      : `El régimen ${regimen} es solo para personas físicas y un RFC de 12 caracteres es de una empresa. Revisa el régimen en la constancia de situación fiscal del paciente.`;
  }
  if (persona === "fisica" && !aplica.includes("fisica")) {
    return ing
      ? `Regime ${regimen} is only for companies, and a 13-character RFC belongs to an individual. Check the regime on the patient's tax certificate.`
      : `El régimen ${regimen} es solo para empresas y un RFC de 13 caracteres es de persona física. Revisa el régimen en la constancia de situación fiscal del paciente.`;
  }
  const u = typeof uso === "string" ? uso.trim() : "";
  if (regimen === "616" && u && u !== USO_PUBLICO_EN_GENERAL) {
    return ing
      ? "Regime 616 (no tax obligations) only accepts CFDI use S01."
      : "El régimen 616 (sin obligaciones fiscales) solo admite el uso S01 (sin efectos fiscales).";
  }
  if (/^D(0[1-9]|10)$/.test(u) && (persona !== "fisica" || !REGIMENES_CON_D01.includes(regimen))) {
    return ing
      ? `CFDI use ${u} (personal deductions) is only for individuals in regimes ${REGIMENES_CON_D01.join(", ")}. Use G03.`
      : `El uso ${u} (deducciones personales) solo es para personas físicas de los regímenes ${REGIMENES_CON_D01.join(", ")}. Usa G03.`;
  }
  return null;
}
