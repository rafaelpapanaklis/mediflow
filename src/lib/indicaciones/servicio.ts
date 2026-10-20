// La biblioteca de hojas de la clínica (indicaciones y constancia): reglas sin
// base de datos. `repo` es cualquier cosa con la forma de `RepoHojas` (en
// producción, `repoHojas` de ./db.ts; en las pruebas, uno en memoria).
//
// Leyes:
//  · `clinicId` sale SIEMPRE de la sesión; el repo corta si falta.
//  · Las de fábrica no cambian de nombre. Su texto se edita como VERSIÓN DE LA
//    CLÍNICA (plantillas-fabrica; la fila de fábrica no se toca) y «volver a la de
//    fábrica» la archiva. Sin esa tabla (falta el SQL) el texto sigue siendo de solo
//    lectura: se copia. Sí se les cambia a qué procedimientos se ligan y si están en uso.
//  · Nada se borra: se apaga («en uso» / «inactiva»).
//  · Los procedimientos ligados se filtran contra el catálogo de ESTA clínica:
//    un id ajeno o inventado se descarta en silencio.

import { TEXTOS_DE_FABRICA, coincideConFabrica, normalizar, textoDeFabrica, type TipoHoja } from "./fabrica";
import type { RepoVersiones } from "@/lib/plantillas-fabrica/versiones";
import {
  MAX_CUERPO_HOJA,
  MAX_NOMBRE_HOJA,
  MAX_PROCEDIMIENTOS_HOJA,
  STATUS_HOJA,
  esTipoHoja,
  type CodigoHoja,
  type HojaDTO,
  type ProcedimientoLigable,
  type ResultadoHoja,
} from "./tipos";

export interface FilaHoja {
  id: string;
  clinicId: string;
  tipo: TipoHoja;
  nombre: string;
  cuerpo: string;
  procedureIds: string[];
  factoryKey: string | null;
  basadaEn: string | null;
  activa: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** El texto que trae es el de la versión de la clínica (lo pone `conVersiones`, no la tabla). */
  versionDeClinica?: boolean;
}

export interface FilaNueva {
  clinicId: string;
  tipo: TipoHoja;
  nombre: string;
  cuerpo: string;
  procedureIds: string[];
  factoryKey: string | null;
  basadaEn: string | null;
  createdById: string | null;
}

export interface CambiosFila {
  nombre?: string;
  cuerpo?: string;
  procedureIds?: string[];
  activa?: boolean;
}

export interface RepoHojas {
  tablaExiste(): Promise<boolean>;
  listar(clinicId: string, tipo?: TipoHoja): Promise<FilaHoja[]>;
  obtener(clinicId: string, id: string): Promise<FilaHoja | null>;
  insertar(f: FilaNueva): Promise<FilaHoja | "NOMBRE_OCUPADO">;
  sembrar(filas: FilaNueva[]): Promise<void>;
  actualizar(clinicId: string, id: string, c: CambiosFila): Promise<FilaHoja | "NOMBRE_OCUPADO" | null>;
}

const familiaDeTipo = (tipo: TipoHoja) => (tipo === "CONSTANCIA" ? ("HOJA_CONSTANCIA" as const) : ("HOJA_INDICACIONES" as const));

const falla = (codigo: CodigoHoja): ResultadoHoja => ({ ok: false, codigo, status: STATUS_HOJA[codigo] });

