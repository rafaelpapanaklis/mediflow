// Detección automática de QUÉ ES un archivo/hoja subido al importador
// ("Importar mi clínica" → varios archivos a la vez, WS1-T12).
//
// No existía nada equivalente: hasta ahora el usuario elegía la entidad a mano
// (StepWhat) ANTES de subir el archivo. Aquí se hace al revés — dadas las
// columnas de un archivo/hoja ya leído, se puntúa cada entidad (`HANDLERS`)
// reutilizando exactamente lo que YA usa el motor para una entidad conocida:
//   - `autodetect()` (engine.ts) con los `headerVariants` de esa entidad, para
//     ver cuántas columnas del archivo se explican con su vocabulario.
//   - `validateMapping()` de esa entidad (puro, sin DB) para saber si con esas
//     columnas la entidad sería estructuralmente importable (campos
//     obligatorios cubiertos) o no.
//   - El nombre del archivo/pestaña contra `sheetNames` del handler (+ los del
//     perfil del origen elegido, si lo hay) como pista adicional, nunca como
//     única señal.
//
// Nunca se adivina en silencio: `mejorEntidad()` solo sugiere una entidad
// cuando sus campos obligatorios quedan cubiertos; si no, o si el primer y
// segundo lugar quedan casi empatados, se devuelve con confianza rebajada (o
// null) para que el usuario elija a mano en la lista — igual que `needsSheet`
// nunca toma "la primera pestaña" en silencio.

import { autodetect, norm } from "./engine";
import { HANDLERS } from "./entities";
import { profileMappingFor } from "./profiles";
import type { OriginProfile } from "./profiles/origin";
import type { ColumnMapping, Entity } from "./types";

export type Confianza = "alta" | "media" | "baja";

export interface EntityGuess {
  entity: Entity;
  /** 0..1, no es una probabilidad calibrada: solo sirve para RANKEAR entidades entre sí. */
  score: number;
  confianza: Confianza;
  /** Con las columnas de este archivo, ¿la entidad tendría sus campos obligatorios cubiertos? */
  requiredOk: boolean;
  matchedColumns: number;
}

/** Bajo esto, ni el primer lugar se sugiere: es "sin identificar". */
const MIN_SCORE_SUGERIBLE = 0.3;
/** Si el 2º lugar queda a menos de esto del 1º (ambos con requiredOk), se avisa con confianza rebajada. */
const MARGEN_EMPATE = 0.05;

const ALTA = 0.65;
const MEDIA = 0.4;

function confianzaDe(score: number): Confianza {
  if (score >= ALTA) return "alta";
  if (score >= MEDIA) return "media";
  return "baja";
}

function normalizado(s: string): string {
  return norm(s).replace(/[^a-z0-9]/g, "");
}

/**
 * Qué tanto del nombre (de archivo o de pestaña) explica el MEJOR candidato de
 * esa entidad: 1 = coincidencia exacta, 0 = ninguno casa. Proporcional a la
 * especificidad del candidato que casó (no solo sí/no): "tratamientos" es a la
 * vez alias de `quotes` Y una subcadena de "tratamientosactivos"
 * (sheetName de `treatmentPlans`) — sin esto, ambas entidades reclamarían el
 * mismo bono fijo y el candidato más específico (el de `treatmentPlans`, que
 * explica el nombre COMPLETO) no pesaría más que el genérico que solo explica
 * una parte.
 */
function mejorCoincidencia(nombre: string, candidatos: string[]): number {
  if (!nombre || candidatos.length === 0) return 0;
  const n = normalizado(nombre);
  if (!n) return 0;
  let mejor = 0;
  for (const c of candidatos) {
    const cn = normalizado(c);
    if (!cn) continue;
    if (n === cn) return 1;
    if (n.includes(cn) || cn.includes(n)) {
      const ratio = Math.min(n.length, cn.length) / Math.max(n.length, cn.length);
      // Bajo esto es ruido: un prefijo corto y genérico ("evolucion…") de un
      // nombre mucho más largo y AJENO no debería pesar como pista real.
      if (ratio >= 0.5 && ratio > mejor) mejor = ratio;
    }
  }
  return mejor;
}

/**
 * `headerVariants` del handler, ampliado con las columnas EXACTAS que el
 * perfil del origen elegido (Dentalink, OpenDental…) ya sabe para esta
 * entidad (`entityMappings`/`mapping`). Un sistema con perfil puede nombrar
 * una columna de forma que el vocabulario genérico no reconoce ("Evolución"
 * para el texto de una nota); si el usuario ya dijo de qué sistema viene el
 * archivo, esa pista cuenta.
 */
function variantesConPerfil(entity: Entity, handler: (typeof HANDLERS)[string], profile?: OriginProfile | null): Record<string, string[]> {
  if (!profile) return handler.headerVariants;
  const propias = profileMappingFor(profile, entity);
  const extra = Object.entries(propias);
  if (extra.length === 0) return handler.headerVariants;
  const merged: Record<string, string[]> = {};
  for (const [campo, variantes] of Object.entries(handler.headerVariants)) merged[campo] = [...variantes];
  for (const [header, campo] of extra) {
    const n = norm(header);
    if (!merged[campo]) merged[campo] = [];
    if (!merged[campo].includes(n)) merged[campo].push(n);
  }
  return merged;
}

