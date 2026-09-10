/**
 * DaleControl INSTITUCIONAL — LA FUSIÓN DE DUPLICADOS · la parte PURA.
 *
 * Módulo PURO y client-safe. Sin prisma, sin `new Date()` escondido.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-05 · POR QUÉ EXISTE
 *
 * «Dos pacientes idénticos, sin deshacer.» El aviso de duplicado ya
 * existe (409 con el folio, `pacientes.ts:811-814`), pero cuando el
 * duplicado ya está creado no hay nada que hacer: no existe ninguna
 * `mergeEduPatient*`, y `listEduPatientOptions` ni siquiera excluye a los
 * INACTIVE, así que al duplicado que recepción marcó inactivo se le sigue
 * pudiendo agendar cita.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA FUSIÓN MUEVE, NO BORRA. NUNCA.
 *
 * El PERDEDOR no se borra: se queda con `mergedIntoId` apuntando al
 * GANADOR, en estado INACTIVE, y sus OCHO colecciones se reasignan. La
 * fila sobrevive porque ese folio se imprimió en un consentimiento, se
 * dictó por teléfono y está escrito en una hoja de papel en un archivero.
 * Borrarla dejaría ese papel apuntando a la nada.
 *
 * 🔴 LAS OCHO TABLAS QUE CUELGAN DEL PACIENTE, Y SON OCHO:
 *   1. edu_appointments        · las citas
 *   2. edu_cases               · los casos clínicos
 *   3. edu_records             · las notas del expediente
 *   4. edu_studies             · las radiografías y tomografías
 *   5. edu_clinical_photos     · las fotos clínicas (Ola B)
 *   6. edu_consents            · las cartas de consentimiento
 *   7. edu_prescriptions       · las recetas
 *   8. edu_charges             · los cobros
 *
 * Y hay tres más que NO se mueven, y no es un olvido:
 *   · edu_odontogram_entries → el índice único de cinco columnas haría
 *     chocar el hallazgo "16-O caries" del perdedor con el del ganador.
 *     Se resuelve fila a fila (ver `eduFusionOdontogramaPlan`), no con un
 *     updateMany.
 *   · edu_patient_tax_profiles → es 1:1. Si el ganador ya tiene el suyo,
 *     mover el del perdedor rompe la unicidad. Gana el del ganador.
 *   · edu_health_questionnaires → el índice único (patientId, version)
 *     haría chocar la versión 1 del perdedor con la del ganador. Se
 *     renumeran, y eso también es fila a fila.
 *
 * Escribirlo aquí, como DATO y no como una secuencia de `updateMany`
 * repartida por un archivo de 300 líneas, es lo que permite que una
 * prueba compruebe que son ocho y no siete.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Las ocho colecciones que la fusión REASIGNA con un `updateMany` simple,
 * en el orden en que se tocan dentro de la transacción.
 *
 * `model` es el nombre del delegate de Prisma (`prisma[model]`), y por eso
 * es una unión de literales y no `string`: un typo aquí sería un
 * `prisma.undefined.updateMany` en tiempo de ejecución, dentro de una
 * transacción que ya movió tres tablas.
 */
export const EDU_FUSION_TABLAS = [
  { model: "eduAppointment", label: "citas" },
  { model: "eduCase", label: "casos" },
  { model: "eduRecord", label: "notas del expediente" },
  { model: "eduStudy", label: "estudios" },
  { model: "eduClinicalPhoto", label: "fotos clínicas" },
  { model: "eduConsent", label: "consentimientos" },
  { model: "eduPrescription", label: "recetas" },
  { model: "eduCharge", label: "cobros" },
] as const;

export type EduFusionTabla = (typeof EDU_FUSION_TABLAS)[number];
export type EduFusionModel = EduFusionTabla["model"];

/** Las tres que NO se mueven con updateMany, y por qué. */
export const EDU_FUSION_NO_MOVIDAS: Record<string, string> = {
  eduOdontogramEntry:
    "El índice único de cinco columnas haría chocar el mismo hallazgo de las dos fichas. Se resuelve fila a fila.",
  eduPatientTaxProfile:
    "Es 1:1 con el paciente. Si el ganador ya tiene datos fiscales, los suyos mandan.",
  eduHealthQuestionnaire:
    "El índice único (patientId, version) haría chocar la versión 1 de las dos fichas. Se renumeran.",
};

/** Cuántas filas se movieron de cada cosa. Es lo que se le enseña a quien fusionó. */
export type EduFusionResumen = Record<string, number>;

// ═══════════════════════════════════════════════════════════════════════
// LAS REGLAS DE QUIÉN PUEDE FUSIONARSE CON QUIÉN
// ═══════════════════════════════════════════════════════════════════════

