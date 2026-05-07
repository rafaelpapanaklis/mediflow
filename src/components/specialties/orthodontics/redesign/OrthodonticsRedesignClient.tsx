"use client";
// OrthodonticsRedesignClient — shell del rediseño completo del módulo
// Ortodoncia patient-detail. Maneja secciones A-I + drawers/modales y
// despacha callbacks a server actions. Layout 2 cols (main + rail) que se
// monta dentro del shell del patient-detail (que provee la sidebar
// contextual a la izquierda).

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { SectionHero } from "./sections/SectionHero";
import { SectionDiagnosis } from "./sections/SectionDiagnosis";
import { SectionPlan } from "./sections/SectionPlan";
import { SectionTreatmentCards } from "./sections/SectionTreatmentCards";
import {
  SectionPhotos,
  type PhotoSetSummary,
  type PhotoStage,
} from "./sections/SectionPhotos";
import { SectionFinance } from "./sections/SectionFinance";
import {
  SectionRetention,
  type RetainerCheckupDTO,
  type RetentionRegimenDTO,
} from "./sections/SectionRetention";
import {
  SectionPostTreatment,
  type NpsScheduleDTO,
  type ReferralCodeDTO,
} from "./sections/SectionPostTreatment";
import {
  SectionDocs,
  type ConsentRow,
  type LabOrderRow,
  type ReferralLetterRow,
  type WhatsAppLogEntry,
} from "./sections/SectionDocs";
import { RightRail } from "./sidebar/RightRail";
import { OrthodonticsModuleSidebar } from "./sidebar/OrthodonticsModuleSidebar";
import { DrawerTreatmentCard } from "./drawers/DrawerTreatmentCard";
import type { DrawerCardSubmit } from "./drawers/DrawerTreatmentCard";
import { ModalAdvancePhase } from "./drawers/ModalAdvancePhase";
import { ModalOpenChoice } from "./drawers/ModalOpenChoice";
import { DrawerSignAtHome } from "./drawers/DrawerSignAtHome";
import { ModalCollect } from "./drawers/ModalCollect";
import { DrawerCFDIList } from "./drawers/DrawerCFDIList";
import { DrawerLabOrder } from "./drawers/DrawerLabOrder";
import { DrawerWireStep, type DrawerWireStepSubmit } from "./drawers/DrawerWireStep";
import { ModalCompare, type CompareSet } from "./drawers/ModalCompare";
import { PatientHeaderG16, type PatientHeaderProps } from "./PatientHeaderG16";
import type { OrthoRedesignViewModel, OrthoPhaseKey } from "./types";
import type { DigitalRecordEntry } from "./sections/SectionDiagnosis";
import type {
  CFDIRecordDTO,
  OrthoInstallmentDTO,
  QuoteScenarioDTO,
} from "./types-finance";

type DrawerState =
  | { kind: "tcard"; cardId: string }
  | { kind: "tcard-new" }
  | { kind: "advance-phase" }
  | { kind: "openchoice" }
  | { kind: "signhome" }
  | { kind: "collect" }
  | { kind: "cfdi" }
  | { kind: "laborder" }
  | { kind: "wirestep" }
  | { kind: "compare" }
  | null;

export interface OrthodonticsRedesignClientProps {
  vm: OrthoRedesignViewModel;
  digitalRecords?: DigitalRecordEntry[];
  /** Foto-sets históricos por etapa (T0/T1/T2/CONTROL). */
  historicalPhotoSets?: PhotoSetSummary[];
  /** Hook para subir foto a un slot — server action al ortho-redesign loader. */
  onUploadPhoto?: (
    stage: PhotoStage,
    slotId: string,
    file: File,
  ) => Promise<void> | void;
  /** Comparativa T0 vs actual. */
  onComparePhotos?: () => void;
  /** Programar foto-set + RX panorámica para mes 12 (G15). */
  onScheduleG15?: () => void;

