// Ortodoncia — CRUD de las plantillas de nota de la hoja de control (ws1-t5 · 10b).
// Lógica aquí y no en el route handler, con `db` inyectable para probarla sin
// base. Ver plantillas-nota.ts para el porqué.
//
// Leyes:
//  · TODA consulta lleva `clinicId`; si falta se corta ANTES de consultar
//    (`clinicId: undefined` en Prisma no filtra: devuelve todas las clínicas).
//  · «Desactivar» es `deletedAt` (la columna que ya existe y que el selector de
//    la hoja ya respeta): sin SQL nuevo, y reactivar es quitarla. Nada se borra.
//  · Las de fábrica no se renombran, y su texto no se reescribe en la fila: al
//    editarlo se guarda la VERSIÓN DE LA CLÍNICA (plantillas-fabrica) que la
//    reemplaza solo ahí; «volver a la de fábrica» la archiva (nada se borra).
//    Sin la tabla de versiones siguen siendo solo de lectura (se copian o se apagan).
//  · El `@@unique([clinicId, module, name])` cuenta también las apagadas, así
//    que los nombres se comparan contra TODAS las filas.

import type { PrismaClient } from "@prisma/client";
import {
  ESTADO_DE_ERROR_NOTA,
  SECCIONES_SOAP,
  esDeFabrica,
  validarCuerpoNota,
  validarNombreNota,
  type CodigoErrorNota,
  type CuerpoSoap,
} from "./plantillas-nota";
import type { RepoVersiones, VersionClinica } from "@/lib/plantillas-fabrica/versiones";

export type NotaDb = Pick<PrismaClient, "clinicalEvolutionTemplate">;

const MODULO = "orthodontics" as const;