export interface EduFusionCandidato {
  id: string;
  folio: string;
  institutionId: string;
  deletedAt?: Date | null;
  anonymizedAt?: Date | null;
  mergedIntoId?: string | null;
}

/**
 * Devuelve el motivo por el que estas dos fichas NO se pueden fusionar, o
 * null si sí.
 *
 * 🔴 EL ORDEN DE LAS COMPROBACIONES IMPORTA: la del instituto va PRIMERA.
 * Aunque el endpoint ya haya buscado los dos dentro del alcance, esta
 * función se puede llamar desde otro sitio mañana, y una fusión entre
 * institutos es una fuga de tenant con forma de botón.
 */
export function eduFusionMotivoParaNoFusionar(
  ganador: EduFusionCandidato,
  perdedor: EduFusionCandidato,
): string | null {
  if (ganador.institutionId !== perdedor.institutionId) {
    return "Esas dos fichas no son del mismo instituto.";
  }
  if (ganador.id === perdedor.id) {
    return "Es la misma ficha: no hay nada que fusionar.";
  }
  if (perdedor.mergedIntoId) {
    return `La ficha ${perdedor.folio} ya se fusionó con otra. Fusiona la ganadora de aquella, no ésta.`;
  }
  if (ganador.mergedIntoId) {
    return `La ficha ${ganador.folio} ya se fusionó con otra, así que no puede ser la ganadora.`;
  }
  if (ganador.anonymizedAt) {
    return `La ficha ${ganador.folio} está anonimizada: no puede recibir el expediente de nadie.`;
  }
  if (perdedor.anonymizedAt) {
    return `La ficha ${perdedor.folio} está anonimizada. Sus datos ya se sustituyeron y mover su expediente no reconstruye nada.`;
  }
  return null;
}

/**
 * El plan del ODONTOGRAMA, fila a fila.
 *
 * Para cada hallazgo del perdedor: si el ganador YA tiene ese mismo
 * (tooth, surface, condition), la fila del perdedor NO se mueve —chocaría
 * contra el índice único— y se queda donde está, con su propio autor y su
 * propia fecha. Si el ganador no lo tiene, se mueve.
 *
 * 🔴 SE QUEDA, NO SE BORRA. Un hallazgo repetido en las dos fichas no es
 * un duplicado que sobra: son dos personas distintas que miraron la misma
 * boca en dos momentos, y el expediente del perdedor sigue existiendo.
 */
export function eduFusionOdontogramaPlan(
  delPerdedor: { id: string; tooth: number; surface: string; condition: string }[],
  delGanador: { tooth: number; surface: string; condition: string }[],
): { mover: string[]; sePierdenPorChoque: string[] } {
  const llaveGanador = new Set(
    delGanador.map((e) => `${e.tooth}|${e.surface}|${e.condition}`),
  );
  const mover: string[] = [];
  const sePierdenPorChoque: string[] = [];
  for (const e of delPerdedor) {
    const k = `${e.tooth}|${e.surface}|${e.condition}`;
    if (llaveGanador.has(k)) sePierdenPorChoque.push(e.id);
    else {
      mover.push(e.id);
      // Un mismo hallazgo repetido DENTRO del perdedor tampoco se puede
      // mover dos veces: en cuanto se marca uno, el siguiente choca.
      llaveGanador.add(k);
    }
  }
  return { mover, sePierdenPorChoque };
}

/**
 * La renumeración de los CUESTIONARIOS: las versiones del perdedor se
 * pegan DESPUÉS de las del ganador, en orden de captura.
 *
 * Devuelve el par (id, versiónNueva). Se aplican de MAYOR a MENOR para
 * que ninguna escritura intermedia choque contra el índice único — el
 * mismo cuidado que renumerar una lista en su sitio.
 */
export function eduFusionCuestionariosPlan(
  delPerdedor: { id: string; recordedAt: Date }[],
  maxVersionGanador: number,
): { id: string; version: number }[] {
  const ordenados = [...delPerdedor].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );
  return ordenados
    .map((q, i) => ({ id: q.id, version: maxVersionGanador + i + 1 }))
    .reverse();
}

/** Tope del motivo de una fusión. */
export const EDU_FUSION_REASON_MAX = 500;

/**
 * El motivo, obligatorio. Fusionar mueve el expediente de una persona a
 * otra ficha y no se deshace con un botón: quien lo hace deja escrito por
 * qué creyó que eran la misma persona.
 */
export function eduFusionParseReason(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < 3) {
    throw new Error(
      "Escribe por qué son la misma persona. Queda en la bitácora y es lo que contesta la pregunta dentro de un año.",
    );
  }
  return v.slice(0, EDU_FUSION_REASON_MAX);
}
