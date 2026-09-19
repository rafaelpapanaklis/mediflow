// ─────────────────────────────────────────────────────────────────────────────
// Las plantillas de consentimiento DE UNA CLÍNICA: listarlas y resolver una.
//
// Lo usan GET /api/consent/templates (el selector de «Nuevo consentimiento
// informado»), la vista previa y el POST que guarda la carta. Los tres pasan por
// aquí para que lo que el doctor elige, lo que revisa y lo que se firma salgan
// de la MISMA fila, con el MISMO filtro de clínica.
//
// RED DE SEGURIDAD: las tablas `document_templates` nacen con un SQL que Rafael
// aplica a mano. Mientras no estén —o si la consulta falla— el selector ofrece
// el catálogo de siempre desde el código (ids `catalogo:<clave>`), para que
// crear un consentimiento no dependa de en qué orden se integró qué.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { CONSENT_TEMPLATES, buildConsentTemplateText, findConsentTemplate } from "./templates";
import { consentHtmlToText } from "./template-html";
import { CONSENT_TEMPLATE_KIND, ensureConsentTemplates, type ConsentSeedDb } from "./seed-templates";

interface TemplateWhere {
  id?: string;
  clinicId: string;
  kind: typeof CONSENT_TEMPLATE_KIND;
  isActive: true;
  deletedAt: null;
}

/** Lo mínimo de Prisma que se usa aquí: permite probar los filtros sin base. */
export interface ClinicTemplatesDb extends ConsentSeedDb {
  documentTemplate: ConsentSeedDb["documentTemplate"] & {
    findMany(args: {
      where: TemplateWhere;
      orderBy: { name: "asc" };
      select: { id: true; name: true };
    }): Promise<{ id: string; name: string }[]>;
    findFirst(args: {
      where: TemplateWhere;
      select: { name: true; body: true };
    }): Promise<{ name: string; body: string } | null>;
  };
}

const defaultDb = (): ClinicTemplatesDb => prisma as unknown as ClinicTemplatesDb;

/** Prefijo de los ids de respaldo, los que salen del código y no de la base. */
export const CATALOG_TEMPLATE_PREFIX = "catalogo:";

export interface ClinicConsentTemplateOption {
  id: string;
  name: string;
}

export interface ClinicConsentTemplateList {
  templates: ClinicConsentTemplateOption[];
  /** true = salieron del código porque la tabla no respondió. */
  fallback: boolean;
}

function catalogOptions(): ClinicConsentTemplateOption[] {
  return CONSENT_TEMPLATES.map((p) => ({ id: `${CATALOG_TEMPLATE_PREFIX}${p.key}`, name: p.label }));
}

/**
 * Las plantillas que se ofrecen al crear: SOLO `kind = CONSENTIMIENTO`, SOLO de
 * esta clínica, activas y sin borrar. Siembra el catálogo la primera vez.
 */
export async function listClinicConsentTemplates(
  clinicId: string,
  db: ClinicTemplatesDb = defaultDb(),
): Promise<ClinicConsentTemplateList> {
  // ⛔ `clinicId: undefined` no filtra nada: sin clínica no se consulta.
  if (!clinicId) return { templates: [], fallback: false };
  try {
    await ensureConsentTemplates(clinicId, db);
    const rows = await db.documentTemplate.findMany({
      where: { clinicId, kind: CONSENT_TEMPLATE_KIND, isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return { templates: rows, fallback: false };
  } catch (err) {
    console.error("[consent/templates] la tabla de plantillas no respondió; se ofrece el catálogo:", err);
    return { templates: catalogOptions(), fallback: true };
  }
}

export interface ResolvedConsentTemplate {
  /** Nombre del acto: el de la plantilla. Se copia a `ConsentForm.procedure`. */
  name: string;
  /** Texto plano de la carta, todavía con sus marcadores `[…]`. */
  text: string;
  /** Clave del catálogo si es una de respaldo; null si es de la clínica. */
  procedureKey: string | null;
}

/** Una plantilla por id, acotada a la clínica. `null` si no existe o no es suya. */
export async function resolveClinicConsentTemplate(
  clinicId: string,
  templateId: string,
  db: ClinicTemplatesDb = defaultDb(),
): Promise<ResolvedConsentTemplate | null> {
  if (!clinicId || !templateId) return null;

  if (templateId.startsWith(CATALOG_TEMPLATE_PREFIX)) {
    // El id de respaldo SOLO vale mientras la tabla no responde. Si responde, la
    // clínica ya manda sobre sus plantillas —puede haber desactivado justo esta—
    // y un `catalogo:…` escrito a mano no puede saltarse esa decisión.
    if (await templatesTableResponds(clinicId, db)) return null;
    const proc = findConsentTemplate(templateId.slice(CATALOG_TEMPLATE_PREFIX.length));
    return proc
      ? { name: proc.label, text: buildConsentTemplateText(proc.key), procedureKey: proc.key }
      : null;
  }

  try {
    const row = await db.documentTemplate.findFirst({
      where: { id: templateId, clinicId, kind: CONSENT_TEMPLATE_KIND, isActive: true, deletedAt: null },
      select: { name: true, body: true },
    });
    return row ? { name: row.name, text: consentHtmlToText(row.body), procedureKey: null } : null;
  } catch (err) {
    // Tabla sin crear o consulta caída: para quien llama es "no existe" (404
    // legible), no una excepción sin capturar.
    console.error("[consent/templates] no se pudo leer la plantilla:", err);
    return null;
  }
}

async function templatesTableResponds(clinicId: string, db: ClinicTemplatesDb): Promise<boolean> {
  try {
    await db.documentTemplate.count({ where: { clinicId, kind: CONSENT_TEMPLATE_KIND } });
    return true;
  } catch {
    return false;
  }
}
