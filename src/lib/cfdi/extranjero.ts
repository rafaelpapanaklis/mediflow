// Facturar a un paciente EXTRANJERO (ws1-t8, auditoría CFDI F-22). Turismo dental: el paciente
// de Tijuana o Cancún que vive en otro país no tenía cómo recibir su CFDI desde el panel.
//
// Reglas del Anexo 20 (Guía de llenado del CFDI 4.0, nodo Receptor) para un residente en el
// extranjero sin RFC mexicano:
//   · Rfc = XEXX010101000 (RFC genérico para extranjeros);
//   · ResidenciaFiscal = clave del país (c_Pais, ISO 3166-1 alfa-3), distinta de MEX;
//   · NumRegIdTrib = su número de identificación fiscal en ese país (1 a 40 caracteres);
//   · RegimenFiscalReceptor = 616 (Sin obligaciones fiscales) y UsoCFDI = S01 (Sin efectos fiscales);
//   · DomicilioFiscalReceptor = el código postal del lugar de expedición (el del emisor).
//
// Facturapi (guía de clientes, «Clientes extranjeros»): el cliente se da de alta con `legal_name`,
// `tax_id` = su identificación fiscal extranjera y `address.country` (alfa-3) ≠ "MEX" + `zip`;
// «No necesitas usar el RFC genérico para extranjeros del SAT. Nosotros lo pondremos por ti».
//
// Los dos timbrados (POST /api/cfdi y POST /api/payments/[id]/cfdi) arman el cliente con
// `clienteFacturapiDelReceptor`, validan con `errorDeReceptorExtranjero` y fuerzan S01 (ws1-t4,
// vuelta 2): la opción está ENCENDIDA.
//
// PURO: sin Prisma ni red.

export const RFC_EXTRANJERO = "XEXX010101000";
export const REGIMEN_EXTRANJERO = "616";
export const USO_EXTRANJERO = "S01";

/** Encendida: los timbrados ya arman el cliente con `clienteFacturapiDelReceptor` (ws1-t4, vuelta 2). */
export const RECEPTOR_EXTRANJERO_HABILITADO = true;

/** Los países de donde más llegan pacientes; «Otro» deja escribir la clave alfa-3. */
export const PAISES_FRECUENTES: ReadonlyArray<{ clave: string; es: string; en: string }> = [
  { clave: "USA", es: "Estados Unidos", en: "United States" },
  { clave: "CAN", es: "Canadá", en: "Canada" },
  { clave: "GBR", es: "Reino Unido", en: "United Kingdom" },
  { clave: "ESP", es: "España", en: "Spain" },
  { clave: "DEU", es: "Alemania", en: "Germany" },
  { clave: "FRA", es: "Francia", en: "France" },
  { clave: "ITA", es: "Italia", en: "Italy" },
  { clave: "NLD", es: "Países Bajos", en: "Netherlands" },
  { clave: "AUS", es: "Australia", en: "Australia" },
  { clave: "JPN", es: "Japón", en: "Japan" },
  { clave: "KOR", es: "Corea del Sur", en: "South Korea" },
  { clave: "CHN", es: "China", en: "China" },
  { clave: "GTM", es: "Guatemala", en: "Guatemala" },
  { clave: "COL", es: "Colombia", en: "Colombia" },
  { clave: "ARG", es: "Argentina", en: "Argentina" },
  { clave: "BRA", es: "Brasil", en: "Brazil" },
  { clave: "CHL", es: "Chile", en: "Chile" },
  { clave: "PER", es: "Perú", en: "Peru" },
];

export interface DatosExtranjero {
  /** c_Pais, alfa-3 (USA, CAN…). */
  pais: string;
  /** NumRegIdTrib: su identificación fiscal en ese país (SSN/ITIN/EIN, SIN, NIF…). */
  numRegIdTrib: string;
}

/** Lo que manda el formulario a POST /api/cfdi en `receptor`. */
export interface ReceptorCfdi {
  rfc: string;
  nombre: string;
  regimenFiscal: string;
  cp: string;
  email?: string;
  extranjero?: DatosExtranjero;
}