  /** Sección F · finanzas. */
  installments?: OrthoInstallmentDTO[];
  /** Escenarios de cotización pre-cargados (G5). */
  quoteScenarios?: QuoteScenarioDTO[];
  /** Lista de CFDI timbrados (M1). */
  cfdiRecords?: CFDIRecordDTO[];
  onSelectQuoteScenario?: (scenarioId: string) => Promise<void> | void;
  onSendSignAtHome?: () => Promise<void> | void;
  onConfirmCollect?: (
    method: "tarjeta" | "transfer" | "efectivo" | "msi",
  ) => Promise<void> | void;
  /** Hook para cobrar siguiente mensualidad desde sidebar derecha. */
  onCollectNow?: () => void;

  /** Callback cuando se firma una card. */
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
  /** Hook para abrir wizard de wire step nuevo. Si está presente reemplaza
   *  al drawer interno G3. */
  onAddWireStep?: () => void;
  /** Submit de un wire step desde el DrawerWireStep G3 interno. */
  onSubmitWireStep?: (payload: DrawerWireStepSubmit) => Promise<void> | void;
  /** Generar PDF antes/después desde ModalCompare. */
  onGenerateComparePdf?: () => void;
  /** Hook para abrir form de TAD nuevo. */
  onAddTad?: () => void;
  /** Hook para chat WhatsApp completo. */
  onOpenChat?: () => void;
  /** ¿El usuario actual puede hacer override del checklist de fase? */
  canOverridePhase?: boolean;

  /** Sección G · retención. */
  retentionRegimen?: RetentionRegimenDTO | null;
  retainerCheckups?: RetainerCheckupDTO[];
  treatmentStatus?: "no-iniciado" | "en-tratamiento" | "retencion" | "completado";
  onTogglePreSurvey?: (enabled: boolean) => Promise<void> | void;
  onConfigureRetention?: () => void;

  /** Sección H · post-tratamiento. */
  npsSchedules?: NpsScheduleDTO[];
  referralCode?: ReferralCodeDTO | null;
  onGeneratePdfBeforeAfter?: () => void;
  onConfigureNps?: () => void;
  onCopyReferralCode?: () => void;

  /** Sección I · documentos & comunicación. */
  labOrders?: LabOrderRow[];
  consents?: ConsentRow[];
  referralLetters?: ReferralLetterRow[];
  whatsappLog?: WhatsAppLogEntry[];
  onCreateLabOrder?: (payload: {
    catalog: string;
    description: string;
    lab: string;
    expectedDate: string | null;
  }) => Promise<void> | void;
  onCreateReferralLetter?: () => void;

  /** Patient header con G16 — opcional. Cuando se provee, se renderiza arriba
   *  de la grilla principal. Si se omite, el shell host (legacy o nuevo) es
   *  responsable de renderizar el header del paciente. */
  patientHeader?: Omit<PatientHeaderProps, "patientFlow" | "nextAppointment"> & {
    /** Si se omite, se reusa vm.patientFlow / vm.nextAppointment. */
    patientFlow?: PatientHeaderProps["patientFlow"];
    nextAppointment?: PatientHeaderProps["nextAppointment"];
  };
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

  const nextPending = (props.installments ?? []).find((i) => i.status === "PENDING");
  const tStatus = props.treatmentStatus ?? "en-tratamiento";

