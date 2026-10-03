// Ortodoncia — catálogos propios de la clínica para la hoja de control (ws1-t9, auditoría BEVADENT, M4). PURO.
//
// Cinco listas, editables en Ortodoncia → Configuración → «Hoja de control»:
//   - arcosMateriales: qué materiales de arco se ofrecen. Son los 7 de siempre (cada uno tiene su valor guardado en
//     `OrthoWireMaterial`, material-de-arco.ts): aquí solo se encienden o apagan, no se inventan;
//   - arcosCalibres: los calibres («014», «16x22»…). Propios: se agregan los que la clínica use;
//   - ligasTipos / ligasColores: lo que se elige en el bloque «Ligas» de la hoja;
//   - mecanicas: los tipos de mecánica auxiliar (resorte, cadeneta, botón…) que se dan de alta en la hoja o el caso.
// Vienen con los valores de fábrica (los de siempre) y la clínica los copia y edita, como las plantillas. «Quitar» solo
// deja de ofrecer la opción: lo ya anotado en hojas y casos conserva su texto.
// Se guardan en `orthodontics_clinic_settings."hojaCatalogos"` (JSONB, sql/ws1-t9-hoja-ligas-mecanicas-catalogos.sql);
// NULL o lista ausente = la de fábrica.

import { WIRE_GAUGE_RECT, WIRE_GAUGE_ROUND, WIRE_MATERIAL_OPTIONS } from "@/components/specialties/orthodontics/redesign/drawers/wire-options";

export const LISTAS_DE_HOJA = ["arcosMateriales", "arcosCalibres", "ligasTipos", "ligasColores", "mecanicas"] as const;
export type ListaDeHoja = (typeof LISTAS_DE_HOJA)[number];

export interface OpcionDeCatalogo {
  /** Estable: las de fábrica usan «d-…» (los materiales, su clave: «NITI_SUPER»…); las propias, «c-…». */
  id: string;
  nombre: string;
  /** false = quitada: no se ofrece en hojas nuevas; lo ya anotado conserva su texto. */
  activa: boolean;
}
export type CatalogosDeHoja = Record<ListaDeHoja, OpcionDeCatalogo[]>;

export const OPCIONES_MAXIMAS_POR_CATALOGO = 40;
export const TEXTO_MAXIMO_CATALOGO = 40;

/** Los tipos de liga de fábrica. El de autoligado no lleva color (no hay ligas). */
export const TIPO_LIGA_AUTOLIGADO = "Autoligado (sin ligas)";

export const CATALOGO_DE_FABRICA: Record<Exclude<ListaDeHoja, "arcosMateriales">, readonly string[]> = {
  arcosCalibres: [...WIRE_GAUGE_ROUND, ...WIRE_GAUGE_RECT].map((g) => g.key),
  ligasTipos: ["Elástica", "Metálica", TIPO_LIGA_AUTOLIGADO],
  ligasColores: [
    "Transparente",
    "Gris",
    "Plata",
    "Blanco",
    "Negro",
    "Azul",
    "Azul marino",
    "Celeste",
    "Rojo",
    "Rosa",
    "Morado",
    "Verde",
    "Amarillo",
    "Naranja",
  ],
  mecanicas: [
    "Resorte abierto",
    "Resorte cerrado",
    "Cadeneta",
    "Botón",
    "Gancho",
    "Tope",
    "Elástico intermaxilar",
    "Expansor",
    "Distalizador",
  ],
};

export const ROTULO_DE_CATALOGO: Record<ListaDeHoja, { es: string; en: string }> = {
  arcosMateriales: { es: "Materiales de arco", en: "Archwire materials" },
  arcosCalibres: { es: "Calibres de arco", en: "Archwire sizes" },
  ligasTipos: { es: "Tipos de liga", en: "Ligature types" },
  ligasColores: { es: "Colores de liga", en: "Ligature colors" },
  mecanicas: { es: "Mecánicas auxiliares", en: "Auxiliary mechanics" },
};

