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
  /** id del procedimiento en el catálogo (el renglón lo trae como `procedureId`). */
  id?: string;
  /** false = dado de baja. Si un nombre se repite, gana el activo. */
  activo?: boolean;
  name: string;
  category: string | null;
  claveSat: string | null;
  ivaCfdi: IvaConcepto | null;
}

export interface ConceptoResuelto {
  claveSat: string;
  ivaModo: IvaConcepto;
  origenClave: "renglon" | "procedimiento" | "porDefecto";
  /** De dónde salió el IVA: del renglón, de su procedimiento o, sin dato, de la factura. */
  origenIva: "renglon" | "procedimiento" | "factura";
  /** Cómo se encontró su procedimiento: por id (lo fiable), por nombre, o no se encontró. */
  ligado: "id" | "nombre" | null;
  /** Varios procedimientos con ese nombre y datos fiscales DISTINTOS: no se adivina cuál. */
  ambiguo: boolean;
}

/** «Resina (36)» → «resina»: sin el diente ni otra aclaración final entre paréntesis. */
export function nombreSinAclaracion(s: unknown): string {
  let n = normalizarNombre(s);
  for (let i = 0; i < 3; i++) {
    const sin = n.replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (sin === n) break;
    n = sin;
  }
  return n;
}

const datosFiscales = (p: ProcedimientoFiscal) => `${esClaveSat(p.claveSat) ? p.claveSat!.trim() : ""}|${esIvaConcepto(p.ivaCfdi) ? p.ivaCfdi : ""}`;

/**
 * Entre los procedimientos con el mismo nombre: los activos primero; los que tienen datos
 * fiscales capturados ganan a los que no (un duplicado sin configurar no anula lo que la
 * clínica sí eligió). Si quedan dos con datos distintos, no se adivina: `ambiguo`.
 */
function elegirPorNombre(candidatos: ProcedimientoFiscal[]): { proc: ProcedimientoFiscal | null; ambiguo: boolean } {
  if (candidatos.length === 0) return { proc: null, ambiguo: false };
  const activos = candidatos.filter((p) => p.activo !== false);
  let xs = activos.length > 0 ? activos : candidatos;
  const conDatos = xs.filter((p) => datosFiscales(p) !== "|");
  if (conDatos.length > 0) xs = conDatos;
  const distintos = new Set(xs.map(datosFiscales));
  if (distintos.size > 1) return { proc: null, ambiguo: true };
  return { proc: xs[0], ambiguo: false };
}

/**
 * El procedimiento del catálogo de un renglón (ws1-t4, auditoría de uso C-40). En orden:
 *   1. por su `procedureId` (lo guardan el editor de facturas, «Cobrar hoy» y el presupuesto);
 *   2. por el procedimiento que le pasa quien llama (`procedureIdDelServidor`: p. ej. el
 *      concepto del presupuesto del que salió la factura);
 *   3. respaldo por NOMBRE normalizado (sin acentos ni mayúsculas), y si no, sin la aclaración
 *      final entre paréntesis («Resina (36)» → «Resina»), para las facturas viejas.
 * Un id que no es de esta clínica no está en `catalogo` (se arma con el clinicId de la sesión).
 */
export function procedimientoDelRenglon(
  item: { description?: unknown; procedureId?: unknown },
  catalogo: readonly ProcedimientoFiscal[],
  procedureIdDelServidor?: string | null,
): { proc: ProcedimientoFiscal | null; ligado: "id" | "nombre" | null; ambiguo: boolean } {
  for (const id of [item.procedureId, procedureIdDelServidor]) {
    if (typeof id === "string" && id) {
      const porId = catalogo.find((p) => p.id === id);
      if (porId) return { proc: porId, ligado: "id", ambiguo: false };
    }
  }
  const nombre = normalizarNombre(item.description);
  if (!nombre) return { proc: null, ligado: null, ambiguo: false };
  let r = elegirPorNombre(catalogo.filter((p) => normalizarNombre(p.name) === nombre));
  if (!r.proc && !r.ambiguo) {
    const corto = nombreSinAclaracion(item.description);
    if (corto && corto !== nombre) r = elegirPorNombre(catalogo.filter((p) => nombreSinAclaracion(p.name) === corto));
  }
  return { proc: r.proc, ligado: r.proc ? "nombre" : null, ambiguo: r.ambiguo };
}

