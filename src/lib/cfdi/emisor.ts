// Comprobaciones del EMISOR del CFDI (ws1-t8, auditoría CFDI F-15).
//
// Lo que la clínica captura en Configuración → Facturación (RFC, régimen, modo de IVA) y el CSD
// que sube no se comparaban con nada:
//   · un régimen de persona moral con un RFC de persona física (o al revés) llegaba a Facturapi;
//   · una S.A. de C.V. podía marcar «exento» y timbrar sin IVA servicios que sí lo causan
//     (art. 15-XIV LIVA: la exención de servicios profesionales de medicina —odontología
//     incluida— es para personas físicas o sociedades civiles, no para sociedades mercantiles);
//   · el RFC del panel nunca se comparaba con el del CSD, que es el que de verdad sale en el CFDI;
//   · el CSD vence (hasta 4 años) y el timbrado empezaba a fallar sin aviso.
//
// El régimen contra el tipo de persona es una regla del catálogo del SAT (c_RegimenFiscal,
// columnas «Física» / «Moral»): eso SÍ se bloquea al guardar. Lo de «exento» depende de qué
// sociedad es (una S.C. de médicos sí puede ir exenta), así que solo se AVISA.
//
// PURO: sin Prisma ni red. Textos es/en aquí mismo.

import { normalizarRfc } from "@/lib/clinic-fields";

export type Idioma = "es" | "en";

export function idiomaDe(locale: string | null | undefined): Idioma {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en") ? "en" : "es";
}

/** 12 = persona moral, 13 = persona física, según el formato del RFC. */
export type Persona = "fisica" | "moral";

export function personaDelRfc(rfc: unknown): Persona | null {
  if (typeof rfc !== "string") return null;
  const r = normalizarRfc(rfc);
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(r)) return null;
  return r.length === 12 ? "moral" : "fisica";
}

/**
 * c_RegimenFiscal del Anexo 20 (CFDI 4.0): a qué tipo de persona aplica cada régimen.
 * Fuente: catálogo oficial catCFDI_V_4 (hoja c_RegimenFiscal, columnas Física y Moral).
 */
export const PERSONA_DEL_REGIMEN: Readonly<Record<string, readonly Persona[]>> = {
  "601": ["moral"],
  "603": ["moral"],
  "605": ["fisica"],
  "606": ["fisica"],
  "607": ["fisica"],
  "608": ["fisica"],
  "610": ["fisica", "moral"],
  "611": ["fisica"],
  "612": ["fisica"],
  "614": ["fisica"],
  "615": ["fisica"],
  "616": ["fisica"],
  "620": ["moral"],
  "621": ["fisica"],
  "622": ["fisica", "moral"],
  "623": ["moral"],
  "624": ["moral"],
  "625": ["fisica"],
  "626": ["fisica", "moral"],
};

/**
 * ¿El régimen existe y aplica al tipo de persona del RFC? Devuelve el motivo del rechazo o null.
 * Esto sí bloquea el guardado: Facturapi y el SAT lo rechazarían igual, pero hasta el timbrado.
 */
export function errorDeRegimenEmisor(rfc: unknown, regimen: unknown, locale?: string | null): string | null {
  const en = idiomaDe(locale) === "en";
  const clave = typeof regimen === "string" ? regimen.trim() : "";
  const aplica = PERSONA_DEL_REGIMEN[clave];
  if (!aplica) {
    return en
      ? `The tax regime "${clave || "—"}" is not in the SAT catalog (c_RegimenFiscal).`
      : `El régimen fiscal «${clave || "—"}» no está en el catálogo del SAT (c_RegimenFiscal).`;
  }
  const persona = personaDelRfc(rfc);
  if (persona && !aplica.includes(persona)) {
    if (persona === "moral") {
      return en
        ? `Regime ${clave} is only for individuals, and a 12-character RFC belongs to a company. Pick the regime on your tax certificate (constancia de situación fiscal).`
        : `El régimen ${clave} es solo para personas físicas y un RFC de 12 caracteres es de persona moral. Elige el régimen que dice tu constancia de situación fiscal.`;
    }
    return en
      ? `Regime ${clave} is only for companies, and a 13-character RFC belongs to an individual. Pick the regime on your tax certificate (constancia de situación fiscal).`
      : `El régimen ${clave} es solo para personas morales y un RFC de 13 caracteres es de persona física. Elige el régimen que dice tu constancia de situación fiscal.`;
  }
  return null;
}