export function aDTO(f: FilaHoja): HojaDTO {
  return {
    id: f.id,
    tipo: f.tipo,
    nombre: f.nombre,
    cuerpo: f.cuerpo,
    procedureIds: [...f.procedureIds],
    deFabrica: !!f.factoryKey,
    versionDeClinica: !!f.versionDeClinica,
    basadaEn: f.factoryKey ?? f.basadaEn,
    activa: f.activa,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

/** Los procedimientos del catálogo que un texto de fábrica liga solo (por su nombre). */
export function ligaDeFabrica(clave: string, catalogo: readonly ProcedimientoLigable[]): string[] {
  const f = textoDeFabrica(clave);
  if (!f || f.tipo !== "INDICACIONES") return [];
  return catalogo.filter((p) => p.isActive && coincideConFabrica(f, p.name)).map((p) => p.id);
}

/**
 * La lista de la clínica. Si le falta alguna de fábrica (primera vez, o
 * DaleControl agregó una nueva), la siembra antes de devolver: ligada a los
 * procedimientos del catálogo que la nombran.
 *
 * `null` = la tabla todavía no existe (falta pegar el SQL): la función se oculta.
 */
export async function listarHojas(
  repo: RepoHojas,
  clinicId: string,
  catalogo: () => Promise<readonly ProcedimientoLigable[]>,
): Promise<HojaDTO[] | null> {
  if (!(await repo.tablaExiste())) return null;
  let filas = await repo.listar(clinicId);
  const tiene = new Set(filas.map((f) => f.factoryKey).filter(Boolean));
  const faltan = TEXTOS_DE_FABRICA.filter((t) => !tiene.has(t.clave));
  if (faltan.length > 0) {
    const cat = await catalogo();
    await repo.sembrar(
      faltan.map((t) => ({
        clinicId,
        tipo: t.tipo,
        nombre: t.nombre,
        cuerpo: t.cuerpo,
        procedureIds: ligaDeFabrica(t.clave, cat),
        factoryKey: t.clave,
        basadaEn: null,
        createdById: null,
      })),
    );
    filas = await repo.listar(clinicId);
  }
  return filas.map(aDTO);
}

function limpiarNombre(v: unknown): { nombre: string } | { codigo: CodigoHoja } {
  const nombre = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!nombre) return { codigo: "NOMBRE_REQUERIDO" };
  if (nombre.length > MAX_NOMBRE_HOJA) return { codigo: "NOMBRE_LARGO" };
  return { nombre };
}

function limpiarCuerpo(v: unknown): { cuerpo: string } | { codigo: CodigoHoja } {
  if (typeof v !== "string" || v.trim() === "") return { codigo: "CUERPO_REQUERIDO" };
  // Sin etiquetas: es texto plano (sale en WhatsApp y en el PDF tal cual).
  const cuerpo = v.replace(/\r\n?/g, "\n").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!cuerpo) return { codigo: "CUERPO_REQUERIDO" };
  if (cuerpo.length > MAX_CUERPO_HOJA) return { codigo: "CUERPO_LARGO" };
  return { cuerpo };
}

/** Solo ids del catálogo de ESTA clínica, sin repetir. */
export function limpiarProcedimientos(v: unknown, catalogo: readonly ProcedimientoLigable[]): string[] {
  if (!Array.isArray(v)) return [];
  const validos = new Set(catalogo.map((p) => p.id));
  const out: string[] = [];
  for (const id of v) {
    if (typeof id === "string" && validos.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_PROCEDIMIENTOS_HOJA) break;
  }
  return out;
}

async function nombreOcupado(repo: RepoHojas, clinicId: string, tipo: TipoHoja, nombre: string, exceptoId?: string) {
  const buscado = nombre.toLocaleLowerCase("es");
  return (await repo.listar(clinicId, tipo)).some((f) => f.id !== exceptoId && f.nombre.toLocaleLowerCase("es") === buscado);
}

export interface EntradaNueva {
  tipo?: unknown;
  nombre?: unknown;
  cuerpo?: unknown;
  procedureIds?: unknown;
  /** Id de la hoja de la que es copia («Copiar y editar»). */
  copiaDe?: unknown;
}

export async function crearHoja(
  repo: RepoHojas,
  clinicId: string,
  userId: string | null,
  e: EntradaNueva,
  catalogo: readonly ProcedimientoLigable[],
): Promise<ResultadoHoja> {
  if (!(await repo.tablaExiste())) return falla("SIN_TABLA");
  const origen = typeof e.copiaDe === "string" && e.copiaDe ? await repo.obtener(clinicId, e.copiaDe) : null;
  if (typeof e.copiaDe === "string" && e.copiaDe && !origen) return falla("NO_ENCONTRADA");
  const tipo = origen ? origen.tipo : e.tipo;
  if (!esTipoHoja(tipo)) return falla("TIPO_INVALIDO");
  const n = limpiarNombre(e.nombre);
  if ("codigo" in n) return falla(n.codigo);
  const c = limpiarCuerpo(e.cuerpo);
  if ("codigo" in c) return falla(c.codigo);
  if (await nombreOcupado(repo, clinicId, tipo, n.nombre)) return falla("NOMBRE_OCUPADO");

  // La copia hereda la liga de su original si no se manda otra.
  const procedureIds =
    tipo !== "INDICACIONES"
      ? []
      : e.procedureIds === undefined && origen
        ? limpiarProcedimientos(origen.procedureIds, catalogo)
        : limpiarProcedimientos(e.procedureIds, catalogo);

  const r = await repo.insertar({
    clinicId,
    tipo,
    nombre: n.nombre,
    cuerpo: c.cuerpo,
    procedureIds,
    factoryKey: null,
    basadaEn: origen ? (origen.factoryKey ?? origen.basadaEn) : null,
    createdById: userId,
  });
  if (r === "NOMBRE_OCUPADO") return falla("NOMBRE_OCUPADO");
  return { ok: true, hoja: aDTO(r) };
}

