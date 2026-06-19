// ═══════════════════════════════════════════════════════════════════════════
// Importar mi clínica — registro de PERFILES de origen (WS2-T2).
// Agrega un perfil por origen del contrato y los proyecta a la forma pública
// `Origin` que consume GET /api/import/origins (y, vía el wizard, T1/T3).
//
// Orden = el del grid del prototipo (design/import-clinic/app.js · SOURCES):
// 9 sistemas con perfil + "Mi Excel" / "Otro" (mapeo manual) al final.
// ═══════════════════════════════════════════════════════════════════════════

import type { Origin, OriginProfile } from "./origin";
import dentalink from "./dentalink";
import medilink from "./medilink";
import identalsoft from "./identalsoft";
import opendental from "./opendental";
import dentrix from "./dentrix";
import eaglesoft from "./eaglesoft";
import gesden from "./gesden";
import dentidesk from "./dentidesk";
import dentalcore from "./dentalcore";
import excel from "./excel";
import otro from "./otro";

export type { DcField, Origin, OriginInstruction, OriginProfile } from "./origin";

/** Perfiles internos completos, en el orden del grid del wizard. */
export const ORIGIN_PROFILES: OriginProfile[] = [
  dentalink,
  medilink,
  identalsoft,
  opendental,
  dentrix,
  eaglesoft,
  gesden,
  dentidesk,
  dentalcore,
  excel,
  otro,
];

/** Busca un perfil por id (o null). Útil para el engine de T1 al auto-mapear. */
export function getOriginProfile(id: string): OriginProfile | null {
  return ORIGIN_PROFILES.find((p) => p.id === id) ?? null;
}

/**
 * Proyección al contrato público. `instructions`/`mapping` se omiten cuando
 * están vacíos (excel/otro no traen mapping) para mantener la respuesta limpia.
 */
function toOrigin(p: OriginProfile): Origin {
  const hasMapping = Object.keys(p.mapping).length > 0;
  return {
    id: p.id,
    name: p.name,
    hasProfile: p.hasProfile,
    verified: p.verified,
    instructions: p.instructions.length ? p.instructions : undefined,
    mapping: hasMapping ? p.mapping : undefined,
  };
}

/** Lista de orígenes para GET /api/import/origins. */
export function listOrigins(): Origin[] {
  return ORIGIN_PROFILES.map(toOrigin);
}