// ── Auditoría de uso (ws1-t4, 4-oct-2026): C-43 y C-51 ─────────────────────────────────────

/**
 * Regímenes con los que una clínica puede EMITIR facturas de ingreso por sus servicios (C-51).
 * Fuera 616 «Sin obligaciones fiscales» (no tiene ingresos que facturar) y 621 (RIF: cerrado a
 * nuevos contribuyentes desde 2022, LISR transitorio 2022 art. segundo); 621 solo se sigue
 * mostrando a quien ya lo tiene guardado. Añadido 603 (asociaciones y sociedades civiles sin
 * fines de lucro que tienen clínica). Descripciones del catálogo c_RegimenFiscal.
 */
export const REGIMENES_EMISOR: ReadonlyArray<{ clave: string; es: string; en: string }> = [
  { clave: "601", es: "General de Ley Personas Morales", en: "General regime for companies" },
  { clave: "603", es: "Personas Morales con Fines no Lucrativos", en: "Non-profit organizations" },
  { clave: "612", es: "Personas Físicas con Actividades Empresariales y Profesionales", en: "Individuals with business and professional activities" },
  { clave: "626", es: "Régimen Simplificado de Confianza (RESICO)", en: "Simplified Trust Regime (RESICO)" },
];
const REGIMEN_RIF = { clave: "621", es: "Incorporación Fiscal (solo si ya lo tenías)", en: "Fiscal Incorporation (only if you already had it)" };

/** La lista que ofrece Configuración: la de siempre y, si la clínica ya tenía 621, también ese. */
export function regimenesEmisorParaElegir(guardado?: string | null): ReadonlyArray<{ clave: string; es: string; en: string }> {
  return guardado === "621" ? [...REGIMENES_EMISOR, REGIMEN_RIF] : REGIMENES_EMISOR;
}

const RFC_GENERICOS = new Set(["XAXX010101000", "XEXX010101000"]);

/**
 * El emisor (C-43 + C-51): ni el RFC de público en general ni el de extranjero (son genéricos para
 * RECEPTORES, Anexo 20), y un régimen con el que se puede facturar (621 solo si ya estaba guardado).
 * Luego la regla de siempre: régimen contra tipo de persona. null = se puede guardar.
 */
export function errorDeEmisor(rfc: unknown, regimen: unknown, locale?: string | null, regimenGuardado?: string | null): string | null {
  const en = idiomaDe(locale) === "en";
  const r = typeof rfc === "string" ? normalizarRfc(rfc) : "";
  if (RFC_GENERICOS.has(r)) {
    return en
      ? `${r} is a generic RFC for the general public or foreigners: it can only be used for the patient, never for the issuer. Enter your clinic's RFC as it appears on your tax certificate.`
      : `${r} es un RFC genérico (público en general o extranjero): solo se usa para el paciente, nunca para quien factura. Escribe el RFC de tu clínica como aparece en tu constancia de situación fiscal.`;
  }
  const clave = typeof regimen === "string" ? regimen.trim() : "";
  if (!regimenesEmisorParaElegir(regimenGuardado).some((x) => x.clave === clave)) {
    if (clave === "616") {
      return en
        ? "Regime 616 (no tax obligations) can't issue income invoices. Pick the regime on your tax certificate."
        : "El régimen 616 (sin obligaciones fiscales) no puede emitir facturas de ingreso. Elige el régimen que dice tu constancia de situación fiscal.";
    }
    if (clave === "621") {
      return en
        ? "Regime 621 (Fiscal Incorporation) has been closed to new taxpayers since 2022. Pick the regime on your tax certificate."
        : "El régimen 621 (Incorporación Fiscal) está cerrado a nuevos contribuyentes desde 2022. Elige el régimen que dice tu constancia de situación fiscal.";
    }
    if (!clave) return en ? "Choose your tax regime." : "Elige tu régimen fiscal.";
  }
  return errorDeRegimenEmisor(rfc, regimen, locale);
}

/**
 * ¿Puede timbrar ya? (C-44) Lo que falta, del primero al último; vacío = listo. «Activo» en
 * Configuración y el formulario de timbrado lo leen de aquí, en vez de solo `facturApiEnabled`.
 */
