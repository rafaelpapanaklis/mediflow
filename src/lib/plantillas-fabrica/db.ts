// La tabla `clinic_template_versions` (sql/salamanca-plantillas-orto-versiones.sql)
// por SQL crudo, SIN modelo de Prisma: si el código sale antes de que Rafael pegue
// el SQL, el cliente de Prisma compartido no cambia y nada se rompe.
//
// Mientras la tabla no exista, `disponible()` lo dice SIN consultarla (to_regclass
// nunca falla) y recuerda la respuesta en `globalThis` (sobrevive a las recargas de
// `next dev`): nada de lanzar consultas que fallan y llenan el log de Postgres.
//
// Toda consulta lleva `clinicId`, y sin él se corta antes de consultar.

import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { FamiliaVersion, GuardarVersion, RepoVersiones, VersionClinica } from "./versiones";

const CLAVE = Symbol.for("dalecontrol.plantillas-fabrica.tabla");
const VOLVER_A_PREGUNTAR_MS = 10 * 60 * 1000;

type Memoria = { existe: boolean; en: number };

function memoria(): Memoria | undefined {
  return (globalThis as Record<symbol, Memoria | undefined>)[CLAVE];
}

export async function tablaVersionesExiste(forzar = false): Promise<boolean> {
  const m = memoria();
  if (m?.existe) return true;
  if (m && !forzar && Date.now() - m.en < VOLVER_A_PREGUNTAR_MS) return false;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.clinic_template_versions') IS NOT NULL AS existe`;
    const existe = filas[0]?.existe === true;
    (globalThis as Record<symbol, Memoria>)[CLAVE] = { existe, en: Date.now() };
    return existe;
  } catch (err) {
    console.error("[plantillas-fabrica] no se pudo saber si existe la tabla:", err);
    return false;
  }
}

function exigirClinica(clinicId: string): void {
  if (typeof clinicId !== "string" || clinicId.length === 0) {
    throw new Error("plantillas-fabrica: clinicId ausente — se corta antes de consultar");
  }
}

interface FilaSql {
  id: string;
  clinicId: string;
  family: string;
  factoryKey: string;
  body: string;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

function aVersion(r: FilaSql): VersionClinica {
  return {
    id: r.id,
    clinicId: r.clinicId,
    familia: r.family as FamiliaVersion,
    clave: r.factoryKey,
    cuerpo: r.body,
    createdById: r.createdById,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
    archivedAt: r.archivedAt ? new Date(r.archivedAt) : null,
  };
}

export const repoVersiones: RepoVersiones = {
  disponible: () => tablaVersionesExiste(),

  async activas(clinicId, familia) {
    exigirClinica(clinicId);
    if (!(await tablaVersionesExiste())) return [];
    const filas = await prisma.$queryRaw<FilaSql[]>`
      SELECT * FROM "clinic_template_versions"
      WHERE "clinicId" = ${clinicId} AND "family" = ${familia} AND "archivedAt" IS NULL`;
    return filas.map(aVersion);
  },

  async guardar(v: GuardarVersion) {
    exigirClinica(v.clinicId);
    // Una sola vigente por (clínica, familia, plantilla): el índice único parcial la hace cumplir.
    const filas = await prisma.$queryRaw<FilaSql[]>`
      INSERT INTO "clinic_template_versions" ("id", "clinicId", "family", "factoryKey", "body", "createdById")
      VALUES (${randomUUID()}, ${v.clinicId}, ${v.familia}, ${v.clave}, ${v.cuerpo}, ${v.userId})
      ON CONFLICT ("clinicId", "family", "factoryKey") WHERE "archivedAt" IS NULL
      DO UPDATE SET "body" = EXCLUDED."body", "updatedAt" = now()
      RETURNING *`;
    return aVersion(filas[0]);
  },

  async archivar(clinicId, familia, clave, userId) {
    exigirClinica(clinicId);
    const filas = await prisma.$queryRaw<FilaSql[]>`
      UPDATE "clinic_template_versions"
      SET "archivedAt" = now(), "archivedById" = ${userId}, "updatedAt" = now()
      WHERE "clinicId" = ${clinicId} AND "family" = ${familia} AND "factoryKey" = ${clave} AND "archivedAt" IS NULL
      RETURNING *`;
    return filas[0] ? aVersion(filas[0]) : null;
  },

  async archivarTexto(v: GuardarVersion) {
    exigirClinica(v.clinicId);
    const filas = await prisma.$queryRaw<FilaSql[]>`
      INSERT INTO "clinic_template_versions"
        ("id", "clinicId", "family", "factoryKey", "body", "createdById", "archivedAt", "archivedById")
      VALUES (${randomUUID()}, ${v.clinicId}, ${v.familia}, ${v.clave}, ${v.cuerpo}, ${v.userId}, now(), ${v.userId})
      RETURNING *`;
    return aVersion(filas[0]);
  },
};
