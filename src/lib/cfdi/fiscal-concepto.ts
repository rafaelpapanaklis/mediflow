// Clave SAT y IVA de cada concepto del CFDI (ws1-t4, vuelta 2: F-11 y F-08).
//
// F-11 · Antes todo salía como 85121502 («Servicios de consulta de médicos de
// atención primaria»); el gerente lo vio en un CFDI real de BEVADENT («Control
// de ortodoncia» y «Restauración con resina»). Claves del catálogo OFICIAL del
// SAT (catCFDI_V_4_20261001.xls, hoja c_ClaveProdServ; vigentes desde el
// 1-ene-2022, IVA «Opcional»):
//   85122001 Servicios de odontólogos            ← por defecto dental
//   85122002 Servicios de higienistas dentales    ← solo si la clínica lo elige
//   85122003 Servicios de personal de apoyo odontológico
//   85122004 Servicios de cirujanos orales        ← cirugía e implantes
//   85122005 Servicios de ortodoncia              ← ortodoncia
// Cada procedimiento del catálogo puede llevar la suya (la clínica la edita);
// sin ella, la de su categoría o su nombre. Las facturas ya timbradas no se
// tocan: la clave se resuelve al timbrar.
//
// F-08 · El IVA de cada concepto: el del renglón si lo trae, si no el de su
// procedimiento («Exento» / «IVA 16%»), y si no el de la factura (lo de
// siempre). Exentos los servicios profesionales de odontología de personas
// físicas (art. 15-XIV LIVA y 41 RLIVA); gravados, por ejemplo, los productos.
//
// PURO (client-safe).

export const CLAVE_DENTAL_POR_DEFECTO = "85122001";
export const CLAVE_ORTODONCIA = "85122005";
export const CLAVE_CIRUGIA_ORAL = "85122004";
export const CLAVE_HIGIENISTA = "85122002";

export const CLAVES_SAT_DENTALES: ReadonlyArray<{ clave: string; es: string; en: string }> = [
  { clave: CLAVE_DENTAL_POR_DEFECTO, es: "85122001 · Servicios de odontólogos", en: "85122001 · Dentist services" },
  { clave: CLAVE_ORTODONCIA, es: "85122005 · Servicios de ortodoncia", en: "85122005 · Orthodontic services" },
  { clave: CLAVE_CIRUGIA_ORAL, es: "85122004 · Servicios de cirujanos orales (cirugía, implantes)", en: "85122004 · Oral surgeon services (surgery, implants)" },
  { clave: CLAVE_HIGIENISTA, es: "85122002 · Servicios de higienistas dentales", en: "85122002 · Dental hygienist services" },
  { clave: "85122003", es: "85122003 · Servicios de personal de apoyo odontológico", en: "85122003 · Dental support staff services" },
];

export type IvaConcepto = "exento" | "iva16";

export function esClaveSat(v: unknown): v is string {
  return typeof v === "string" && /^\d{8}$/.test(v.trim());
}

export function esIvaConcepto(v: unknown): v is IvaConcepto {
  return v === "exento" || v === "iva16";
}

/** Sin acentos, minúsculas y espacios simples: para comparar nombres. */
export function normalizarNombre(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * La clave de un procedimiento que no tiene una propia: ortodoncia → 85122005;
 * cirugía o implantes → 85122004; todo lo demás → 85122001. La de higienista
 * (85122002) NUNCA se pone sola: depende de quién presta el servicio.
 */
export function claveSatPorDefecto(p: { category?: string | null; name?: string | null }): string {
  const cat = normalizarNombre(p.category);
  const nom = normalizarNombre(p.name);
  if (cat === "orthodontics" || cat.includes("ortodon") || nom.includes("ortodon")) return CLAVE_ORTODONCIA;
  if (/cirug|implant/.test(cat) || /cirug|implant/.test(nom)) return CLAVE_CIRUGIA_ORAL;
  return CLAVE_DENTAL_POR_DEFECTO;
}

export interface ProcedimientoFiscal {
  name: string;
  category: string | null;
  claveSat: string | null;
  ivaCfdi: IvaConcepto | null;
}

export interface ConceptoResuelto {
  claveSat: string;
  ivaModo: IvaConcepto;
  origenClave: "renglon" | "procedimiento" | "porDefecto";
}

/**
 * Clave e IVA de un renglón de la factura. El renglón no guarda de qué
 * procedimiento salió (solo la descripción), así que se busca en el catálogo
 * de la clínica por NOMBRE (sin acentos ni mayúsculas).
 */
export function resolverConcepto(
  item: { description?: unknown; claveSat?: unknown; ivaModo?: unknown },
  catalogo: readonly ProcedimientoFiscal[],
  ivaDeLaFactura: IvaConcepto,
): ConceptoResuelto {
  const nombre = normalizarNombre(item.description);
  const proc = nombre ? catalogo.find((p) => normalizarNombre(p.name) === nombre) ?? null : null;

  let claveSat: string;
  let origenClave: ConceptoResuelto["origenClave"];
  if (esClaveSat(item.claveSat)) { claveSat = String(item.claveSat).trim(); origenClave = "renglon"; }
  else if (proc && esClaveSat(proc.claveSat)) { claveSat = proc.claveSat!.trim(); origenClave = "procedimiento"; }
  else { claveSat = claveSatPorDefecto(proc ?? { name: String(item.description ?? "") }); origenClave = "porDefecto"; }

  const ivaModo: IvaConcepto = esIvaConcepto(item.ivaModo)
    ? item.ivaModo
    : proc && esIvaConcepto(proc.ivaCfdi) ? proc.ivaCfdi : ivaDeLaFactura;

  return { claveSat, ivaModo, origenClave };
}

export const CFDI_IVA_MIXTO_AGREGADO = "CFDI_IVA_MIXTO_AGREGADO";
export const CFDI_IVA_MIXTO_POR_PAGO = "CFDI_IVA_MIXTO_POR_PAGO";

/** ¿Los conceptos mezclan exento y 16%? */
export function hayIvaMixto(conceptos: readonly { ivaModo: IvaConcepto }[]): boolean {
  return new Set(conceptos.map((c) => c.ivaModo)).size > 1;
}

function en(locale?: string | null): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en");
}

/**
 * Con «IVA agregado» la factura interna le suma el 16% a TODO: no puede
 * mezclar conceptos exentos y gravados sin descuadrar. Con «IVA incluido» sí
 * (el precio de cada concepto ya es su total).
 */
export function errorIvaMixtoAgregado(locale?: string | null): string {
  return en(locale)
    ? "This invoice mixes VAT-exempt and 16% VAT items, but its prices are set as \"VAT added\". Mixed items can only be stamped with VAT included in the price: edit the invoice."
    : "Esta factura mezcla conceptos exentos y con IVA 16%, pero sus precios son «IVA agregado». Los conceptos mezclados solo se timbran con el IVA incluido en el precio: edita la factura.";
}

export function errorIvaMixtoPorPago(locale?: string | null): string {
  return en(locale)
    ? "This invoice mixes VAT-exempt and 16% VAT items: invoicing a single payment can't split it yet. Invoice the whole invoice once it is paid."
    : "Esta factura mezcla conceptos exentos y con IVA 16%: el CFDI de un pago suelto todavía no sabe repartirlo. Timbra la factura completa cuando quede pagada.";
}