export type FaltaDelEmisor = "organizacion" | "rfc" | "regimen" | "cp" | "csd";

export function faltantesDelEmisor(c: {
  facturApiEnabled?: boolean | null;
  facturApiOrgId?: string | null;
  rfcEmisor?: string | null;
  regimenFiscal?: string | null;
  cpEmisor?: string | null;
  csdUploaded?: boolean | null;
  /** En Live el CSD es obligatorio; en pruebas Facturapi usa el suyo. */
  live: boolean;
}): FaltaDelEmisor[] {
  const f: FaltaDelEmisor[] = [];
  if (!c.facturApiEnabled || !c.facturApiOrgId) f.push("organizacion");
  if (!c.rfcEmisor || !personaDelRfc(c.rfcEmisor)) f.push("rfc");
  if (!c.regimenFiscal || !PERSONA_DEL_REGIMEN[c.regimenFiscal]) f.push("regimen");
  if (!c.cpEmisor || !/^\d{5}$/.test(c.cpEmisor.trim())) f.push("cp");
  if (c.live && !c.csdUploaded) f.push("csd");
  return f;
}

/** «Para timbrar falta: tu RFC, tu código postal…» (null si no falta nada). */
export function textoDeFaltantes(f: readonly FaltaDelEmisor[], locale?: string | null): string | null {
  if (f.length === 0) return null;
  const en = idiomaDe(locale) === "en";
  const nombre: Record<FaltaDelEmisor, [string, string]> = {
    organizacion: ["guardar tus datos fiscales", "saving your tax details"],
    rfc: ["tu RFC", "your RFC"],
    regimen: ["tu régimen fiscal", "your tax regime"],
    cp: ["tu código postal fiscal", "your tax ZIP code"],
    csd: ["tus certificados de sello digital (CSD)", "your digital seal certificates (CSD)"],
  };
  const lista = f.map((x) => nombre[x][en ? 1 : 0]).join(", ");
  return en
    ? `You can't stamp CFDI yet: missing ${lista}. Complete it in Settings → Billing.`
    : `Todavía no puedes timbrar: falta ${lista}. Complétalo en Configuración → Facturación.`;
}

/** El modo de IVA de la clínica viene como "exempt" (columna) o "exento" (por factura). */
function esExento(modo: unknown): boolean {
  return modo === "exempt" || modo === "exento";
}

/** Días antes del vencimiento del CSD a partir de los que se avisa (F-15: 30). */
export const DIAS_AVISO_CSD = 30;

export type CodigoAvisoEmisor =
  | "CSD_VENCIDO"
  | "CSD_POR_VENCER"
  | "RFC_DISTINTO_AL_CSD"
  | "EXENTO_PERSONA_MORAL";

export interface AvisoEmisor {
  code: CodigoAvisoEmisor;
  /** peligro = el timbrado va a fallar o sale mal; alerta = revisar. */
  nivel: "peligro" | "alerta";
  texto: string;
}

