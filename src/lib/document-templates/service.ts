// CRUD de plantillas. Toda la lógica vive aquí y no en el route handler para
// que (1) las otras pantallas lean plantillas con las mismas reglas y (2) se
// pueda probar sin base: `db` es cualquier cosa con la forma de
// `prisma.documentTemplate`.
//
// Tres leyes:
//  · TODA consulta lleva `clinicId`, y si falta se corta ANTES de consultar
//    (`clinicId: undefined` en Prisma no filtra nada: devuelve todas las clínicas).
//  · El cuerpo se sanea SIEMPRE aquí, en el servidor, al crear y al editar.
//  · Borrar es marcar `deletedAt`. La fila sigue ahí, así que un
//    `PatientDocument.templateId` que la apunte no se rompe — y aunque la fila
//    desapareciera, el documento lleva su propia copia de título y cuerpo.

import type { PrismaClient, DocumentTemplate } from "@prisma/client";
import {
  isDocumentTemplateKind,
  normalizeTemplateName,
  MAX_NAME_LENGTH,
  type DocumentTemplateKindValue,
} from "./kinds";
import { sanitizeTemplateHtml, isBlankHtml, MAX_BODY_LENGTH, MAX_INPUT_LENGTH } from "./sanitize";

export type TemplateDb = Pick<PrismaClient, "documentTemplate">;

export type TemplateErrorCode =
  | "KIND_INVALID"
  | "NAME_REQUIRED"
  | "NAME_TOO_LONG"
  | "BODY_REQUIRED"
  | "BODY_TOO_LONG"
  | "NAME_TAKEN"
  | "NOT_FOUND";

const MENSAJES: Record<TemplateErrorCode, { status: number; error: string }> = {
  KIND_INVALID: { status: 400, error: "Tipo de plantilla inválido" },
  NAME_REQUIRED: { status: 400, error: "El nombre es requerido" },
  NAME_TOO_LONG: { status: 400, error: `El nombre no puede pasar de ${MAX_NAME_LENGTH} caracteres` },
  BODY_REQUIRED: { status: 400, error: "El texto de la plantilla está vacío" },
  BODY_TOO_LONG: { status: 400, error: "El texto de la plantilla es demasiado largo" },
  NAME_TAKEN: { status: 409, error: "Ya existe una plantilla de este tipo con ese nombre" },
  NOT_FOUND: { status: 404, error: "Plantilla no encontrada" },
};

export type TemplateResult =
  | { ok: true; template: DocumentTemplate }
  | { ok: false; code: TemplateErrorCode; status: number; error: string };

const falla = (code: TemplateErrorCode): TemplateResult => ({ ok: false, code, ...MENSAJES[code] });

/**
 * El código del fallo, o null si salió bien. Con `"strict": false` un `!r.ok`
 * NO estrecha la unión (hace falta `r.ok === false`); esto ahorra recordarlo.
 */
export function templateErrorCode(r: TemplateResult): TemplateErrorCode | null {
  return r.ok === false ? r.code : null;
}

function exigirClinica(clinicId: string): void {
  if (typeof clinicId !== "string" || clinicId.length === 0) {
    throw new Error("document-templates: clinicId ausente — se corta antes de consultar");
  }
}

const esChoqueDeUnico = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

export interface ListTemplatesOptions {
  kind?: DocumentTemplateKindValue;
  /** La pantalla de Administración las quiere todas; la ficha del paciente, solo las activas. */
  includeInactive?: boolean;
}

