// Consentimientos de fábrica (ws1-t6). Los consentimientos NO se guardan como
// "versión": se SIEMBRAN como filas de la clínica (`ensureConsentTemplates`) y la
// clínica las edita en su propia fila, que ninguna actualización pisa. Lo que
// faltaba es poder volver al texto de fábrica sin perder el suyo:
//
//  · se reconoce una plantilla de fábrica por ser precargada (sin autor) y
//    llamarse como una carta del catálogo;
//  · «volver a la de fábrica» deja el texto de la clínica ARCHIVADO en
//    `clinic_template_versions` y repone el del catálogo en la fila. Nada se borra.
//
// PURO salvo por el `db` y el repositorio que recibe (los de las pruebas sirven).

import type { DocumentTemplate } from "@prisma/client";
import { CONSENT_TEMPLATES } from "@/lib/consent/templates";
import { consentSeedTemplates } from "@/lib/consent/seed-templates";
import { sanitizeTemplateHtml } from "@/lib/document-templates/sanitize";
import {
  getTemplate,
  updateTemplate,
  validarCuerpo,
  validarNombre,
  nombreOcupado,
  esChoqueDeUnico,
  type TemplateDb,
  type TemplateResult,
  type UpdateTemplateInput,
} from "@/lib/document-templates/service";
import { difiere, type RepoVersiones } from "./versiones";

export interface TextoDeFabricaConsentimiento {
  /** Clave del catálogo (`extraccion`, `atencion-general`…). */
  clave: string;
  nombre: string;
  /** El HTML que el sembrado habría guardado, ya saneado como lo guarda el CRUD. */
  cuerpo: string;
}

/** Los textos de fábrica de consentimiento, tal como quedan guardados en una fila. */
let memo: TextoDeFabricaConsentimiento[] | null = null;
export function consentimientosDeFabrica(): TextoDeFabricaConsentimiento[] {
  // Salen del código y no cambian durante la vida del proceso: se arman una vez.
  memo ??= consentSeedTemplates().map((t) => ({ clave: t.key, nombre: t.name, cuerpo: sanitizeTemplateHtml(t.body) }));
  return memo;
}

const comparable = (n: string) => n.replace(/\s+/g, " ").trim().toLocaleLowerCase("es");

/**
 * El texto de fábrica del que sale una plantilla, o `null` si no es de fábrica:
 * la escribió alguien de la clínica (lleva autor) o ya no se llama como la carta.
 */
export function fabricaDeConsentimiento(
  fila: { name: string; createdById: string | null },
): TextoDeFabricaConsentimiento | null {
  if (fila.createdById) return null;
  const q = comparable(fila.name);
  return consentimientosDeFabrica().find((t) => comparable(t.nombre) === q) ?? null;
}

/** ¿Es de fábrica y la clínica ya la cambió? Solo entonces se ofrece «Volver a la de fábrica». */
export function consentimientoModificado(fila: { name: string; body: string; createdById: string | null }): boolean {
  const f = fabricaDeConsentimiento(fila);
  return !!f && difiere(fila.body, f.cuerpo);
}

/** Lo que la pantalla necesita saber de una fila: solo los CONSENTIMIENTOS tienen texto de fábrica que restaurar. */
export function restaurableDe(fila: { kind: string; name: string; body: string; createdById: string | null }): boolean {
  return fila.kind === "CONSENTIMIENTO" && consentimientoModificado(fila);
}

export type ResultadoVolverConsentimiento =
  | { ok: true; template: DocumentTemplate }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_FACTORY" | "NOT_MODIFIED" | "VERSIONES_NO_DISPONIBLES" | "CAMBIO_CONCURRENTE";
      status: number;
    };

const ESTADOS = {
  NOT_FOUND: 404,
  NOT_FACTORY: 409,
  NOT_MODIFIED: 409,
  VERSIONES_NO_DISPONIBLES: 503,
  CAMBIO_CONCURRENTE: 409,
} as const;
const error = (code: keyof typeof ESTADOS): ResultadoVolverConsentimiento => ({ ok: false, code, status: ESTADOS[code] });

/**
 * Repone el texto de fábrica en la fila y deja el de la clínica archivado.
 * El orden importa: primero se guarda el archivo y luego se cambia la fila, así
 * un fallo a la mitad nunca pierde el texto de la clínica.
 */
export async function volverAFabricaConsentimiento(
  db: TemplateDb,
  versiones: RepoVersiones,
  clinicId: string,
  id: string,
  userId: string,
): Promise<ResultadoVolverConsentimiento> {
  if (typeof clinicId !== "string" || clinicId.length === 0) {
    throw new Error("plantillas-fabrica: clinicId ausente — se corta antes de consultar");
  }
  const actual = await getTemplate(db, clinicId, id);
  if (!actual || actual.kind !== "CONSENTIMIENTO") return error("NOT_FOUND");
  const fabrica = fabricaDeConsentimiento(actual);
  if (!fabrica) return error("NOT_FACTORY");
  if (!difiere(actual.body, fabrica.cuerpo)) return error("NOT_MODIFIED");
  if (!(await versiones.disponible())) return error("VERSIONES_NO_DISPONIBLES");
  await versiones.archivarTexto({ clinicId, familia: "CONSENTIMIENTO", clave: fabrica.clave, cuerpo: actual.body, userId });
  // Solo si el texto sigue siendo el que se archivó: si alguien guardó otra edición entre la lectura y este punto, esa
  // edición NO se pisa (el texto leído ya quedó archivado arriba). ws1-t8 · P9.
  const r = await db.documentTemplate.updateMany({
    where: { id: actual.id, clinicId, body: actual.body },
    data: { body: fabrica.cuerpo },
  });
  if (r.count === 0) return error("CAMBIO_CONCURRENTE");
  const template = await getTemplate(db, clinicId, actual.id);
  return template ? { ok: true, template } : error("NOT_FOUND");
}

