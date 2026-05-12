// Reglas disabled de UI — SPEC §4 verbatim · 22 reglas.
//
// Cada regla devuelve { disabled: boolean, reason?: string } para que el
// componente pueda renderizar el control en estado deshabilitado con tooltip.
//
// Las funciones reciben el bundle del caso (no Prisma directo) para mantener
// los componentes server-side y client-side desacoplados.

import type { OrthoCaseBundle } from "./types";

export interface DisabledState {
  disabled: boolean;
  reason?: string;
}

const ENABLED: DisabledState = { disabled: false };

const hasPendingInstallments = (b: OrthoCaseBundle): boolean =>
  !!b.financialPlan?.installments.some(
    (i) => i.status === "PENDING" || i.status === "OVERDUE",
  );

const hasFutureArches = (b: OrthoCaseBundle): boolean =>
  !!b.plan?.arches.some((a) => a.status === "FUTURE");

const hasPastArches = (b: OrthoCaseBundle): boolean =>
  !!b.plan?.arches.some((a) => a.status === "PAST");

// ─────────────────────────────────────────────────────────────────────────────
// 22 reglas
// ─────────────────────────────────────────────────────────────────────────────

export const Disabled = {
  // 1. Btn "Generar PDF antes/después"
  generateBeforeAfterPdf(b: OrthoCaseBundle): DisabledState {
    const completed = b.case.status === "COMPLETED";
    const debonded = !!b.case.debondedAt;
    if (!completed && !debonded)
      return { disabled: true, reason: "Disponible al marcar debonding completado" };
    return ENABLED;
  },

  // 2. Btn "Cobrar siguiente $X"
  collectInstallment(b: OrthoCaseBundle): DisabledState {
    if (!hasPendingInstallments(b))
      return { disabled: true, reason: "No hay mensualidad pendiente" };
    return ENABLED;
  },

  // 3. Btn "Avanzar al arco siguiente"
  advanceArch(b: OrthoCaseBundle): DisabledState {
    if (!hasFutureArches(b))
      return {
        disabled: true,
        reason: "No hay arcos futuros — agrega uno o avanza a Cierre",
      };
    return ENABLED;
  },

  // 4. Btn "Sign@Home WhatsApp"
  signAtHome(b: OrthoCaseBundle): DisabledState {
    if (!b.financialPlan?.activeScenarioId)
      return { disabled: true, reason: "Selecciona escenario A/B/C antes de enviar" };
    return ENABLED;
  },

  // 5. Tab T1 (etapa)
  photoStageT1(b: OrthoCaseBundle): DisabledState {
    const t0 = b.photoSets.find((s) => s.stageCode === "T0");
    if (!t0 || t0.photos.length === 0)
      return { disabled: true, reason: "Sube primero el set inicial T0" };
    return ENABLED;
  },

  // 6. Btn "+ Treatment Card"
  createTreatmentCard(b: OrthoCaseBundle): DisabledState {
    if (b.case.status === "DRAFT")
      return { disabled: true, reason: "Acepta el plan antes de registrar citas" };
    return ENABLED;
  },

  // 7. Btn "Marcar debonding"
  markDebonding(b: OrthoCaseBundle): DisabledState {
    if (b.case.currentPhase !== "FINISHING" && b.cards.length < 6)
      return { disabled: true, reason: "El caso debe estar en Finalización" };
    return ENABLED;
  },

  // 8. Btn "Generar consentimiento"
  generateConsent(b: OrthoCaseBundle): DisabledState {
    if (!b.plan?.acceptedAt)
      return { disabled: true, reason: "Plan no aceptado por paciente todavía" };
    return ENABLED;
  },

  // 9. Btn "+ Carta referencia"
  newReferralLetter(b: OrthoCaseBundle): DisabledState {
    if (!b.diagnosis)
      return {
        disabled: true,
        reason: "Falta diagnóstico — captura clasificación de Angle primero",
      };
    return ENABLED;
  },

  // 10. Btn "Guardar como plantilla"
  saveAsTemplate(b: OrthoCaseBundle): DisabledState {
    if (!b.plan || b.plan.arches.length === 0)
      return { disabled: true, reason: "Plan vacío — agrega al menos un arco" };
    return ENABLED;
  },

  // 11. Btn "Cargar plantilla"
  loadTemplate(b: OrthoCaseBundle): DisabledState {
    if (!b.plan) return ENABLED;
    if (b.plan.arches.length > 0 && b.case.status !== "DRAFT")
      return {
        disabled: true,
        reason: "Plan ya iniciado — borra arcos para cargar otra plantilla",
      };
    return ENABLED;
  },

  // 12. Btn comparar fotos
  comparePhotos(b: OrthoCaseBundle): DisabledState {
    if (b.photoSets.length < 2)
      return { disabled: true, reason: "Necesitas al menos 2 sets para comparar" };
    return ENABLED;
  },

  // 13. Editor narrativa diagnóstico
  editDiagnosisNarrative(b: OrthoCaseBundle, canReopen: boolean): DisabledState {
    if (b.case.status === "COMPLETED" && !canReopen)
      return { disabled: true, reason: "Caso completado — reabre para editar" };
    return ENABLED;
  },

  // 14. Btn "Activar NPS"
  activateNps(b: OrthoCaseBundle): DisabledState {
    if (!b.case.debondedAt)
      return { disabled: true, reason: "NPS se activa post-debond" };
    return ENABLED;
  },

  // 15. Chip checkpoint pasado
  pastCheckpoint(date: Date, done: boolean): DisabledState {
    if (date < new Date() && !done)
      return { disabled: true, reason: "Vencido — registra manualmente" };
    return ENABLED;
  },

  // 16. Btn "Eliminar foto T0"
  deletePhoto(b: OrthoCaseBundle, photoSetId: string): DisabledState {
    const linked = b.cards.some((c) => c.linkedPhotoSet === photoSetId);
    if (linked)
      return { disabled: true, reason: "Foto vinculada a Treatment Card" };
    return ENABLED;
  },

  // 17. Input mensual
  editMonthly(activeScenarioId: string | null, thisScenarioId: string): DisabledState {
    if (activeScenarioId !== thisScenarioId)
      return { disabled: true, reason: "Activa este escenario para editar" };
    return ENABLED;
  },

  // 18. Btn "Imprimir indicaciones"
  printIndications(cardSignedOffAt: string | null): DisabledState {
    if (!cardSignedOffAt)
      return { disabled: true, reason: "Firma la Treatment Card primero" };
    return ENABLED;
  },

  // 19. Btn "+ Tipo nuevo aparatología"
  newApplianceType(role: string): DisabledState {
    if (role !== "doctor")
      return { disabled: true, reason: "Solo el ortodoncista puede crear tipos nuevos" };
    return ENABLED;
  },

  // 20. Drag-reorder arcos
  reorderArches(b: OrthoCaseBundle): DisabledState {
    if (hasPastArches(b))
      return {
        disabled: true,
        reason: "Hay arcos ya ejecutados — solo se pueden reordenar futuros",
      };
    return ENABLED;
  },

  // 21. Btn "Aceptar plan"
  acceptPlan(b: OrthoCaseBundle): DisabledState {
    if (!b.financialPlan || !b.plan || b.plan.arches.length === 0)
      return {
        disabled: true,
        reason: "Plan financiero y arcos requeridos antes de aceptar",
      };
    return ENABLED;
  },

  // 22. Btn "Pregúntale a IA"
  askAi(user: { aiAssistantEnabled?: boolean }): DisabledState {
    if (!user.aiAssistantEnabled)
      return { disabled: true, reason: "AI Assistant no contratado · contratar" };
    return ENABLED;
  },
};