export async function listTemplates(
  db: TemplateDb,
  clinicId: string,
  opts: ListTemplatesOptions = {},
): Promise<DocumentTemplate[]> {
  exigirClinica(clinicId);
  return db.documentTemplate.findMany({
    where: {
      clinicId,
      deletedAt: null,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
}

export async function getTemplate(
  db: TemplateDb,
  clinicId: string,
  id: string,
): Promise<DocumentTemplate | null> {
  exigirClinica(clinicId);
  if (typeof id !== "string" || id.length === 0) return null;
  return db.documentTemplate.findFirst({ where: { id, clinicId, deletedAt: null } });
}

function validarNombre(v: unknown): { name: string } | { code: TemplateErrorCode } {
  const name = normalizeTemplateName(v);
  if (!name) return { code: "NAME_REQUIRED" };
  if (name.length > MAX_NAME_LENGTH) return { code: "NAME_TOO_LONG" };
  return { name };
}

function validarCuerpo(v: unknown): { body: string } | { code: TemplateErrorCode } {
  // El tamaño de la ENTRADA se mira antes de gastar CPU en sanearla.
  if (typeof v === "string" && v.length > MAX_INPUT_LENGTH) return { code: "BODY_TOO_LONG" };
  const body = sanitizeTemplateHtml(v);
  if (isBlankHtml(body)) return { code: "BODY_REQUIRED" };
  if (body.length > MAX_BODY_LENGTH) return { code: "BODY_TOO_LONG" };
  return { body };
}

/** «Endodoncia» y «endodoncia» son la misma plantilla para quien las lee en una lista. */
async function nombreOcupado(
  db: TemplateDb,
  clinicId: string,
  kind: DocumentTemplateKindValue,
  name: string,
  exceptoId?: string,
): Promise<boolean> {
  // Se comparan aquí y no con `mode: "insensitive"`: en Postgres eso es un
  // ILIKE, y un nombre con `%` o `_` («Endo%») haría de comodín y chocaría con
  // plantillas que no se llaman así. Son pocas filas por clínica y tipo.
  const delTipo = await db.documentTemplate.findMany({
    where: { clinicId, kind, deletedAt: null },
    select: { id: true, name: true },
  });
  const buscado = name.toLocaleLowerCase("es");
  return delTipo.some((t) => t.id !== exceptoId && t.name.toLocaleLowerCase("es") === buscado);
}

export interface CreateTemplateInput {
  kind?: unknown;
  name?: unknown;
  body?: unknown;
}

export async function createTemplate(
  db: TemplateDb,
  clinicId: string,
  createdById: string | null,
  input: CreateTemplateInput,
): Promise<TemplateResult> {
  exigirClinica(clinicId);
  if (!isDocumentTemplateKind(input.kind)) return falla("KIND_INVALID");
  const n = validarNombre(input.name);
  if ("code" in n) return falla(n.code);
  const b = validarCuerpo(input.body);
  if ("code" in b) return falla(b.code);

  if (await nombreOcupado(db, clinicId, input.kind, n.name)) return falla("NAME_TAKEN");

  try {
    const template = await db.documentTemplate.create({
      data: { clinicId, kind: input.kind, name: n.name, body: b.body, createdById },
    });
    return { ok: true, template };
  } catch (err) {
    // Dos altas a la vez: la que pierde la carrera choca con el @@unique.
    if (esChoqueDeUnico(err)) return falla("NAME_TAKEN");
    throw err;
  }
}

export interface UpdateTemplateInput {
  name?: unknown;
  body?: unknown;
  isActive?: unknown;
}

/** El tipo NO se edita: una nota no se convierte en consentimiento. Se crea otra. */
export async function updateTemplate(
  db: TemplateDb,
  clinicId: string,
  id: string,
  input: UpdateTemplateInput,
): Promise<TemplateResult> {
  exigirClinica(clinicId);
  const actual = await getTemplate(db, clinicId, id);
  if (!actual) return falla("NOT_FOUND");

  const data: { name?: string; body?: string; isActive?: boolean } = {};
  if (input.name !== undefined) {
    const n = validarNombre(input.name);
    if ("code" in n) return falla(n.code);
    if (n.name !== actual.name) {
      if (await nombreOcupado(db, clinicId, actual.kind, n.name, actual.id)) return falla("NAME_TAKEN");
      data.name = n.name;
    }
  }
  if (input.body !== undefined) {
    const b = validarCuerpo(input.body);
    if ("code" in b) return falla(b.code);
    data.body = b.body;
  }
  if (typeof input.isActive === "boolean") data.isActive = input.isActive;

  try {
    // `actual` ya se leyó con clinicId: su id es de esta clínica.
    const template = await db.documentTemplate.update({ where: { id: actual.id }, data });
    return { ok: true, template };
  } catch (err) {
    if (esChoqueDeUnico(err)) return falla("NAME_TAKEN");
    throw err;
  }
}

/**
 * Borrado lógico. Además de marcar `deletedAt` se le cambia el nombre a la
 * fila borrada: el `@@unique([clinicId, kind, name])` de la base no sabe de
 * `deletedAt`, y sin esto la clínica no podría volver a crear «Endodoncia»
 * después de borrarla. Los documentos ya hechos no se enteran: llevan su
 * propia copia del título.
 */
export async function deleteTemplate(db: TemplateDb, clinicId: string, id: string): Promise<TemplateResult> {
  exigirClinica(clinicId);
  const actual = await getTemplate(db, clinicId, id);
  if (!actual) return falla("NOT_FOUND");
  const borrar = (name: string) =>
    db.documentTemplate.update({
      where: { id: actual.id },
      data: { deletedAt: new Date(), isActive: false, name },
    });
  try {
    return { ok: true, template: await borrar(`${actual.name} (eliminada ${actual.id})`) };
  } catch (err) {
    if (!esChoqueDeUnico(err)) throw err;
    // Alguien llamó a otra plantilla justo «X (eliminada <id>)». El borrado no
    // puede quedarse bloqueado por eso: se libera con un nombre irrepetible.
    return { ok: true, template: await borrar(`${actual.name} (eliminada ${actual.id} ${Date.now()})`) };
  }
}
