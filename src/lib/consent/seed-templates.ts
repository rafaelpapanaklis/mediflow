// ─────────────────────────────────────────────────────────────────────────────
// Sembrado de las plantillas de consentimiento de una clínica.
//
// Rafael pidió que el doctor no empiece con la hoja en blanco: el catálogo fijo
// (`lib/herramientas/consent-procedures`, más la carta de atención general) se
// siembra como filas de `DocumentTemplate` con `kind = CONSENTIMIENTO`, con el
// mismo texto que hoy produce el catálogo. A partir de ahí son de la clínica:
// las edita, las desactiva o añade las suyas en Administración → Plantillas.
//
// Mismo patrón que `ensureDentalCatalog` (lib/odontogram/snapshot.ts): se llama
// al entrar y no hace nada si ya está hecho.
//
// IDEMPOTENTE, y con una regla más dura que "no duplicar": si la clínica ya
// tiene CUALQUIER plantilla de consentimiento —activa, inactiva o borrada— no
// se siembra nada. Sembrar "las que falten" resucitaría la que la clínica borró
// a propósito, y volvería a meter la original junto a la que renombró.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { CONSENT_TEMPLATES, buildConsentTemplateText } from "./templates";
import { consentTextToHtml } from "./template-html";

export const CONSENT_TEMPLATE_KIND = "CONSENTIMIENTO" as const;

export interface ConsentSeedTemplate {
  /** Clave del catálogo de la que sale. No se guarda: solo identifica el seed. */
  key: string;
  name: string;
  /** HTML de la plantilla, con todos los datos como marcadores `[…]`. */
  body: string;
}

/** Las plantillas que se siembran, en el orden del catálogo. PURO. */
export function consentSeedTemplates(): ConsentSeedTemplate[] {
  return CONSENT_TEMPLATES.map((proc) => ({
    key: proc.key,
    name: proc.label,
    body: consentTextToHtml(buildConsentTemplateText(proc.key)),
  }));
}

/** Lo mínimo de Prisma que usa el sembrado: permite probarlo sin base. */
export interface ConsentSeedDb {
  documentTemplate: {
    count(args: { where: { clinicId: string; kind: typeof CONSENT_TEMPLATE_KIND } }): Promise<number>;
    createMany(args: {
      data: Array<{ clinicId: string; kind: typeof CONSENT_TEMPLATE_KIND; name: string; body: string }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
}

/**
 * Garantiza que la clínica tenga sus plantillas de consentimiento.
 * Devuelve cuántas creó (0 = ya las tenía).
 */
export async function ensureConsentTemplates(
  clinicId: string,
  db: ConsentSeedDb = prisma as unknown as ConsentSeedDb,
): Promise<number> {
  // ⛔ Sin clínica no se consulta: `clinicId: undefined` no filtra nada en Prisma.
  if (!clinicId) return 0;

  // El `count` NO filtra por `deletedAt` ni por `isActive`, a propósito (ver la
  // cabecera): una plantilla borrada también cuenta como "ya se sembró".
  const existing = await db.documentTemplate.count({
    where: { clinicId, kind: CONSENT_TEMPLATE_KIND },
  });
  if (existing > 0) return 0;

  const created = await db.documentTemplate.createMany({
    data: consentSeedTemplates().map((t) => ({
      clinicId,
      kind: CONSENT_TEMPLATE_KIND,
      name: t.name,
      body: t.body,
    })),
    // Dos pestañas entrando a la vez: el @@unique([clinicId, kind, name]) para
    // a la segunda, y con esto no revienta.
    skipDuplicates: true,
  });
  return created.count;
}