export function sinAcentos(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const clave = (t: string): string => sinAcentos(t).toLowerCase();
function slug(t: string): string {
  return clave(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "x";
}

export function limpiarNombre(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, TEXTO_MAXIMO_CATALOGO);
}

/**
 * Un calibre como lo guarda la secuencia de arcos: redondo «014» (de «.014», «0.014» o «14»), rectangular «16x22»
 * (de «16 X 22», «.016x.022», «16×22»). `null` = no se entiende.
 */
export function normalizarCalibre(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  const redondo = /^(?:0?\.)?0?(\d{2})$/.exec(t);
  if (redondo) return `0${redondo[1]}`;
  const rect = /^(?:0?\.)?0?(\d{2})x(?:0?\.)?0?(\d{2})$/.exec(t);
  if (rect) return `${rect[1]}x${rect[2]}`;
  return null;
}

/** «.014» / «16x22»: cómo se muestra un calibre en un selector. */
export function etiquetaDeCalibre(calibre: string): string {
  return /^\d{3}$/.test(calibre) ? `.${calibre}` : calibre;
}

function materialesDeFabrica(): OpcionDeCatalogo[] {
  return WIRE_MATERIAL_OPTIONS.map((m) => ({ id: m.key, nombre: m.label, activa: true }));
}

export function catalogosDeFabrica(): CatalogosDeHoja {
  return {
    arcosMateriales: materialesDeFabrica(),
    arcosCalibres: CATALOGO_DE_FABRICA.arcosCalibres.map((n) => ({ id: `d-${slug(n)}`, nombre: n, activa: true })),
    ligasTipos: CATALOGO_DE_FABRICA.ligasTipos.map((n) => ({ id: `d-${slug(n)}`, nombre: n, activa: true })),
    ligasColores: CATALOGO_DE_FABRICA.ligasColores.map((n) => ({ id: `d-${slug(n)}`, nombre: n, activa: true })),
    mecanicas: CATALOGO_DE_FABRICA.mecanicas.map((n) => ({ id: `d-${slug(n)}`, nombre: n, activa: true })),
  };
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;

/** Los materiales: siempre los 7 conocidos, en su orden; de lo guardado solo se toma si están encendidos. */
function normalizarMateriales(raw: unknown): OpcionDeCatalogo[] | null {
  if (!Array.isArray(raw)) return null;
  const apagados = new Set<string>();
  for (const x of raw) {
    if (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" && (x as { activa?: unknown }).activa === false) {
      apagados.add((x as { id: string }).id);
    }
  }
  return materialesDeFabrica().map((m) => ({ ...m, activa: !apagados.has(m.id) }));
}

function normalizarLista(l: ListaDeHoja, raw: unknown): OpcionDeCatalogo[] | null {
  if (l === "arcosMateriales") return normalizarMateriales(raw);
  if (!Array.isArray(raw)) return null;
  const vistos = new Set<string>();
  const ids = new Set<string>();
  const out: OpcionDeCatalogo[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const nombre = l === "arcosCalibres" ? normalizarCalibre(o.nombre) : limpiarNombre(o.nombre);
    if (!nombre) continue;
    const k = clave(nombre);
    if (vistos.has(k)) continue;
    let id = typeof o.id === "string" ? o.id.trim() : "";
    if (!ID_VALIDO.test(id) || ids.has(id)) id = `c-${slug(nombre)}-${out.length}`;
    vistos.add(k);
    ids.add(id);
    out.push({ id, nombre, activa: o.activa !== false });
    if (out.length >= OPCIONES_MAXIMAS_POR_CATALOGO) break;
  }
  return out;
}

/**
 * Lo guardado (o lo que manda el cliente) → las cinco listas. Una lista ausente es la de fábrica (la clínica nunca la
 * editó); una lista guardada vacía SÍ se respeta (la clínica quitó todo).
 */
export function normalizarCatalogos(raw: unknown): CatalogosDeHoja {
  const base = catalogosDeFabrica();
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as CatalogosDeHoja;
  for (const l of LISTAS_DE_HOJA) out[l] = normalizarLista(l, o[l]) ?? base[l];
  return out;
}

/** ¿La clínica ya guardó alguna lista propia? (false = usa las de fábrica). */
export function catalogosEditados(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return LISTAS_DE_HOJA.some((l) => Array.isArray((raw as Record<string, unknown>)[l]));
}

/** Mensaje para quien edita, o null si se pueden guardar. */
export function validarCatalogos(c: Partial<Record<ListaDeHoja, ReadonlyArray<{ nombre: string }>>>): string | null {
  for (const l of LISTAS_DE_HOJA) {
    if (l === "arcosMateriales") continue;
    const lista = c[l] ?? [];
    const rotulo = ROTULO_DE_CATALOGO[l].es;
    if (lista.length > OPCIONES_MAXIMAS_POR_CATALOGO) return `«${rotulo}»: máximo ${OPCIONES_MAXIMAS_POR_CATALOGO} opciones.`;
    const vistos = new Set<string>();
    for (const o of lista) {
      const nombre = l === "arcosCalibres" ? normalizarCalibre(o.nombre) : limpiarNombre(o.nombre);
      if (!nombre) {
        return l === "arcosCalibres"
          ? `«${rotulo}»: «${o.nombre.trim() || "(vacío)"}» no es un calibre (usa «014» o «16x22»).`
          : `«${rotulo}»: cada opción necesita un nombre.`;
      }
      const k = clave(nombre);
      if (vistos.has(k)) return `«${rotulo}»: «${nombre}» está repetida.`;
      vistos.add(k);
    }
  }
  return null;
}

/** ¿Falta alguna de fábrica en esta lista (quitada o borrada)? → se ofrece «Copiar las de fábrica». */
export function faltanDeFabrica(l: ListaDeHoja, lista: readonly OpcionDeCatalogo[]): boolean {
  if (l === "arcosMateriales") return lista.some((o) => !o.activa);
  return CATALOGO_DE_FABRICA[l].some((n) => {
    const x = lista.find((o) => clave(o.nombre) === clave(n));
    return !x || !x.activa;
  });
}

/** Repone las de fábrica (las reactiva o las añade al final) sin tocar las propias. */
export function copiarDeFabrica(l: ListaDeHoja, lista: readonly OpcionDeCatalogo[]): OpcionDeCatalogo[] {
  if (l === "arcosMateriales") return materialesDeFabrica();
  const de = CATALOGO_DE_FABRICA[l];
  const out = lista.map((o) => (de.some((n) => clave(n) === clave(o.nombre)) ? { ...o, activa: true } : { ...o }));
  const ids = new Set(out.map((o) => o.id));
  for (const n of de) {
    if (out.some((o) => clave(o.nombre) === clave(n))) continue;
    let id = `d-${slug(n)}`;
    if (ids.has(id)) id = `${id}-${out.length}`;
    ids.add(id);
    out.push({ id, nombre: n, activa: true });
  }
  return out;
}

export function idNuevoDeOpcion(existentes: readonly OpcionDeCatalogo[], azar: number = Math.random()): string {
  const usados = new Set(existentes.map((o) => o.id));
  let n = Math.floor(azar * 36 ** 6);
  for (let i = 0; i < 1000; i++, n++) {
    const id = `c-${n.toString(36).padStart(6, "0")}`;
    if (!usados.has(id)) return id;
  }
  return `c-${Date.now().toString(36)}`;
}

export function nombresActivos(lista: readonly OpcionDeCatalogo[]): string[] {
  return lista.filter((o) => o.activa).map((o) => o.nombre);
}

/** Lo que la hoja ofrece en el selector de arco: materiales encendidos y calibres activos, en el formato del selector. */
export function opcionesDeArco(c: CatalogosDeHoja): {
  materiales: Array<{ key: string; label: string }>;
  calibres: Array<{ key: string; label: string }>;
} {
  return {
    materiales: c.arcosMateriales.filter((m) => m.activa).map((m) => ({ key: m.id, label: m.nombre })),
    calibres: c.arcosCalibres.filter((g) => g.activa).map((g) => ({ key: g.nombre, label: etiquetaDeCalibre(g.nombre) })),
  };
}

/**
 * Las opciones para elegir en la hoja: las activas y, al final, lo que ya está anotado aunque la clínica ya no lo
 * ofrezca (para no perderlo al editar un borrador).
 */
export function opcionesParaElegir(lista: readonly OpcionDeCatalogo[], yaAnotadas: ReadonlyArray<string | null | undefined>): string[] {
  const activas = nombresActivos(lista);
  const conocidas = new Set(activas.map(clave));
  const extra: string[] = [];
  for (const n of yaAnotadas) {
    const t = limpiarNombre(n);
    if (!t || conocidas.has(clave(t))) continue;
    conocidas.add(clave(t));
    extra.push(t);
  }
  return [...activas, ...extra];
}

/** ¿Este tipo de liga es «sin ligas» (autoligado)? Entonces no lleva color. */
export function esTipoSinLigas(tipo: string | null | undefined): boolean {
  const t = clave(tipo ?? "");
  return t.includes("autolig") || t.includes("sin liga");
}