/**
 * Puntúa las 9 entidades importables contra las columnas de UN archivo/hoja.
 * Devuelve TODAS, ordenadas de mejor a peor — la UI las usa para el dropdown
 * de corrección manual (con su confianza) y para decidir si sugiere alguna.
 */
export function detectEntitiesForColumns(
  columns: string[],
  fileName: string,
  sheetName: string | undefined,
  profile?: OriginProfile | null,
): EntityGuess[] {
  const baseName = fileName.replace(/\.(xlsx|csv)$/i, "");
  const out: EntityGuess[] = [];

  for (const entity of Object.keys(HANDLERS) as Entity[]) {
    const handler = HANDLERS[entity];
    const variants = variantesConPerfil(entity, handler, profile);
    const mapping: ColumnMapping = autodetect(columns, variants);
    const mappedFields = new Set(Object.values(mapping).filter(Boolean));
    const matchedColumns = Object.keys(mapping).length;
    const requiredOk = handler.validateMapping(mappedFields) === null;
    const totalFields = Object.keys(variants).length || 1;
    const coverage = columns.length ? matchedColumns / columns.length : 0;
    const fieldCoverage = mappedFields.size / totalFields;

    const candidatos = [
      ...(handler.sheetNames ?? []),
      ...((entity === "patients" ? undefined : profile?.sheetNames?.[entity as Exclude<Entity, "patients">]) ?? []),
    ];
    let nameBonus = sheetName ? mejorCoincidencia(sheetName, candidatos) * 0.35 : 0;
    if (nameBonus === 0) nameBonus = mejorCoincidencia(baseName, candidatos) * 0.25;

    const score = Math.min(1, (requiredOk ? 0.45 : 0) + coverage * 0.25 + fieldCoverage * 0.2 + nameBonus);
    out.push({ entity, score, confianza: confianzaDe(score), requiredOk, matchedColumns });
  }

  out.sort((a, b) => b.score - a.score || b.matchedColumns - a.matchedColumns);
  return out;
}

/**
 * La sugerencia final a partir de `detectEntitiesForColumns`: null si nada
 * llega al mínimo o si el primer lugar no cubre sus campos obligatorios
 * (nunca se sugiere una entidad que ni siquiera podría importarse). Con un
 * segundo lugar casi empatado (misma cobertura estructural) se sugiere igual
 * el primero, pero con confianza rebajada a "media" — para que la insignia en
 * pantalla invite a revisarlo, no a confiar a ciegas.
 */
export function mejorEntidad(guesses: EntityGuess[]): { entity: Entity | null; confianza: Confianza | null } {
  const top = guesses[0];
  if (!top || !top.requiredOk || top.score < MIN_SCORE_SUGERIBLE) return { entity: null, confianza: null };
  const second = guesses[1];
  if (second && second.requiredOk && top.score - second.score < MARGEN_EMPATE) {
    return { entity: top.entity, confianza: top.confianza === "alta" ? "media" : top.confianza };
  }
  return { entity: top.entity, confianza: top.confianza };
}

/**
 * Orden de importación por dependencia (implícita hoy en `entities.ts`, nunca
 * declarada como grafo): pacientes siempre primero (todo lo demás los busca
 * por `patientExternalId`/teléfono/correo/nombre, `loadPatientIndex`); notas de
 * evolución de TRATAMIENTO al final (liga por folio contra un tratamiento
 * activo ya migrado, `treatmentPlansHandler`). Entre el resto no hay
 * dependencia real declarada en el motor: el orden es solo un criterio estable
 * y predecible (el mismo de `DATA_TYPES` en el wizard de un solo archivo).
 */
export const ENTITY_IMPORT_ORDER: Entity[] = [
  "patients",
  // Doctores (ws1-t12): sin dependencia de pacientes, pero todo lo que trae
  // doctorId (citas, bloqueos, casos de ortodoncia) lo necesita ya resuelto.
  "doctors",
  "balances",
  // Casos de ortodoncia (ws1-t1): liga con el doctor tratante y abre su
  // propia factura/caso, que installmentPlans puede necesitar más abajo.
  "orthoCases",
  // Cuotas por vencer (ws1-t6): reparte en fechas la deuda que ya contó
  // "balances" (factura "Saldo inicial migrado") o el totalAmount de un caso
  // de ortodoncia migrado — por eso va DESPUÉS de los dos.
  "installmentPlans",
  "paymentHistory",
  "appointments",
  // Bloqueos de agenda (ws1-t12): necesita doctors resuelto, y revisa choque
  // contra las citas VIVAS ya importadas (appointments, arriba).
  "blockedHours",
  // Historial de citas pasadas (ws1-t12): necesita patients + doctors.
  "appointmentHistory",
  "medicalHistory",
  "clinicalNotes",
  "odontogram",
  "quotes",
  "treatmentPlans",
  "treatmentNotes",
  // Historial de gastos de laboratorio (ws1-t2): solo necesita patients.
  "labExpenseHistory",
];

/** Posición en el orden de dependencia; sin identificar queda siempre al final. */
export function ordenDe(entity: Entity | null): number {
  if (!entity) return ENTITY_IMPORT_ORDER.length + 1;
  const i = ENTITY_IMPORT_ORDER.indexOf(entity);
  return i === -1 ? ENTITY_IMPORT_ORDER.length : i;
}
