"use client";
// OrthodonticsRedesignClient — shell del rediseño Fase 1 patient-detail.
//
// Layout: 2 columnas (main scrollable + right rail sticky). El layout 3
// columnas final (con la sidebar contextual del patient-detail) se logra
// porque este componente se monta DENTRO del shell existente que ya provee
// la sidebar izquierda — solo aportamos main + rail derecha.
//
// Maneja estado de drawer (Treatment Card) y modal (Advance Phase) con
// useReducer simple; los handlers de save/sign son placeholders por ahora —
// se cablean a server actions en commit posterior.

import { Camera, DollarSign, FileText, Shield, Sparkles, Star } from "lucide-react";
import { useState } from "react";
import { SectionHero } from "./sections/SectionHero";
import { SectionDiagnosis } from "./sections/SectionDiagnosis";
import { SectionPlan } from "./sections/SectionPlan";
import { SectionTreatmentCards } from "./sections/SectionTreatmentCards";
import { SectionPlaceholder } from "./sections/SectionPlaceholder";
import { RightRail } from "./sidebar/RightRail";
import { DrawerTreatmentCard } from "./drawers/DrawerTreatmentCard";
import type { DrawerCardSubmit } from "./drawers/DrawerTreatmentCard";
import { ModalAdvancePhase } from "./drawers/ModalAdvancePhase";
import type { OrthoRedesignViewModel, OrthoPhaseKey } from "./types";
import type { DigitalRecordEntry } from "./sections/SectionDiagnosis";

type DrawerState =
  | { kind: "tcard"; cardId: string }
  | { kind: "tcard-new" }
  | { kind: "advance-phase" }
  | null;

export interface OrthodonticsRedesignClientProps {
  vm: OrthoRedesignViewModel;
  digitalRecords?: DigitalRecordEntry[];
  /** Hook para cobrar siguiente mensualidad — abre modal cobro existente. */
  onCollectNow?: () => void;
  /** Callback cuando se firma una card. Para ahora, solo cierra drawer. */
  onCardSigned?: (payload: DrawerCardSubmit) => Promise<void> | void;
  /** Callback cuando se guarda como borrador. */
  onCardDraftSaved?: (payload: DrawerCardSubmit) => Promise<void> | void;
  /** Callback cuando se confirma avance de fase. */
  onPhaseAdvanced?: (payload: {
    fromPhase: OrthoPhaseKey;
    toPhase: OrthoPhaseKey;
    criteriaChecked: string[];
    doctorNotes: string | null;
    isOverride: boolean;
    overrideReason: string | null;
    overridePin: string | null;
  }) => Promise<void> | void;
  /** Hook para abrir wizard de diagnóstico legacy. */
  onStartDiagnosisWizard?: () => void;
  /** Hook para abrir wizard del plan tx legacy (G4 prescription). */
  onEditPrescription?: () => void;
  /** Hook para abrir wizard de wire step nuevo. */
  onAddWireStep?: () => void;
  /** Hook para abrir form de TAD nuevo. */
  onAddTad?: () => void;
  /** Hook para chat WhatsApp completo. */
  onOpenChat?: () => void;
  /** ¿El usuario actual puede hacer override del checklist de fase? */
  canOverridePhase?: boolean;
}

