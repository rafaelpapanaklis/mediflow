"use client";
// OrthodonticsRedesignClient — shell del rediseño completo del módulo
// Ortodoncia patient-detail. Maneja secciones A-I + drawers/modales y
// despacha callbacks a server actions. Layout 2 cols (main + rail) que se
// monta dentro del shell del patient-detail (que provee la sidebar
// contextual a la izquierda).

import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cargarPanelDeCobro, type PanelDeCobro } from "@/app/actions/orthodontics/cobro/cargarPanelDeCobro";
import { PARAMETRO_ABRIR_CASO, debeAbrirElAlta } from "@/lib/orthodontics/abrir-caso";
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
import { ResumenCobranza } from "../cobranza/ResumenCobranza";
import { HygieneTrendCard } from "../hygiene/HygieneTrendCard";
import { AlineadoresPanel } from "../alineadores/AlineadoresPanel";
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
import { DrawerLabOrder } from "./drawers/DrawerLabOrder";
import { DrawerEditDiagnosis } from "./drawers/DrawerEditDiagnosis";
import { DrawerEditPrescription } from "./drawers/DrawerEditPrescription";
import { DrawerNewReferral } from "./drawers/DrawerNewReferral";
import { DrawerConfigRetention } from "./drawers/DrawerConfigRetention";
import { DrawerWhatsAppChat } from "./drawers/DrawerWhatsAppChat";
import { DrawerWireStep, type DrawerWireStepSubmit } from "./drawers/DrawerWireStep";
import { DrawerAddTad, type DrawerAddTadSubmit } from "./drawers/DrawerAddTad";
import {
  DrawerNewCase,
  type DrawerNewCaseDiagnosisPayload,
  type DrawerNewCasePlanPayload,
} from "./drawers/DrawerNewCase";
import { DrawerCaseSettings, type DrawerCaseSettingsPayload } from "./drawers/DrawerCaseSettings";
import { PatientHeaderG16, type PatientHeaderProps } from "./PatientHeaderG16";
import layout from "./ortho-redesign-layout.module.css";
import orto from "./orto.module.css";
import { RAIZ_ORTO } from "./raiz";
import { proximaFechaDeVisitaPorDefecto } from "@/lib/orthodontics/redesign/next-card-visit-default";
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
  | { kind: "cfdi" }
  | { kind: "laborder" }
  | { kind: "wirestep" }
  | { kind: "add-tad" }
  | { kind: "compare" }
  | { kind: "edit-diagnosis" }
  | { kind: "edit-prescription" }
  | { kind: "new-referral" }
  | { kind: "config-retention" }
  | { kind: "config-nps" }
  | { kind: "wa-chat" }
  | { kind: "new-case" }
  | { kind: "case-settings" }
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
  /** Datos del plan financiero — para el editor (BUG 7). */
  financialPlan?: {
    totalAmount: number;
    initialDownPayment: number;
    installmentCount: number;
    installmentAmount: number;
    paidAmount: number;
  } | null;
  onSelectQuoteScenario?: (scenarioId: string) => Promise<void> | void;
  onSendSignAtHome?: () => Promise<void> | void;
  onConfirmCollect?: (
    method: "tarjeta" | "transfer" | "efectivo" | "msi",
  ) => Promise<void> | void;
  /** Editar plan financiero — abre DrawerEditFinancialPlan. */
  onUpdateFinancialPlan?: (payload: {
    totalAmount: number;
    initialDownPayment: number;
    installmentCount: number;
    paymentDayOfMonth: number;
  }) => Promise<void> | void;
  /** Editar escenario individual del modal G5 (cards editables). */
  onUpdateQuoteScenario?: (payload: {
    scenarioId: string;
    downPayment: number;
    monthlyAmount: number;
    monthsCount: number;
    totalAmount: number;
  }) => Promise<void> | void;
  /** Editor de diagnóstico ortodóntico — Sección B. */
  onUpdateDiagnosis?: (payload: {
    diagnosisId: string;
    angleClassRight: string;
    angleClassLeft: string;
    overbiteMm: number;
    overjetMm: number;
    crowdingUpperMm: number | null;
    crowdingLowerMm: number | null;
    crossbite: boolean;
    crossbiteDetails: string | null;
    openBite: boolean;
    skeletalPattern: string | null;
    tmjPainPresent: boolean;
    tmjClickingPresent: boolean;
    tmjNotes: string | null;
    clinicalSummary: string;
  }) => Promise<void> | void;
  /** Editor de aparatología — Sección C "Cambiar". */
  onUpdateAppliances?: (payload: {
    treatmentPlanId: string;
    prescriptionSlot: string;
    bondingType: "DIRECTO" | "INDIRECTO";
    technique: string;
    prescriptionNotes: string | null;
  }) => Promise<void> | void;
  /** Crear carta de referencia — Sección I. */
  onCreateReferralLetter?: (payload: {
    toClinicName: string;
    toDoctorName: string | null;
    toSpecialty: string | null;
    reason: string;
    clinicalSummary: string;
  }) => Promise<void> | void;
  /** Configurar régimen de retención — Sección G. */
  onUpdateRetentionRegimen?: (payload: {
    upperRetainer: string | null;
    upperDescription: string | null;
    lowerRetainer: string | null;
    lowerDescription: string | null;
    fixedLingualPresent: boolean;
    fixedLingualGauge: string | null;
    regimenDescription: string;
    preSurveyEnabled: boolean;
  }) => Promise<void> | void;
  /** Configurar NPS — Sección H. */
  onUpdateNpsConfig?: (payload: {
    windowEarlyDays: number;
    windowMidDays: number;
    windowLateDays: number;
    customMessage: string | null;
    triggerGoogleReview: boolean;
  }) => Promise<void> | void;
  /** Programar foto-set checkpoint mes 12 — Sección E. */
  onScheduleG15Action?: () => Promise<void> | void;
  /** Patient name para chat WhatsApp drawer. */
  patientFullName?: string;
  /** Hook para cobrar siguiente mensualidad desde sidebar derecha. */
  onCollectNow?: () => void;

  /**
   * Callback cuando se firma una card. Devuelve el `cardId` con el que
   * quedó (§1 completo, ws1-t8) — DrawerTreatmentCard lo recuerda para
   * que un "Guardar borrador" seguido de "Firmar" en la misma sesión no
   * vuelva a mandar `cardId: null` dos veces.
   */
  onCardSigned?: (payload: DrawerCardSubmit) => Promise<string | null | void> | string | null | void;
  /** Callback cuando se guarda como borrador. Mismo contrato que onCardSigned. */
  onCardDraftSaved?: (payload: DrawerCardSubmit) => Promise<string | null | void> | string | null | void;
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
  /** Hook para abrir wizard de diagnóstico legacy — fallback si `onCreateCase`
   *  no está (queda por compatibilidad; ver `onCreateCase` para el flujo
   *  nuevo, ws1-t6, dentro de la ficha). */
  onStartDiagnosisWizard?: () => void;
  /** Hook para abrir wizard del plan tx legacy (G4 prescription) — fallback
   *  cuando no hay `onUpdateAppliances`. */
  onEditPrescription?: () => void;
  /** Ola 1 (ws1-t6) — «Alta del caso»: abre el asistente DENTRO de la ficha
   *  (diagnóstico + plan, o solo plan si ya hay diagnóstico). Si está
   *  presente, sustituye a `onStartDiagnosisWizard` en Hero/Diagnóstico. */
  onCreateCase?: (payload: {
    diagnosis: DrawerNewCaseDiagnosisPayload | null;
    plan: DrawerNewCasePlanPayload | null;
  }) => Promise<void> | void;
  /** A9 · enlaza a las radiografías/escaneos que ya existen en el
   *  expediente, en vez de mandar al asistente de diagnóstico (bug heredado
   *  de reusar `onStartDiagnosisWizard` para "subir registro"). */
  onOpenImagingRecords?: () => void;
  /** Ola 1 (ws1-t6) — A5/A6/A7/A11: cambiar doctor tratante, responsable del
   *  pago, fecha de colocación o estado del caso ya abierto. */
  onUpdateCaseSettings?: (payload: DrawerCaseSettingsPayload) => Promise<void> | void;
  /** Ola 1 (ws1-t6) — A10: si ya existe un consentimiento GENERAL de
   *  ortodoncia firmado (`ConsentForm`, no el propio `OrthodonticConsent`
   *  que se oculta). `null` = todavía cargando/no se pudo saber; no pinta
   *  nada mientras tanto. El enlace de la pestaña "Consentimientos" se arma
   *  aquí mismo con `vm.patient.id` — es navegación real de página (`<a>`),
   *  no client-side: el `tab` de la ficha solo lee `?tab=` en el montaje
   *  inicial (`useState(initialTab)`), así que un `router.push` sin recarga
   *  no cambiaría la pestaña visible. */
  generalConsentSigned?: boolean | null;
  /** Hook para abrir wizard de wire step nuevo. Si está presente reemplaza
   *  al drawer interno G3. */
  onAddWireStep?: () => void;
  /** Submit de un wire step desde el DrawerWireStep G3 interno. */
  onSubmitWireStep?: (payload: DrawerWireStepSubmit) => Promise<void> | void;
  /** Generar PDF antes/después desde ModalCompare. */
  onGenerateComparePdf?: () => void;
  /** Hook para abrir form de TAD nuevo. Si está presente reemplaza al
   *  drawer interno DrawerAddTad (hallazgo ws1-t4 §9). */
  onAddTad?: () => void;
  /** Submit de un TAD desde el DrawerAddTad interno. */
  onSubmitAddTad?: (payload: DrawerAddTadSubmit) => Promise<void> | void;
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
  // (onCreateReferralLetter ahora vive arriba en la sección "Cierre 100%"
  // como callback con payload completo. Se removió la versión () => void.)

  /** Patient header con G16 — opcional. Cuando se provee, se renderiza arriba
   *  de la grilla principal. Si se omite, el shell host (legacy o nuevo) es
   *  responsable de renderizar el header del paciente. */
  patientHeader?: Omit<PatientHeaderProps, "patientFlow" | "nextAppointment" | "outstandingAmount"> & {
    /** Si se omite, se reusa vm.patientFlow / vm.nextAppointment. */
    patientFlow?: PatientHeaderProps["patientFlow"];
    nextAppointment?: PatientHeaderProps["nextAppointment"];
    /**
     * Hallazgo ws1-t4 §5: ya no la lee nadie — `OrthodonticsRedesignClient`
     * calcula el saldo real de la factura (`cargarPanelDeCobro`), no el
     * precio de referencia del plan. Se deja opcional (no se borra del
     * type) para no romper a un caller que todavía la pase; se ignora.
     */
    outstandingAmount?: number;
  };
}

