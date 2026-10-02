// Ortodoncia — CRUD de las plantillas de nota de la hoja de control (ws1-t5 · 10b).
// Lógica aquí y no en el route handler, con `db` inyectable para probarla sin
// base. Ver plantillas-nota.ts para el porqué.
//
// Leyes:
//  · TODA consulta lleva `clinicId`; si falta se corta ANTES de consultar
//    (`clinicId: undefined` en Prisma no filtra: devuelve todas las clínicas).
//  · «Desactivar» es `deletedAt` (la columna que ya existe y que el selector de
//    la hoja ya respeta): sin SQL nuevo, y reactivar es quitarla. Nada se borra.
//  · Las de fábrica no se editan ni se renombran: solo se copian o se apagan.
//  · El `@@unique([clinicId, module, name])` cuenta también las apagadas, así
//    que los nombres se comparan contra TODAS las filas.

import type { PrismaClient } from "@prisma/client";
import {
  ESTADO_DE_ERROR_NOTA,
  esDeFabrica,
  validarCuerpoNota,
  validarNombreNota,
  type CodigoErrorNota,
  type CuerpoSoap,
} from "./plantillas-nota";

export type NotaDb = Pick<PrismaClient, "clinicalEvolutionTemplate">;

const MODULO = "orthodontics" as const;

export interface PlantillaNotaDTO {
  id: string;
  name: string;
  soap: CuerpoSoap;
  /** Sembrada por DaleControl: se copia, no se edita. */
  deFabrica: boolean;
  activa: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ResultadoNota =
  | { ok: true; plantilla: PlantillaNotaDTO }
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

function aDTO(f: Fila, fabrica: readonly string[]): PlantillaNotaDTO {
  return {
    id: f.id,
    name: f.name,
    soap: comoSoap(f.soapTemplate),
    deFabrica: esDeFabrica(f.name, fabrica),
    activa: f.deletedAt === null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
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
): Promise<PlantillaNotaDTO[]> {
  exigirClinica(clinicId);
  const filas = await db.clinicalEvolutionTemplate.findMany({
    where: { clinicId, module: MODULO },
    select: SELECCION,
  });
  return filas.map((f) => aDTO(f, nombresDeFabrica));
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

export async function editarPlantillaNota(
  db: NotaDb,
  clinicId: string,
  id: string,
  input: EditarNotaInput,
  nombresDeFabrica: readonly string[],
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
  const tocaTexto = input.name !== undefined || input.soap !== undefined;
  if (tocaTexto && fabrica) return falla("FACTORY_READONLY");

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
  if (typeof input.activa === "boolean") {
    const yaActiva = actual.deletedAt === null;
    if (input.activa !== yaActiva) data.deletedAt = input.activa ? null : new Date();
  }

  try {
    // `actual` ya se leyó con clinicId: su id es de esta clínica.
    const fila = await db.clinicalEvolutionTemplate.update({ where: { id: actual.id }, data, select: SELECCION });
    return { ok: true, plantilla: aDTO(fila, nombresDeFabrica) };
  } catch (err) {
    if (esChoqueDeUnico(err)) return falla("NAME_TAKEN");
    throw err;
  }
}