/**
 * Clave e IVA de un renglón de la factura: los del renglón si los trae, si no los de su
 * procedimiento (`procedimientoDelRenglon`), y si no, la clave de su categoría o nombre y el
 * IVA de la factura.
 */
export function resolverConcepto(
  item: { description?: unknown; claveSat?: unknown; ivaModo?: unknown; procedureId?: unknown },
  catalogo: readonly ProcedimientoFiscal[],
  ivaDeLaFactura: IvaConcepto,
  procedureIdDelServidor?: string | null,
): ConceptoResuelto {
  const { proc, ligado, ambiguo } = procedimientoDelRenglon(item, catalogo, procedureIdDelServidor);

  let claveSat: string;
  let origenClave: ConceptoResuelto["origenClave"];
  if (esClaveSat(item.claveSat)) { claveSat = String(item.claveSat).trim(); origenClave = "renglon"; }
  else if (proc && esClaveSat(proc.claveSat)) { claveSat = proc.claveSat!.trim(); origenClave = "procedimiento"; }
  else { claveSat = claveSatPorDefecto(proc ?? { name: String(item.description ?? "") }); origenClave = "porDefecto"; }

  let ivaModo: IvaConcepto;
  let origenIva: ConceptoResuelto["origenIva"];
  if (esIvaConcepto(item.ivaModo)) { ivaModo = item.ivaModo; origenIva = "renglon"; }
  else if (proc && esIvaConcepto(proc.ivaCfdi)) { ivaModo = proc.ivaCfdi; origenIva = "procedimiento"; }
  else { ivaModo = ivaDeLaFactura; origenIva = "factura"; }

  return { claveSat, ivaModo, origenClave, origenIva, ligado, ambiguo };
}

/**
 * Aviso ANTES de timbrar (C-40: «un blanqueamiento marcado con 16% salía EXENTO sin avisar»):
 * los conceptos cuyo IVA no salió de su procedimiento porque hay duplicados con datos distintos,
 * o porque no se encontró y la clínica tiene procedimientos con IVA 16%. null = nada que decir.
 */
export function avisoDeConceptos(
  conceptos: readonly { descripcion: string; resuelto: ConceptoResuelto }[],
  catalogo: readonly ProcedimientoFiscal[],
  locale?: string | null,
): string | null {
  const ambiguos = conceptos.filter((c) => c.resuelto.ambiguo).map((c) => c.descripcion);
  const hayGravados = catalogo.some((p) => p.activo !== false && p.ivaCfdi === "iva16");
  const sueltos = hayGravados
    ? conceptos.filter((c) => !c.resuelto.ambiguo && c.resuelto.ligado === null && c.resuelto.origenIva === "factura").map((c) => c.descripcion)
    : [];
  if (ambiguos.length === 0 && sueltos.length === 0) return null;
  const lista = (xs: string[]) => xs.map((x) => `«${x}»`).join(", ");
  const partes: string[] = [];
  if (en(locale)) {
    if (ambiguos.length) partes.push(`${lista(ambiguos)}: there are several procedures with that name and different tax data, so it takes the invoice's VAT. Merge the duplicates in Procedures.`);
    if (sueltos.length) partes.push(`${lista(sueltos)}: it isn't linked to any procedure of your catalog, so it takes the invoice's VAT.`);
    return `${partes.join(" ")} Check the «Taxes» field before stamping.`;
  }
  if (ambiguos.length) partes.push(`${lista(ambiguos)}: hay varios procedimientos con ese nombre y datos fiscales distintos, así que toma el IVA de la factura. Une los duplicados en Procedimientos.`);
  if (sueltos.length) partes.push(`${lista(sueltos)}: no está ligado a ningún procedimiento de tu catálogo, así que toma el IVA de la factura.`);
  return `${partes.join(" ")} Revisa «Impuestos» antes de timbrar.`;
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