export function OrthodonticsRedesignClient(props: OrthodonticsRedesignClientProps) {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const closeDrawer = () => setDrawer(null);

  const vm = props.vm;
  const t = vm.treatment;

  // H17 (QA ws1-t9, ws1-t3): quien llega desde «Abrir caso» del módulo
  // (Pacientes en tratamiento → elegir paciente) trae `?abrirCaso=1`: el
  // asistente de alta se abre solo, sin tener que buscar el botón. El aviso
  // no da ningún permiso (ver `debeAbrirElAlta`), y se quita de la dirección
  // para que recargar o volver atrás no lo abra otra vez.
  const puedeCrearCaso = Boolean(props.onCreateCase);
  const tieneCaso = Boolean(t.treatmentPlanId);
  useEffect(() => {
    const direccion = new URLSearchParams(window.location.search);
    const parametro = direccion.get(PARAMETRO_ABRIR_CASO);
    if (parametro === null) return;
    if (debeAbrirElAlta({ parametro, tieneCaso, puedeCrear: puedeCrearCaso })) setDrawer({ kind: "new-case" });
    direccion.delete(PARAMETRO_ABRIR_CASO);
    const resto = direccion.toString();
    // Con `null`, no con `window.history.state`: así Next se entera del cambio
    // y no vuelve a poner el aviso en la dirección en su siguiente refresco.
    window.history.replaceState(null, "", `${window.location.pathname}${resto ? `?${resto}` : ""}${window.location.hash}`);
  }, [tieneCaso, puedeCrearCaso]);

  // Hallazgo ws1-t4 §5/§11: la cabecera, «Estado de cuenta» (RightRail),
  // «Cobro del tratamiento» (SectionFinance) y el resumen de mensualidades
  // (ResumenCobranza) tienen que decir EXACTAMENTE el mismo número — la
  // factura real del caso, no el precio de referencia del plan
  // (t.totalCost/paid, que sigue igual aunque nunca se abra una factura).
  // Antes cada tarjeta se auto-cargaba por su lado (SectionFinance Y
  // ResumenCobranza pedían `cargarPanelDeCobro` cada una, dos veces el
  // mismo caso) — se carga UNA vez aquí y se reparte hacia abajo.
  const [panelDeCobro, setPanelDeCobro] = useState<PanelDeCobro | null | "cargando" | "error">("cargando");
  const recargarPanelDeCobro = useCallback(() => {
    if (!t.treatmentPlanId) {
      setPanelDeCobro(null);
      return;
    }
    setPanelDeCobro("cargando");
    cargarPanelDeCobro(t.treatmentPlanId)
      .then((r) => setPanelDeCobro(r.ok ? r.data : "error"))
      .catch(() => setPanelDeCobro("error"));
  }, [t.treatmentPlanId]);
  useEffect(() => { recargarPanelDeCobro(); }, [recargarPanelDeCobro]);

  // Saldo real: null mientras carga o si el caso no tiene factura todavía
  // — nunca el precio de referencia disfrazado de "pendiente" (§5).
  const outstandingAmountReal =
    panelDeCobro && panelDeCobro !== "cargando" && panelDeCobro !== "error" && panelDeCobro.invoice
      ? Math.max(0, panelDeCobro.invoice.balance)
      : null;

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
          // H22 (QA ws1-t9): con la instantánea del instante en que se abre
          // el cajón, "Próximo control en N semanas" heredaba esa hora
          // (03:24, lo que fuera la hora del servidor) en vez de una hora de
          // consulta. Si hay una cita de control de HOY, se usa su hora real
          // — mismo criterio que ya usa BotonHojaControl al abrir desde la
          // Agenda (getTreatmentCardContextForAppointment.ts: appt.startsAt).
          visitDate: proximaFechaDeVisitaPorDefecto(vm.nextAppointment?.date),
        }
      : undefined;

  const tStatus = props.treatmentStatus ?? "en-tratamiento";

  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`}>
      {props.patientHeader ? (
        <PatientHeaderG16
          patient={props.patientHeader.patient}
          patientFlow={props.patientHeader.patientFlow ?? vm.patientFlow}
          nextAppointment={props.patientHeader.nextAppointment ?? vm.nextAppointment}
          outstandingAmount={outstandingAmountReal}
          lastVisitAt={props.patientHeader.lastVisitAt}
          totalVisits={props.patientHeader.totalVisits}
          onStartVisit={props.patientHeader.onStartVisit}
          onScheduleNext={props.patientHeader.onScheduleNext}
          onCollect={props.patientHeader.onCollect}
          onMore={props.patientHeader.onMore}
          // Registrar el control es lo que se hace veinte veces al día: va
          // arriba, a la vista, y manda sobre los demás botones. Mismo
          // cajón que abría «Nueva cita» en el resumen.
          onStartControl={
            t.status !== "no-iniciado" ? () => setDrawer({ kind: "tcard-new" }) : undefined
          }
          controlIsToday={isToday(vm.nextAppointment?.date)}
        />
      ) : null}
      <div className={layout.grid}>
        {/* Sub-sidebar contextual del módulo (lg+) */}
        <OrthodonticsModuleSidebar treatmentStatus={tStatus} />

        {/* Columna principal. El orden sigue al día de trabajo: resumen,
            controles (lo último que se hizo, antes de registrar lo de hoy)
            y después el expediente del caso. */}
        <div className={orto.columna}>
          <SectionHero
            treatment={t}
            hasUpcomingControlToday={isToday(vm.nextAppointment?.date)}
            onStartTreatment={
              props.onCreateCase ? () => setDrawer({ kind: "new-case" }) : props.onStartDiagnosisWizard
            }
            onEditPlan={
              props.onUpdateAppliances
                ? () => setDrawer({ kind: "edit-prescription" })
                : props.onEditPrescription
            }
            onOpenCaseSettings={
              props.onUpdateCaseSettings ? () => setDrawer({ kind: "case-settings" }) : undefined
            }
            // Con la cabecera del paciente montada, «Registrar control» vive
            // ahí (arriba, siempre a la vista); aquí solo si no hay cabecera.
            onStartControl={
              props.patientHeader ? undefined : () => setDrawer({ kind: "tcard-new" })
            }
            onAdvancePhase={t.phase ? () => setDrawer({ kind: "advance-phase" }) : undefined}
          />

          {/* Ola 1 (ws1-t6, Alta del caso) — A10: consentimiento GENERAL
              (no el propio OrthodonticConsent, que se oculta) sin firmar. */}
          {vm.diagnosis && props.generalConsentSigned === false ? (
            <ConsentMissingBanner patientId={vm.patient.id} />
          ) : null}

          <SectionTreatmentCards
            cards={vm.treatmentCards}
            nextAppointment={vm.nextAppointment}
            onOpenCard={(id) => setDrawer({ kind: "tcard", cardId: id })}
            // Sin caso abierto no hay dónde guardar un control: el botón no
            // se pinta (antes abría la hoja y al guardar salía un error).
            onStartNewCard={
              t.status !== "no-iniciado" ? () => setDrawer({ kind: "tcard-new" }) : undefined
            }
          />

          {/* Ola 1 (ws1-t4, Control y agenda) — C8 */}
          <HygieneTrendCard treatmentCards={vm.treatmentCards} />

          <SectionDiagnosis
            diagnosis={vm.diagnosis}
            digitalRecords={props.digitalRecords ?? []}
            onStartWizard={
              props.onCreateCase ? () => setDrawer({ kind: "new-case" }) : props.onStartDiagnosisWizard
            }
            onEdit={
              vm.diagnosis && props.onUpdateDiagnosis
                ? () => setDrawer({ kind: "edit-diagnosis" })
                : props.onCreateCase
                  ? () => setDrawer({ kind: "new-case" })
                  : props.onStartDiagnosisWizard
            }
            onUploadRecord={props.onOpenImagingRecords ?? props.onStartDiagnosisWizard}
            treatmentPlanId={t.treatmentPlanId}
            patientId={t.patientId}
          />

          <SectionPlan
            treatment={t}
            wireSequence={vm.wireSequence}
            iprPlan={derivePlanIprFromCards(vm)}
            tads={vm.tads}
            auxMechanics={vm.auxMechanics}
            onEditPrescription={
              props.onUpdateAppliances
                ? () => setDrawer({ kind: "edit-prescription" })
                : props.onEditPrescription
            }
            onAddWireStep={
              props.onAddWireStep ?? (() => setDrawer({ kind: "wirestep" }))
            }
            onAddTad={props.onAddTad ?? (() => setDrawer({ kind: "add-tad" }))}
          />

          {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S12, QUITAR
              (solo el comparador): en la ficha nueva el comparador de fotos
              muestra huecos (el loader no trae URL por slot todavía). Sin
              onCompare no hay botón que lo abra. El PDF comparativo SÍ se
              queda — ver onGeneratePdf de SectionPostTreatment más arriba. */}
          <SectionPhotos
            monthCurrent={t.monthCurrent}
            monthTotal={t.monthTotal}
            historicalSets={props.historicalPhotoSets ?? []}
            onUpload={props.onUploadPhoto}
            onScheduleG15={props.onScheduleG15Action ?? props.onScheduleG15}
          />

          {/* Ortodoncia — Ola 1 (ws1-t1 · Cobro): Sección F reescrita contra
              la factura a plazos del tratamiento (decisión 1), ya no contra
              el maquetado OrthoPaymentPlan/installments de Ola 0. Se basta
              con el id del caso: autofetch vía cargarPanelDeCobro. */}
          {t.treatmentPlanId ? (
            <SectionFinance
              treatmentPlanId={t.treatmentPlanId}
              patientId={t.patientId}
              patientName={vm.patient.fullName}
              panel={panelDeCobro}
              onReload={recargarPanelDeCobro}
            />
          ) : null}

          {/* Ranura del resumen de cobranza (decisión 1), rellenada en Ola 1
              (ws1-t1 · Cobro): mismo número que Sección F, calculado una vez
              por cobranzaDelCaso — y, desde el hallazgo ws1-t4 §11, la misma
              carga (panelDeCobro de arriba) en vez de una segunda consulta. */}
          {t.treatmentPlanId ? (
            <ResumenCobranza
              treatmentPlanId={t.treatmentPlanId}
              patientName={vm.patient.fullName}
              panel={panelDeCobro}
              onReload={recargarPanelDeCobro}
            />
          ) : null}

          {/* Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026):
              ranura nueva, mismo patrón self-fetch que ResumenCobranza. Se
              calla si no hay caso de alineadores ni cumplimiento registrado. */}
          {t.treatmentPlanId ? <AlineadoresPanel treatmentPlanId={t.treatmentPlanId} /> : null}

          <SectionRetention
            regimen={props.retentionRegimen ?? null}
            checkups={props.retainerCheckups ?? []}
            treatmentStatus={tStatus}
            sinCaso={!t.treatmentPlanId}
            onTogglePreSurvey={props.onTogglePreSurvey}
            onConfigureRegimen={
              props.onUpdateRetentionRegimen
                ? () => setDrawer({ kind: "config-retention" })
                : props.onConfigureRetention
            }
          />

          {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S6, QUITAR: NPS
              (se programa pero nadie lo envía) y códigos de referidos (solo
              con datos de ejemplo) sin sus botones. El PDF comparativo
              (onGeneratePdf) SÍ se queda — S12 lo saca explícitamente del
              QUITAR ("el PDF comparativo se queda"), es distinto del
              comparador de fotos roto que sí se oculta más abajo. */}
          <SectionPostTreatment
            treatmentStatus={tStatus}
            npsSchedules={props.npsSchedules ?? []}
            referralCode={props.referralCode ?? null}
            onGeneratePdf={props.onGeneratePdfBeforeAfter}
          />

          <SectionDocs
            labOrders={props.labOrders ?? []}
            consents={props.consents ?? []}
            referralLetters={props.referralLetters ?? []}
            whatsappLog={props.whatsappLog ?? []}
            onNewLabOrder={() => setDrawer({ kind: "laborder" })}
            onNewReferral={
              props.onCreateReferralLetter
                ? () => setDrawer({ kind: "new-referral" })
                : undefined
            }
          />

          <PhaseTransitionAuditTeaser count={vm.phaseTransitions.length} />

          {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S14, QUITAR: el
              pie de desarrollo ("11 gaps integrados...") hacía parecer roto
              el módulo a un ojo clínico. Ocultar, no borrar. */}
        </div>

        {/* Columna de la derecha */}
        <div className="min-w-0">
          <div className={orto.rielPegajoso}>
            <RightRail
              treatment={t}
              panel={panelDeCobro}
              nextAppointment={vm.nextAppointment}
              patientFlow={vm.patientFlow}
              aiSuggestions={vm.aiSuggestions}
              whatsappRecent={vm.whatsappRecent}
              suggestedChargeAmount={null}
              onCollectNow={props.onCollectNow}
              onOpenChat={() => setDrawer({ kind: "wa-chat" })}
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

      {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S4 y S5, QUITAR:
          "Modal Open Choice" (presupuestos A/B/C, duplica los presupuestos
          generales del paciente) y "Sign@Home" (maqueta: dice que envía el
          link y no envía nada) ya no tienen botón que los abra en
          SectionFinance. Ocultar, no borrar: ModalOpenChoice y
          DrawerSignAtHome se quedan en su archivo. */}

      {/* Ortodoncia — Ola 1 (ws1-t1 · Cobro), S3 QUITAR: "cobrar siguiente"
          aparte (ModalCollect) no pasaba por Caja ni por la factura del
          tratamiento — verificado sin ortho_installments guardados, nada
          que perder. Cobrar de verdad vive ahora en la Sección F (arriba),
          con PaymentModal sobre la factura real. Ocultar, no borrar:
          ModalCollect se queda en su archivo. */}

      {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S14, QUITAR: la
          lista de CFDI sale siempre vacía (nada la llena hoy). Sin botón
          que la abra en SectionFinance; DrawerCFDIList se queda en su
          archivo. */}

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

      {/* Drawer Agregar TAD (hallazgo ws1-t4 §9 — antes 4 window.prompt()) */}
      {drawer?.kind === "add-tad" ? (
        <DrawerAddTad
          onClose={closeDrawer}
          onSubmit={async (payload) => {
            await props.onSubmitAddTad?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S12, QUITAR: sin
          botón que abra el comparador de fotos (ver SectionPhotos más
          arriba). ModalCompare se queda en su archivo; el helper que
          armaba su input (summaryToCompareSet, glue local de este
          archivo, no reusable) se quitó por no tener ya llamador. */}

      {/* Ortodoncia — Ola 1 (ws1-t1 · Cobro): "Editar plan financiero"
          (DrawerEditFinancialPlan) apuntaba a updateFinancialPlan.ts, que
          edita el modelo OrthoPaymentPlan/installments que la decisión 1 de
          la arquitectura reemplaza. F7 (cambiar el plan a mitad) vive ahora
          en la Sección F, sobre las condiciones de la factura real.
          Ocultar, no borrar: DrawerEditFinancialPlan y updateFinancialPlan.ts
          se quedan en su archivo. */}

      {/* Drawer Editor Diagnóstico (Sección B "Editar") */}
      {drawer?.kind === "edit-diagnosis" && vm.diagnosis ? (
        <DrawerEditDiagnosis
          diagnosis={vm.diagnosis}
          onClose={closeDrawer}
          onConfirm={async (payload) => {
            await props.onUpdateDiagnosis?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Drawer Editor Aparatología (Sección C "Cambiar") */}
      {drawer?.kind === "edit-prescription" && t.treatmentPlanId ? (
        <DrawerEditPrescription
          current={{
            treatmentPlanId: t.treatmentPlanId,
            prescriptionSlot: t.appliance.prescriptionSlot,
            bondingType: t.appliance.bonding,
            technique:
              t.appliance.type === "Brackets metálicos auto-ligado"
                ? "SELF_LIGATING_METAL"
                : "METAL_BRACKETS",
            prescriptionNotes: t.appliance.notes,
          }}
          onClose={closeDrawer}
          onConfirm={async (payload) => {
            await props.onUpdateAppliances?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Drawer Nueva Carta Referencia (Sección I) */}
      {drawer?.kind === "new-referral" ? (
        <DrawerNewReferral
          patientName={vm.patient.fullName}
          onClose={closeDrawer}
          onConfirm={async (payload) => {
            await props.onCreateReferralLetter?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Drawer Configurar Régimen Retención (Sección G) */}
      {drawer?.kind === "config-retention" ? (
        <DrawerConfigRetention
          current={
            props.retentionRegimen
              ? {
                  upperRetainer: null,
                  upperDescription: props.retentionRegimen.upperDescription,
                  lowerRetainer: null,
                  lowerDescription: props.retentionRegimen.lowerDescription,
                  fixedLingualPresent:
                    props.retentionRegimen.fixedLingualPresent,
                  fixedLingualGauge:
                    props.retentionRegimen.fixedLingualGauge ?? null,
                  regimenDescription:
                    props.retentionRegimen.regimenDescription,
                  preSurveyEnabled: props.retentionRegimen.preSurveyEnabled,
                }
              : null
          }
          onClose={closeDrawer}
          onConfirm={async (payload) => {
            await props.onUpdateRetentionRegimen?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S6, QUITAR: sin
          botón que abra "Configurar NPS" en SectionPostTreatment.
          DrawerConfigNps se queda en su archivo. */}

      {/* Drawer WhatsApp Chat read-only (sidebar derecha "Abrir chat") */}
      {drawer?.kind === "wa-chat" ? (
        <DrawerWhatsAppChat
          patientName={vm.patient.fullName}
          messages={(props.whatsappLog ?? []).map((m) => ({
            id: m.id,
            direction: m.direction,
            preview: m.preview,
            at: m.at,
            patientName: m.patientName,
          }))}
          onClose={closeDrawer}
        />
      ) : null}

      {/* Ola 1 (ws1-t6) — «Alta del caso»: asistente de alta DENTRO de la
          ficha nueva (reemplaza el puente a la vista antigua S1). */}
      {drawer?.kind === "new-case" && props.onCreateCase ? (
        <DrawerNewCase
          patientId={vm.patient.id}
          patientFullName={vm.patient.fullName}
          existingDiagnosisId={vm.diagnosis?.id ?? null}
          onClose={closeDrawer}
          onConfirm={async (payload) => {
            await props.onCreateCase?.(payload);
            closeDrawer();
          }}
        />
      ) : null}

      {/* Ola 1 (ws1-t6) — A5/A6/A7/A11: configuración del caso ya abierto. */}
      {drawer?.kind === "case-settings" && t.treatmentPlanId && props.onUpdateCaseSettings ? (
        <DrawerCaseSettings
          patientId={vm.patient.id}
          treatmentPlanId={t.treatmentPlanId}
          onClose={closeDrawer}
          onConfirm={async (payload) => {
            await props.onUpdateCaseSettings?.(payload);
            closeDrawer();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A10 — aviso de que falta el consentimiento GENERAL de ortodoncia firmado.
 * El enlace es un `<a>` normal (navegación real de página), no un botón con
 * `router.push`: la pestaña de la ficha (`tab`) solo lee `?tab=` en el
 * montaje inicial (`useState(initialTab)` en patient-detail-client.tsx, sin
 * `useEffect` que la resincronice), así que un push sin recargar no movería
 * la vista de un tab ya montado a "Consentimientos".
 */
function ConsentMissingBanner({ patientId }: { patientId: string }) {
  return (
    <div className={`${orto.aviso} ${orto.avisoAlerta}`} role="status">
      <span className={orto.avisoTexto}>
        <strong>Falta el consentimiento informado firmado.</strong> El caso no tiene un
        consentimiento general de ortodoncia firmado en «Consentimientos».
      </span>
      <a
        href={`/dashboard/patients/${patientId}?tab=consentimientos`}
        className={`${orto.boton} ${orto.botonChico}`}
      >
        Ir a Consentimientos
      </a>
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
    <div className={`${orto.tonoApagado} px-1 text-[11.5px]`}>
      <Sparkles className="w-3 h-3 inline mr-1" aria-hidden />
      Historial de fases: {count} cambio{count === 1 ? "" : "s"} de fase registrado
      {count === 1 ? "" : "s"}.
    </div>
  );
}