export interface EntradaEdicion {
  nombre?: unknown;
  cuerpo?: unknown;
  procedureIds?: unknown;
  activa?: unknown;
}

/** Dónde se guardan las versiones de clínica de las hojas de fábrica, y quién las guarda. */
export interface ContextoVersionesHoja {
  versiones: RepoVersiones;
  userId: string | null;
}

export async function editarHoja(
  repo: RepoHojas,
  clinicId: string,
  id: string,
  e: EntradaEdicion,
  catalogo: readonly ProcedimientoLigable[],
  ctx?: ContextoVersionesHoja,
): Promise<ResultadoHoja & { antes?: HojaDTO }> {
  if (!(await repo.tablaExiste())) return falla("SIN_TABLA");
  const actual = await repo.obtener(clinicId, id);
  if (!actual) return falla("NO_ENCONTRADA");

  const cambios: CambiosFila = {};
  let cuerpoDeClinica: string | null = null;
  if (e.nombre !== undefined || e.cuerpo !== undefined) {
    const n = e.nombre !== undefined ? limpiarNombre(e.nombre) : { nombre: actual.nombre };
    if ("codigo" in n) return falla(n.codigo);
    const c = e.cuerpo !== undefined ? limpiarCuerpo(e.cuerpo) : { cuerpo: actual.cuerpo };
    if ("codigo" in c) return falla(c.codigo);
    const cambiaTexto = n.nombre !== actual.nombre || c.cuerpo !== actual.cuerpo;
    if (actual.factoryKey) {
      // El nombre de la de fábrica es su identidad. El texto se guarda como versión de ESTA clínica.
      if (n.nombre !== actual.nombre) return falla("FABRICA_NO_SE_EDITA");
      if (c.cuerpo !== actual.cuerpo) {
        if (!ctx) return falla("FABRICA_NO_SE_EDITA");
        if (!(await ctx.versiones.disponible())) return falla("VERSIONES_NO_DISPONIBLES");
        cuerpoDeClinica = c.cuerpo;
      }
    } else if (cambiaTexto) {
      if (n.nombre !== actual.nombre) {
        if (await nombreOcupado(repo, clinicId, actual.tipo, n.nombre, actual.id)) return falla("NOMBRE_OCUPADO");
        cambios.nombre = n.nombre;
      }
      if (c.cuerpo !== actual.cuerpo) cambios.cuerpo = c.cuerpo;
    }
  }
  if (e.procedureIds !== undefined && actual.tipo === "INDICACIONES") {
    cambios.procedureIds = limpiarProcedimientos(e.procedureIds, catalogo);
  }
  if (typeof e.activa === "boolean") cambios.activa = e.activa;

  if (Object.keys(cambios).length === 0 && cuerpoDeClinica === null) {
    return { ok: true, hoja: aDTO(actual), antes: aDTO(actual) };
  }
  if (cuerpoDeClinica !== null && ctx) {
    // Misma fila de fábrica, otro texto SOLO para esta clínica (la de fábrica no se toca).
    await ctx.versiones.guardar({
      clinicId,
      familia: familiaDeTipo(actual.tipo),
      clave: actual.factoryKey!,
      cuerpo: cuerpoDeClinica,
      userId: ctx.userId,
    });
  }
  if (Object.keys(cambios).length === 0) {
    const fresca = await repo.obtener(clinicId, actual.id);
    if (!fresca) return falla("NO_ENCONTRADA");
    return { ok: true, hoja: aDTO(fresca), antes: aDTO(actual) };
  }
  const r = await repo.actualizar(clinicId, actual.id, cambios);
  if (r === "NOMBRE_OCUPADO") return falla("NOMBRE_OCUPADO");
  if (!r) return falla("NO_ENCONTRADA");
  // `actualizar` devuelve la fila con la versión puesta si el repo es el de la clínica; si no, la lee otra vez.
  const hoja = cuerpoDeClinica !== null ? ((await repo.obtener(clinicId, actual.id)) ?? r) : r;
  return { ok: true, hoja: aDTO(hoja), antes: aDTO(actual) };
}

