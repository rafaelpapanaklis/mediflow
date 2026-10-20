// Plantillas de fábrica EDITABLES por clínica (ws1-t6). PURO: sin Prisma ni React.
//
// Una plantilla de fábrica (nota de ortodoncia, indicaciones, constancia,
// consentimiento) es la misma para todas las clínicas y vive en el código. Cuando
// una clínica la edita NO se toca la de fábrica: se guarda la VERSIÓN DE ESA
// CLÍNICA en `clinic_template_versions` y esa versión reemplaza a la de fábrica
// solo ahí. Las demás clínicas siguen con la de fábrica, y una actualización
// futura de la de fábrica no pisa la versión de la clínica.
//
// «Volver a la de fábrica» no borra: marca la versión como archivada
// (`archivedAt`) y la fila se queda para siempre.
//
// Una versión guarda SOLO el texto. El nombre de la plantilla de fábrica no se
// cambia (es su identidad), y lo demás (procedimientos ligados, «en uso») sigue
// viviendo en la fila de siempre.

export const FAMILIAS_VERSION = ["ORTO_NOTA", "HOJA_INDICACIONES", "HOJA_CONSTANCIA", "CONSENTIMIENTO"] as const;
export type FamiliaVersion = (typeof FAMILIAS_VERSION)[number];

export function esFamiliaVersion(v: unknown): v is FamiliaVersion {
  return typeof v === "string" && (FAMILIAS_VERSION as readonly string[]).includes(v);
}

/** Una versión de clínica tal como la devuelve el repositorio. */
export interface VersionClinica {
  id: string;
  clinicId: string;
  familia: FamiliaVersion;
  /** Qué plantilla de fábrica reemplaza: nombre (ortodoncia), clave (hojas) o clave del catálogo (consentimiento). */
  clave: string;
  /** El texto de la versión. En notas de ortodoncia es el SOAP en JSON. */
  cuerpo: string;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface GuardarVersion {
  clinicId: string;
  familia: FamiliaVersion;
  clave: string;
  cuerpo: string;
  userId: string | null;
}

/**
 * Lo que el servidor necesita de la tabla. En producción lo implementa
 * `./db.ts` (SQL crudo); en las pruebas, uno en memoria.
 *
 * Toda operación lleva `clinicId`; sin él el repositorio corta ANTES de consultar
 * (`clinicId: undefined` en Prisma no filtra nada).
 */
export interface RepoVersiones {
  /** La tabla existe (se pegó el SQL). Sin ella las de fábrica siguen siendo solo de lectura. */
  disponible(): Promise<boolean>;
  /** Las versiones vigentes (no archivadas) de la clínica en una familia. */
  activas(clinicId: string, familia: FamiliaVersion): Promise<VersionClinica[]>;
  /** Crea la versión vigente. Si ya había una con otro texto, la ARCHIVA (nada se pisa); con el mismo texto no hace nada. */
  guardar(v: GuardarVersion): Promise<VersionClinica>;
  /** Archiva la vigente (no la borra). `null` si no había ninguna. */
  archivar(clinicId: string, familia: FamiliaVersion, clave: string, userId: string | null): Promise<VersionClinica | null>;
  /** Deja constancia ARCHIVADA de un texto que ya no rige (lo usa «volver a la de fábrica» en consentimientos). */
  archivarTexto(v: GuardarVersion): Promise<VersionClinica>;
}

/** Las versiones vigentes indexadas por la clave de la plantilla de fábrica que reemplazan. */
export function indexarPorClave(versiones: readonly VersionClinica[]): Map<string, VersionClinica> {
  const m = new Map<string, VersionClinica>();
  for (const v of versiones) {
    if (v.archivedAt === null) m.set(v.clave, v);
  }
  return m;
}

/**
 * Dado el texto de la clínica y el de fábrica, ¿se diferencian? Se comparan
 * sin contar espacios de sobra en los extremos ni saltos de línea de Windows.
 */
export function difiere(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\r\n?/g, "\n").trim();
  return n(a) !== n(b);
}