  return (
    <div className="bg-slate-50 dark:bg-slate-950 grid-bg -m-4 sm:-m-6 px-4 sm:px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 min-h-[calc(100vh-200px)] overflow-x-hidden">
      <div className="max-w-[1920px] mx-auto">
        {props.patientHeader ? (
          <div className="mb-4 lg:mb-6">
            <PatientHeaderG16
              patient={props.patientHeader.patient}
              patientFlow={props.patientHeader.patientFlow ?? vm.patientFlow}
              nextAppointment={
                props.patientHeader.nextAppointment ?? vm.nextAppointment
              }
              outstandingAmount={props.patientHeader.outstandingAmount}
              lastVisitAt={props.patientHeader.lastVisitAt}
              totalVisits={props.patientHeader.totalVisits}
              onStartVisit={props.patientHeader.onStartVisit}
              onScheduleNext={props.patientHeader.onScheduleNext}
              onCollect={props.patientHeader.onCollect}
              onMore={props.patientHeader.onMore}
            />
          </div>
        ) : null}
      </div>
      <div
        className="max-w-[1920px] mx-auto grid gap-4 lg:gap-6 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_320px] xl:grid-cols-[240px_minmax(0,1fr)_360px]"
      >
        {/* Sub-sidebar contextual del módulo (lg+) */}
        <OrthodonticsModuleSidebar treatmentStatus={tStatus} />

        {/* Main column */}
        <main className="min-w-0 space-y-4">
          <SectionHero
            treatment={t}
            hasUpcomingControlToday={isToday(vm.nextAppointment?.date)}
            onStartTreatment={props.onStartDiagnosisWizard}
            onEditPlan={props.onEditPrescription}
            onStartControl={() => setDrawer({ kind: "tcard-new" })}
            onAdvancePhase={t.phase ? () => setDrawer({ kind: "advance-phase" }) : undefined}
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
            onAddWireStep={
              props.onAddWireStep ?? (() => setDrawer({ kind: "wirestep" }))
            }
            onAddTad={props.onAddTad}
          />

          <SectionTreatmentCards
            cards={vm.treatmentCards}
            nextAppointment={vm.nextAppointment}
            onOpenCard={(id) => setDrawer({ kind: "tcard", cardId: id })}
            onStartNewCard={() => setDrawer({ kind: "tcard-new" })}
          />

          <SectionPhotos
            monthCurrent={t.monthCurrent}
            monthTotal={t.monthTotal}
            historicalSets={props.historicalPhotoSets ?? []}
            onUpload={props.onUploadPhoto}
            onCompare={
              props.onComparePhotos ??
              ((props.historicalPhotoSets ?? []).length > 0
                ? () => setDrawer({ kind: "compare" })
                : undefined)
            }
            onScheduleG15={props.onScheduleG15}
          />

          <SectionFinance
            totalCost={t.totalCost}
            paid={t.paid}
            installments={props.installments ?? []}
            onPresentQuote={() => setDrawer({ kind: "openchoice" })}
            onSignAtHome={() => setDrawer({ kind: "signhome" })}
            onCollectNext={() => setDrawer({ kind: "collect" })}
            onViewCfdi={() => setDrawer({ kind: "cfdi" })}
          />

          <SectionRetention
            regimen={props.retentionRegimen ?? null}
            checkups={props.retainerCheckups ?? []}
            treatmentStatus={tStatus}
            onTogglePreSurvey={props.onTogglePreSurvey}
            onConfigureRegimen={props.onConfigureRetention}
          />

          <SectionPostTreatment
            treatmentStatus={tStatus}
            npsSchedules={props.npsSchedules ?? []}
            referralCode={props.referralCode ?? null}
            onGeneratePdf={props.onGeneratePdfBeforeAfter}
            onConfigureNps={props.onConfigureNps}
            onCopyReferralCode={props.onCopyReferralCode}
          />

          <SectionDocs
            labOrders={props.labOrders ?? []}
            consents={props.consents ?? []}
            referralLetters={props.referralLetters ?? []}
            whatsappLog={props.whatsappLog ?? []}
            onNewLabOrder={() => setDrawer({ kind: "laborder" })}
            onNewReferral={props.onCreateReferralLetter}
          />

          <PhaseTransitionAuditTeaser count={vm.phaseTransitions.length} />

          <footer className="text-[11px] text-slate-400 text-center py-4 dark:text-slate-500">
            MediFlow · Ortodoncia · Patient Detail · 11 gaps integrados (G1 G3 G4 G5 G6 G9 G10 G11
            G12 G15 G16 G18) · 6 differentiators preservados (M1-M6)
          </footer>
        </main>

        {/* Right rail */}
        <div className="w-full">
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto pr-1">
            <RightRail
              treatment={t}
              nextAppointment={vm.nextAppointment}
              patientFlow={vm.patientFlow}
              aiSuggestions={vm.aiSuggestions}
              whatsappRecent={vm.whatsappRecent}
              suggestedChargeAmount={nextPending?.amount ?? null}
              onCollectNow={
                props.onCollectNow ?? (() => setDrawer({ kind: "collect" }))
              }
              onOpenChat={props.onOpenChat}
            />
          </div>
        </div>
      </div>

      {/* Drawer Treatment Card existente */}
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

      {/* Drawer nueva cita */}
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

      {/* Modal advance phase */}
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

      {/* Modal Open Choice G5 */}
      {drawer?.kind === "openchoice" ? (
        <ModalOpenChoice
          scenarios={props.quoteScenarios ?? []}
          patientFirstName={vm.patient.firstName}
          onClose={closeDrawer}
          onConfirm={async (id) => {
            await props.onSelectQuoteScenario?.(id);
            setDrawer({ kind: "signhome" });
          }}
        />
      ) : null}

      {/* Drawer Sign@Home G6 */}
      {drawer?.kind === "signhome" ? (
        <DrawerSignAtHome
          patientFirstName={vm.patient.firstName}
          onClose={closeDrawer}
          onSend={async () => {
            await props.onSendSignAtHome?.();
            closeDrawer();
          }}
        />
      ) : null}

      {/* Modal Collect (cobrar siguiente) */}
      {drawer?.kind === "collect" ? (
        <ModalCollect
          amount={nextPending?.amount ?? 0}
          installmentLabel={
            nextPending
              ? `Mensualidad ${nextPending.installmentNumber}/${(props.installments ?? []).length}`
              : "—"
          }
          onClose={closeDrawer}
          onConfirm={async (method) => {
            await props.onConfirmCollect?.(method);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Drawer CFDI list (M1) */}
      {drawer?.kind === "cfdi" ? (
        <DrawerCFDIList cfdiRecords={props.cfdiRecords ?? []} onClose={closeDrawer} />
      ) : null}

      {/* Drawer Lab Order G18 */}
      {drawer?.kind === "laborder" ? (
        <DrawerLabOrder
          onClose={closeDrawer}
          onSend={async (payload) => {
            await props.onCreateLabOrder?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Drawer Wire Step G3 */}
      {drawer?.kind === "wirestep" ? (
        <DrawerWireStep
          defaultPhase={t.phase}
          onClose={closeDrawer}
          onSubmit={async (payload) => {
            await props.onSubmitWireStep?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Modal Compare T0 vs actual */}
      {drawer?.kind === "compare" ? (
        <ModalCompare
          setT0={summaryToCompareSet(
            (props.historicalPhotoSets ?? []).find((s) => s.stage === "T0") ?? null,
          )}
          setRight={summaryToCompareSet(
            (props.historicalPhotoSets ?? []).find((s) => s.stage === "T1") ??
              (props.historicalPhotoSets ?? []).find((s) => s.stage === "T2") ??
              null,
          )}
          availableRightStages={(props.historicalPhotoSets ?? [])
            .filter((s) => s.stage !== "T0")
            .map((s) => s.stage)}
          onGeneratePdf={props.onGenerateComparePdf}
          onClose={closeDrawer}
        />
      ) : null}
    </div>
  );
}

/**
 * El loader actual entrega únicamente meta-datos del set (sin URLs por slot).
 * Este helper construye un CompareSet con `photos = {}` para mostrar
 * placeholders en columnas y la fecha del set. La carga de URLs reales se
 * hará vía server action en commit posterior cuando el loader incluya el
 * map slot→url.
 */
function summaryToCompareSet(
  s: import("./sections/SectionPhotos").PhotoSetSummary | null,
): CompareSet | null {
  if (!s) return null;
  return { stage: s.stage, takenAt: s.date, photos: {} };
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