export interface PlantillaNotaDTO {
  id: string;
  name: string;
  soap: CuerpoSoap;
  /** Sembrada por DaleControl: el nombre no cambia; el texto se edita como versión de la clínica. */
  deFabrica: boolean;
  /** El texto que rige es el de la clínica (editó la de fábrica). Solo en las de fábrica. */
  versionDeClinica: boolean;
  activa: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ResultadoNota =
  | { ok: true; plantilla: PlantillaNotaDTO; yaEstabaDeFabrica?: boolean }
  | { ok: false; codigo: CodigoErrorNota; status: number };

const falla = (codigo: CodigoErrorNota): ResultadoNota => ({ ok: false, codigo, status: ESTADO_DE_ERROR_NOTA[codigo] });

function exigirClinica(clinicId: string): void {
  if (typeof clinicId !== "string" || clinicId.length === 0) {
    throw new Error("plantillas-nota: clinicId ausente — se corta antes de consultar");
  }
}

const esChoqueDeUnico = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

interface Fila {
  id: string;
  name: string;
  soapTemplate: unknown;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function comoSoap(v: unknown): CuerpoSoap {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const t = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return { S: t("S"), O: t("O"), A: t("A"), P: t("P") };
}

/** El SOAP de una versión de clínica (guardada como JSON); `null` si no se puede leer. */
export function soapDeVersion(v: Pick<VersionClinica, "cuerpo">): CuerpoSoap | null {
  try {
    const o = JSON.parse(v.cuerpo);
    if (!o || typeof o !== "object") return null;
    const soap = comoSoap(o);
    return SECCIONES_SOAP.every((s) => soap[s] === "") ? null : soap;
  } catch {
    return null;
  }
}

/** Qué versión vigente reemplaza a esta fila de fábrica (por el nombre con que se siembra). */
function versionDe(nombre: string, versiones: ReadonlyMap<string, VersionClinica> | undefined): VersionClinica | undefined {
  if (!versiones) return undefined;
  for (const [clave, v] of versiones) {
    if (clave.toLocaleLowerCase("es") === nombre.toLocaleLowerCase("es")) return v;
  }
  return undefined;
}

/**
 * El SOAP que rige para una fila: el de la versión de la clínica si la hay (solo
 * existen para plantillas de fábrica, se reconocen por el nombre), y si no el de
 * la fila. Lo usa el selector de la hoja de control.
 */
export function soapVigente<T>(
  nombre: string,
  soapDeLaFila: T,
  vigentes: ReadonlyMap<string, VersionClinica>,
): T | CuerpoSoap {
  const v = versionDe(nombre, vigentes);
  return (v && soapDeVersion(v)) || soapDeLaFila;
}

function aDTO(
  f: Fila,
  fabrica: readonly string[],
  versiones?: ReadonlyMap<string, VersionClinica>,
): PlantillaNotaDTO {
  const deFabrica = esDeFabrica(f.name, fabrica);
  // La versión de la clínica reemplaza el TEXTO de la de fábrica: el id, el nombre y lo demás son los de siempre.
  const v = deFabrica ? versionDe(f.name, versiones) : undefined;
  const soapVersion = v ? soapDeVersion(v) : null;
  return {
    id: f.id,
    name: f.name,
    soap: soapVersion ?? comoSoap(f.soapTemplate),
    deFabrica,
    versionDeClinica: !!soapVersion,
    activa: f.deletedAt === null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: (soapVersion && v ? v.updatedAt : f.updatedAt).toISOString(),
  };
}

/** Las versiones vigentes de la clínica ya indexadas; vacío si no hay tabla. */
export async function versionesVigentes(
  versiones: RepoVersiones | undefined,
  clinicId: string,
): Promise<Map<string, VersionClinica>> {
  exigirClinica(clinicId);
  const m = new Map<string, VersionClinica>();
  if (!versiones || !(await versiones.disponible())) return m;
  for (const v of await versiones.activas(clinicId, "ORTO_NOTA")) m.set(v.clave, v);
  return m;
}

const SELECCION = {
  id: true,
  name: true,
  soapTemplate: true,
  proceduresPrefilled: true,
  materialsPrefilled: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Todas las de la clínica, activas y apagadas (la pantalla las quiere a las dos). */
export async function listarPlantillasNota(
  db: NotaDb,
  clinicId: string,
  nombresDeFabrica: readonly string[],
  versiones?: RepoVersiones,
): Promise<PlantillaNotaDTO[]> {
  exigirClinica(clinicId);
  const filas = await db.clinicalEvolutionTemplate.findMany({
    where: { clinicId, module: MODULO },
    select: SELECCION,
  });
  const vigentes = await versionesVigentes(versiones, clinicId);
  return filas.map((f) => aDTO(f, nombresDeFabrica, vigentes));
}

async function nombresDeLaClinica(db: NotaDb, clinicId: string, exceptoId?: string): Promise<string[]> {
  const filas = await db.clinicalEvolutionTemplate.findMany({
    where: { clinicId, module: MODULO },
    select: { id: true, name: true },
  });
  return filas.filter((f) => f.id !== exceptoId).map((f) => f.name);
}

const igual = (a: string, b: string) => a.toLocaleLowerCase("es") === b.toLocaleLowerCase("es");

export interface CrearNotaInput {
  name?: unknown;
  soap?: unknown;
  /** Si es una copia: de cuál (hereda sus procedimientos y materiales sugeridos). */
  copiaDe?: unknown;
}

export async function crearPlantillaNota(
  db: NotaDb,
  clinicId: string,
  userId: string,
  input: CrearNotaInput,
  nombresDeFabrica: readonly string[],
): Promise<ResultadoNota> {
  exigirClinica(clinicId);
  const n = validarNombreNota(input.name);
  if ("codigo" in n) return falla(n.codigo);
  const c = validarCuerpoNota(input.soap);
  if ("codigo" in c) return falla(c.codigo);

  let procedimientos: string[] = [];
  let materiales: string[] = [];
  if (typeof input.copiaDe === "string" && input.copiaDe) {
    const origen = await db.clinicalEvolutionTemplate.findFirst({
      where: { id: input.copiaDe, clinicId, module: MODULO },
      select: SELECCION,
    });
    if (!origen) return falla("NOT_FOUND");
    procedimientos = origen.proceduresPrefilled;
    materiales = origen.materialsPrefilled;
  }

  const ocupados = await nombresDeLaClinica(db, clinicId);
  if (ocupados.some((o) => igual(o, n.nombre)) || esDeFabrica(n.nombre, nombresDeFabrica)) return falla("NAME_TAKEN");

  try {
    const fila = await db.clinicalEvolutionTemplate.create({
      data: {
        clinicId,
        module: MODULO,
        name: n.nombre,
        soapTemplate: c.soap as unknown as object,
        proceduresPrefilled: procedimientos,
        materialsPrefilled: materiales,
        isDefault: false,
        createdBy: userId,
      },
      select: SELECCION,
    });
    return { ok: true, plantilla: aDTO(fila, nombresDeFabrica) };
  } catch (err) {
    if (esChoqueDeUnico(err)) return falla("NAME_TAKEN");
    throw err;
  }
}

export interface EditarNotaInput {
  name?: unknown;
  soap?: unknown;
  activa?: unknown;
}

/** Con quién y dónde se guardan las versiones de clínica de las de fábrica. */
export interface ContextoVersiones {
  versiones: RepoVersiones;
  userId: string;
}

export async function editarPlantillaNota(
  db: NotaDb,
  clinicId: string,
  id: string,
  input: EditarNotaInput,
  nombresDeFabrica: readonly string[],
  ctx?: ContextoVersiones,
): Promise<ResultadoNota> {
  exigirClinica(clinicId);
  if (typeof id !== "string" || id.length === 0) return falla("NOT_FOUND");
  const actual = await db.clinicalEvolutionTemplate.findFirst({
    where: { id, clinicId, module: MODULO },
    select: SELECCION,
  });
  if (!actual) return falla("NOT_FOUND");
  const fabrica = esDeFabrica(actual.name, nombresDeFabrica);

  const data: { name?: string; soapTemplate?: object; deletedAt?: Date | null } = {};
  let soapDeClinica: CuerpoSoap | null = null;

  if (fabrica) {
    // El nombre es la identidad de la de fábrica: no cambia. Mandar el mismo es inofensivo.
    if (input.name !== undefined) {
      const n = validarNombreNota(input.name);
      if ("codigo" in n) return falla(n.codigo);
      if (!igual(n.nombre, actual.name)) return falla("FACTORY_READONLY");
    }
    if (input.soap !== undefined) {
      // Sin la tabla de versiones (falta el SQL) el texto de fábrica sigue siendo de solo lectura.
      if (!ctx) return falla("FACTORY_READONLY");
      if (!(await ctx.versiones.disponible())) return falla("VERSIONES_NO_DISPONIBLES");
      const c = validarCuerpoNota(input.soap);
      if ("codigo" in c) return falla(c.codigo);
      // Guardar sin cambiar nada no convierte la de fábrica en «versión de la clínica» (ws1-t8 · P5).
      const vigentesAntes = await versionesVigentes(ctx.versiones, clinicId);
      const rige = comoSoap(soapVigente(actual.name, actual.soapTemplate, vigentesAntes));
      if (SECCIONES_SOAP.some((s) => rige[s].replace(/\r\n/g, "\n").trim() !== c.soap[s])) soapDeClinica = c.soap;
    }
  } else {
    if (input.name !== undefined) {
      const n = validarNombreNota(input.name);
      if ("codigo" in n) return falla(n.codigo);
      if (n.nombre !== actual.name) {
        const ocupados = await nombresDeLaClinica(db, clinicId, actual.id);
        if (ocupados.some((o) => igual(o, n.nombre)) || esDeFabrica(n.nombre, nombresDeFabrica)) return falla("NAME_TAKEN");
        data.name = n.nombre;
      }
    }
    if (input.soap !== undefined) {
      const c = validarCuerpoNota(input.soap);
      if ("codigo" in c) return falla(c.codigo);
      data.soapTemplate = c.soap as unknown as object;
    }
  }
  if (typeof input.activa === "boolean") {
    const yaActiva = actual.deletedAt === null;
    if (input.activa !== yaActiva) data.deletedAt = input.activa ? null : new Date();
  }

  try {
    // `actual` ya se leyó con clinicId: su id es de esta clínica.
    const fila = Object.keys(data).length
      ? await db.clinicalEvolutionTemplate.update({ where: { id: actual.id }, data, select: SELECCION })
      : actual;
    if (soapDeClinica && ctx) {
      // Misma fila de fábrica, otro texto SOLO para esta clínica (la de fábrica no se toca).
      await ctx.versiones.guardar({
        clinicId,
        familia: "ORTO_NOTA",
        clave: actual.name,
        cuerpo: JSON.stringify(soapDeClinica),
        userId: ctx.userId,
      });
    }
    const vigentes = await versionesVigentes(ctx?.versiones, clinicId);
    return { ok: true, plantilla: aDTO(fila, nombresDeFabrica, vigentes) };
  } catch (err) {
    if (esChoqueDeUnico(err)) return falla("NAME_TAKEN");
    throw err;
  }
}

/**
 * «Volver a la de fábrica»: archiva la versión de la clínica (no la borra) y la
 * plantilla vuelve a su texto de fábrica. Devuelve la plantilla ya sin versión.
 */
export async function volverAFabricaNota(
  db: NotaDb,
  clinicId: string,
  id: string,
  nombresDeFabrica: readonly string[],
  ctx: ContextoVersiones,
): Promise<ResultadoNota> {
  exigirClinica(clinicId);
  if (typeof id !== "string" || id.length === 0) return falla("NOT_FOUND");
  const actual = await db.clinicalEvolutionTemplate.findFirst({
    where: { id, clinicId, module: MODULO },
    select: SELECCION,
  });
  if (!actual) return falla("NOT_FOUND");
  if (!esDeFabrica(actual.name, nombresDeFabrica)) return falla("NOT_FACTORY");
  if (!(await ctx.versiones.disponible())) return falla("VERSIONES_NO_DISPONIBLES");
  // Una pestaña vieja puede pedir «volver» cuando ya no hay versión vigente: no cambió nada, no se audita (P8).
  const archivada = await ctx.versiones.archivar(clinicId, "ORTO_NOTA", actual.name, ctx.userId);
  const vigentes = await versionesVigentes(ctx.versiones, clinicId);
  return { ok: true, plantilla: aDTO(actual, nombresDeFabrica, vigentes), ...(archivada ? {} : { yaEstabaDeFabrica: true }) };
}