/**
 * «Volver a la de fábrica»: archiva la versión de la clínica (la fila se queda) y
 * la hoja vuelve a su texto de fábrica. Devuelve la hoja ya sin versión.
 */
export async function volverAFabricaHoja(
  repo: RepoHojas,
  clinicId: string,
  id: string,
  ctx: ContextoVersionesHoja,
): Promise<ResultadoHoja & { antes?: HojaDTO }> {
  if (!(await repo.tablaExiste())) return falla("SIN_TABLA");
  const actual = await repo.obtener(clinicId, id);
  if (!actual) return falla("NO_ENCONTRADA");
  if (!actual.factoryKey) return falla("NO_ES_DE_FABRICA");
  if (!(await ctx.versiones.disponible())) return falla("VERSIONES_NO_DISPONIBLES");
  // Una pestaña vieja puede pedir «volver» cuando ya no hay versión vigente: no cambió nada (y no se audita).
  const archivada = await ctx.versiones.archivar(clinicId, familiaDeTipo(actual.tipo), actual.factoryKey, ctx.userId);
  const fresca = await repo.obtener(clinicId, actual.id);
  if (!fresca) return falla("NO_ENCONTRADA");
  return { ok: true, hoja: aDTO(fresca), antes: aDTO(actual), ...(archivada ? {} : { yaEstabaDeFabrica: true }) };
}

/** «Después de una extracción (copia)», «… (copia 2)»… sin chocar con los nombres que ya hay. */
export function nombreDeCopiaHoja(original: string, existentes: readonly string[], sufijo = "copia"): string {
  const usados = new Set(existentes.map((n) => n.toLocaleLowerCase("es")));
  const base = original.replace(/\s*\((?:copia|copy)(?: \d+)?\)\s*$/i, "").trim();
  for (let i = 1; i < 100; i++) {
    const candidato = `${base} (${sufijo}${i === 1 ? "" : ` ${i}`})`.slice(0, MAX_NOMBRE_HOJA);
    if (!usados.has(candidato.toLocaleLowerCase("es"))) return candidato;
  }
  return `${base} (${sufijo} ${Date.now()})`.slice(0, MAX_NOMBRE_HOJA);
}

// ─── La cita ────────────────────────────────────────────────────────────────

/**
 * Los procedimientos del catálogo que se hicieron (o se iban a hacer) en la cita.
 * La cita no guarda ids de procedimiento: se reconocen por NOMBRE (sin acentos ni
 * mayúsculas) en el motivo de la cita y en los conceptos de su nota de cobro —el
 * mismo criterio de «Cobrar hoy», que nunca adivina por parecido—.
 */
export function procedimientosDeLaCita(
  textos: ReadonlyArray<string | null | undefined>,
  catalogo: readonly ProcedimientoLigable[],
): ProcedimientoLigable[] {
  const buscados = new Set(textos.map((t) => normalizar(t)).filter(Boolean));
  return catalogo.filter((p) => buscados.has(normalizar(p.name)));
}

/**
 * Lo que se PROPONE no repite la MISMA hoja (ws1-t8 · N-P2, N3-P1, N3-P3). La fila de fábrica «Después de una
 * extracción», la versión que la clínica editó de ella y las copias que sacó comparten `basadaEn`; entre ellas:
 *  · si la clínica editó la de fábrica (`versionDeClinica`), esa versión es LA hoja y las copias viejas no se proponen
 *    (la fecha de una copia cambia con solo tocarle la liga o «en uso», así que no sirve para decidir cuál es la nueva);
 *  · si no hay versión, la de fábrica pelada cede a sus copias (la clínica ya tiene la suya).
 * Dos COPIAS entre sí nunca se descartan: son hojas distintas que la clínica hizo a propósito («Cirugía de cordales»,
 * «Injerto de encía»). Las que no vienen de una de fábrica (`basadaEn` nulo) tampoco. Conserva el orden de entrada.
 * Solo propone: lo que la persona marca a mano se respeta (ver `sinIdsRepetidos`).
 */