function en(locale?: string | null): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en");
}

export function normalizarPais(p: unknown): string {
  return typeof p === "string" ? p.trim().toUpperCase() : "";
}

export function normalizarNumRegIdTrib(n: unknown): string {
  return typeof n === "string" ? n.trim().replace(/\s+/g, "").toUpperCase() : "";
}

/** null si está bien; si no, el motivo. */
export function errorDeReceptorExtranjero(r: { nombre?: unknown; cp?: unknown; extranjero?: Partial<DatosExtranjero> | null }, locale?: string | null): string | null {
  const ing = en(locale);
  const pais = normalizarPais(r.extranjero?.pais);
  const id = normalizarNumRegIdTrib(r.extranjero?.numRegIdTrib);
  if (!/^[A-Z]{3}$/.test(pais)) return ing ? "Choose the patient's country of tax residence." : "Elige el país de residencia fiscal del paciente.";
  if (pais === "MEX") return ing ? "A resident of Mexico is invoiced with their RFC, not as a foreigner." : "Un residente en México se factura con su RFC, no como extranjero.";
  if (!id) return ing ? "Write the patient's tax ID number in their country." : "Escribe el número de identificación fiscal del paciente en su país.";
  if (id.length > 40 || !/^[A-Z0-9-]+$/.test(id)) {
    return ing ? "The tax ID can have up to 40 letters, numbers or dashes." : "El número de identificación fiscal admite hasta 40 letras, números o guiones.";
  }
  if (typeof r.nombre !== "string" || !r.nombre.trim()) return ing ? "Write the patient's full name." : "Escribe el nombre completo del paciente.";
  if (typeof r.cp !== "string" || !r.cp.trim() || r.cp.trim().length > 12) {
    return ing ? "Write the patient's postal (ZIP) code in their country." : "Escribe el código postal del paciente en su país.";
  }
  return null;
}

/** El `receptor` del formulario para un extranjero (RFC genérico, 616, sin acentos de más). */
export function receptorExtranjero(args: { nombre: string; zip: string; email?: string; pais: string; numRegIdTrib: string }): ReceptorCfdi {
  return {
    rfc: RFC_EXTRANJERO,
    nombre: args.nombre.trim(),
    regimenFiscal: REGIMEN_EXTRANJERO,
    cp: args.zip.trim().toUpperCase(),
    ...(args.email?.trim() ? { email: args.email.trim() } : {}),
    extranjero: { pais: normalizarPais(args.pais), numRegIdTrib: normalizarNumRegIdTrib(args.numRegIdTrib) },
  };
}

export function esReceptorExtranjero(r: { rfc?: unknown; extranjero?: unknown } | null | undefined): boolean {
  return !!r && (r.rfc === RFC_EXTRANJERO || (typeof r.rfc === "string" && r.rfc.trim().toUpperCase() === RFC_EXTRANJERO)) && !!r.extranjero;
}

/** El cliente de Facturapi (POST /customers) para un receptor nacional o extranjero. */
export function clienteFacturapiDelReceptor(r: ReceptorCfdi, correoRespaldo?: string | null): {
  legal_name: string;
  tax_id: string;
  tax_system?: string;
  email?: string;
  address: { zip: string; country?: string };
} {
  const email = r.email?.trim() || correoRespaldo?.trim() || undefined;
  if (esReceptorExtranjero(r) && r.extranjero) {
    return {
      legal_name: r.nombre.trim(),
      // Facturapi: para un extranjero `tax_id` es SU identificación fiscal; el RFC genérico lo pone él.
      tax_id: normalizarNumRegIdTrib(r.extranjero.numRegIdTrib),
      ...(email ? { email } : {}),
      address: { zip: r.cp.trim(), country: normalizarPais(r.extranjero.pais) },
    };
  }
  return {
    legal_name: r.nombre,
    tax_id: r.rfc,
    tax_system: r.regimenFiscal,
    ...(email ? { email } : {}),
    address: { zip: r.cp },
  };
}
