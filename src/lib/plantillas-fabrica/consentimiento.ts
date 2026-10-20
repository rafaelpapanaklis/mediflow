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
import { getTemplate, type TemplateDb } from "@/lib/document-templates/service";
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

export type ResultadoVolverConsentimiento =
  | { ok: true; template: DocumentTemplate }
  | { ok: false; code: "NOT_FOUND" | "NOT_FACTORY" | "NOT_MODIFIED" | "VERSIONES_NO_DISPONIBLES"; status: number };

const ESTADOS = { NOT_FOUND: 404, NOT_FACTORY: 409, NOT_MODIFIED: 409, VERSIONES_NO_DISPONIBLES: 503 } as const;
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
  const template = await db.documentTemplate.update({ where: { id: actual.id }, data: { body: fabrica.cuerpo } });
  return { ok: true, template };
}

/** Para los tests: el catálogo y el sembrado hablan de las mismas cartas. */
export const CLAVES_CONSENTIMIENTO = CONSENT_TEMPLATES.map((p) => p.key);
