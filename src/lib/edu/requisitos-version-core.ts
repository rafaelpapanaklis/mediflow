/**
 * DaleControl INSTITUCIONAL — EL REQUISITO VERSIONADO POR COHORTE ·
 * la parte PURA (H-89).
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (H-89)
 *
 * «Subir el mínimo de un requisito a mitad de generación reescribe el
 * pasado de todo el mundo, sin versión y sin rastro. De 8 a 12 en marzo y
 * TODA la escuela —incluida la que se gradúa en junio— pasa de "Cumplido
 * 8 de 8" a "Te faltan 4 de 12". El alumno lo ve esa tarde, sin
 * explicación y sin fecha.»
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN EduRequirement
 *
 * El arreglo natural sería `version` + `cohortId` DENTRO de
 * `EduRequirement`… pero esa tabla tiene
 * `@@unique([institutionId, programId, name])` y dos versiones del mismo
 * requisito chocan contra él. Cambiar ese índice es DROP INDEX, y en esta
 * ola no se borra nada sin decisión de Rafael (queda escrito y comentado
 * en la §14 de sql/edu-ola-c.sql).
 *
 * Así que la fila de `EduRequirement` sigue siendo LA VIGENTE —que es lo
 * que todo el código de evaluación ya lee, sin cambiar una línea— y cada
 * cambio escribe una VERSIÓN con su cohorte, su fecha de vigencia y su
 * autor. El avance de un alumno se mide contra la versión que aplicaba a
 * SU generación.
 *
 * 🔴 LA REGLA DE RESOLUCIÓN, ESCRITA UNA VEZ:
 *   1. la versión más reciente CON LA COHORTE del alumno, vigente a la
 *      fecha; si no hay,
 *   2. la versión más reciente SIN cohorte (la regla general), vigente a
 *      la fecha; si no hay,
 *   3. la fila viva del requisito (lo de siempre).
 *
 * El paso 3 es lo que hace que aplicar esta ola no cambie NADA para una
 * escuela que todavía no ha versionado nada.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const EDU_REQ_VERSION_NOTES_MAX = 300;

/** Lo que una versión congela del requisito. */
export interface EduRequirementSnapshot {
  requiredCount: number;
  semesterFrom: number | null;
  semesterTo: number | null;
  onlyCompleted: boolean;
  notes: string | null;
}

export interface EduRequirementVersionLike extends EduRequirementSnapshot {
  id: string;
  version: number;
  cohortId: string | null;
  effectiveFrom: Date;
}

/**
 * QUÉ versión aplica a este alumno en esta fecha.
 *
 * Devuelve `null` cuando no aplica ninguna, y ese null significa «usa la
 * fila viva del requisito»: es el paso 3 de la regla, y es lo que hace
 * que una escuela sin versiones siga funcionando exactamente igual.
 *
 * 🔴 EL DESEMPATE ES POR `effectiveFrom` Y LUEGO POR `version`, en ese
 * orden y no al revés: dos versiones creadas el mismo día (subir el
 * mínimo y corregirlo cinco minutos después) tienen la misma fecha de
 * vigencia, y la que manda es la ÚLTIMA que se escribió. Sin el segundo
 * criterio, cuál gana dependería del orden en que Postgres devolvió las
 * filas — y el avance de una generación entera no puede depender de eso.
 */
export function eduRequisitoVersionVigente(
  versiones: EduRequirementVersionLike[],
  cohortId: string | null,
  now: Date,
): EduRequirementVersionLike | null {
  const vigentes = versiones.filter((v) => v.effectiveFrom.getTime() <= now.getTime());
  const mejor = (lista: EduRequirementVersionLike[]) =>
    lista.length === 0
      ? null
      : lista.reduce((a, b) => {
          const da = a.effectiveFrom.getTime();
          const db = b.effectiveFrom.getTime();
          if (db !== da) return db > da ? b : a;
          return b.version > a.version ? b : a;
        });

  if (cohortId) {
    const deLaCohorte = mejor(vigentes.filter((v) => v.cohortId === cohortId));
    if (deLaCohorte) return deLaCohorte;
  }
  return mejor(vigentes.filter((v) => v.cohortId === null));
}

/**
 * El requisito EFECTIVO para un alumno: la versión que aplique, o la fila
 * viva si no aplica ninguna.
 *
 * Es la función que la pantalla de evaluación tiene que llamar en lugar de
 * leer el requisito a pelo, y por eso devuelve TAMBIÉN de dónde salió: el
 * alumno al que le subieron el mínimo tiene derecho a ver «tu generación
 * se mide con la versión 2, vigente desde el 3 de marzo» en vez de un
 * número que cambió solo.
 */
export function eduRequisitoEfectivo(
  vivo: EduRequirementSnapshot,
  versiones: EduRequirementVersionLike[],
  cohortId: string | null,
  now: Date,
): { snapshot: EduRequirementSnapshot; version: number | null; effectiveFrom: Date | null } {
  const v = eduRequisitoVersionVigente(versiones, cohortId, now);
  if (!v) return { snapshot: vivo, version: null, effectiveFrom: null };
  return {
    snapshot: {
      requiredCount: v.requiredCount,
      semesterFrom: v.semesterFrom,
      semesterTo: v.semesterTo,
      onlyCompleted: v.onlyCompleted,
      notes: v.notes,
    },
    version: v.version,
    effectiveFrom: v.effectiveFrom,
  };
}

/**
 * ¿Este cambio AFECTA a alguien que ya cumplía?
 *
 * Devuelve true cuando el mínimo SUBE, que es el caso que H-89 describe y
 * el único que le quita a alguien un "cumplido" que ya tenía. Bajarlo no
 * duele; subirlo sin versionar es lo que produce la tarde en que media
 * escuela pasa de verde a rojo.
 *
 * Se usa para AVISAR en la pantalla antes de guardar, no para bloquear:
 * subir el mínimo es una decisión legítima de la escuela; lo que no es
 * legítimo es que ocurra sin que nadie lo sepa.
 */
export function eduRequisitoCambioDuele(
  antes: EduRequirementSnapshot,
  despues: EduRequirementSnapshot,
): boolean {
  if (despues.requiredCount > antes.requiredCount) return true;
  // Pasar de "cuenta desde que se abre" a "solo los completados" también
  // le quita avance a todo el mundo de golpe, y es igual de silencioso.
  if (!antes.onlyCompleted && despues.onlyCompleted) return true;
  return false;
}

export function eduRequisitoParseCount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(n) || n < 0 || n > 999) {
    throw new Error("El mínimo del requisito tiene que ser un entero entre 0 y 999.");
  }
  return n;
}