export function OrthodonticsRedesignClient(props: OrthodonticsRedesignClientProps) {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const closeDrawer = () => setDrawer(null);

  const vm = props.vm;
  const t = vm.treatment;

  const cardForDrawer =
    drawer?.kind === "tcard"
      ? vm.treatmentCards.find((c) => c.id === drawer.cardId) ?? null
      : null;

  // Defaults para nueva cita: siguiente número, fase actual, mes actual.
  const newCardDefaults =
    drawer?.kind === "tcard-new"
      ? {
          cardNumber:
            (vm.treatmentCards.reduce((m, c) => Math.max(m, c.cardNumber), 0) ?? 0) + 1,
          phase: t.phase ?? "Sin fase",
          monthAt: t.monthCurrent,
          wireFrom: t.wireCurrent,
          visitDate: new Date().toISOString(),
        }
      : undefined;

  const placeholders: Array<{
    id: string;
    eyebrow: string;
    title: string;
    icon: React.ReactNode;
    bullets: string[];
  }> = [
    {
      id: "photos",
      eyebrow: "Sección E",
      title: "Fotos comparativas T0/T1/T2",
      icon: <Camera className="w-6 h-6" aria-hidden />,
      bullets: [
        "Comparativa side-by-side T0 vs actual con métricas overlay (overjet, overbite).",
        "Alert G15 automático: faltan registros mid-treatment a los 12 meses.",
        "Reusa PhotoSetWizard existente con las 8 vistas AAO.",
      ],
    },
    {
      id: "finance",
      eyebrow: "Sección F",
      title: "Plan financiero · CFDI 4.0",
      icon: <DollarSign className="w-6 h-6" aria-hidden />,
      bullets: [
        "Plan de pagos visualizado como chips (mes 1, mes 2, … pagado/pendiente/futuro).",
        "G5 Open Choice slider · 3 escenarios financieros para presentar al paciente.",
        "G6 Sign@Home · firma + cobro vía WhatsApp con link tokenizado.",
        "M1 CFDI 4.0 · timbrado automático con Facturapi.",
      ],
    },
    {
      id: "retention",
      eyebrow: "Sección G",
      title: "Retención",
      icon: <Shield className="w-6 h-6" aria-hidden />,
      bullets: [
        "G9 régimen visual: Hawley sup/inf · Essix · Fijo lingual 3-3 (.0175/.0195/.021).",
        "Auto-schedule 3/6/12/24/36 meses con pre-encuesta WhatsApp antes de cada cita.",
        "Trigger automático al avanzar fase a Retención (LabOrder retenedor).",
      ],
    },
    {
      id: "post",
      eyebrow: "Sección H",
      title: "Post-tratamiento",
      icon: <Star className="w-6 h-6" aria-hidden />,
      bullets: [
        "G11 NPS automático +3 días post-debond.",
        "Auto Google review +7 días.",
        "Programa referidos con código personalizado.",
      ],
    },
    {
      id: "docs",
      eyebrow: "Sección I",
      title: "Documentos & comunicación",
      icon: <FileText className="w-6 h-6" aria-hidden />,
      bullets: [
        "Tabs: Consentimientos · Cartas referencia · LabOrders · WhatsApp log.",
        "G18 LabOrder catalog ampliado: alineadores serie 1-30, retenedor Hawley/Essix/fijo, expansor RPE/Hyrax.",
        "Reusa ReferralLetter + LabOrder cross-cutting existentes.",
      ],
    },
  ];

  return (
    <div className="bg-slate-50 dark:bg-slate-950 -m-4 sm:-m-6 px-4 sm:px-6 py-4">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Main column */}
        <main className="flex-1 min-w-0 space-y-4">
          <SectionHero
            treatment={t}
            hasUpcomingControlToday={isToday(vm.nextAppointment?.date)}
            onStartTreatment={props.onStartDiagnosisWizard}
            onEditPlan={props.onEditPrescription}
            onStartControl={() => setDrawer({ kind: "tcard-new" })}
          />

          <SectionDiagnosis
            diagnosis={vm.diagnosis}
            digitalRecords={props.digitalRecords ?? []}
            onStartWizard={props.onStartDiagnosisWizard}
            onEdit={props.onStartDiagnosisWizard}
            onUploadRecord={props.onStartDiagnosisWizard}
          />

          <SectionPlan
            treatment={t}
            wireSequence={vm.wireSequence}
            iprPlan={derivePlanIprFromCards(vm)}
            tads={vm.tads}
            auxMechanics={vm.auxMechanics}
            onEditPrescription={props.onEditPrescription}
            onAddWireStep={props.onAddWireStep}
            onAddTad={props.onAddTad}
            onAdvancePhase={t.phase ? () => setDrawer({ kind: "advance-phase" }) : undefined}
          />

          <SectionTreatmentCards
            cards={vm.treatmentCards}
            nextAppointment={vm.nextAppointment}
            onOpenCard={(id) => setDrawer({ kind: "tcard", cardId: id })}
            onStartNewCard={() => setDrawer({ kind: "tcard-new" })}
          />

          {placeholders.map((p) => (
            <SectionPlaceholder
              key={p.id}
              id={p.id}
              eyebrow={p.eyebrow}
              title={p.title}
              icon={p.icon}
              bullets={p.bullets}
            />
          ))}

          <PhaseTransitionAuditTeaser count={vm.phaseTransitions.length} />
        </main>

        {/* Right rail */}
        <div className="w-full lg:w-72 flex-shrink-0">
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto pr-1">
            <RightRail
              treatment={t}
              nextAppointment={vm.nextAppointment}
              patientFlow={vm.patientFlow}
              aiSuggestions={vm.aiSuggestions}
              whatsappRecent={vm.whatsappRecent}
              suggestedChargeAmount={null}
              onCollectNow={props.onCollectNow}
              onOpenChat={props.onOpenChat}
            />
          </div>
        </div>
      </div>

      {/* Drawer Treatment Card */}
      {drawer?.kind === "tcard" && cardForDrawer ? (
        <DrawerTreatmentCard
          key={cardForDrawer.id}
          card={cardForDrawer}
          availableWires={vm.wireSequence}
          onClose={closeDrawer}
          onSave={props.onCardDraftSaved}
          onSign={props.onCardSigned}
        />
      ) : null}

      {drawer?.kind === "tcard-new" && newCardDefaults ? (
        <DrawerTreatmentCard
          key="new-card"
          card={null}
          defaultsForNew={{
            cardNumber: newCardDefaults.cardNumber,
            phase: newCardDefaults.phase,
            monthAt: newCardDefaults.monthAt,
            wireFrom: newCardDefaults.wireFrom,
            visitDate: newCardDefaults.visitDate,
          }}
          availableWires={vm.wireSequence}
          onClose={closeDrawer}
          onSave={props.onCardDraftSaved}
          onSign={props.onCardSigned}
        />
      ) : null}

      {/* Modal Advance Phase */}
      {drawer?.kind === "advance-phase" && t.phase ? (
        <ModalAdvancePhase
          fromPhase={t.phase}
          canOverride={props.canOverridePhase}
          onClose={closeDrawer}
          onConfirm={async (payload) => {
            await props.onPhaseAdvanced?.(payload);
            closeDrawer();
          }}
        />
      ) : null}
    </div>
  );
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
}

/**
 * Deriva el set de IPR planeado consolidando los puntos de todas las
 * Treatment Cards. Cuando aún no hay cards, devuelve [] (la UI muestra
 * empty state). En commit posterior se moverá a un campo dedicado del plan.
 */
function derivePlanIprFromCards(vm: OrthoRedesignViewModel) {
  const map = new Map<string, (typeof vm.treatmentCards)[number]["iprPoints"][number]>();
  for (const c of vm.treatmentCards) {
    for (const p of c.iprPoints) {
      const k = `${Math.min(p.toothA, p.toothB)}-${Math.max(p.toothA, p.toothB)}`;
      const prev = map.get(k);
      if (!prev || (p.done && !prev.done)) map.set(k, p);
    }
  }
  return Array.from(map.values());
}

function PhaseTransitionAuditTeaser({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="text-[11px] text-slate-500 px-1 dark:text-slate-400">
      <Sparkles className="w-3 h-3 inline mr-1" aria-hidden />
      Audit trail: {count} transición{count === 1 ? "" : "es"} de fase registrada
      {count === 1 ? "" : "s"}.
    </div>
  );
}
