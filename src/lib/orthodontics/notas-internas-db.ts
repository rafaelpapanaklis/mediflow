// Ortodoncia — «Notas internas» del caso: las tablas `ortho_internal_notes` y `ortho_internal_note_revisions`
// (sql/salamanca-plantillas-orto-notas-internas.sql) por SQL crudo, SIN modelo de Prisma. Parte del módulo
// SOLO-EQUIPO (NOTAS_INTERNAS_SOLO_EQUIPO, ver ./notas-internas-service).
//
// Mientras las tablas no existan, `tablasNotasInternasExisten()` lo dice SIN consultarlas (to_regclass nunca
// falla) y recuerda la respuesta en `globalThis` (sobrevive a las recargas de `next dev`): nada de lanzar
// consultas que fallan y llenan el log de Postgres. Mismo patrón que src/lib/indicaciones/db.ts.
//
// Toda consulta lleva `clinicId`, y sin él se corta antes de consultar. NO hay ninguna sentencia DELETE aquí
// (ni en el SQL: una regla de la tabla hace que un DELETE no haga nada).

import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { FilaNotaNueva, NotaInterna, RepoNotasInternas, RevisionNota } from "./notas-internas-service";

const CLAVE = Symbol.for("dalecontrol.orto.notasInternas.tablas");
// 1 min: `to_regclass` nunca falla ni deja rastro en los logs, y así tras pegar el SQL la sección se enciende sola
// (ws1-t8 · P12; antes eran 10 min y la QA tenía que esperar).
const VOLVER_A_PREGUNTAR_MS = 60 * 1000;

type Memoria = { existe: boolean; en: number };

function memoria(): Memoria | undefined {
  return (globalThis as Record<symbol, Memoria | undefined>)[CLAVE];
}