export interface DatosEmisor {
  rfcEmisor: string | null | undefined;
  /** "exempt" | "iva16" (o "exento"). */
  cfdiTaxMode: string | null | undefined;
  csdUploaded?: boolean | null;
  csdValidUntil: Date | string | null | undefined;
  /** RFC que trae el CSD (Facturapi lo pone en legal.tax_id al subirlo, o se lee del .cer). */
  rfcDelCsd?: string | null;
  ahora: Date;
  locale?: string | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

function fechaCorta(d: Date, en: boolean): string {
  return d.toLocaleDateString(en ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
}

/** Aviso del modo «exento» con un RFC de persona moral (no bloquea: una S.C. sí puede). */
export function avisoExentoPersonaMoral(rfc: unknown, modo: unknown, locale?: string | null): AvisoEmisor | null {
  if (!esExento(modo) || personaDelRfc(rfc) !== "moral") return null;
  const en = idiomaDe(locale) === "en";
  return {
    code: "EXENTO_PERSONA_MORAL",
    nivel: "alerta",
    texto: en
      ? "Your RFC belongs to a company and you chose «VAT exempt». The exemption for medical and dental services (art. 15-XIV of the VAT law) applies to individuals and civil companies (S.C.), not to commercial companies (S.A. de C.V., S. de R.L.…), which charge 16% VAT. Confirm it with your accountant before invoicing."
      : "Tu RFC es de persona moral y elegiste «Exento de IVA». La exención de los servicios médicos y dentales (art. 15-XIV de la Ley del IVA) es para personas físicas y sociedades civiles (S.C.), no para sociedades mercantiles (S.A. de C.V., S. de R.L.…), que cobran IVA del 16%. Confírmalo con tu contador antes de facturar.",
  };
}

/**
 * Todo lo que hay que avisarle al dueño sobre su configuración de emisor, del más grave al
 * menos. Nada de esto bloquea el timbrado: lo bloquearía el SAT (CSD vencido) o es criterio
 * del contador (exento).
 */
export function avisosDelEmisor(d: DatosEmisor): AvisoEmisor[] {
  const en = idiomaDe(d.locale) === "en";
  const avisos: AvisoEmisor[] = [];

  const vence = d.csdValidUntil ? new Date(d.csdValidUntil) : null;
  if (vence && !Number.isNaN(vence.getTime())) {
    const dias = Math.ceil((vence.getTime() - d.ahora.getTime()) / DIA_MS);
    if (dias <= 0) {
      avisos.push({
        code: "CSD_VENCIDO",
        nivel: "peligro",
        texto: en
          ? `Your digital seal certificate (CSD) expired on ${fechaCorta(vence, true)}. You can't issue CFDI until you request a new one from the SAT and upload it here.`
          : `Tu certificado de sello digital (CSD) venció el ${fechaCorta(vence, false)}. No podrás timbrar hasta que tramites uno nuevo en el SAT y lo subas aquí.`,
      });
    } else if (dias <= DIAS_AVISO_CSD) {
      avisos.push({
        code: "CSD_POR_VENCER",
        nivel: "alerta",
        texto: en
          ? `Your digital seal certificate (CSD) expires on ${fechaCorta(vence, true)} (${dias} ${dias === 1 ? "day" : "days"}). Request a new one from the SAT (CertiSAT) and upload it here so invoicing doesn't stop.`
          : `Tu certificado de sello digital (CSD) vence el ${fechaCorta(vence, false)} (${dias === 1 ? "falta 1 día" : `faltan ${dias} días`}). Tramita uno nuevo en el SAT (CertiSAT) y súbelo aquí para que no se detenga el timbrado.`,
      });
    }
  }

  const rfcPanel = typeof d.rfcEmisor === "string" && d.rfcEmisor.trim() ? normalizarRfc(d.rfcEmisor) : null;
  const rfcCsd = typeof d.rfcDelCsd === "string" && d.rfcDelCsd.trim() ? normalizarRfc(d.rfcDelCsd) : null;
  if (d.csdUploaded !== false && rfcPanel && rfcCsd && rfcPanel !== rfcCsd) {
    avisos.push({
      code: "RFC_DISTINTO_AL_CSD",
      nivel: "peligro",
      texto: en
        ? `The RFC saved here (${rfcPanel}) is not the one in your CSD (${rfcCsd}). Invoices are issued with the CSD's RFC: fix whichever is wrong.`
        : `El RFC capturado aquí (${rfcPanel}) no es el de tu CSD (${rfcCsd}). Las facturas salen con el RFC del CSD: corrige el que esté mal.`,
    });
  }

  const exento = avisoExentoPersonaMoral(d.rfcEmisor, d.cfdiTaxMode, d.locale);
  if (exento) avisos.push(exento);

  return avisos;
}

/** Lo que se guarda en la bitácora al cambiar los datos fiscales (solo lo que cambió cuenta). */
export function datosFiscalesParaBitacora(c: {
  rfcEmisor?: string | null; regimenFiscal?: string | null; cpEmisor?: string | null;
  razonSocial?: string | null; cfdiTaxMode?: string | null;
}): Record<string, string | null> {
  return {
    rfcEmisor: c.rfcEmisor ?? null,
    regimenFiscal: c.regimenFiscal ?? null,
    cpEmisor: c.cpEmisor ?? null,
    razonSocial: c.razonSocial ?? null,
    cfdiTaxMode: c.cfdiTaxMode ?? null,
  };
}
