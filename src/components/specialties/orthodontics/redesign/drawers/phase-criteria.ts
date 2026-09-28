// Checklist clínico por fase, separado de `ModalAdvancePhase.tsx` para que se
// pueda importar sin arrastrar el componente (y su hoja de estilos): las
// pruebas de `__tests__/phase-criteria.test.ts` corren en Node, que no sabe
// leer un `.module.css`. El contenido es el mismo, movido tal cual.

import type { OrthoPhaseKey } from "../types";

export interface PhaseCriterion {
  key: string;
  label: string;
  /** Hint clínico breve si la criteria no es obvia. */
  hint?: string;
}

/**
 * Checklist clínico por fase de origen. El doctor confirma cada item antes
 * de poder avanzar a la siguiente. Diseñado contra el SPEC §HANDOFF #2 con
 * el vocabulario clínico real (NiTi, MBT, Clase II, etc.).
 */
export const PHASE_CRITERIA: Record<OrthoPhaseKey, PhaseCriterion[]> = {
  ALIGNMENT: [
    { key: "all-bonded", label: "Todos los brackets cementados de canino a canino" },
    { key: "no-rotation", label: "Rotaciones corregidas <2 mm" },
    { key: "wire-rectangular", label: "Arco NiTi rectangular tolerado sin molestia" },
    { key: "photos-t0", label: "Foto-set T0 capturado y revisado" },
  ],
  LEVELING: [
    { key: "wire-ss", label: "Curva de Spee nivelada a SS rectangular" },
    { key: "overjet-stable", label: "Overjet estable, sin compensación dental" },
    { key: "elastics-tolerated", label: "Elásticos Clase II/III tolerados ≥2 sem" },
    { key: "hygiene-ok", label: "Higiene <30% placa en última cita" },
  ],
  SPACE_CLOSURE: [
    { key: "spaces-closed", label: "Espacios cerrados o pendientes documentados" },
    { key: "anchorage-ok", label: "Anclaje verificado (TADs/Clase II/molar block)" },
    { key: "midlines-ok", label: "Líneas medias con desviación ≤1 mm" },
    { key: "torque-control", label: "Control de torque en incisivos confirmado" },
  ],
  DETAILS: [
    { key: "ipr-done", label: "IPR planeado completado al 100%" },
    { key: "settling", label: "Settling iniciado en próximo control" },
    { key: "cosmetic-bonding", label: "Bonding cosmético / acabado revisado" },
  ],
  FINISHING: [
    { key: "occlusion-class-i", label: "Oclusión Clase I funcional verificada" },
    { key: "panoramic-final", label: "Panorámica final tomada (paralelismo)" },
    { key: "patient-approved", label: "Paciente aprobó resultado estético" },
    { key: "retainers-ordered", label: "LabOrder de retenedores enviada" },
  ],
  RETENTION: [
    { key: "retention-confirmed", label: "Retención permanente confirmada" },
  ],
};
