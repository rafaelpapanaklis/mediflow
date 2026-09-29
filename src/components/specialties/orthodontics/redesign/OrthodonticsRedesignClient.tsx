"use client";
// OrthodonticsRedesignClient — shell del rediseño completo del módulo
// Ortodoncia patient-detail. Maneja secciones A-I + drawers/modales y
// despacha callbacks a server actions. Layout 2 cols (main + rail) que se
// monta dentro del shell del patient-detail (que provee la sidebar
// contextual a la izquierda).

import { Shield, Sparkles, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { hojaFirmadaDeHoy } from "@/lib/orthodontics/hoja-de-control-reglas";
import { cargarPanelDeCobro, type PanelDeCobro } from "@/app/actions/orthodontics/cobro/cargarPanelDeCobro";
// ws1-t4: «Cobrar» de la cabecera → ventana completa de la factura del caso.
import { CobrarEnFactura } from "@/components/dashboard/billing/cobrar-en-factura";
import { accionDeCobrarCabecera, cobroPrincipalDelCaso, type CobroPrincipal } from "@/lib/orthodontics/cobro/cobro-principal";
import {
  getTreatmentCardContextForPatient,
} from "@/app/actions/orthodontics/getTreatmentCardContextForPatient";
import type { TreatmentCardAgendaContext } from "@/app/actions/orthodontics/getTreatmentCardContextForAppointment";
import { isFailure } from "@/app/actions/orthodontics/result";
import { useAbrirAltaAlLlegar } from "./useAbrirAltaAlLlegar";
import { SectionHero } from "./sections/SectionHero";
import { SeccionPlegada } from "./SeccionPlegada";
import { seccionesPlegadasPorFase } from "@/lib/orthodontics/redesign/secciones-por-fase";
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
import { DrawerNewCase, type DrawerNewCaseSubmit } from "./drawers/DrawerNewCase";
import { DrawerCaseSettings, type DrawerCaseSettingsPayload } from "./drawers/DrawerCaseSettings";
import { ModalCompare } from "./drawers/ModalCompare";
import {
  MOTIVO_SIN_REPORTE_DE_AVANCE,
  etapaActualParaComparar,
  etapasParaComparar,
  hayReporteDeAvance,
  juegoParaComparar,
  sePuedeComparar,
} from "./fotos-del-caso";
import { PatientHeaderG16, type PatientHeaderProps } from "./PatientHeaderG16";
import layout from "./ortho-redesign-layout.module.css";
import orto from "./orto.module.css";
import { RAIZ_ORTO } from "./raiz";
import { proximaFechaDeVisitaPorDefecto } from "@/lib/orthodontics/redesign/next-card-visit-default";
import { PHASE_LABELS } from "./types";
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
  /** H55: liga una foto que ya está en el expediente a una vista del juego. */
  onElegirFotoExistente?: (stage: PhotoStage, slotId: string, fileId: string) => Promise<string | null | void> | string | null | void;
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
    techniqueLabel: string | null;
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
  onCreateCase?: (payload: DrawerNewCaseSubmit) => Promise<void> | void;
  /** Se llegó desde «Nueva consulta» con el tipo «Ortodoncia»: abrir la hoja de control al entrar. */
  abrirControlAlEntrar?: boolean;
  onControlAbierto?: () => void;
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
  /** H64: pide el asentimiento del menor; devuelve un texto solo si falló. */
  onPedirAsentimiento?: () => Promise<string | null | void> | string | null | void;
  onCreateLabOrder?: (payload: {
    catalog: string;
    description: string;
    lab: string;
    labPartnerId?: string | null;
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
  // «Comparar» fotos: la etapa del lado derecho mientras el modal está abierto
  // (null = cerrado). Los juegos salen de `historicalPhotoSets`, que ya trae
  // las URLs firmadas por vista.
  const [compararCon, setCompararCon] = useState<PhotoStage | null>(null);
  const juegosDeFotos = props.historicalPhotoSets ?? [];
  const cerrarComparar = useCallback(() => setCompararCon(null), []);
  // M6 (ws1-t8, Ronda 6 — hallazgo 6): "Registrar control" desde la ficha
  // resuelve la cita de HOY (si la hay) y "¿ya hay hoja de hoy?" con el
  // MISMO cargador que Agenda (getTreatmentCardContextForPatient, hermano de
  // getTreatmentCardContextForAppointment) — antes abría siempre en blanco,
  // sin ligar nada a la cita del día.
  const [nuevoControlCtx, setNuevoControlCtx] = useState<TreatmentCardAgendaContext | null>(null);
  const closeDrawer = () => {
    setDrawer(null);
    setNuevoControlCtx(null);
  };

  const vm = props.vm;
  const t = vm.treatment;

  // ws1-t9 #9: «Registrar control» tarda (trae la cita de hoy y el contexto): mientras tanto se
  // ve que está cargando y un segundo clic no lanza otra apertura.
  const [abriendoControl, setAbriendoControl] = useState(false);
  const abriendoControlRef = useRef(false);
  // ws1-t9 #17: la hoja de hoy YA firmada. No se ofrece «Registrar control de hoy» otra vez:
  // se dice y se puede ver.
  const hojaDeHoyFirmada = hojaFirmadaDeHoy(vm.treatmentCards);
  const pacienteParaAgendar = { id: vm.patient.id, nombre: vm.patient.fullName, doctorId: null };

  const abrirRegistrarControl = useCallback(async () => {
    if (!t.treatmentPlanId) return;
    if (abriendoControlRef.current) return;
    if (hojaDeHoyFirmada) {
      toast("El control de hoy ya está firmado. Aquí lo puedes ver.", { id: "control-hoy-firmado", duration: 6000 });
      setDrawer({ kind: "tcard", cardId: hojaDeHoyFirmada.id });
      return;
    }
    abriendoControlRef.current = true;
    setAbriendoControl(true);
    try {
    // Mismo criterio que BotonHojaControl.tsx en Agenda: se trae el
    // contexto ANTES de abrir el cajón, para que nazca ya con la cita de
    // hoy ligada (si la hay) y, si ya hay hoja de hoy, continuándola en vez
    // de crear una segunda (hallazgo 7). Si el self-fetch falla, se abre
    // igual con los defaults locales de `newCardDefaults` (sin cita ligada)
    // — degradación, no bloqueo: el control se sigue pudiendo registrar.
    // Si la consulta se cae (red, servidor reiniciando) tampoco se queda sin
    // abrir: mismo degradado que un fallo devuelto por la action.
    const res = await getTreatmentCardContextForPatient(t.treatmentPlanId).catch(() => null);
    setNuevoControlCtx(!res || isFailure(res) ? null : res.data);
    setDrawer({ kind: "tcard-new" });
    } finally {
      abriendoControlRef.current = false;
      setAbriendoControl(false);
    }
  }, [t.treatmentPlanId, hojaDeHoyFirmada]);

  // H17 (QA ws1-t9, ws1-t3): quien llega desde «Abrir caso» del módulo
  // (Pacientes en tratamiento → elegir paciente) trae `?abrirCaso=1`: el
  // asistente de alta se abre solo, sin tener que buscar el botón. El aviso
  // no da ningún permiso (ver `debeAbrirElAlta`), y se quita de la dirección
  // para que recargar o volver atrás no lo abra otra vez.
  // Quien llega desde «Nueva consulta» eligiendo el tipo «Ortodoncia»
  // (Rafael, 28-sep-2026): con un caso activo se abre la hoja de control, la
  // misma de «Registrar control». Sin caso activo no se abre nada: la pestaña
  // ya enseña lo que hay. El aviso se apaga en la ficha en cuanto se atiende.
  const { abrirControlAlEntrar, onControlAbierto } = props;
  // ws1-t9 #17: «Nueva consulta → Ortodoncia» y el botón «Registrar control» de la ficha hacen LO
  // MISMO, con el mismo criterio (antes cada uno tenía el suyo: con un caso «Por colocar» uno abría
  // la hoja y el otro no). El del botón manda: hay caso y no es «no iniciado».
  const casoActivo = Boolean(t.treatmentPlanId) && t.status !== "no-iniciado";
  useEffect(() => {
    if (!abrirControlAlEntrar) return;
    if (casoActivo) void abrirRegistrarControl();
    onControlAbierto?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirControlAlEntrar]);

  // La regla y el porqué, en `useAbrirAltaAlLlegar` (la comparte la vista
  // limpia del paciente que nunca tuvo caso, `OrtodonciaSinCaso`).
  useAbrirAltaAlLlegar({
    tieneCaso: Boolean(t.treatmentPlanId),
    puedeCrear: Boolean(props.onCreateCase),
    abrir: () => setDrawer({ kind: "new-case" }),
  });

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

  // #73: lo VENCIDO de ese saldo (el rojo de la cabecera depende de esto, no del saldo total).
  const overdueAmountReal =
    panelDeCobro && panelDeCobro !== "cargando" && panelDeCobro !== "error" && panelDeCobro.cobranza
      ? Math.round(panelDeCobro.cobranza.vencidas.reduce((acc, q) => acc + q.falta, 0) * 100) / 100
      : null;

  // ws1-t4 (revisión panel.108, fallo 3): «Cobrar» de la cabecera abría solo la
  // pestaña Facturación. Ahora abre la ventana completa de la factura del caso
  // con «Registrar pago» abierto — la MISMA factura y el MISMO monto que
  // «Cobrar · $X» de la Sección F (cobro-principal.ts). Sin permiso de cobro,
  // no hay botón. Segunda pasada (fallo A): un clic mientras el cobro del caso
  // aún carga (o si falló) ya NO cae en Facturación: el botón dice «Cargando
  // cobro…», se espera (o se reintenta) y la ventana se abre sola al llegar.
  // Solo si el caso no tiene factura que cobrar va a Facturación, donde se crea.
  const panelListo = panelDeCobro && panelDeCobro !== "cargando" && panelDeCobro !== "error" ? panelDeCobro : null;
  const cobroDeCabecera = panelListo?.puedeCobrar ? cobroPrincipalDelCaso(panelListo) : null;
  const [cobrandoDesdeCabecera, setCobrandoDesdeCabecera] = useState<
    (CobroPrincipal & { rediseno: boolean; clinicTaxMode: string | null }) | null
  >(null);
  // El clic que espera a que llegue el cobro, y la ventana que ya se pidió pero
  // aún trae su factura: mientras tanto el botón está «cargando».
  const [cobroPendiente, setCobroPendiente] = useState(false);
  const [abriendoVentanaDeCobro, setAbriendoVentanaDeCobro] = useState(false);
  const irAFacturacion = props.patientHeader?.onCollect;
  const abrirCobroDeCabecera = useCallback(() => {
    if (!panelListo || !cobroDeCabecera) return;
    setAbriendoVentanaDeCobro(true);
    setCobrandoDesdeCabecera({ ...cobroDeCabecera, rediseno: panelListo.redisenoFacturas, clinicTaxMode: panelListo.clinicTaxMode });
  }, [panelListo, cobroDeCabecera]);
  const accionCobrar = accionDeCobrarCabecera(panelListo ?? (panelDeCobro === "cargando" || panelDeCobro === "error" ? panelDeCobro : null), cobroDeCabecera !== null);
  const pulsarCobrarCabecera = () => {
    if (accionCobrar === "abrir") abrirCobroDeCabecera();
    else if (accionCobrar === "esperar") setCobroPendiente(true);
    else if (accionCobrar === "reintentar") { setCobroPendiente(true); recargarPanelDeCobro(); }
    else if (accionCobrar === "facturacion") irAFacturacion?.();
  };
  // Llegó (o volvió a fallar) el cobro que esperaba un clic: se resuelve UNA vez.
  useEffect(() => {
    if (!cobroPendiente || panelDeCobro === "cargando") return;
    setCobroPendiente(false);
    if (accionCobrar === "abrir") abrirCobroDeCabecera();
    else if (accionCobrar === "facturacion") irAFacturacion?.();
    else if (accionCobrar === "reintentar") toast.error("No se pudo cargar el cobro del caso. Vuelve a pulsar «Cobrar».");
    // "oculto": sin permiso, el botón desaparece y no se abre nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobroPendiente, panelDeCobro]);
  const onCollectCabecera = !irAFacturacion || accionCobrar === "oculto" ? undefined : pulsarCobrarCabecera;

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
  // Fila 26 (ws1-t4 ronda 6): lo que no toca por fase va plegado.
  const plegadas = seccionesPlegadasPorFase({
    estado: tStatus,
    hayRetencionCapturada:
      props.retentionRegimen != null || (props.retainerCheckups?.length ?? 0) > 0,
  });

  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`}>
      {props.patientHeader ? (
        <PatientHeaderG16
          patient={props.patientHeader.patient}
          patientFlow={props.patientHeader.patientFlow ?? vm.patientFlow}
          nextAppointment={props.patientHeader.nextAppointment ?? vm.nextAppointment}
          outstandingAmount={outstandingAmountReal}
          overdueAmount={overdueAmountReal}
          lastVisitAt={props.patientHeader.lastVisitAt}
          totalVisits={props.patientHeader.totalVisits}
          onStartVisit={props.patientHeader.onStartVisit}
          onScheduleNext={props.patientHeader.onScheduleNext}
          onCollect={onCollectCabecera}
          collectCargando={cobroPendiente || abriendoVentanaDeCobro}
          onMore={props.patientHeader.onMore}
          // Registrar el control es lo que se hace veinte veces al día: va
          // arriba, a la vista, y manda sobre los demás botones. Mismo
          // cajón que abría «Nueva cita» en el resumen.
          onStartControl={
            t.status !== "no-iniciado" ? abrirRegistrarControl : undefined
          }
          controlIsToday={isToday(vm.nextAppointment?.date)}
          controlCargando={abriendoControl}
          controlFirmadoHoy={Boolean(hojaDeHoyFirmada)}
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
            cards={vm.treatmentCards}
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
              props.patientHeader ? undefined : abrirRegistrarControl
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
              t.status !== "no-iniciado" ? abrirRegistrarControl : undefined
            }
            controlFirmadoHoy={Boolean(hojaDeHoyFirmada)}
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
            // H51: sin plan activo estos formularios solo fallan al guardar.
            onAddWireStep={
              t.treatmentPlanId
                ? (props.onAddWireStep ?? (() => setDrawer({ kind: "wirestep" })))
                : undefined
            }
            onAddTad={
              t.treatmentPlanId
                ? (props.onAddTad ?? (() => setDrawer({ kind: "add-tad" })))
                : undefined
            }
          />

          {/* «Comparar» (S12) vuelve: el loader ya trae la URL firmada de
              cada vista (`slots`), así que ModalCompare pinta las fotos de
              verdad. El botón solo sale con fotos en el inicial y en al
              menos una etapa posterior (fotos-del-caso.ts). */}
          <SectionPhotos
            monthCurrent={t.monthCurrent}
            monthTotal={t.monthTotal}
            historicalSets={juegosDeFotos}
            onCompare={
              sePuedeComparar(juegosDeFotos)
                ? () => setCompararCon(etapaActualParaComparar(juegosDeFotos))
                : undefined
            }
            onUpload={props.onUploadPhoto}
            patientId={vm.patient.id}
            onElegirExistente={props.onElegirFotoExistente}
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

          <SeccionPlegada
            plegada={plegadas.retencion}
            id="retention"
            icon={<Shield size={15} strokeWidth={1.75} />}
            title="Retención"
            cuando="Empieza al retirar los brackets"
          >
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
          </SeccionPlegada>

          {/* Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S6, QUITAR: NPS
              (se programa pero nadie lo envía) y códigos de referidos (solo
              con datos de ejemplo) sin sus botones. El PDF comparativo
              (onGeneratePdf) SÍ se queda — S12 lo saca explícitamente del
              QUITAR ("el PDF comparativo se queda"), es distinto del
              comparador de fotos roto que sí se oculta más abajo. */}
          <SeccionPlegada
            plegada={plegadas.postratamiento}
            id="post"
            icon={<Star size={15} strokeWidth={1.75} />}
            title="Post-tratamiento"
            cuando="Al terminar el tratamiento"
          >
            <SectionPostTreatment
              treatmentStatus={tStatus}
              npsSchedules={props.npsSchedules ?? []}
              referralCode={props.referralCode ?? null}
              onGeneratePdf={props.onGeneratePdfBeforeAfter}
            />
          </SeccionPlegada>

          <SectionDocs
            labOrders={props.labOrders ?? []}
            consents={props.consents ?? []}
            referralLetters={props.referralLetters ?? []}
            whatsappLog={props.whatsappLog ?? []}
            onNewLabOrder={t.treatmentPlanId ? () => setDrawer({ kind: "laborder" }) : undefined}
            onNewReferral={
              props.onCreateReferralLetter
                ? () => setDrawer({ kind: "new-referral" })
                : undefined
            }
            treatmentPlanId={t.treatmentPlanId || null}
            onPedirAsentimiento={props.onPedirAsentimiento}
            cartaDeAltaDisponible={t.status === "retencion" || t.status === "completado"}
            motivoSinReporteDeAvance={
              hayReporteDeAvance(juegosDeFotos) ? null : MOTIVO_SIN_REPORTE_DE_AVANCE
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

      {cobrandoDesdeCabecera ? (
        <CobrarEnFactura
          invoiceId={cobrandoDesdeCabecera.invoiceId}
          montoSugerido={cobrandoDesdeCabecera.montoSugerido}
          rediseno={cobrandoDesdeCabecera.rediseno}
          clinicTaxMode={cobrandoDesdeCabecera.clinicTaxMode}
          onClose={() => { setCobrandoDesdeCabecera(null); setAbriendoVentanaDeCobro(false); }}
          onRefrescar={recargarPanelDeCobro}
          onLista={() => setAbriendoVentanaDeCobro(false)}
        />
      ) : null}

      {compararCon ? (
        <ModalCompare
          key={compararCon}
          setT0={juegoParaComparar(juegosDeFotos, "T0")}
          setRight={juegoParaComparar(juegosDeFotos, compararCon)}
          availableRightStages={etapasParaComparar(juegosDeFotos)}
          onSelectRight={setCompararCon}
          onGeneratePdf={props.onGenerateComparePdf ?? props.onGeneratePdfBeforeAfter}
          onClose={cerrarComparar}
        />
      ) : null}

      {/* Drawer Treatment Card existente */}
      {drawer?.kind === "tcard" && cardForDrawer ? (
        <DrawerTreatmentCard
          paciente={pacienteParaAgendar}
          key={cardForDrawer.id}
          card={cardForDrawer}
          availableWires={vm.wireSequence}
          treatmentPlanId={t.treatmentPlanId || undefined}
          onClose={closeDrawer}
          onSave={props.onCardDraftSaved}
          onSign={props.onCardSigned}
        />
      ) : null}

      {/* Drawer nueva cita. M6 (Ronda 6): si `nuevoControlCtx` trajo una
          hoja de HOY (ligada a esta cita, a otra, o sin cita — hallazgo 7),
          se CONTINÚA esa en vez de abrir una en blanco. Sin contexto (falló
          el self-fetch), cae a `newCardDefaults` — mismo comportamiento que
          antes de esta ronda. */}
      {drawer?.kind === "tcard-new" && nuevoControlCtx?.existingCard ? (
        <DrawerTreatmentCard
          paciente={pacienteParaAgendar}
          key={nuevoControlCtx.existingCard.id}
          card={nuevoControlCtx.existingCard}
          appointmentId={nuevoControlCtx.appointmentId}
          availableWires={nuevoControlCtx.availableWires}
          treatmentPlanId={t.treatmentPlanId || undefined}
          availablePhotoSets={nuevoControlCtx.availablePhotoSets}
          onClose={closeDrawer}
          onSave={props.onCardDraftSaved}
          onSign={props.onCardSigned}
        />
      ) : drawer?.kind === "tcard-new" && nuevoControlCtx ? (
        <DrawerTreatmentCard
          paciente={pacienteParaAgendar}
          key="new-card-con-cita"
          card={null}
          appointmentId={nuevoControlCtx.appointmentId}
          defaultsForNew={{
            cardNumber: nuevoControlCtx.defaultsForNew.cardNumber,
            phase: PHASE_LABELS[nuevoControlCtx.defaultsForNew.phase],
            monthAt: nuevoControlCtx.defaultsForNew.monthAt,
            wireFrom: nuevoControlCtx.defaultsForNew.wireFrom,
            visitDate: nuevoControlCtx.defaultsForNew.visitDate,
            monthTotal: t.monthTotal > 0 ? t.monthTotal : null,
            lastElastics: nuevoControlCtx.defaultsForNew.lastElastics,
            lastIndications: nuevoControlCtx.defaultsForNew.lastIndications,
            // Fila 12: la hoja nueva también hereda los brackets pendientes y
            // la nota precargada del control anterior.
            lastPendingBrackets: nuevoControlCtx.defaultsForNew.lastPendingBrackets,
            proximoControlMin: nuevoControlCtx.defaultsForNew.proximoControlMin,
            soapPrefill: nuevoControlCtx.defaultsForNew.soapPrefill,
          }}
          availableWires={nuevoControlCtx.availableWires}
          treatmentPlanId={t.treatmentPlanId || undefined}
          availablePhotoSets={nuevoControlCtx.availablePhotoSets}
          onClose={closeDrawer}
          onSave={props.onCardDraftSaved}
          onSign={props.onCardSigned}
        />
      ) : drawer?.kind === "tcard-new" && !nuevoControlCtx && newCardDefaults ? (
        <DrawerTreatmentCard
          paciente={pacienteParaAgendar}
          key="new-card"
          card={null}
          defaultsForNew={{
            cardNumber: newCardDefaults.cardNumber,
            phase: newCardDefaults.phase,
            monthAt: newCardDefaults.monthAt,
            wireFrom: newCardDefaults.wireFrom,
            visitDate: newCardDefaults.visitDate,
            monthTotal: t.monthTotal > 0 ? t.monthTotal : null,
          }}
          availableWires={vm.wireSequence}
          treatmentPlanId={t.treatmentPlanId || undefined}
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
          aparatologia={t.appliance.type}
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
              t.appliance.technique ??
              (t.appliance.type === "Brackets metálicos auto-ligado" ? "SELF_LIGATING_METAL" : "METAL_BRACKETS"),
            techniqueLabel: t.appliance.techniqueLabel ?? null,
            techniqueName: t.appliance.type,
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