export function sinRepetirLaMismaHoja<T extends HojaDTO>(hojas: readonly T[]): T[] {
  const conVersion = new Set(hojas.filter((h) => h.deFabrica && h.versionDeClinica && h.basadaEn).map((h) => h.basadaEn));
  const conCopia = new Set(hojas.filter((h) => !h.deFabrica && h.basadaEn).map((h) => h.basadaEn));
  return hojas.filter((h) => {
    if (!h.basadaEn) return true;
    if (!h.deFabrica) return !conVersion.has(h.basadaEn); // la copia vieja cede a la versión editada
    return h.versionDeClinica || !conCopia.has(h.basadaEn); // la de fábrica pelada cede a sus copias
  });
}

/**
 * Lo que la persona MARCÓ: se respeta tal cual, sin descartar hojas distintas aunque vengan de la misma de fábrica
 * (ws1-t8 · N3-P1). Solo se quitan los ids repetidos en la petición.
 */
export function sinIdsRepetidos<T extends { id: string }>(hojas: readonly T[]): T[] {
  const vistos = new Set<string>();
  return hojas.filter((h) => (vistos.has(h.id) ? false : (vistos.add(h.id), true)));
}

/**
 * Qué hojas de indicaciones proponer para la cita (en uso). Primero las ligadas a
 * sus procedimientos; si ninguna, las de fábrica (o copias de una de fábrica)
 * cuyas palabras aparecen en el motivo o en los conceptos. Solo PROPONE: quien
 * está en la cita elige.
 */
export function hojasSugeridas(
  hojas: readonly HojaDTO[],
  procedimientos: readonly ProcedimientoLigable[],
  textos: ReadonlyArray<string | null | undefined>,
): string[] {
  const enUso = hojas.filter((h) => h.tipo === "INDICACIONES" && h.activa);
  const ids = new Set(procedimientos.map((p) => p.id));
  const porLiga = enUso.filter((h) => h.procedureIds.some((id) => ids.has(id)));
  if (porLiga.length > 0) return sinRepetirLaMismaHoja(porLiga).map((h) => h.id);
  const porPalabras = enUso.filter((h) => {
    const f = textoDeFabrica(h.basadaEn);
    return !!f && textos.some((t) => coincideConFabrica(f, t));
  });
  // Si la clínica ya tiene su propia hoja (copia o versión editada), la de fábrica pelada no se propone; y una copia
  // vieja no compite con la versión editada de la misma hoja.
  const sugeridas = sinRepetirLaMismaHoja(porPalabras).map((h) => h.id);
  if (sugeridas.length > 0) return sugeridas;
  return hojasDeOrtodonciaPorNombre(enUso, textos);
}

/** Minúsculas y sin acentos. */
function plano(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const PALABRAS_ORTO = ["ortodoncia", "brackets", "bracket", "alineador", "elastico", "retenedor", "arco"];

/**
 * C-72 (auditoría de uso, vuelta 2): DaleControl no trae hojas de ortodoncia de fábrica (textos clínicos: los decide
 * la clínica, decisión 15). Lo que sí hace el sistema: en una cita de ortodoncia («Control de ortodoncia», colocación…)
 * propone las hojas PROPIAS de la clínica cuyo nombre habla de ortodoncia, aunque nadie las haya ligado a un
 * procedimiento. Solo si no hubo propuesta por liga ni por palabras.
 */
export function hojasDeOrtodonciaPorNombre(
  enUso: readonly HojaDTO[],
  textos: ReadonlyArray<string | null | undefined>,
): string[] {
  const esCitaDeOrto = textos.some((t) => plano(t).includes("ortodoncia") || plano(t).includes("bracket"));
  if (!esCitaDeOrto) return [];
  return enUso
    .filter((h) => h.tipo === "INDICACIONES" && h.activa && !h.deFabrica && PALABRAS_ORTO.some((p) => plano(h.nombre).includes(p)))
    .map((h) => h.id);
}

/** La constancia que se usa si no se elige: la de la clínica más reciente en uso; si no, la de fábrica. */
export function constanciaPorDefecto(hojas: readonly HojaDTO[]): HojaDTO | null {
  const enUso = hojas.filter((h) => h.tipo === "CONSTANCIA" && h.activa);
  // La de fábrica que la clínica editó es LA constancia de la clínica y va primero; las copias, de la más reciente a la
  // más antigua (la fecha de una copia cambia al tocarle «en uso», por eso la versión no compite por fecha: N3-P3).
  const propias = enUso
    .filter((h) => !h.deFabrica || h.versionDeClinica)
    .sort((a, b) => Number(!!b.versionDeClinica) - Number(!!a.versionDeClinica) || b.updatedAt.localeCompare(a.updatedAt));
  return propias[0] ?? enUso[0] ?? null;
}