/** Para los tests: el catálogo y el sembrado hablan de las mismas cartas. */
export const CLAVES_CONSENTIMIENTO = CONSENT_TEMPLATES.map((p) => p.key);

export interface EditarConsentimientoInput extends UpdateTemplateInput {
  /**
   * El texto con el que la persona abrió el editor. Si el de la base ya es otro (alguien guardó mientras tanto), este
   * guardado NO lo pisa: 409 CAMBIO_CONCURRENTE (ws1-t8 · N-P1).
   */
  baseBody?: unknown;
}

/** La clave bajo la que se archiva el texto de un consentimiento: la del catálogo, o la de la propia fila. */
const claveDeArchivo = (fila: { id: string; name: string; createdById: string | null }) =>
  fabricaDeConsentimiento(fila)?.clave ?? `propia:${fila.id}`;

/**
 * Editar una plantilla. En un CONSENTIMIENTO, cuando el texto cambia, el anterior se ARCHIVA (nunca se pisa sin copia:
 * regla de Rafael) y la fila solo se cambia si sigue teniendo el texto archivado; si no, 409 y la edición ajena queda.
 * Guardar el mismo texto no archiva ni cambia nada. Las notas de evolución y los demás campos van por `updateTemplate`.
 * Sin la tabla de versiones (falta el SQL) se edita como antes: sin copia.
 */
export async function editarPlantillaConPrevias(
  db: TemplateDb,
  versiones: RepoVersiones,
  clinicId: string,
  id: string,
  input: EditarConsentimientoInput,
  userId: string,
): Promise<TemplateResult> {
  if (typeof clinicId !== "string" || clinicId.length === 0) {
    throw new Error("plantillas-fabrica: clinicId ausente — se corta antes de consultar");
  }
  const { baseBody, ...resto } = input;
  const actual = await getTemplate(db, clinicId, id);
  if (!actual || actual.kind !== "CONSENTIMIENTO" || resto.body === undefined) return updateTemplate(db, clinicId, id, resto);

  const nuevo = validarCuerpo(resto.body);
  if ("code" in nuevo) return updateTemplate(db, clinicId, id, resto); // que conteste el mismo error de siempre
  const sinTexto = { name: resto.name, isActive: resto.isActive };

  if (!difiere(nuevo.body, actual.body)) return updateTemplate(db, clinicId, id, sinTexto);

  // Una pestaña abierta antes de que otra persona guardara no pisa lo de la otra persona.
  if (typeof baseBody === "string" && difiere(baseBody, actual.body)) return concurrente();

  // TODO O NADA (ws1-t8 · N3-P2): todo lo que puede rechazar el guardado se revisa ANTES de escribir, y el texto, el
  // nombre y «en uso» se escriben en una sola sentencia. Un nombre repetido ya no deja el texto nuevo vigente.
  const data: { body: string; name?: string; isActive?: boolean } = { body: nuevo.body };
  if (resto.name !== undefined) {
    const n = validarNombre(resto.name);
    if ("code" in n) return updateTemplate(db, clinicId, id, { name: resto.name }); // el mismo error de siempre; no escribe
    if (n.name !== actual.name) {
      if (await nombreOcupado(db, clinicId, actual.kind, n.name, actual.id)) {
        return { ok: false, code: "NAME_TAKEN", status: 409, error: "Ya existe una plantilla de este tipo con ese nombre" };
      }
      data.name = n.name;
    }
  }
  if (typeof resto.isActive === "boolean") data.isActive = resto.isActive;

  if (await versiones.disponible()) {
    await versiones.archivarTexto({ clinicId, familia: "CONSENTIMIENTO", clave: claveDeArchivo(actual), cuerpo: actual.body, userId });
  }
  try {
    const r = await db.documentTemplate.updateMany({ where: { id: actual.id, clinicId, body: actual.body }, data });
    if (r.count === 0) return concurrente();
  } catch (err) {
    // Otra persona tomó ese nombre justo ahora: nada se escribió (una sola sentencia).
    if (esChoqueDeUnico(err)) return { ok: false, code: "NAME_TAKEN", status: 409, error: "Ya existe una plantilla de este tipo con ese nombre" };
    throw err;
  }
  const guardada = await getTemplate(db, clinicId, id);
  return guardada ? { ok: true, template: guardada } : concurrente();
}

function concurrente(): TemplateResult {
  return { ok: false, code: "CAMBIO_CONCURRENTE", status: 409, error: "Alguien guardó un cambio en esta plantilla mientras la editabas" };
}