/** ¿Existen las DOS tablas? Una vez que existen, no se vuelve a preguntar. */
export async function tablasNotasInternasExisten(forzar = false): Promise<boolean> {
  const m = memoria();
  if (m?.existe) return true;
  if (m && !forzar && Date.now() - m.en < VOLVER_A_PREGUNTAR_MS) return false;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT (to_regclass('public.ortho_internal_notes') IS NOT NULL
          AND to_regclass('public.ortho_internal_note_revisions') IS NOT NULL) AS existe`;
    const existe = filas[0]?.existe === true;
    (globalThis as Record<symbol, Memoria>)[CLAVE] = { existe, en: Date.now() };
    return existe;
  } catch (err) {
    // Si la base tarda (pooler) NO es «las tablas no existen»: se propaga para que la ruta conteste el error con
    // «Reintentar» y no el aviso de «todavía no están activas» (ws1-t8 · P12). No se memoriza.
    console.error("[ortodoncia:notas-internas] no se pudo saber si existen las tablas:", err);
    throw err;
  }
}

function exigirClinica(clinicId: string): void {
  if (typeof clinicId !== "string" || clinicId.length === 0) {
    throw new Error("notas internas: clinicId ausente — se corta antes de consultar");
  }
}

interface FilaNota {
  id: string;
  clinicId: string;
  patientId: string;
  caseId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FilaRevision {
  id: string;
  clinicId: string;
  noteId: string;
  previousBody: string;
  previousFrom: Date;
  editedById: string;
  editedAt: Date;
}

/** Nombres de las personas del EQUIPO de ESTA clínica (autores y quien corrigió). */
async function nombresDe(clinicId: string, ids: string[]): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (unicos.length === 0) return new Map();
  const usuarios: Array<{ id: string; firstName: string; lastName: string }> = await prisma.user
    .findMany({ where: { clinicId, id: { in: unicos } }, select: { id: true, firstName: true, lastName: true } })
    .catch(() => []);
  return new Map<string, string>(usuarios.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()] as [string, string]));
}

async function armar(clinicId: string, notas: FilaNota[]): Promise<NotaInterna[]> {
  if (notas.length === 0) return [];
  const ids = notas.map((n) => n.id);
  const revisiones = await prisma.$queryRaw<FilaRevision[]>`
    SELECT "id", "clinicId", "noteId", "previousBody", "previousFrom", "editedById", "editedAt"
      FROM "ortho_internal_note_revisions"
     WHERE "clinicId" = ${clinicId} AND "noteId" = ANY(${ids}::text[])
     ORDER BY "editedAt" DESC, "id" DESC`;
  const nombres = await nombresDe(clinicId, [...notas.map((n) => n.authorId), ...revisiones.map((r) => r.editedById)]);
  const porNota = new Map<string, RevisionNota[]>();
  for (const r of revisiones) {
    const lista = porNota.get(r.noteId) ?? [];
    lista.push({
      id: r.id,
      noteId: r.noteId,
      textoAnterior: r.previousBody,
      textoAnteriorDesde: new Date(r.previousFrom),
      corregidaPorId: r.editedById,
      corregidaPorNombre: nombres.get(r.editedById) ?? null,
      corregidaEl: new Date(r.editedAt),
    });
    porNota.set(r.noteId, lista);
  }
  return notas.map((n) => ({
    id: n.id,
    clinicId: n.clinicId,
    patientId: n.patientId,
    caseId: n.caseId,
    authorId: n.authorId,
    authorNombre: nombres.get(n.authorId) ?? null,
    texto: n.body,
    createdAt: new Date(n.createdAt),
    updatedAt: new Date(n.updatedAt),
    revisiones: porNota.get(n.id) ?? [],
  }));
}

export const repoNotasInternas: RepoNotasInternas = {
  tablaExiste: () => tablasNotasInternasExisten(),

  async listar(clinicId, caseId) {
    exigirClinica(clinicId);
    if (typeof caseId !== "string" || !caseId) return [];
    const filas = await prisma.$queryRaw<FilaNota[]>`
      SELECT "id", "clinicId", "patientId", "caseId", "authorId", "body", "createdAt", "updatedAt"
        FROM "ortho_internal_notes"
       WHERE "clinicId" = ${clinicId} AND "caseId" = ${caseId}
       ORDER BY "createdAt" DESC, "id" DESC`;
    return armar(clinicId, filas);
  },

  async obtener(clinicId, id) {
    exigirClinica(clinicId);
    if (typeof id !== "string" || !id) return null;
    const filas = await prisma.$queryRaw<FilaNota[]>`
      SELECT "id", "clinicId", "patientId", "caseId", "authorId", "body", "createdAt", "updatedAt"
        FROM "ortho_internal_notes"
       WHERE "id" = ${id} AND "clinicId" = ${clinicId}
       LIMIT 1`;
    return (await armar(clinicId, filas))[0] ?? null;
  },

  async insertar(f: FilaNotaNueva) {
    exigirClinica(f.clinicId);
    const filas = await prisma.$queryRaw<FilaNota[]>`
      INSERT INTO "ortho_internal_notes" ("id", "clinicId", "patientId", "caseId", "authorId", "body")
      VALUES (${randomUUID()}, ${f.clinicId}, ${f.patientId}, ${f.caseId}, ${f.authorId}, ${f.texto})
      RETURNING "id", "clinicId", "patientId", "caseId", "authorId", "body", "createdAt", "updatedAt"`;
    return (await armar(f.clinicId, filas))[0];
  },

  async corregir(clinicId, id, texto, corregidaPorId) {
    exigirClinica(clinicId);
    if (typeof id !== "string" || !id) return null;
    // UNA sola sentencia: la fila se bloquea, el texto vigente pasa a la tabla de revisiones y el nuevo lo
    // reemplaza. O pasan las dos cosas o ninguna; dos correcciones a la vez se turnan (FOR UPDATE).
    const hecho = await prisma.$queryRaw<{ id: string }[]>`
      WITH prev AS (
        SELECT "id", "clinicId", "body", "updatedAt"
          FROM "ortho_internal_notes"
         WHERE "id" = ${id} AND "clinicId" = ${clinicId}
           FOR UPDATE
      ), rev AS (
        INSERT INTO "ortho_internal_note_revisions"
          ("id", "clinicId", "noteId", "previousBody", "previousFrom", "editedById")
        SELECT ${randomUUID()}::text, p."clinicId", p."id", p."body", p."updatedAt", ${corregidaPorId}::text
          FROM prev p
        RETURNING "noteId"
      )
      UPDATE "ortho_internal_notes" n
         SET "body" = ${texto}::text, "updatedAt" = now()
        FROM prev p
       WHERE n."id" = p."id" AND n."clinicId" = ${clinicId}
      RETURNING n."id"`;
    if (hecho.length === 0) return null;
    return repoNotasInternas.obtener(clinicId, id);
  },
};
