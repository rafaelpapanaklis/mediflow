// La tabla `patient_handout_templates` (sql/ws1-t10-indicaciones-y-constancia.sql)
// por SQL crudo, SIN modelo de Prisma: si el código sale antes de que Rafael pegue
// el SQL, un modelo nuevo no rompe nada, pero el cliente de Prisma compartido de
// las otras pantallas tampoco tiene que regenerarse.
//
// Mientras la tabla no exista, `tablaExiste()` lo dice SIN consultarla (to_regclass
// nunca falla) y recuerda la respuesta en `globalThis` (sobrevive a las recargas de
// `next dev`): nada de lanzar consultas que fallan y llenan el log de Postgres.
//
// Toda consulta lleva `clinicId`, y sin él se corta antes de consultar.

import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { TipoHoja } from "./fabrica";
import type { RepoHojas, FilaHoja, FilaNueva, CambiosFila } from "./servicio";
import { conVersiones } from "./con-versiones";
import { repoVersiones } from "@/lib/plantillas-fabrica/db";

const CLAVE = Symbol.for("dalecontrol.indicaciones.tabla");
const VOLVER_A_PREGUNTAR_MS = 10 * 60 * 1000;

type Memoria = { existe: boolean; en: number };

function memoria(): Memoria | undefined {
  return (globalThis as Record<symbol, Memoria | undefined>)[CLAVE];
}

export async function tablaHojasExiste(forzar = false): Promise<boolean> {
  const m = memoria();
  // Una vez que existe, existe: no se vuelve a preguntar.
  if (m?.existe) return true;
  if (m && !forzar && Date.now() - m.en < VOLVER_A_PREGUNTAR_MS) return false;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.patient_handout_templates') IS NOT NULL AS existe`;
    const existe = filas[0]?.existe === true;
    (globalThis as Record<symbol, Memoria>)[CLAVE] = { existe, en: Date.now() };
    return existe;
  } catch (err) {
    console.error("[indicaciones] no se pudo saber si existe la tabla:", err);
    return false;
  }
}

function exigirClinica(clinicId: string): void {
  if (typeof clinicId !== "string" || clinicId.length === 0) {
    throw new Error("indicaciones: clinicId ausente — se corta antes de consultar");
  }
}

interface FilaSql {
  id: string;
  clinicId: string;
  kind: string;
  name: string;
  body: string;
  procedureIds: string[] | null;
  factoryKey: string | null;
  basedOn: string | null;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function aFila(r: FilaSql): FilaHoja {
  return {
    id: r.id,
    clinicId: r.clinicId,
    tipo: r.kind as TipoHoja,
    nombre: r.name,
    cuerpo: r.body,
    procedureIds: Array.isArray(r.procedureIds) ? r.procedureIds : [],
    factoryKey: r.factoryKey,
    basadaEn: r.basedOn,
    activa: r.isActive,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

/** ¿Es el choque con un índice único (23505)? Prisma lo envuelve en P2010 con el código en el mensaje. */
export function esChoqueDeUnico(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  if (!e) return false;
  return e.code === "23505" || e.meta?.code === "23505" || /23505|unique constraint/i.test(String(e.message ?? ""));
}

export const repoHojas: RepoHojas = {
  tablaExiste: () => tablaHojasExiste(),

  async listar(clinicId, tipo) {
    exigirClinica(clinicId);
    const filas = tipo
      ? await prisma.$queryRaw<FilaSql[]>`
          SELECT * FROM "patient_handout_templates"
          WHERE "clinicId" = ${clinicId} AND "kind" = ${tipo}
          ORDER BY "name" ASC`
      : await prisma.$queryRaw<FilaSql[]>`
          SELECT * FROM "patient_handout_templates"
          WHERE "clinicId" = ${clinicId}
          ORDER BY "kind" ASC, "name" ASC`;
    return filas.map(aFila);
  },

  async obtener(clinicId, id) {
    exigirClinica(clinicId);
    if (typeof id !== "string" || !id) return null;
    const filas = await prisma.$queryRaw<FilaSql[]>`
      SELECT * FROM "patient_handout_templates"
      WHERE "id" = ${id} AND "clinicId" = ${clinicId}
      LIMIT 1`;
    return filas[0] ? aFila(filas[0]) : null;
  },

  async insertar(f: FilaNueva) {
    exigirClinica(f.clinicId);
    try {
      const filas = await prisma.$queryRaw<FilaSql[]>`
        INSERT INTO "patient_handout_templates"
          ("id", "clinicId", "kind", "name", "body", "procedureIds", "factoryKey", "basedOn", "isActive", "createdById")
        VALUES
          (${randomUUID()}, ${f.clinicId}, ${f.tipo}, ${f.nombre}, ${f.cuerpo}, ${f.procedureIds}::text[],
           ${f.factoryKey}, ${f.basadaEn}, true, ${f.createdById})
        RETURNING *`;
      return aFila(filas[0]);
    } catch (err) {
      if (esChoqueDeUnico(err)) return "NOMBRE_OCUPADO";
      throw err;
    }
  },

  async sembrar(filas: FilaNueva[]) {
    for (const f of filas) {
      exigirClinica(f.clinicId);
      // ON CONFLICT sin destino: ni la llave de fábrica ni el nombre se duplican, y
      // dos pestañas abriendo Plantillas a la vez no chocan.
      await prisma.$executeRaw`
        INSERT INTO "patient_handout_templates"
          ("id", "clinicId", "kind", "name", "body", "procedureIds", "factoryKey", "basedOn", "isActive", "createdById")
        VALUES
          (${randomUUID()}, ${f.clinicId}, ${f.tipo}, ${f.nombre}, ${f.cuerpo}, ${f.procedureIds}::text[],
           ${f.factoryKey}, ${f.basadaEn}, true, NULL)
        ON CONFLICT DO NOTHING`;
    }
  },

  async actualizar(clinicId, id, c: CambiosFila) {
    exigirClinica(clinicId);
    try {
      // COALESCE: lo que no viene no se toca. `id` + `clinicId`: nunca la fila de otra clínica.
      const filas = await prisma.$queryRaw<FilaSql[]>`
        UPDATE "patient_handout_templates" SET
          "name" = COALESCE(${c.nombre ?? null}, "name"),
          "body" = COALESCE(${c.cuerpo ?? null}, "body"),
          "procedureIds" = COALESCE(${c.procedureIds ?? null}::text[], "procedureIds"),
          "isActive" = COALESCE(${c.activa ?? null}, "isActive"),
          "updatedAt" = now()
        WHERE "id" = ${id} AND "clinicId" = ${clinicId}
        RETURNING *`;
      return filas[0] ? aFila(filas[0]) : null;
    } catch (err) {
      if (esChoqueDeUnico(err)) return "NOMBRE_OCUPADO";
      throw err;
    }
  },
};

/**
 * La biblioteca como la ve la clínica: con SU versión del texto puesta sobre cada
 * hoja de fábrica que editó. Es la que usan las pantallas, la API y la cita.
 * `repoHojas` a secas es la tabla tal cual (la copia de sede la necesita así).
 */
export const repoHojasVigente: RepoHojas = conVersiones(repoHojas, repoVersiones);

/** El catálogo de la clínica, sin precios: lo que hace falta para ligar y para reconocer la cita. */
export async function catalogoLigable(clinicId: string) {
  exigirClinica(clinicId);
  return prisma.procedureCatalog.findMany({
    where: { clinicId },
    select: { id: true, name: true, isActive: true },
    orderBy: { name: "asc" },
  });
}
