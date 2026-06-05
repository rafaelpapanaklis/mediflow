"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { useT } from "@/i18n/i18n-provider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Phone, Mail, Calendar, AlertTriangle, Plus, Printer, Edit, Download, Pill, HeartPulse, Play, Trash2, XCircle } from "lucide-react";
import { formatCurrency, formatDate, getInitials, avatarColor } from "@/lib/utils";
import { ageFromDob, fmtMXN } from "@/lib/format";
import { Odontogram } from "@/components/dashboard/odontogram/Odontogram";
import { HeroCard } from "@/components/dashboard/patient-detail/hero-card";
import { TreatmentsModal, type SuggestedTreatment } from "@/components/dashboard/patient-detail/treatments-modal";
import { QuickNav } from "@/components/dashboard/patient-detail/quick-nav";
import { SideCards } from "@/components/dashboard/patient-detail/side-cards";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { ConsultBar } from "@/components/dashboard/patient-detail/consult-bar";
import { SoapEditorInline, type SoapDraft } from "@/components/dashboard/patient-detail/soap-editor-inline";
import { NoteDetailModal, type ClinicalNote } from "@/components/dashboard/patient-detail/note-detail-modal";
import { InvoiceDetailModal } from "@/components/dashboard/billing/invoice-detail-modal";
import { HistoriaTimeline } from "@/components/dashboard/patient-detail/historia-timeline";
import patientDetailStyles from "@/components/dashboard/patient-detail/patient-detail.module.css";
import { DentalForm }          from "@/components/clinical/dental-form";
import { NutritionForm }       from "@/components/clinical/nutrition-form";
import { PsychologyForm }      from "@/components/clinical/psychology-form";
import { GeneralMedicineForm } from "@/components/clinical/medicine-form";
import { EvolutionChart, TreatmentTimeline } from "@/components/clinical/shared";
import { ReferralsTab } from "@/components/dashboard/patients/referrals-tab";
import { Models3DTab } from "@/components/patient-3d/Models3DTab";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import dynamicImport from "next/dynamic";
import type { PediatricsTabData } from "@/components/patient-detail/pediatrics/PediatricsTab";
import { buildPediatricSoapPrefill } from "@/lib/pediatrics/soap-prefill";
import {
  derivePediatricsTabState,
  PEDIATRICS_DISABLED_REASON,
} from "@/lib/pediatrics/tab-state";
import type { PerioTabData } from "@/lib/periodontics/load-data";
import type { SoapPrefill, EndoToothSummary } from "@/lib/types/endodontics";
import type { ImplantFull } from "@/lib/types/implants";
import type { OrthoTabData } from "@/lib/orthodontics/load-data";
import type { OrthoRedesignViewModel } from "@/components/specialties/orthodontics/redesign/types";
import type { OrthoRedesignBundle } from "@/lib/orthodontics/redesign/loader";
import type { PatientActivityCounts } from "@/lib/clinical-shared/get-patient-activity-counts";
import { buildEmptySuggestion } from "@/lib/patient-detail/empty-suggestion";
import {
  signTreatmentCard,
  saveTreatmentCardDraft,
  createOrthoTAD,
  addWireStep,
  advanceTreatmentPhase,
  selectQuoteScenario,
  sendSignAtHomeLink,
  confirmCollect,
  createOrthoLabOrder,
  toggleRetentionPreSurvey,
  createPhotoSet,
  uploadPhotoToSet,
  updateFinancialPlan,
  updateDiagnosis,
  updateOrthoAppliances,
  createReferralLetter,
  updateRetentionRegimenConfig,
  updateNpsConfig,
  scheduleG15Checkpoint,
  updateQuoteScenario,
} from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";

// Mapeo slotId del SectionPhotos → OrthoPhotoView del API. Solo las 8 vistas
// AAO persistibles tienen mapeo; sobremordida y resalte (extra-AAO) no
// tienen columna en OrthoPhotoSet y se documentan como Fase 2.
const SLOT_TO_VIEW: Record<
  string,
  | "EXTRA_FRONTAL"
  | "EXTRA_PROFILE"
  | "EXTRA_SMILE"
  | "INTRA_FRONTAL_OCCLUSION"
  | "INTRA_LATERAL_RIGHT"
  | "INTRA_LATERAL_LEFT"
  | "INTRA_OCCLUSAL_UPPER"
  | "INTRA_OCCLUSAL_LOWER"
> = {
  normal: "EXTRA_FRONTAL",
  lateral: "EXTRA_PROFILE",
  sonrisa: "EXTRA_SMILE",
  frontal: "INTRA_FRONTAL_OCCLUSION",
  lat_der: "INTRA_LATERAL_RIGHT",
  lat_izq: "INTRA_LATERAL_LEFT",
  oclusal_sup: "INTRA_OCCLUSAL_UPPER",
  oclusal_inf: "INTRA_OCCLUSAL_LOWER",
};

// Fallback de carga de los módulos lazy (pestañas de especialidad). Componente
// cliente para poder traducir el texto con useT — el `loading` de dynamicImport
// se renderiza dentro del árbol que ya tiene el I18nProvider.
function ModuleLoading({ labelKey }: { labelKey: string }) {
  const t = useT();
  return <div className="text-xs text-muted-foreground p-4">{t(labelKey)}</div>;
}

// Pediatrics — lazy load del módulo. Solo carga el bundle cuando el doctor
// abre la pestaña, evitando inflar el bundle del paciente cuando no aplica.
const PediatricsTab = dynamicImport(
  () => import("@/components/patient-detail/pediatrics/PediatricsTab").then((m) => ({ default: m.PediatricsTab })),
  { ssr: false, loading: () => <ModuleLoading labelKey="moduleLoading.pediatrics" /> },
);

// Periodontics — lazy load del módulo. El bundle del periodontograma 6×32
// solo carga cuando el doctor abre la pestaña.
const PeriodonticsPatientTab = dynamicImport(
  () =>
    import("@/components/specialties/periodontics/PeriodonticsPatientTab").then((m) => ({
      default: m.PeriodonticsPatientTab,
    })),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.periodontics" />
    ),
  },
);

// Endodontics — lazy load. El bundle del odontograma de 32 dientes + drawers
// solo carga cuando el doctor abre la pestaña.
const EndodonticsTab = dynamicImport(
  () =>
    import("@/components/specialties/endodontics/EndodonticsTab").then((m) => ({
      default: m.EndodonticsTab,
    })),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.endodontics" />
    ),
  },
);

// Implants — lazy load. El bundle de los wizards de cirugía/prótesis +
// drawers solo carga cuando el doctor abre la pestaña.
const ImplantsTab = dynamicImport(
  () =>
    import("@/components/specialties/implants/ImplantsTab").then((m) => ({
      default: m.ImplantsTab,
    })),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.implants" />
    ),
  },
);

// Orthodontics — lazy load. Fase 1 rediseño usa OrthodonticsRedesignClient
// (Hero + Diagnóstico + Plan + Treatment Card G1 + drawers + sidebar derecha).
// Fallback al cliente legacy `OrthodonticsClient` cuando no hay viewModel.
const OrthodonticsRedesignClient = dynamicImport(
  () =>
    import("@/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient").then(
      (m) => ({ default: m.OrthodonticsRedesignClient }),
    ),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.orthodontics" />
    ),
  },
);

const OrthodonticsClient = dynamicImport(
  () =>
    import("@/components/specialties/orthodontics/OrthodonticsClient").then((m) => ({
      default: m.OrthodonticsClient,
    })),
  {
    ssr: false,
    loading: () => (
      <ModuleLoading labelKey="moduleLoading.orthodonticsLegacy" />
    ),
  },
);

// resolveFileUrl es función — no se puede pasar de server a client. Como
// patient-detail-client.tsx ya es "use client" la definimos aquí mismo,
// igual al patrón de /dashboard/patients/[id]/orthodontics/page.tsx.
function resolveOrthoFileUrl(fileId: string): string {
  return `/api/patient-files/${fileId}`;
}

// MediFlow es DENTAL — el form de "Nueva consulta" siempre usa DentalForm.
// El parámetro `specialty` viene del Clinic.specialty (legacy) y se ignora.
// Si en el futuro MediFlow expande a otras specialties, restaurar la
// lógica de detección y los renders condicionales abajo.
function detectSpecialty(_raw: string) {
  return "dental";
}

const APPT_STATUS: Record<string, { labelKey: string; cls: string }> = {
  PENDING:   { labelKey: "patients.apptStatus.pending",   cls: "bg-amber-50 text-amber-700 border border-amber-200"      },
  CONFIRMED: { labelKey: "patients.apptStatus.confirmed", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  COMPLETED: { labelKey: "patients.apptStatus.completed", cls: "bg-muted text-muted-foreground border border-border"      },
  CANCELLED: { labelKey: "patients.apptStatus.cancelled", cls: "bg-rose-50 text-rose-700 border border-rose-200"          },
  NO_SHOW:   { labelKey: "patients.apptStatus.noShow",    cls: "bg-muted text-muted-foreground border border-border"       },
};

const INV_STATUS: Record<string, { labelKey: string; cls: string }> = {
  PENDING: { labelKey: "patients.invStatus.pending", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  PARTIAL: { labelKey: "patients.invStatus.partial", cls: "bg-blue-50 text-blue-700 border border-blue-200"   },
  PAID:    { labelKey: "patients.invStatus.paid",    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  OVERDUE: { labelKey: "patients.invStatus.overdue", cls: "bg-rose-50 text-rose-700 border border-rose-200"   },
};

const TABS_BASE = [
  { id: "resumen",       labelKey: "patients.tabs.resumen"            },
  { id: "historia",      labelKey: "patients.tabs.historia"           },
  { id: "odontograma",   labelKey: "patients.tabs.odontograma"        },
  { id: "expediente",    labelKey: "patients.tabs.expediente"         },
  { id: "historial-consultas", labelKey: "patients.tabs.historialConsultas" },
  { id: "evolucion",     labelKey: "patients.tabs.evolucion"          },
  { id: "radiografias",  labelKey: "patients.tabs.radiografias"       },
  { id: "modelos-3d",    labelKey: "patients.tabs.modelos3d"          },
  { id: "tratamiento",   labelKey: "patients.tabs.tratamiento"        },
  { id: "referencias",   labelKey: "patients.tabs.referencias"        },
  { id: "agenda",        labelKey: "patients.tabs.agenda"             },
  { id: "facturacion",   labelKey: "patients.tabs.facturacion"        },
];

interface PatientTab {
  id: string;
  labelKey: string;
  /** Tab visible pero deshabilitado: no responde click, sirve de feedback. */
  disabled?: boolean;
  /** Tooltip mostrado en `title` cuando `disabled=true`. */
  disabledReason?: string;
}

function buildTabs(opts: {
  /** Tab Pediatría con tres estados — ver `derivePediatricsTabState`. */
  pediatrics: { state: "enabled" | "disabled" | "hidden"; reason?: string };
  /** Periodoncia hoy solo enabled/hidden — no tiene gate clínico extra. */
  showPeriodontics: boolean;
  /** Endodoncia — enabled cuando el módulo está activo en la clínica
   *  (el componente maneja el caso de paciente sin tratamientos endo). */
  showEndodontics: boolean;
  /** Implantes — enabled cuando el módulo está activo. Sin gate de edad. */
  showImplants: boolean;
  /** Ortodoncia — enabled cuando el módulo está activo. Sin gate de edad. */
  showOrthodontics: boolean;
}): PatientTab[] {
  const out: PatientTab[] = [...TABS_BASE];
  // Insertar "Pediatría" entre "Historia clínica" y "Odontograma" según spec §1.2.
  if (opts.pediatrics.state !== "hidden") {
    out.splice(2, 0, {
      id:             "pediatria",
      labelKey:       "patients.tabs.pediatria",
      disabled:       opts.pediatrics.state === "disabled",
      disabledReason: opts.pediatrics.state === "disabled" ? opts.pediatrics.reason : undefined,
    });
  }
  // Insertar las especialidades dentales justo antes de "Odontograma".
  // Cada splice usa odontoIdx fresco, así el orden de inserción se preserva:
  // periodoncia → endodoncia → implantes → ortodoncia.
  const insertBeforeOdonto = (tab: PatientTab) => {
    const odontoIdx = out.findIndex((t) => t.id === "odontograma");
    out.splice(odontoIdx >= 0 ? odontoIdx : 2, 0, tab);
  };
  if (opts.showPeriodontics)  insertBeforeOdonto({ id: "periodoncia", labelKey: "patients.tabs.periodoncia" });
  if (opts.showEndodontics)   insertBeforeOdonto({ id: "endodoncia",  labelKey: "patients.tabs.endodoncia"  });
  if (opts.showImplants)      insertBeforeOdonto({ id: "implantes",   labelKey: "patients.tabs.implantes"   });
  if (opts.showOrthodontics)  insertBeforeOdonto({ id: "ortodoncia",  labelKey: "patients.tabs.ortodoncia"  });
  return out;
}

const SEV_STYLES: Record<string, { bg: string; text: string; labelKey: string }> = {
  alta:        { bg: "bg-rose-50 border-rose-200",    text: "text-rose-700",    labelKey: "patients.severity.alta"        },
  media:       { bg: "bg-amber-50 border-amber-200",  text: "text-amber-700",   labelKey: "patients.severity.media"       },
  baja:        { bg: "bg-blue-50 border-blue-200",    text: "text-blue-700",    labelKey: "patients.severity.baja"        },
  informativo: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", labelKey: "patients.severity.informativo" },
};

const FILE_CAT_LABELS: Record<string, string> = {
  XRAY_PERIAPICAL: "patients.fileCat.periapical", XRAY_PANORAMIC: "patients.fileCat.panoramic", XRAY_BITEWING: "patients.fileCat.bitewing",
  XRAY_OCCLUSAL: "patients.fileCat.occlusal", PHOTO_INTRAORAL: "patients.fileCat.intraoral", PHOTO_EXTRAORAL: "patients.fileCat.extraoral",
  PHOTO_PROGRESS: "patients.fileCat.progress", CONSENT_FORM: "patients.fileCat.consent", OTHER: "patients.fileCat.other",
};

interface Props {
  patient:      any;
  records:      any[];
  appointments: any[];
  invoices:     any[];
  doctors:      { id: string; firstName: string; lastName: string }[];
  /** El doctor logueado. cedulaProfesional es necesaria para el carnet
   *  de implantes (NOM-024 — firma legal del responsable de la cirugía). */
  currentUser:  { id: string; firstName: string; lastName: string; cedulaProfesional?: string | null };
  specialty:    string;
  treatments:   any[];
  portalUrl?:   string | null;
  pediatricsData?: PediatricsTabData | null;
  /**
   * True si la clínica tiene el módulo Odontopediatría activo (o trial
   * vigente). Se usa para mostrar el tab en estado disabled cuando
   * `pediatricsData` viene null porque el paciente actual no califica
   * (adulto / sin DOB) en lugar de ocultar el tab por completo.
   */
  pediatricsModuleActive?: boolean;
  perioData?: PerioTabData | null;
  /**
   * Resúmenes de los 32 dientes para el tab de Endodoncia. `null` cuando
   * la clínica no tiene el módulo activo o no es DENTAL — el tab no se
   * renderiza. Array vacío cuando el módulo está activo pero el paciente
   * no tiene tratamientos: el tab se muestra con su propio empty state.
   */
  endoSummaries?: EndoToothSummary[] | null;
  endoSoapPrefill?: SoapPrefill | null;
  /**
   * Lista de implantes del paciente con todas sus relaciones para el tab
   * Implantes. `null` cuando la clínica no tiene el módulo activo o no
   * es DENTAL — el tab no se renderiza. Array vacío cuando módulo activo
   * pero el paciente aún no tiene implantes colocados.
   */
  implants?: ImplantFull[] | null;
  /**
   * Datos del paciente para el tab Ortodoncia. `null` cuando la clínica
   * no tiene el módulo activo o no es DENTAL — el tab no se renderiza.
   * Cuando el paciente no tiene diagnóstico/plan, el componente muestra
   * el wizard de inicio.
   */
  orthoData?: OrthoTabData | null;
  /**
   * ViewModel del rediseño Fase 1 ortodoncia patient-detail. Cuando viene
   * presente, se renderiza el shell nuevo (Hero+Diagnóstico+Plan+G1) en el
   * tab "ortodoncia". Si es null, fallback al cliente legacy.
   */
  orthoRedesignVM?: OrthoRedesignViewModel | null;
  /**
   * Datos extra del rediseño Fase 1.5 (secciones E-I) — installments,
   * quoteScenarios, retentionRegimen, retainerCheckups, npsSchedules,
   * referralCode, consents, labOrders, referralLetters, whatsappLog +
   * treatmentStatus derivado. Cuando viene null se usa todo en empty state.
   */
  orthoRedesignBundle?: OrthoRedesignBundle | null;
  /**
   * Conteos por módulo del paciente actual. Se usan en el quick-nav para
   * atenuar ítems de especialidades sin actividad. El módulo permanece
   * visible (el clinic lo tiene activo) y clickable; la atenuación
   * comunica "todavía sin registros".
   */
  activityCounts?: PatientActivityCounts;
}

export function PatientDetailClient({
  patient, records: initialRecords, appointments, invoices: initialInvoices,
  doctors, currentUser, specialty, treatments, portalUrl,
  pediatricsData,
  pediatricsModuleActive = false,
  perioData,
  endoSummaries,
  endoSoapPrefill,
  implants,
  orthoData,
  orthoRedesignVM,
  orthoRedesignBundle,
  activityCounts,
}: Props) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { open: openNewAppointment } = useNewAppointmentDialog();
  const pediatricsState = derivePediatricsTabState({
    hasData:      Boolean(pediatricsData),
    moduleActive: pediatricsModuleActive,
  });
  const showPediatrics = pediatricsState === "enabled";
  const showPeriodontics = Boolean(perioData);
  const showEndodontics  = endoSummaries !== null && endoSummaries !== undefined;
  const showImplants     = implants !== null && implants !== undefined;
  const showOrthodontics = orthoData !== null && orthoData !== undefined;
  const tabs = useMemo(
    () => buildTabs({
      pediatrics:      { state: pediatricsState, reason: PEDIATRICS_DISABLED_REASON },
      showPeriodontics,
      showEndodontics,
      showImplants,
      showOrthodontics,
    }),
    [pediatricsState, showPeriodontics, showEndodontics, showImplants, showOrthodontics],
  );
  const tabFromUrl = searchParams.get("tab");
  const initialTab =
    tabFromUrl === "pediatria" && showPediatrics
      ? "pediatria"
      : tabFromUrl === "periodoncia" && showPeriodontics
        ? "periodoncia"
        : tabFromUrl === "endodoncia" && showEndodontics
          ? "endodoncia"
          : tabFromUrl === "implantes" && showImplants
            ? "implantes"
            : tabFromUrl === "ortodoncia" && showOrthodontics
              ? "ortodoncia"
              : "resumen";
  const [tab, setTab]         = useState(initialTab);
  const [consultPaused, setConsultPaused] = useState(false);
  const [consultClosed, setConsultClosed] = useState(false);
  const [noteDetailOpen, setNoteDetailOpen] = useState<ClinicalNote | null>(null);
  const [expandedConsultas, setExpandedConsultas] = useState<Set<string>>(new Set());

  function toggleConsulta(id: string) {
    setExpandedConsultas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState<any | null>(null);
  const [invoices, setInvoices] = useState(initialInvoices);
  useEffect(() => {
    setInvoices(initialInvoices);
  }, [initialInvoices]);
  // Sincroniza el snapshot del modal con la versión fresca de invoices tras
  // router.refresh(). Sin esto, el InvoiceDetailModal queda con un invoice
  // stale (ej. status=DRAFT cuando el server ya pasó a PENDING/PAID),
  // rompiendo el PaymentModal interno y el cálculo de balance.
  useEffect(() => {
    if (!invoiceDetailOpen) return;
    const fresh = (invoices as any[]).find((i: any) => i.id === invoiceDetailOpen.id);
    if (fresh && (fresh.status !== invoiceDetailOpen.status || fresh.paid !== invoiceDetailOpen.paid || fresh.balance !== invoiceDetailOpen.balance)) {
      setInvoiceDetailOpen(fresh);
    }
  }, [invoices]);
  // Shortcut: cuando el usuario hace click en "Cobrar" desde HeroCard /
  // SideCards, abrir directo el InvoiceDetailModal con la factura más
  // relevante (DRAFT > PENDING/PARTIAL/OVERDUE). Si no hay ninguna
  // procesable, fallback al tab Facturación para que pueda crear una.
  const openChargeShortcut = () => {
    const draft = invoices.find((inv: any) => inv.status === "DRAFT");
    const pendingLike = invoices.find((inv: any) =>
      inv.status === "PENDING" || inv.status === "PARTIAL" || inv.status === "OVERDUE",
    );
    const target = draft ?? pendingLike;
    if (target) setInvoiceDetailOpen(target);
    else setTab("facturacion");
  };

  async function handleDeleteRecord(record: { id: string; specialtyData?: any }) {
    const status = record.specialtyData?.status ?? "DRAFT";
    if (status === "SIGNED") {
      toast.error(t("patients.deleteRecord.signedError"));
      return;
    }
    if (!window.confirm(t("patients.deleteRecord.confirm"))) return;
    try {
      const res = await fetch(`/api/clinical-notes/${record.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("patients.deleteRecord.failed"));
      }
      toast.success(t("patients.deleteRecord.success"));
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
    } catch (err: any) {
      toast.error(err.message ?? t("patients.toast.deleteError"));
    }
  }

  async function handleCancelAppointment(appt: { id: string; date: any }) {
    if (!window.confirm(t("patients.cancelAppt.confirm", { date: formatDate(appt.date) }))) return;
    try {
      const res = await fetch(`/api/appointments/${appt.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("patients.cancelAppt.failed"));
      }
      toast.success(t("patients.cancelAppt.success"));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? t("patients.cancelAppt.error"));
    }
  }

  async function handleDeleteFile(file: { id: string; name: string }) {
    if (!window.confirm(t("patients.deleteFile.confirm", { name: file.name }))) return;
    try {
      const res = await fetch(`/api/xrays/${file.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("patients.deleteFile.failed"));
      }
      toast.success(t("patients.deleteFile.success"));
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err: any) {
      toast.error(err.message ?? t("patients.toast.deleteError"));
    }
  }

  async function handleDeleteTreatment(plan: { id: string; name: string }) {
    if (!window.confirm(t("patients.deleteTreatment.confirm", { name: plan.name }))) return;
    try {
      const res = await fetch(`/api/treatments/${plan.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("patients.deleteTreatment.failed"));
      }
      toast.success(t("patients.deleteTreatment.success"));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? t("patients.toast.deleteError"));
    }
  }

  const [showNewTreatment, setShowNewTreatment] = useState(false);
  const [savingTreatment, setSavingTreatment] = useState(false);
  const [treatmentForm, setTreatmentForm] = useState({
    doctorId: "",
    name: "",
    description: "",
    totalSessions: "6",
    sessionIntervalDays: "30",
    totalCost: "",
  });
  useEffect(() => {
    if (showNewTreatment) {
      setTreatmentForm({
        doctorId: doctors?.[0]?.id ?? "",
        name: "",
        description: "",
        totalSessions: "6",
        sessionIntervalDays: "30",
        totalCost: "",
      });
    }
  }, [showNewTreatment, doctors]);

  const [viewPlan, setViewPlan] = useState<any | null>(null);
  const [editPlan, setEditPlan] = useState<any | null>(null);
  const [editPlanForm, setEditPlanForm] = useState({ name:"", description:"", totalSessions:"6", sessionIntervalDays:"30", totalCost:"", status:"ACTIVE" });
  const [savingEditPlan, setSavingEditPlan] = useState(false);
  useEffect(() => {
    if (editPlan) setEditPlanForm({
      name: editPlan.name ?? "",
      description: editPlan.description ?? "",
      totalSessions: String(editPlan.totalSessions ?? 6),
      sessionIntervalDays: String(editPlan.sessionIntervalDays ?? 30),
      totalCost: String(editPlan.totalCost ?? 0),
      status: editPlan.status ?? "ACTIVE",
    });
  }, [editPlan]);

  async function handleCreateTreatment() {
    if (!treatmentForm.name.trim()) {
      toast.error(t("patients.createTreatment.nameRequired"));
      return;
    }
    if (!treatmentForm.doctorId) {
      toast.error(t("patients.createTreatment.doctorRequired"));
      return;
    }
    setSavingTreatment(true);
    try {
      const res = await fetch("/api/treatments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: patient.id,
          doctorId: treatmentForm.doctorId,
          name: treatmentForm.name.trim(),
          description: treatmentForm.description.trim() || null,
          totalSessions: Math.max(1, Number(treatmentForm.totalSessions) || 1),
          sessionIntervalDays: Math.max(1, Number(treatmentForm.sessionIntervalDays) || 30),
          totalCost: Math.max(0, Number(treatmentForm.totalCost) || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("patients.createTreatment.failed"));
      toast.success(t("patients.createTreatment.success"));
      setShowNewTreatment(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? t("patients.createTreatment.error"));
    } finally {
      setSavingTreatment(false);
    }
  }

  async function handleUpdatePlan() {
    if (!editPlan) return;
    if (!editPlanForm.name.trim()) { toast.error(t("patients.createTreatment.nameRequired")); return; }
    setSavingEditPlan(true);
    try {
      if (editPlanForm.status !== editPlan.status) {
        const r1 = await fetch(`/api/treatments/${editPlan.id}`, { method:"PATCH", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ status: editPlanForm.status }) });
        if (!r1.ok) { const e = await r1.json().catch(()=>({})); throw new Error(e.error ?? t("patients.treatment.updateFailed")); }
      }
      const res = await fetch(`/api/treatments/${editPlan.id}`, { method:"PATCH", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({
        name: editPlanForm.name.trim(),
        description: editPlanForm.description.trim() || null,
        totalCost: Math.max(0, Number(editPlanForm.totalCost) || 0),
        totalSessions: Math.max(1, Number(editPlanForm.totalSessions) || 1),
        sessionIntervalDays: Math.max(1, Number(editPlanForm.sessionIntervalDays) || 30),
      }) });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error ?? t("patients.treatment.updateFailed"));
      toast.success(t("patients.treatment.updateSuccess"));
      setEditPlan(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? t("patients.treatment.updateFailed"));
    } finally {
      setSavingEditPlan(false);
    }
  }

  const [treatmentsModal, setTreatmentsModal] = useState<{
    open: boolean;
    appointmentId: string;
    treatments: SuggestedTreatment[];
  }>({ open: false, appointmentId: "", treatments: [] });
  const [records, setRecords] = useState(initialRecords);
  // Sincroniza con props frescas tras router.refresh()/navegación (mismo patrón
  // que `invoices` arriba). Sin esto el historial de Consultas queda en un
  // "snapshot" del primer render. Las escrituras optimistas (add/update/delete
  // vía setRecords) se conservan porque ocurren ANTES del siguiente refresh.
  useEffect(() => {
    setRecords(initialRecords);
  }, [initialRecords]);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: patient.firstName, lastName: patient.lastName,
    email: patient.email ?? "", phone: patient.phone ?? "",
    gender: patient.gender ?? "OTHER", dob: patient.dob ? new Date(patient.dob).toISOString().split("T")[0] : "",
    address: patient.address ?? "", allergies: (patient.allergies ?? []).join(", "), notes: patient.notes ?? "",
    // NOM-024
    curp:        patient.curp ?? "",
    curpStatus:  (patient.curpStatus ?? "PENDING") as "COMPLETE" | "PENDING" | "FOREIGN",
    passportNo:  patient.passportNo ?? "",
    // NOM-004 antecedentes
    familyHistory:                   patient.familyHistory ?? "",
    personalNonPathologicalHistory:  patient.personalNonPathologicalHistory ?? "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [portalLink, setPortalLink] = useState<string | null>(portalUrl ?? null);
  const [generatingPortal, setGeneratingPortal] = useState(false);
  // Radiografias state
  const [files, setFiles]             = useState<any[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [analyzing, setAnalyzing]     = useState<string | null>(null); // fileId being analyzed
  const [analyses, setAnalyses]       = useState<Record<string, any>>({}); // fileId -> analysis result
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  async function loadFiles() {
    if (filesLoaded) return;
    try {
      const res = await fetch(`/api/xrays?patientId=${patient.id}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }
    } catch { /* ignore */ }
    setFilesLoaded(true);
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("patientId", patient.id);
      formData.append("category", "XRAY_PERIAPICAL");
      const res = await fetch("/api/xrays", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error);
      const newFile = await res.json();
      setFiles(prev => [newFile, ...prev]);
      toast.success(t("patients.uploadFile.success"));
    } catch (err: any) {
      toast.error(err.message ?? t("patients.uploadFile.error"));
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  }

  async function analyzeFile(fileId: string) {
    setAnalyzing(fileId);
    try {
      const res = await fetch(`/api/xrays/${fileId}/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalyses(prev => ({ ...prev, [fileId]: data }));
      setExpandedFile(fileId);
      toast.success(t("patients.analyze.success", { count: data.analysis.findings?.length ?? 0 }));
    } catch (err: any) {
      toast.error(err.message ?? t("patients.analyze.error"));
    } finally {
      setAnalyzing(null);
    }
  }

  async function generatePortalLink() {
    setGeneratingPortal(true);
    try {
      const res = await fetch("/api/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPortalLink(data.portalUrl);
      await navigator.clipboard.writeText(data.portalUrl);
      toast.success(t("patients.portal.copied"));
    } catch (err: any) {
      toast.error(err.message ?? t("patients.portal.error"));
    } finally {
      setGeneratingPortal(false);
    }
  }

  const [overrideSpecialty, setOverrideSpecialty] = useState<string | null>(null);
  const detectedSpecialty = detectSpecialty(specialty);
  const currentSpecialty = overrideSpecialty ?? detectedSpecialty;

  const [evolutionPlans, setEvolutionPlans] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/treatments?patientId=${patient.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setEvolutionPlans(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [patient.id]);

  const mainChart = useMemo(() => {
    if (detectedSpecialty === "dental") return null;
    if (detectedSpecialty === "nutrition") {
      const data = records
        .filter((r: any) => r?.specialtyData?.anthropometrics?.weight)
        .map((r: any) => ({
          date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
          value: Number(r.specialtyData.anthropometrics.weight),
        }))
        .reverse();
      return { data, metric: t("patients.chart.weight"), color: "#fbbf24", unit: "kg" as string | undefined, normalRange: undefined as { min: number; max: number } | undefined };
    }
    if (detectedSpecialty === "psychology") {
      const data = records
        .filter((r: any) => r?.specialtyData?.scales?.phq9?.score !== undefined)
        .map((r: any) => ({
          date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
          value: Number(r.specialtyData.scales.phq9.score),
        }))
        .reverse();
      return { data, metric: t("patients.chart.phq9"), color: "#38bdf8", unit: undefined, normalRange: { min: 0, max: 4 } };
    }
    const data: { date: string; value: number }[] = [];
    for (const r of records) {
      const bp = r?.vitals?.bloodPressure ?? r?.specialtyData?.vitals?.bloodPressure;
      if (!bp) continue;
      if (typeof bp === "string") {
        const m = bp.match(/(\d+)\s*\/\s*(\d+)/);
        if (m) data.push({
          date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
          value: Number(m[1]),
        });
      } else if (typeof bp === "object" && bp.systolic) {
        data.push({
          date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
          value: Number(bp.systolic),
        });
      }
    }
    return { data: data.reverse(), metric: t("patients.chart.systolicBp"), color: "#34d399", unit: "mmHg", normalRange: { min: 90, max: 120 } };
  }, [records, detectedSpecialty]);

  const activePlanMilestones = useMemo(() => {
    const plan = evolutionPlans.find(p => p.status === "ACTIVE") ?? evolutionPlans[0];
    if (!plan?.startDate) return null;
    const start = new Date(plan.startDate);
    const end = plan.endDate ? new Date(plan.endDate) : new Date(start.getTime() + (plan.totalSessions ?? 6) * (plan.sessionIntervalDays ?? 30) * 86400000);
    const now = new Date();
    const months: { date: string; title: string; status: "completed" | "current" | "pending" }[] = [];
    const cursor = new Date(start);
    let i = 0;
    while (cursor <= end && i < 24) {
      const isCompleted = cursor < now && (cursor.getFullYear() < now.getFullYear() || cursor.getMonth() < now.getMonth());
      const isCurrent = cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth();
      months.push({
        date: cursor.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }),
        title: t("patients.milestone.session", { num: i + 1 }),
        status: isCompleted ? "completed" : isCurrent ? "current" : "pending",
      });
      cursor.setMonth(cursor.getMonth() + 1);
      i++;
    }
    return { plan, months };
  }, [evolutionPlans]);
  const age = patient.dob ? new Date().getFullYear() - new Date(patient.dob).getFullYear() : null;
  const initials = getInitials(patient.firstName, patient.lastName);
  const color    = avatarColor(patient.id);
  const nextAppt = appointments.find(a => new Date(a.date) >= new Date() && !["CANCELLED","NO_SHOW"].includes(a.status));
  const lastAppt = appointments.find(a => new Date(a.date) < new Date() && a.status === "COMPLETED");
  // Derivamos totales del state local `invoices` para que el card "Finanzas"
  // y el sidebar "Estado de cuenta" reflejen mutaciones (cobrar/cancelar/
  // editar/reembolsar) sin esperar al re-fetch del server component.
  const { totalPlan, totalPaid, totalBalance } = useMemo(() => {
    return (invoices as any[]).reduce(
      (acc, inv) => ({
        totalPlan:    acc.totalPlan    + (inv.total   ?? 0),
        totalPaid:    acc.totalPaid    + (inv.paid    ?? 0),
        totalBalance: acc.totalBalance + (inv.balance ?? 0),
      }),
      { totalPlan: 0, totalPaid: 0, totalBalance: 0 },
    );
  }, [invoices]);
  const pctPaid  = totalPlan > 0 ? Math.round((totalPaid / totalPlan) * 100) : 0;

  function handleRecordSaved(record: any) {
    setRecords(prev => [record, ...prev]);
    if (record?.draftInvoice) {
      setInvoices(prev => [{ ...record.draftInvoice, payments: [] }, ...prev]);
      router.refresh();
    }
    toast.success(t("patients.record.saved"));
    setTab("resumen");
  }

  const handleRecordUpdated = useCallback((updated: any) => {
    setRecords(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setExpandedConsultas(prev => {
      const next = new Set(prev);
      next.delete(updated.id);
      return next;
    });
  }, []);

  const openNewAppointmentForPatient = useCallback(() => {
    openNewAppointment({
      initialPatient: { id: patient.id, name: `${patient.firstName} ${patient.lastName}`.trim() },
      openAgendaAfter: false,
      onCreated: () => {
        router.refresh();
      },
    });
  }, [openNewAppointment, patient.id, patient.firstName, patient.lastName, router]);

  const fullName = `${patient.firstName} ${patient.lastName}`;
  const ageNum = ageFromDob(patient.dob);
  const genderLabel = patient.gender === "M" ? "Masculino" : patient.gender === "F" ? "Femenino" : "Otro";
  const completedCount = appointments.filter(a => a.status === "COMPLETED").length;

  const tabCounts: Record<string, number | undefined> = {
    historia: records.length,
    agenda: appointments.length,
    facturacion: invoices.length,
  };

  // ─── Consulta activa (audit Opción C ajustes 2, 5 y 6) ─────────────
  const consultAppointmentId = searchParams.get("appointment");
  const activeAppointment = useMemo(
    () =>
      consultAppointmentId && !consultClosed
        ? appointments.find((a: any) => a.id === consultAppointmentId) ?? null
        : null,
    [consultAppointmentId, consultClosed, appointments],
  );
  const isConsultActive = activeAppointment !== null;

  const [clinicalNoteId, setClinicalNoteId] = useState<string | null>(null);
  const [soapDraft, setSoapDraft] = useState<SoapDraft>({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    attachments: [],
  });

  // Al activarse la consulta, crear (o reutilizar) el draft note en server.
  useEffect(() => {
    if (!isConsultActive || !activeAppointment) return;
    if (clinicalNoteId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/clinical-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId: patient.id,
            appointmentId: activeAppointment.id,
            doctorId: activeAppointment.doctorId ?? undefined,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "create_failed");
        }
        const data = await res.json();
        if (cancelled) return;
        setClinicalNoteId(data.note.id);
        // Hidrata el draft con cualquier contenido previo (por si recargó la página).
        const note = data.note;
        if (note.subjective || note.objective || note.assessment || note.plan) {
          setSoapDraft((d) => ({
            subjective: note.subjective ?? d.subjective,
            objective: note.objective ?? d.objective,
            assessment: note.assessment ?? d.assessment,
            plan: note.plan ?? d.plan,
            attachments: note.specialtyData?.attachments ?? d.attachments,
          }));
        } else if (pediatricsData) {
          // Pre-fill pediátrico cuando es la primera vez que se abre la nota
          // y aplica el módulo Pediatría (spec §4.B.9). Solo se inserta si
          // el subjective está vacío para no pisar contenido del doctor.
          const latestFrankl = pediatricsData.behaviorHistory.find(
            (b) => b.scale === "frankl" && !b.deletedAt,
          );
          const activeHabits = pediatricsData.oralHabits
            .filter((h) => !h.deletedAt && !h.endedAt)
            .map((h) => h.habitType.replace(/_/g, " "));
          const prefill = buildPediatricSoapPrefill({
            ageFormatted: pediatricsData.ageFormatted,
            latestFranklValue: latestFrankl?.value ?? null,
            activeHabits,
            cambraCategory: (pediatricsData.latestCambra?.category as any) ?? null,
            cambraRecallMonths: pediatricsData.latestCambra?.recommendedRecallMonths ?? null,
          });
          if (prefill) {
            setSoapDraft((d) => d.subjective.trim().length === 0 ? { ...d, subjective: prefill } : d);
          }
        } else if (endoSoapPrefill) {
          // Pre-fill endodóntico cuando hay tratamiento activo o diagnóstico
          // AAE registrado para el paciente. Spec Endo §10.2. Solo aplica si
          // los 4 campos están vacíos para no pisar contenido del doctor.
          setSoapDraft((d) => {
            const allEmpty =
              !d.subjective.trim() &&
              !d.objective.trim() &&
              !d.assessment.trim() &&
              !d.plan.trim();
            if (!allEmpty) return d;
            return {
              ...d,
              subjective: endoSoapPrefill.subjective,
              objective: endoSoapPrefill.objective,
              assessment: endoSoapPrefill.assessment,
              plan: endoSoapPrefill.plan,
            };
          });
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("patients.consult.draftCreateFailed"),
        );
      }
    })();

    return () => { cancelled = true; };
  }, [isConsultActive, activeAppointment, clinicalNoteId, patient.id]);

  const handleSaveDraft = useCallback(async (d: SoapDraft) => {
    setSoapDraft(d);
    if (!clinicalNoteId) return;
    try {
      await fetch(`/api/clinical-notes/${clinicalNoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjective: d.subjective,
          objective: d.objective,
          assessment: d.assessment,
          plan: d.plan,
        }),
      });
    } catch {
      /* el editor maneja su propio toast si fuera crítico; auto-save silencioso */
    }
  }, [clinicalNoteId]);

  const handleAttach = useCallback(
    async (file: File): Promise<{ id: string; name: string; mime: string } | null> => {
      if (!clinicalNoteId) return null;
      try {
        // Subir vía /api/xrays (endpoint existente para uploads de paciente).
        const formData = new FormData();
        formData.append("file", file);
        formData.append("patientId", patient.id);
        formData.append("category", file.type.startsWith("image/") ? "PHOTO_INTRAORAL" : "OTHER");
        const upRes = await fetch("/api/xrays", { method: "POST", body: formData });
        if (!upRes.ok) {
          const body = await upRes.json().catch(() => ({}));
          throw new Error(body.error ?? "upload_failed");
        }
        const uploaded = await upRes.json();

        // Vincular a la nota.
        const linkRes = await fetch(`/api/clinical-notes/${clinicalNoteId}/attach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: uploaded.id }),
        });
        if (!linkRes.ok) {
          const body = await linkRes.json().catch(() => ({}));
          throw new Error(body.error ?? "attach_failed");
        }
        toast.success(t("patients.attach.success"));
        return {
          id: uploaded.id,
          name: uploaded.name ?? file.name,
          mime: uploaded.mimeType ?? file.type,
        };
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("patients.attach.failed"));
        return null;
      }
    },
    [clinicalNoteId, patient.id],
  );

  const handleEndConsult = useCallback(async () => {
    if (!activeAppointment) {
      setConsultClosed(true);
      return;
    }
    try {
      // Guarda el draft final si aún no se persistió (debounce pendiente).
      if (clinicalNoteId) {
        await fetch(`/api/clinical-notes/${clinicalNoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjective: soapDraft.subjective,
            objective: soapDraft.objective,
            assessment: soapDraft.assessment,
            plan: soapDraft.plan,
          }),
        });
      }
      // Completa cita + firma nota + crea snapshot odontograma + diff →
      // suggestedTreatments en respuesta (transacción server-side).
      const res = await fetch(`/api/appointments/${activeAppointment.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicalNoteId: clinicalNoteId ?? undefined,
          signNote: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "complete_failed");
      }
      const data = await res.json().catch(() => ({}));
      toast.success(t("patients.consult.completedSigned"));
      // Si el server detectó tratamientos, abrir el modal de facturación.
      const suggested: SuggestedTreatment[] = data.suggestedTreatments ?? [];
      if (suggested.length > 0) {
        setTreatmentsModal({
          open: true,
          appointmentId: activeAppointment.id,
          treatments: suggested,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("patients.consult.completeFailed"));
      return;
    }
    setConsultClosed(true);
    setClinicalNoteId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("appointment");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname);
    router.refresh();
  }, [activeAppointment, clinicalNoteId, soapDraft, searchParams, router]);

  const consultDoctorName =
    activeAppointment?.doctor?.firstName
      ? `${t("patients.doctorPrefix")} ${activeAppointment.doctor.firstName} ${activeAppointment.doctor.lastName ?? ""}`.trim()
      : null;

  // El módulo Ortodoncia rediseño usa max-width 1920px (mockup verbatim:
  // viewport 1920+ aprovechado con sub-sidebar + sections + right rail).
  // Otros tabs conservan 1400 para no romper densidad existente.
  const isOrthoTab = tab === "ortodoncia" && Boolean(orthoRedesignVM);
  const outerMaxWidth = isOrthoTab ? 1920 : 1400;

  return (
    <div style={{ padding: "20px 28px 28px", maxWidth: outerMaxWidth, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
        <Link href="/dashboard/patients" style={{ color: "var(--text-3)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ArrowLeft size={12} /> {t("patients.breadcrumb.patients")}
        </Link>
        <span style={{ color: "var(--text-4)" }}>/</span>
        <span style={{ color: "var(--text-1)", fontWeight: 500 }}>{fullName}</span>
        {/* NOM-024 — exportar expediente HL7 CDA R2. La API gate por
            permission medicalRecord.read; si el rol no califica devuelve
            403 (mejor mostrar y dejar al server gatear que duplicar lógica). */}
        <button
          type="button"
          onClick={() => { window.location.href = `/api/patients/${patient.id}/export-cda`; }}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-border bg-card hover:bg-muted text-foreground"
          title={t("patients.export.cdaTitle")}
        >
          <Download size={11} aria-hidden /> {t("patients.export.cdaLabel")}
        </button>
      </div>

      {/* Hero card permanente — audit Opción C ajuste 1.
          En tab Ortodoncia se reemplaza por PatientHeaderG16 (rendered
          inside OrthodonticsRedesignClient) — evita doble header. */}
      {tab !== "ortodoncia" && (
        <HeroCard
          patient={{
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            patientNumber: patient.patientNumber,
            gender: patient.gender ?? "",
            dob: patient.dob ?? null,
            phone: patient.phone ?? null,
            email: patient.email ?? null,
            bloodType: patient.bloodType ?? null,
            status: patient.status ?? "ACTIVE",
          }}
          nextAppointment={nextAppt ? {
            id: nextAppt.id,
            date: nextAppt.date,
            startTime: nextAppt.startTime ?? "",
            type: nextAppt.type,
            doctorName: nextAppt.doctor ? `${t("patients.doctorPrefix")} ${nextAppt.doctor.firstName} ${nextAppt.doctor.lastName}` : undefined,
          } : null}
          lastVisitDate={lastAppt?.date ?? null}
          visitCount={completedCount}
          pendingBalance={totalBalance}
          portalUrl={portalLink}
          onEdit={() => setShowEdit(true)}
          onStartConsult={() => {
            if (nextAppt) {
              // En commit 6 esto creará el draft note + activará context bar.
              router.push(`?appointment=${nextAppt.id}`);
            }
          }}
          onReschedule={openNewAppointmentForPatient}
          onCharge={openChargeShortcut}
        />
      )}

      {/* Pediatrics — chips informativos cuando aplica el módulo (spec §1.3) */}
      {pediatricsData && (
        <div className="flex flex-wrap items-center gap-2 px-1 -mt-2 mb-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200">
            <span className="font-mono">{pediatricsData.ageFormatted}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold capitalize">
            {t("patients.pediatrics.dentition")} {pediatricsData.dentition}
          </span>
          {pediatricsData.latestCambra ? (
            <span className={`cambra-chip cambra-chip--${pediatricsData.latestCambra.category}`}>
              <span className="cambra-chip__dot" aria-hidden />
              CAMBRA {pediatricsData.latestCambra.category}
            </span>
          ) : null}
        </div>
      )}

      {/* Layout 3 columnas — audit Opción C ajuste 3.
          tab=ortodoncia y odontograma usan layoutWide (oculta SideCards
          genéricas) porque el orchestrator de ortodoncia ya provee su
          propia RightRail (M2 IA + M5 WhatsApp + estado de cuenta), y
          odontograma usa todo el ancho para los 32 dientes. */}
      <div
        className={`${patientDetailStyles.layout} ${
          tab === "odontograma" || isOrthoTab ? patientDetailStyles.layoutWide : ""
        }`}
      >
        <QuickNav
          activeTab={tab}
          onSelect={setTab}
          counts={{
            historia: records.length,
            historialConsultas: records.length,
            evolucion: records.length,
            radiografias: filesLoaded ? files.length : undefined,
            tratamiento: treatments.length,
            agenda: appointments.length,
            facturacion: invoices.length,
            pediatria: pediatricsData?.pendingConsents.length ?? 0,
            periodoncia: perioData?.recordsCount ?? 0,
            endodoncia: endoSummaries?.filter((s) => s.hasActiveTreatment).length ?? 0,
            implantes: implants?.length ?? 0,
            ortodoncia: orthoData?.controls.filter((c) => c.performedAt === null).length ?? 0,
          }}
          hasBalance={totalBalance > 0}
          pediatrics={{ state: pediatricsState, reason: PEDIATRICS_DISABLED_REASON }}
          showPeriodontics={showPeriodontics}
          showEndodontics={showEndodontics}
          showImplants={showImplants}
          showOrthodontics={showOrthodontics}
          activityCounts={activityCounts}
        />

        <div className={patientDetailStyles.mainColumn}>
          {/* Sticky context bar + SOAP editor (audit Opción C ajustes 2 y 5) */}
          {isConsultActive && activeAppointment && (
            <>
              <ConsultBar
                patientName={fullName}
                resourceName={activeAppointment.room ?? null}
                doctorName={consultDoctorName}
                startedAt={activeAppointment.startedAt ?? activeAppointment.startsAt}
                paused={consultPaused}
                onPause={() => setConsultPaused((v) => !v)}
                onComplete={handleEndConsult}
                onClose={handleEndConsult}
              />
              <SoapEditorInline
                appointment={{
                  id: activeAppointment.id,
                  patientName: fullName,
                  type: activeAppointment.type,
                }}
                initialDraft={soapDraft}
                onSaveDraft={handleSaveDraft}
                onComplete={async (d) => {
                  setSoapDraft(d);
                  await handleEndConsult();
                }}
                onAttach={handleAttach}
              />
            </>
          )}

          {/* Tab bar móvil sticky — sólo visible <1024 (donde el quick-nav
              está oculto). Patrón iOS-style: scroll horizontal con buttons
              tappables, sticky bajo el hero para que el usuario pueda
              cambiar de sección sin scrollear arriba. */}
          <div
            className={patientDetailStyles.mobileTabBar}
            role="tablist"
            aria-label={t("patients.tabs.sectionsAria")}
          >
            {tabs.map((tabItem) => {
              const isActive = tab === tabItem.id;
              const count = tabCounts[tabItem.id];
              const isDisabled = tabItem.disabled === true;
              return (
                <button
                  key={tabItem.id}
                  type="button"
                  role="tab"
                  id={`patient-tab-${tabItem.id}`}
                  aria-selected={isActive}
                  aria-controls={`patient-panel-${tabItem.id}`}
                  aria-disabled={isDisabled || undefined}
                  disabled={isDisabled}
                  title={isDisabled ? tabItem.disabledReason : undefined}
                  className={`${patientDetailStyles.mobileTabBtn} ${
                    isActive ? patientDetailStyles.mobileTabBtnActive : ""
                  } ${isDisabled ? patientDetailStyles.mobileTabBtnDisabled : ""}`}
                  onClick={() => { if (!isDisabled) setTab(tabItem.id); }}
                >
                  {t(tabItem.labelKey)}
                  {count !== undefined && count > 0 && (
                    <span className={patientDetailStyles.mobileTabCount}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ===== TAB: RESUMEN ===== */}
          {tab === "resumen" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-brand-500" />
                  <span className="text-xs font-bold">{t("patients.summary.clinicalSummary")}</span>
                </div>
                <HistoriaTimeline
                  patientId={patient.id}
                  compact
                  limit={8}
                  onOpenSoap={(recordId) => {
                    const record = records.find((r) => r.id === recordId);
                    if (record) setNoteDetailOpen(record as ClinicalNote);
                  }}
                  onOpenXray={(fileId) => router.push(`/dashboard/xrays/${patient.id}?fileId=${fileId}`)}
                  onOpenAppointment={() => setTab("agenda")}
                  onOpenTreatment={() => setTab("tratamiento")}
                  onOpenReferral={() => setTab("referencias")}
                  emptyState={(() => {
                    const ageYears = ageFromDob(patient.dob);
                    const suggestion = buildEmptySuggestion({
                      ageYears,
                      isChild: Boolean(patient.isChild) || (ageYears !== null && ageYears < 18),
                      dentition: pediatricsData?.dentition,
                      hasPerioModule: perioData !== null && perioData !== undefined,
                      hasOrthoModule: (orthoData !== null && orthoData !== undefined) || orthoRedesignVM !== null,
                      hasEndoModule: endoSummaries !== null && endoSummaries !== undefined,
                      hasImplantsModule: implants !== null && implants !== undefined,
                      clinicSpecialty: specialty ?? "",
                    });
                    return (
                      <div className="bg-card border border-dashed border-border rounded-xl p-4 text-center">
                        <p className="text-xs font-semibold text-foreground mb-1">{suggestion.headline}</p>
                        <p className="text-xs text-muted-foreground mb-3">{suggestion.hint}</p>
                        <button
                          type="button"
                          onClick={() => setTab("expediente")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                        >
                          <Play size={12} aria-hidden /> {t("patients.summary.startConsult")}
                        </button>
                      </div>
                    );
                  })()}
                />
                {records[0]?.specialtyData?.periodontal && (
                  <div className="mt-3">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("patients.summary.clinicalTrafficLight")}</div>
                    <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold text-center">
                      <div className="bg-emerald-50 text-emerald-700 rounded-lg py-1.5">✓ {t("patients.summary.hygiene")}<br/>{t("patients.summary.hygieneGood")}</div>
                      <div className="bg-amber-50 text-amber-700 rounded-lg py-1.5">⚠ {t("patients.summary.caries")}<br/>{t("patients.summary.cariesModerate")}</div>
                      <div className="bg-rose-50 text-rose-700 rounded-lg py-1.5">✕ {t("patients.summary.perio")}<br/>{records[0]?.specialtyData?.periodontal?.gingival ?? t("patients.summary.noData")}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold">{t("patients.summary.medicalHistory")}</span>
                </div>
                {(patient.allergies?.length || patient.currentMedications?.length || patient.chronicConditions?.length) ? (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {patient.allergies?.map((a: string) => (
                      <span key={`a-${a}`} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                        <AlertTriangle size={11} aria-hidden /> {a}
                      </span>
                    ))}
                    {patient.currentMedications?.map((m: string) => (
                      <span key={`m-${m}`} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        <Pill size={11} aria-hidden /> {m}
                      </span>
                    ))}
                    {patient.chronicConditions?.map((c: string) => (
                      <span key={`c-${c}`} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        <HeartPulse size={11} aria-hidden /> {c}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="space-y-1.5 text-xs">
                  {[
                    { label: t("patients.summary.bloodType"), val: patient.bloodType || t("patients.summary.notRegistered") },
                    { label: t("patients.summary.insurance"),  val: patient.insuranceProvider || t("patients.summary.noInsurance") },
                    { label: t("common.notes"),                val: patient.notes?.slice(0, 60) || "—" },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-start py-1.5 border-b border-slate-50">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="font-semibold text-right max-w-[55%]">{r.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Próxima cita */}
              {nextAppt && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-brand-500" />
                    <span className="text-xs font-bold">{t("patients.summary.nextAppointment")}</span>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <div className="text-sm font-extrabold text-brand-700">{formatDate(nextAppt.date)}</div>
                    <div className="text-xs text-foreground mt-1">{nextAppt.type}</div>
                    <div className="text-[10px] text-muted-foreground">{nextAppt.startTime}h · {t("patients.doctorPrefix")} {nextAppt.doctor?.firstName} {nextAppt.doctor?.lastName}</div>
                  </div>
                </div>
              )}

              {/* Finanzas resumen */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs font-bold">{t("patients.summary.finance")}</span>
                </div>
                <div className="space-y-1.5 text-xs mb-3">
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-muted-foreground">{t("patients.summary.totalPlan")}</span>
                    <span className="font-bold">{formatCurrency(totalPlan)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-muted-foreground">{t("patients.summary.paid")}</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-muted-foreground">{t("patients.summary.pending")}</span>
                    <span className="font-bold text-rose-600">{formatCurrency(totalBalance)}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pctPaid}%` }} />
                </div>
                <div className="text-[10px] text-muted-foreground text-right mt-1">{t("patients.summary.pctCovered", { pct: pctPaid })}</div>
              </div>
            </div>
          )}

          {/* ===== TAB: HISTORIA CLINICA ===== */}
          {tab === "historia" && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-sm font-bold">{t("patients.history.title")}</h2>
                <p className="text-xs text-muted-foreground">
                  {t("patients.history.subtitle")}
                </p>
              </div>
              <HistoriaTimeline
                patientId={patient.id}
                onOpenSoap={(recordId) => {
                  const record = records.find((r) => r.id === recordId);
                  if (record) setNoteDetailOpen(record as ClinicalNote);
                }}
                onOpenXray={(fileId) => router.push(`/dashboard/xrays/${patient.id}?fileId=${fileId}`)}
                onOpenAppointment={() => setTab("agenda")}
                onOpenTreatment={() => setTab("tratamiento")}
                onOpenReferral={() => setTab("referencias")}
              />
            </div>
          )}

          {/* ===== TAB: PEDIATRÍA ===== */}
          {tab === "pediatria" && pediatricsData && (
            <PediatricsTab data={pediatricsData} />
          )}

          {/* ===== TAB: PERIODONCIA ===== */}
          {tab === "periodoncia" && perioData && (
            <PeriodonticsPatientTab data={perioData} />
          )}

          {/* ===== TAB: ENDODONCIA ===== */}
          {tab === "endodoncia" && endoSummaries && (
            <EndodonticsTab
              patientId={patient.id}
              patientName={fullName}
              summaries={endoSummaries}
            />
          )}

          {/* ===== TAB: IMPLANTES ===== */}
          {tab === "implantes" && implants && (
            <ImplantsTab
              patientId={patient.id}
              patientName={fullName}
              doctorId={currentUser.id}
              doctorName={`${currentUser.firstName} ${currentUser.lastName}`.trim()}
              doctorCedula={currentUser.cedulaProfesional ?? null}
              implants={implants}
            />
          )}

          {/* ===== TAB: ORTODONCIA ===== */}
          {tab === "ortodoncia" && orthoRedesignVM && (
            <OrthodonticsRedesignClient
              vm={orthoRedesignVM}
              digitalRecords={orthoData?.digitalRecords?.map((r: any) => {
                const RECORD_LABEL: Record<string, string> = {
                  CEPH_ANALYSIS_PDF: t("patients.ortho.recordCeph"),
                  SCAN_STL: t("patients.ortho.recordStl"),
                };
                const RECORD_KIND: Record<string, "ceph" | "stl" | "other"> = {
                  CEPH_ANALYSIS_PDF: "ceph",
                  SCAN_STL: "stl",
                };
                return {
                  label: r.notes ?? RECORD_LABEL[r.recordType] ?? r.recordType,
                  date: r.capturedAt instanceof Date
                    ? r.capturedAt.toISOString()
                    : (typeof r.capturedAt === "string" ? r.capturedAt : null),
                  kind: RECORD_KIND[r.recordType] ?? "other",
                };
              }) ?? []}
              historicalPhotoSets={orthoRedesignBundle?.historicalPhotoSets ?? []}
              installments={orthoRedesignBundle?.installments ?? []}
              quoteScenarios={orthoRedesignBundle?.quoteScenarios ?? []}
              cfdiRecords={orthoRedesignBundle?.cfdiRecords ?? []}
              retentionRegimen={orthoRedesignBundle?.retentionRegimen ?? null}
              retainerCheckups={orthoRedesignBundle?.retainerCheckups ?? []}
              npsSchedules={orthoRedesignBundle?.npsSchedules ?? []}
              referralCode={orthoRedesignBundle?.referralCode ?? null}
              labOrders={orthoRedesignBundle?.labOrders ?? []}
              consents={orthoRedesignBundle?.consents ?? []}
              referralLetters={orthoRedesignBundle?.referralLetters ?? []}
              whatsappLog={orthoRedesignBundle?.whatsappLog ?? []}
              treatmentStatus={orthoRedesignBundle?.treatmentStatus ?? "en-tratamiento"}
              financialPlan={orthoRedesignBundle?.financialPlan ?? null}
              onUpdateFinancialPlan={async (payload) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await updateFinancialPlan({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  ...payload,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(
                  t("patients.ortho.financialPlanUpdated", {
                    count: res.data.installmentCount,
                    amount: res.data.installmentAmount.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }),
                  }),
                );
                router.refresh();
              }}
              canOverridePhase={true}
              patientHeader={{
                patient: {
                  id: patient.id,
                  fullName: fullName,
                  avatarInitials: getInitials(patient.firstName, patient.lastName),
                  age: patient.dob ? ageFromDob(new Date(patient.dob)) : null,
                  sex:
                    patient.gender === "F"
                      ? "F"
                      : patient.gender === "M"
                        ? "M"
                        : patient.gender === "OTHER"
                          ? "X"
                          : null,
                  phone: patient.phone ?? null,
                  email: patient.email ?? null,
                  bloodType: patient.bloodType ?? null,
                  guardianLabel: orthoData?.guardianName
                    ? t("patients.ortho.guardianLabel", { name: orthoData.guardianName })
                    : null,
                  criticalAllergies:
                    Array.isArray(patient.allergies) && patient.allergies.length > 0
                      ? patient.allergies.join(", ")
                      : null,
                },
                outstandingAmount: Math.max(
                  0,
                  orthoRedesignVM.treatment.totalCost - orthoRedesignVM.treatment.paid,
                ),
                // En tab Ortodoncia, derivamos lastVisitAt y totalVisits
                // del modelo OrthodonticControlAppointment (visitas reales
                // del tx ortodóntico), no del Appointment genérico.
                lastVisitAt: (() => {
                  const performed = (orthoData?.controls ?? []).filter(
                    (c: any) => c.performedAt,
                  );
                  if (performed.length === 0) return lastAppt?.date ?? null;
                  performed.sort(
                    (a: any, b: any) =>
                      new Date(b.performedAt).getTime() -
                      new Date(a.performedAt).getTime(),
                  );
                  return performed[0].performedAt instanceof Date
                    ? performed[0].performedAt.toISOString()
                    : performed[0].performedAt;
                })(),
                totalVisits: {
                  count:
                    (orthoData?.controls ?? []).filter(
                      (c: any) => c.attendance === "ATTENDED" && c.performedAt,
                    ).length || completedCount,
                  sinceLabel: orthoRedesignVM.treatment.startDate
                    ? t("patients.ortho.sinceLabel", { date: new Date(orthoRedesignVM.treatment.startDate).toLocaleDateString("es-MX", { month: "short", year: "numeric" }) })
                    : null,
                },
                onStartVisit: () => {
                  if (nextAppt) router.push(`?appointment=${nextAppt.id}`);
                  else toast(t("patients.ortho.scheduleApptFirst"));
                },
                onScheduleNext: () => setTab("agenda"),
                onCollect: () => setTab("facturacion"),
                onMore: undefined,
              }}
              onStartDiagnosisWizard={() => {
                // Si no hay diagnóstico, redirige al cliente legacy con el
                // wizard completo en /dashboard/specialties/orthodontics/[id].
                router.push(`/dashboard/specialties/orthodontics/${patient.id}`);
              }}
              onEditPrescription={() => {
                // Sin onUpdateAppliances todavía hidratado; este handler
                // delega al wizard del cliente legacy.
                router.push(`/dashboard/specialties/orthodontics/${patient.id}`);
              }}
              onUpdateDiagnosis={async (payload) => {
                const res = await updateDiagnosis({
                  ...payload,
                  patientId: patient.id,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.diagnosisUpdated"));
                router.refresh();
              }}
              onUpdateAppliances={async (payload) => {
                const res = await updateOrthoAppliances(payload);
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.appliancesUpdated"));
                router.refresh();
              }}
              onCreateReferralLetter={async (payload) => {
                const res = await createReferralLetter({
                  patientId: patient.id,
                  ...payload,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.referralLetterSent"));
                router.refresh();
              }}
              onUpdateRetentionRegimen={async (payload) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await updateRetentionRegimenConfig({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  ...payload,
                  upperRetainer: payload.upperRetainer as any,
                  lowerRetainer: payload.lowerRetainer as any,
                  fixedLingualGauge: payload.fixedLingualGauge as any,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.retentionRegimenSaved"));
                router.refresh();
              }}
              onUpdateNpsConfig={async (payload) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await updateNpsConfig({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  ...payload,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(
                  payload.customMessage
                    ? t("patients.ortho.npsConfigSavedWhatsapp")
                    : t("patients.ortho.npsConfigSaved"),
                );
                router.refresh();
              }}
              onScheduleG15Action={async () => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await scheduleG15Checkpoint({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.g15Scheduled"));
                router.refresh();
              }}
              onUpdateQuoteScenario={async (payload) => {
                const res = await updateQuoteScenario(payload);
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.scenarioUpdated"));
                router.refresh();
              }}
              onAddWireStep={undefined}
              onSubmitWireStep={async (payload) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await addWireStep({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  phase: payload.phase,
                  material: payload.material,
                  shape: payload.shape,
                  gauge: payload.gauge,
                  archUpper: payload.archUpper,
                  archLower: payload.archLower,
                  durationWeeks: payload.durationWeeks,
                  auxiliaries: payload.auxiliaries,
                  purpose: payload.purpose ?? null,
                  notes: payload.notes ?? null,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.wireStepAdded"));
                router.refresh();
              }}
              onAddTad={async () => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const brand = window.prompt(
                  t("patients.ortho.tadBrandPrompt"),
                  "DENTOS",
                );
                if (!brand) return;
                const size = window.prompt(t("patients.ortho.tadSizePrompt"), "");
                if (!size) return;
                const location = window.prompt(
                  t("patients.ortho.tadLocationPrompt"),
                  "",
                );
                if (!location) return;
                const torqueStr = window.prompt(
                  t("patients.ortho.tadTorquePrompt"),
                  "",
                );
                const torqueNcm = torqueStr ? parseInt(torqueStr, 10) : null;
                const res = await createOrthoTAD({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  brand: brand.toUpperCase() as any,
                  size,
                  location,
                  torqueNcm: Number.isFinite(torqueNcm as number)
                    ? (torqueNcm as number)
                    : null,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.tadRegistered"));
                router.refresh();
              }}
              onCardSigned={async (payload) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await signTreatmentCard({
                  cardId: payload.cardId,
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  cardNumber:
                    (orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                      ?.cardNumber ??
                      orthoRedesignVM.treatmentCards.reduce(
                        (m, c) => Math.max(m, c.cardNumber),
                        0,
                      ) + 1),
                  visitDate:
                    orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                      ?.visitDate ?? new Date().toISOString(),
                  durationMin:
                    orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                      ?.durationMin ?? 30,
                  phaseKey:
                    orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                      ?.phaseKey ??
                    orthoRedesignVM.treatment.phase ??
                    "LEVELING",
                  monthAt:
                    orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                      ?.monthAt ?? orthoRedesignVM.treatment.monthCurrent,
                  wireFromId:
                    orthoRedesignVM.treatmentCards.find((c) => c.id === payload.cardId)
                      ?.wireFrom?.id ?? null,
                  wireToId: payload.wireToId,
                  soap: payload.soap,
                  hygiene: payload.hygiene,
                  elastics: payload.elastics,
                  iprPoints: payload.iprPoints,
                  brokenBrackets: payload.brokenBrackets,
                  hasProgressPhoto: payload.hasProgressPhoto,
                  nextDate: payload.nextDate,
                  nextDurationMin: payload.nextDurationMin,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.appointmentSigned"));
                router.refresh();
              }}
              onCardDraftSaved={async (payload) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const card = orthoRedesignVM.treatmentCards.find(
                  (c) => c.id === payload.cardId,
                );
                const res = await saveTreatmentCardDraft({
                  cardId: payload.cardId,
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  cardNumber:
                    card?.cardNumber ??
                    orthoRedesignVM.treatmentCards.reduce(
                      (m, c) => Math.max(m, c.cardNumber),
                      0,
                    ) + 1,
                  visitDate: card?.visitDate ?? new Date().toISOString(),
                  durationMin: card?.durationMin ?? 30,
                  phaseKey:
                    card?.phaseKey ?? orthoRedesignVM.treatment.phase ?? "LEVELING",
                  monthAt: card?.monthAt ?? orthoRedesignVM.treatment.monthCurrent,
                  wireFromId: card?.wireFrom?.id ?? null,
                  wireToId: payload.wireToId,
                  soap: payload.soap,
                  hygiene: payload.hygiene,
                  elastics: payload.elastics,
                  iprPoints: payload.iprPoints,
                  brokenBrackets: payload.brokenBrackets,
                  hasProgressPhoto: payload.hasProgressPhoto,
                  nextDate: payload.nextDate,
                  nextDurationMin: payload.nextDurationMin,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.draftSaved"));
                router.refresh();
              }}
              onPhaseAdvanced={async (payload) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                // El audit trail (criteriaChecked, isOverride) lo registra
                // OrthoPhaseTransition por separado; advanceTreatmentPhase solo
                // necesita treatmentPlanId + toPhase + notes.
                const notesParts = [
                  payload.doctorNotes ?? "",
                  payload.isOverride
                    ? `OVERRIDE: ${payload.overrideReason ?? "—"}`
                    : "",
                  payload.criteriaChecked.length > 0
                    ? `Criterios: ${payload.criteriaChecked.join(", ")}`
                    : "",
                ].filter(Boolean);
                const res = await advanceTreatmentPhase({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  toPhase: payload.toPhase,
                  notes: notesParts.join(" · ") || null,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.phaseAdvanced", { phase: payload.toPhase }));
                router.refresh();
              }}
              onSelectQuoteScenario={async (scenarioId) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await selectQuoteScenario({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  scenarioId,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.scenarioSelected"));
                router.refresh();
              }}
              onSendSignAtHome={async () => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const accepted = orthoRedesignBundle?.quoteScenarios.find(
                  (s) => s.status === "ACCEPTED",
                );
                if (!accepted) {
                  toast.error(t("patients.ortho.selectScenarioBeforeSign"));
                  return;
                }
                const res = await sendSignAtHomeLink({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  scenarioId: accepted.id,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.signAtHomeSent"));
                router.refresh();
              }}
              onConfirmCollect={async (method) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await confirmCollect({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  method,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.collectRegistered"));
                if ((res.data as { cfdiTimbradoStub?: boolean }).cfdiTimbradoStub) {
                  toast(t("patients.ortho.cfdiStub"));
                }
                router.refresh();
              }}
              onCreateLabOrder={async (payload) => {
                const res = await createOrthoLabOrder({
                  patientId: patient.id,
                  catalog: payload.catalog,
                  description: payload.description,
                  lab: payload.lab,
                  expectedDate: payload.expectedDate,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(t("patients.ortho.labOrderCreated"));
                router.refresh();
              }}
              onTogglePreSurvey={async (enabled) => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const res = await toggleRetentionPreSurvey({
                  treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                  enabled,
                });
                if (isFailure(res)) {
                  toast.error(res.error);
                  return;
                }
                toast.success(
                  enabled ? t("patients.ortho.preSurveyEnabled") : t("patients.ortho.preSurveyDisabled"),
                );
                router.refresh();
              }}
              onGeneratePdfBeforeAfter={async () => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                // Genera PDF comparativo T0 vs Tn vía endpoint existente.
                // El download se dispara en el browser; el endpoint usa
                // puppeteer + las URLs firmadas de Supabase Storage.
                const url = `/api/orthodontics/treatment-plans/${orthoRedesignVM.treatment.treatmentPlanId}/comparison-pdf`;
                window.open(url, "_blank");
                toast.success(t("patients.ortho.generatingBeforeAfterPdf"));
              }}
              onCopyReferralCode={() => {
                const code = orthoRedesignBundle?.referralCode?.code;
                if (!code) {
                  toast(t("patients.ortho.noReferralCode"));
                  return;
                }
                navigator.clipboard
                  .writeText(code)
                  .then(() => toast.success(t("patients.ortho.codeCopied", { code })))
                  .catch(() => toast.error(t("patients.ortho.clipboardFailed")));
              }}
              onUploadPhoto={async (stage, slotId, file) => {
                // Persistencia real: createPhotoSet (si no existe set para
                // esta etapa) → POST /api/orthodontics/photos/upload →
                // uploadPhotoToSet → router.refresh() para que el loader
                // re-pinte con la URL firmada de Supabase.
                const view = SLOT_TO_VIEW[slotId];
                if (!view) {
                  // Slot extra-AAO (sobremordida / resalte): no tienen
                  // columna en OrthoPhotoSet schema actual. Subir requiere
                  // ALTER TABLE (no servicio externo · backlog interno).
                  toast.error(t("patients.ortho.slotOutsideAao"));
                  return;
                }
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                try {
                  // 1. Resolver setId · usar el del bundle si existe,
                  //    o crear uno nuevo para esta etapa.
                  const existingSet =
                    orthoRedesignBundle?.historicalPhotoSets.find(
                      (s) => s.stage === stage,
                    );
                  let setId = existingSet?.setId ?? null;
                  if (!setId) {
                    const created = await createPhotoSet({
                      treatmentPlanId: orthoRedesignVM.treatment.treatmentPlanId,
                      patientId: patient.id,
                      setType: stage,
                      capturedAt: new Date().toISOString(),
                      monthInTreatment: orthoRedesignVM.treatment.monthCurrent,
                    });
                    if (isFailure(created)) {
                      toast.error(created.error);
                      return;
                    }
                    setId = (created.data as { id: string }).id;
                  }

                  // 2. POST file + setId + view al endpoint que sube a
                  //    Supabase Storage + crea PatientFile.
                  const fd = new FormData();
                  fd.append("file", file);
                  fd.append("setId", setId);
                  fd.append("view", view);
                  const res = await fetch(
                    "/api/orthodontics/photos/upload",
                    { method: "POST", body: fd },
                  );
                  if (!res.ok) {
                    const errBody = await res.json().catch(() => null);
                    toast.error(errBody?.error ?? t("patients.ortho.photoUploadFailed"));
                    return;
                  }
                  const { fileId } = (await res.json()) as { fileId: string };

                  // 3. Asocia el PatientFile a la columna del set.
                  const attached = await uploadPhotoToSet({
                    setId,
                    fileId,
                    view,
                  });
                  if (isFailure(attached)) {
                    toast.error(attached.error);
                    return;
                  }

                  toast.success(t("patients.ortho.photoUploaded", { view: view.replace(/_/g, " ").toLowerCase() }));
                  // 4. Re-pinta con URLs firmadas frescas del loader.
                  router.refresh();
                } catch (e) {
                  console.error("[ortho upload] failed:", e);
                  toast.error(t("patients.ortho.photoUploadUnexpected"));
                }
              }}
              onComparePhotos={undefined}
              onGenerateComparePdf={async () => {
                if (!orthoRedesignVM.treatment.treatmentPlanId) {
                  toast.error(t("patients.ortho.noPlan"));
                  return;
                }
                const url = `/api/orthodontics/treatment-plans/${orthoRedesignVM.treatment.treatmentPlanId}/comparison-pdf`;
                window.open(url, "_blank");
                toast.success(t("patients.ortho.generatingComparePdf"));
              }}
              onCollectNow={undefined}
            />
          )}
          {tab === "ortodoncia" && !orthoRedesignVM && orthoData && (
            <OrthodonticsClient
              patientId={orthoData.patientId}
              patientName={orthoData.patientName}
              isMinor={orthoData.isMinor}
              hasPediatricProfile={orthoData.hasPediatricProfile}
              guardianName={orthoData.guardianName}
              pediatricHabits={orthoData.pediatricHabits}
              pediatricsModuleActive={pediatricsModuleActive}
              diagnosis={orthoData.diagnosis}
              plan={orthoData.plan}
              phases={orthoData.phases}
              monthInTreatment={orthoData.monthInTreatment}
              paymentPlan={orthoData.paymentPlan}
              installments={orthoData.installments}
              photoSets={orthoData.photoSets}
              controls={orthoData.controls}
              digitalRecords={orthoData.digitalRecords}
              resolveFileUrl={resolveOrthoFileUrl}
              agreementPdfHref={
                orthoData.paymentPlan
                  ? `/api/orthodontics/payment-plans/${orthoData.paymentPlan.id}/financial-agreement-pdf`
                  : undefined
              }
            />
          )}

          {/* ===== TAB: ODONTOGRAMA ===== */}
          {tab === "odontograma" && (
            <Odontogram patientId={patient.id} />
          )}

          {/* ===== TAB: NUEVA CONSULTA (specialty form) ===== */}
          {tab === "expediente" && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h2 className="text-sm font-bold">
                  {currentSpecialty === "dental"     ? t("patients.newConsult.titleDental") :
                   currentSpecialty === "nutrition"  ? t("patients.newConsult.titleNutrition") :
                   currentSpecialty === "psychology" ? t("patients.newConsult.titlePsychology") :
                   t("patients.newConsult.titleMedicine")}
                </h2>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.newConsult.typeLabel")}</label>
                  <select
                    value={currentSpecialty}
                    onChange={(e) => setOverrideSpecialty(e.target.value)}
                    className="flex h-8 rounded-lg border border-border bg-card px-3 text-xs"
                  >
                    <option value="dental">{t("patients.newConsult.optDental")}</option>
                    <option value="nutrition">{t("patients.newConsult.optNutrition")}</option>
                    <option value="psychology">{t("patients.newConsult.optPsychology")}</option>
                    <option value="medicine">{t("patients.newConsult.optMedicine")}</option>
                  </select>
                  {overrideSpecialty && overrideSpecialty !== detectedSpecialty && (
                    <button
                      type="button"
                      onClick={() => setOverrideSpecialty(null)}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline"
                      title={t("patients.newConsult.resetTitle")}
                    >
                      {t("patients.newConsult.reset")}
                    </button>
                  )}
                </div>
              </div>
              {currentSpecialty === "dental"     && <DentalForm          patientId={patient.id} isChild={!!patient.isChild} onSaved={handleRecordSaved} />}
              {currentSpecialty === "nutrition"  && <NutritionForm       patientId={patient.id} patient={patient} onSaved={handleRecordSaved} />}
              {currentSpecialty === "psychology" && <PsychologyForm      patientId={patient.id} sessionNum={records.length + 1} onSaved={handleRecordSaved} />}
              {currentSpecialty === "medicine"   && <GeneralMedicineForm patientId={patient.id} onSaved={handleRecordSaved} />}
            </div>
          )}

          {/* ===== TAB: HISTORIAL DE CONSULTAS (expanded) ===== */}
          {tab === "historial-consultas" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">{t("patients.consultHistory.title", { count: records.length })}</h2>
                <button
                  onClick={() => setTab("expediente")}
                  className="text-xs font-semibold text-brand-600 hover:underline"
                >
                  {t("patients.consultHistory.newConsult")}
                </button>
              </div>

              {records.length === 0 ? (
                <div className="bg-card border border-border rounded-xl px-5 py-10 text-center text-muted-foreground">
                  <div className="text-3xl mb-2">📋</div>
                  <div className="text-sm font-semibold">{t("patients.consultHistory.empty")}</div>
                  <button
                    onClick={() => setTab("expediente")}
                    className="text-xs text-brand-600 hover:underline mt-2 inline-block"
                  >
                    {t("patients.consultHistory.registerFirst")}
                  </button>
                </div>
              ) : records.map((record: any, idx: number) => {
                const isExpanded = expandedConsultas.has(record.id);
                const noteStatus: "DRAFT" | "SIGNED" = record.specialtyData?.status ?? "DRAFT";
                const isSigned = noteStatus === "SIGNED";
                const specialtyType = record.specialtyData?.type ?? null;
                const isDental = specialtyType === "dental" || currentSpecialty === "dental";

                const visitDateLong = new Intl.DateTimeFormat("es-MX", {
                  day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
                }).format(new Date(record.visitDate));

                return (
                  <div key={record.id} className="bg-card border border-border rounded-xl overflow-hidden">
                    {/* Header colapsable */}
                    <button
                      type="button"
                      onClick={() => toggleConsulta(record.id)}
                      className="w-full flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 border-2 border-brand-500 flex items-center justify-center text-[10px] font-bold text-brand-700">
                          {records.length - idx}
                        </div>
                        <div>
                          <div className="text-sm font-bold">{t("patients.consultHistory.consultLabel")} · {visitDateLong}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {t("patients.doctorPrefix")} {record.doctor?.firstName} {record.doctor?.lastName}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          isSigned
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                        }`}>
                          {isSigned ? t("patients.note.signed") : t("patients.note.draft")}
                        </span>
                        <span className={`text-muted-foreground text-lg transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                          ⌄
                        </span>
                      </div>
                    </button>

                    {/* Body expandido: form completo con datos pre-llenados */}
                    {isExpanded && (
                      <div className="p-5 border-t border-border bg-background">
                        {isDental ? (
                          <DentalForm
                            patientId={patient.id}
                            isChild={!!patient.isChild}
                            initialRecord={{
                              id: record.id,
                              subjective: record.subjective ?? null,
                              objective: record.objective ?? null,
                              assessment: record.assessment ?? null,
                              plan: record.plan ?? null,
                              specialtyData: record.specialtyData ?? {},
                            }}
                            onSaved={handleRecordUpdated}
                          />
                        ) : (
                          <div className="bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 rounded-lg p-4 text-sm">
                            <div className="font-semibold text-amber-800 dark:text-amber-300 mb-1">
                              {t("patients.consultHistory.editUnavailableTitle")}
                            </div>
                            <div className="text-xs text-amber-700 dark:text-amber-400">
                              {t("patients.consultHistory.editUnavailableBody")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Footer simple: solo eliminar borrador */}
                    {!isExpanded && noteStatus === "DRAFT" && (
                      <div className="flex items-center justify-end gap-2 px-5 py-2 border-t border-border bg-muted/20">
                        <button
                          type="button"
                          onClick={() => handleDeleteRecord(record)}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          {t("patients.consultHistory.deleteDraft")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ===== TAB: EVOLUCION ===== */}
          {tab === "evolucion" && (
            <>
              {(mainChart || activePlanMilestones) && (
                <div style={{ display: "grid", gridTemplateColumns: mainChart && activePlanMilestones ? "1fr 1fr" : "1fr", gap: 14, marginBottom: 14 }}>
                  {mainChart && (
                    mainChart.data.length < 2 ? (
                      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }}>
                        <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {t("patients.evolution.needMore", { metric: mainChart.metric })}
                        </div>
                      </div>
                    ) : (
                      <EvolutionChart
                        data={mainChart.data}
                        metric={mainChart.metric}
                        color={mainChart.color}
                        unit={mainChart.unit}
                        normalRange={mainChart.normalRange}
                      />
                    )
                  )}
                  {activePlanMilestones && activePlanMilestones.months.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8 }}>
                        {activePlanMilestones.plan.name}
                      </div>
                      <TreatmentTimeline milestones={activePlanMilestones.months} />
                    </div>
                  )}
                </div>
              )}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">{t("patients.evolution.title", { count: records.length })}</h2>
                <button onClick={() => setTab("expediente")} className="text-xs font-semibold text-brand-600 hover:underline">{t("patients.evolution.newNote")}</button>
              </div>
              <div className="p-5">
                {records.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-3">{t("patients.evolution.empty")}</p>
                    <button onClick={() => setTab("expediente")} className="text-xs font-semibold text-brand-600 hover:underline">{t("patients.evolution.createFirst")}</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {records.map((record, idx) => {
                      const noteStatus: "DRAFT" | "SIGNED" =
                        record.specialtyData?.status ?? "DRAFT";
                      const isSigned = noteStatus === "SIGNED";
                      return (
                      <div key={record.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-blue-100 border-2 border-brand-500 flex items-center justify-center text-[9px] font-bold text-brand-700 flex-shrink-0 z-10">
                            {records.length - idx}
                          </div>
                          {idx < records.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <button
                          type="button"
                          onClick={() => setNoteDetailOpen(record as ClinicalNote)}
                          className={`${patientDetailStyles.noteRow} flex-1 bg-muted rounded-xl border border-border p-3 mb-1 text-left w-full`}
                          aria-label={t("patients.evolution.viewDetailAria", { date: formatDate(record.visitDate) })}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">{formatDate(record.visitDate)}</span>
                              <span
                                className={`${patientDetailStyles.noteRowStatusBadge} ${
                                  isSigned ? patientDetailStyles.signed : patientDetailStyles.draft
                                }`}
                              >
                                {isSigned ? t("patients.note.signed") : t("patients.note.draft")}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-brand-600">{t("patients.doctorPrefix")} {record.doctor?.firstName} {record.doctor?.lastName}</span>
                              <span className={patientDetailStyles.noteRowChevron} aria-hidden>›</span>
                            </div>
                          </div>
                          {record.subjective && (
                            <p className="text-xs text-foreground mb-1.5 leading-relaxed">{record.subjective}</p>
                          )}
                          {record.assessment && (
                            <div className="text-xs"><span className="font-bold text-muted-foreground">{t("patients.note.dx")}</span> {record.assessment}</div>
                          )}
                          {record.plan && (
                            <div className="text-xs mt-1"><span className="font-bold text-muted-foreground">{t("patients.note.plan")}</span> {record.plan}</div>
                          )}
                          {/* Specialty badges */}
                          {record.specialtyData?.procedures?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {record.specialtyData.procedures.map((p: any) => {
                                const label = typeof p === "string" ? p : (p?.name ?? t("patients.note.procedure"));
                                const key = typeof p === "string" ? p : (p?.id ?? label);
                                return <span key={key} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{label}</span>;
                              })}
                            </div>
                          )}
                          {record.specialtyData?.scales && (
                            <div className="flex gap-2 mt-2">
                              <span className="text-[10px] bg-card border border-border rounded px-2 py-0.5">PHQ-9: {record.specialtyData.scales.phq9?.score}/27 ({record.specialtyData.scales.phq9?.severity})</span>
                              <span className="text-[10px] bg-card border border-border rounded px-2 py-0.5">GAD-7: {record.specialtyData.scales.gad7?.score}/21 ({record.specialtyData.scales.gad7?.severity})</span>
                            </div>
                          )}
                          {record.specialtyData?.anthropometrics && (
                            <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                              {record.specialtyData.anthropometrics.weight && <span>{t("patients.note.weight")} <strong>{record.specialtyData.anthropometrics.weight}kg</strong></span>}
                              {record.specialtyData.anthropometrics.bmi    && <span>{t("patients.note.bmi")} <strong>{record.specialtyData.anthropometrics.bmi}</strong></span>}
                            </div>
                          )}
                          {record.specialtyData?.medications?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {record.specialtyData.medications.filter((m: any) => m.drug).map((m: any, i: number) => (
                                <span key={i} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">💊 {m.drug}</span>
                              ))}
                            </div>
                          )}
                        </button>
                        {(record.specialtyData?.status ?? "DRAFT") === "DRAFT" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRecord(record);
                            }}
                            className="self-start p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            aria-label={t("patients.note.deleteDraftAria")}
                            title={t("patients.note.deleteDraftAria")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            </>
          )}

          {/* ===== TAB: PLAN DE TRATAMIENTO ===== */}
          {tab === "tratamiento" && (() => {
            const pendingSessionsTotal = treatments
              .filter((t: any) => t.status === "ACTIVE")
              .reduce((acc: number, t: any) => acc + Math.max(0, (t.totalSessions || 0) - (t.sessions?.length || 0)), 0);
            const activeCount = treatments.filter((t: any) => t.status === "ACTIVE").length;
            const completedCount = treatments.filter((t: any) => t.status === "COMPLETED").length;

            const COMMON_TREATMENTS = [
              t("patients.commonTreatment.bracesOrtho"),
              t("patients.commonTreatment.invisibleOrtho"),
              t("patients.commonTreatment.dentalImplant"),
              t("patients.commonTreatment.perioRehab"),
              t("patients.commonTreatment.whitening"),
              t("patients.commonTreatment.rootCanal"),
              t("patients.commonTreatment.nutritionPlan"),
              t("patients.commonTreatment.psychProgram"),
            ];

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold">{t("patients.treatment.title")}</h2>
                  <button
                    type="button"
                    onClick={() => setShowNewTreatment(true)}
                    className="text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700"
                  >
                    {t("patients.treatment.newTreatment")}
                  </button>
                </div>

                {treatments.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-brand-700 dark:text-brand-300">{pendingSessionsTotal}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{t("patients.treatment.pendingSessions")}</div>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{activeCount}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{t("patients.treatment.active")}</div>
                    </div>
                    <div className="bg-muted border border-border rounded-xl p-3 text-center">
                      <div className="text-xl font-bold text-muted-foreground">{completedCount}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{t("patients.treatment.completed")}</div>
                    </div>
                  </div>
                )}

                {treatments.length === 0 ? (
                  <div className="bg-card border border-border rounded-xl px-5 py-10 text-center text-muted-foreground">
                    <div className="text-3xl mb-2">💊</div>
                    <div className="text-sm font-semibold">{t("patients.treatment.empty")}</div>
                    <button
                      type="button"
                      onClick={() => setShowNewTreatment(true)}
                      className="text-xs text-brand-600 hover:underline mt-2 inline-block"
                    >
                      {t("patients.treatment.createFirst")}
                    </button>
                  </div>
                ) : treatments.map((plan: any) => {
                  const completed = plan.sessions?.length ?? 0;
                  const pct = plan.totalSessions > 0 ? Math.round((completed / plan.totalSessions) * 100) : 0;
                  const pendingThis = Math.max(0, (plan.totalSessions || 0) - completed);
                  const STATUS_CFG: Record<string,{labelKey:string;cls:string}> = {
                    ACTIVE:    { labelKey:"patients.treatmentStatus.active",    cls:"bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800" },
                    COMPLETED: { labelKey:"patients.treatmentStatus.completed", cls:"bg-muted text-muted-foreground border-border" },
                    ABANDONED: { labelKey:"patients.treatmentStatus.abandoned", cls:"bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800" },
                    PAUSED:    { labelKey:"patients.treatmentStatus.paused",    cls:"bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800" },
                  };
                  const cfg = STATUS_CFG[plan.status] ?? STATUS_CFG.ACTIVE;
                  return (
                    <div
                      key={plan.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setViewPlan(plan)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewPlan(plan); } }}
                      className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-brand-300 hover:shadow-sm transition-colors w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="font-bold text-sm">{plan.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {t("patients.doctorPrefix")} {plan.doctor?.firstName} {plan.doctor?.lastName}
                          </div>
                          {plan.description && (
                            <div className="text-xs text-muted-foreground mt-1">{plan.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
                            {t(cfg.labelKey)}
                          </span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setEditPlan(plan); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-colors" aria-label={t("patients.treatment.editAria", { name: plan.name })} title={t("patients.treatment.editBtn")}>
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteTreatment(plan); }}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            aria-label={t("patients.treatment.deletePlanAria", { name: plan.name })}
                            title={t("patients.treatment.deletePlanTitle")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-muted-foreground">
                          {completed}/{plan.totalSessions}
                        </span>
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                        <span>💰 {formatCurrency(plan.totalCost)}</span>
                        <span>📅 {t("patients.treatment.everyDays", { days: plan.sessionIntervalDays })}</span>
                        {pendingThis > 0 && plan.status === "ACTIVE" && (
                          <span className="text-brand-600 dark:text-brand-400 font-semibold">⏳ {t("patients.treatment.pendingCount", { count: pendingThis })}</span>
                        )}
                        {plan.nextExpectedDate && (
                          <span>⏰ {t("patients.treatment.next", { date: new Date(plan.nextExpectedDate).toLocaleDateString("es-MX",{day:"numeric",month:"short"}) })}</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {showNewTreatment && (
                  <div
                    style={{ position:"fixed", inset:0, background:"rgba(15,10,30,0.55)", backdropFilter:"blur(4px)", zIndex:80, display:"grid", placeItems:"center" }}
                    onClick={() => !savingTreatment && setShowNewTreatment(false)}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="bg-card border border-border rounded-2xl w-[min(92vw,560px)] max-h-[90vh] overflow-auto"
                    >
                      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h3 className="text-sm font-bold">{t("patients.treatment.modalTitle", { name: `${patient.firstName} ${patient.lastName}` })}</h3>
                        <button
                          type="button"
                          onClick={() => !savingTreatment && setShowNewTreatment(false)}
                          className="text-muted-foreground hover:text-foreground p-1"
                          aria-label={t("common.close")}
                        >
                          ×
                        </button>
                      </div>
                      <div className="p-5 space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.doctorLabel")}</label>
                          <select
                            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                            value={treatmentForm.doctorId}
                            onChange={(e) => setTreatmentForm(f => ({ ...f, doctorId: e.target.value }))}
                          >
                            {(doctors ?? []).map((d: any) => (
                              <option key={d.id} value={d.id}>{t("patients.doctorPrefix")} {d.firstName} {d.lastName}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.nameLabel")}</label>
                          <input
                            type="text"
                            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                            placeholder={t("patients.treatment.namePlaceholder")}
                            value={treatmentForm.name}
                            onChange={(e) => setTreatmentForm(f => ({ ...f, name: e.target.value }))}
                          />
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {COMMON_TREATMENTS.slice(0, 5).map(suggestion => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => setTreatmentForm(f => ({ ...f, name: suggestion }))}
                                className="text-[10px] px-2 py-1 rounded-full border border-border bg-muted hover:bg-brand-50 hover:border-brand-300"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.descLabel")}</label>
                          <textarea
                            className="flex w-full rounded-lg border border-border bg-card px-3 py-2 text-sm resize-none"
                            rows={2}
                            placeholder={t("patients.treatment.descPlaceholder")}
                            value={treatmentForm.description}
                            onChange={(e) => setTreatmentForm(f => ({ ...f, description: e.target.value }))}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.totalSessions")}</label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                              value={treatmentForm.totalSessions}
                              onChange={(e) => setTreatmentForm(f => ({ ...f, totalSessions: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.daysBetween")}</label>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                              value={treatmentForm.sessionIntervalDays}
                              onChange={(e) => setTreatmentForm(f => ({ ...f, sessionIntervalDays: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.totalCost")}</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                            placeholder="0.00"
                            value={treatmentForm.totalCost}
                            onChange={(e) => setTreatmentForm(f => ({ ...f, totalCost: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
                        <button
                          type="button"
                          onClick={() => setShowNewTreatment(false)}
                          disabled={savingTreatment}
                          className="text-xs font-semibold border border-border px-4 py-2 rounded-lg hover:bg-muted disabled:opacity-50"
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateTreatment}
                          disabled={savingTreatment}
                          className="text-xs font-semibold bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
                        >
                          {savingTreatment ? t("patients.treatment.creating") : t("patients.treatment.createBtn")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {viewPlan && (() => {
                  const vp = viewPlan;
                  const vCompleted = vp.sessions?.length ?? 0;
                  const vPct = vp.totalSessions > 0 ? Math.round((vCompleted / vp.totalSessions) * 100) : 0;
                  const vCls: Record<string,string> = {
                    ACTIVE:"bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",
                    COMPLETED:"bg-muted text-muted-foreground border-border",
                    ABANDONED:"bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800",
                    PAUSED:"bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
                  };
                  const vKey: Record<string,string> = { ACTIVE:"patients.treatmentStatus.active", COMPLETED:"patients.treatmentStatus.completed", ABANDONED:"patients.treatmentStatus.abandoned", PAUSED:"patients.treatmentStatus.paused" };
                  return (
                    <div style={{ position:"fixed", inset:0, background:"rgba(15,10,30,0.55)", backdropFilter:"blur(4px)", zIndex:80, display:"grid", placeItems:"center" }} onClick={() => setViewPlan(null)}>
                      <div onClick={(e)=>e.stopPropagation()} className="bg-card border border-border rounded-2xl w-[min(92vw,560px)] max-h-[90vh] overflow-auto">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                          <h3 className="text-sm font-bold">{t("patients.treatment.viewTitle")}</h3>
                          <button type="button" onClick={() => setViewPlan(null)} className="text-muted-foreground hover:text-foreground p-1" aria-label={t("common.close")}>×</button>
                        </div>
                        <div className="p-5 space-y-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold text-base">{vp.name}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{t("patients.doctorPrefix")} {vp.doctor?.firstName} {vp.doctor?.lastName}</div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${vCls[vp.status] ?? vCls.ACTIVE}`}>{t(vKey[vp.status] ?? vKey.ACTIVE)}</span>
                          </div>
                          {vp.description && <div className="text-sm text-muted-foreground">{vp.description}</div>}
                          <div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                              <span>{t("patients.treatment.progressLabel")}</span>
                              <span className="font-bold">{vCompleted}/{vp.totalSessions} ({vPct}%)</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${vPct}%` }} /></div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("patients.treatment.totalCost")}</div><div className="font-semibold">{formatCurrency(vp.totalCost)}</div></div>
                            <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("patients.treatment.daysBetween")}</div><div className="font-semibold">{vp.sessionIntervalDays}</div></div>
                            <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("patients.treatment.startLabel")}</div><div className="font-semibold">{new Date(vp.startDate).toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"})}</div></div>
                            {vp.nextExpectedDate && <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("patients.treatment.nextLabel")}</div><div className="font-semibold">{new Date(vp.nextExpectedDate).toLocaleDateString("es-MX",{day:"numeric",month:"short"})}</div></div>}
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">{t("patients.treatment.sessionsTitle")}</div>
                            {(vp.sessions?.length ?? 0) === 0 ? (
                              <div className="text-sm text-muted-foreground">{t("patients.treatment.noSessions")}</div>
                            ) : (
                              <ul className="space-y-1">
                                {vp.sessions.map((s:any)=>(
                                  <li key={s.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-1.5">
                                    <span>{t("patients.treatment.sessionN",{n:s.sessionNumber})}</span>
                                    <span className="text-xs text-muted-foreground">{s.completedAt ? new Date(s.completedAt).toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"}) : "—"}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
                          <button type="button" onClick={() => setViewPlan(null)} className="px-3 h-9 rounded-lg border border-border text-sm font-semibold hover:bg-muted">{t("common.close")}</button>
                          <button type="button" onClick={() => { const p = viewPlan; setViewPlan(null); setEditPlan(p); }} className="px-3 h-9 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 inline-flex items-center gap-1.5"><Edit className="w-3.5 h-3.5" />{t("patients.treatment.editBtn")}</button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {editPlan && (
                  <div style={{ position:"fixed", inset:0, background:"rgba(15,10,30,0.55)", backdropFilter:"blur(4px)", zIndex:80, display:"grid", placeItems:"center" }} onClick={() => !savingEditPlan && setEditPlan(null)}>
                    <div onClick={(e)=>e.stopPropagation()} className="bg-card border border-border rounded-2xl w-[min(92vw,560px)] max-h-[90vh] overflow-auto">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h3 className="text-sm font-bold">{t("patients.treatment.editTitle")}</h3>
                        <button type="button" onClick={() => !savingEditPlan && setEditPlan(null)} className="text-muted-foreground hover:text-foreground p-1" aria-label={t("common.close")}>×</button>
                      </div>
                      <div className="p-5 space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.nameLabel")}</label>
                          <input type="text" className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder={t("patients.treatment.namePlaceholder")} value={editPlanForm.name} onChange={(e)=>setEditPlanForm(f=>({...f,name:e.target.value}))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.descLabel")}</label>
                          <textarea className="flex w-full rounded-lg border border-border bg-card px-3 py-2 text-sm resize-none" rows={2} placeholder={t("patients.treatment.descPlaceholder")} value={editPlanForm.description} onChange={(e)=>setEditPlanForm(f=>({...f,description:e.target.value}))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.statusLabel")}</label>
                          <select className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" value={editPlanForm.status} onChange={(e)=>setEditPlanForm(f=>({...f,status:e.target.value}))}>
                            <option value="ACTIVE">{t("patients.treatmentStatus.active")}</option>
                            <option value="PAUSED">{t("patients.treatmentStatus.paused")}</option>
                            <option value="COMPLETED">{t("patients.treatmentStatus.completed")}</option>
                            <option value="ABANDONED">{t("patients.treatmentStatus.abandoned")}</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.totalSessions")}</label>
                            <input type="number" min={1} className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" value={editPlanForm.totalSessions} onChange={(e)=>setEditPlanForm(f=>({...f,totalSessions:e.target.value}))} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.daysBetween")}</label>
                            <input type="number" min={1} className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" value={editPlanForm.sessionIntervalDays} onChange={(e)=>setEditPlanForm(f=>({...f,sessionIntervalDays:e.target.value}))} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("patients.treatment.totalCost")}</label>
                          <input type="number" min={0} className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" value={editPlanForm.totalCost} onChange={(e)=>setEditPlanForm(f=>({...f,totalCost:e.target.value}))} />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
                        <button type="button" disabled={savingEditPlan} onClick={() => setEditPlan(null)} className="px-3 h-9 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50">{t("common.cancel")}</button>
                        <button type="button" disabled={savingEditPlan} onClick={handleUpdatePlan} className="px-3 h-9 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">{savingEditPlan ? t("patients.treatment.saving") : t("patients.treatment.saveBtn")}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ===== TAB: CITAS ===== */}
          {/* ===== TAB: REFERENCIAS ===== */}
          {tab === "referencias" && (
            <ReferralsTab patientId={patient.id} />
          )}

          {tab === "agenda" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">{t("patients.agenda.title", { count: appointments.length })}</h2>
                <button onClick={openNewAppointmentForPatient} className="text-xs font-semibold text-brand-600 hover:underline">{t("patients.agenda.schedule")}</button>
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {[
                      { id: "date", label: t("common.date") },
                      { id: "time", label: t("patients.agenda.colTime") },
                      { id: "type", label: t("patients.agenda.colType") },
                      { id: "doctor", label: t("patients.agenda.colDoctor") },
                      { id: "status", label: t("common.status") },
                      { id: "actions", label: "" },
                    ].map(h => (
                      <th key={h.id} className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {appointments.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{t("patients.agenda.empty")}</td></tr>
                  ) : appointments.map(a => {
                    const s = APPT_STATUS[a.status] ?? APPT_STATUS.PENDING;
                    return (
                      <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 font-medium">{formatDate(a.date)}</td>
                        <td className="px-4 py-2 text-muted-foreground font-mono">{a.startTime}</td>
                        <td className="px-4 py-2">{a.type}</td>
                        <td className="px-4 py-2 text-muted-foreground">{a.doctor?.firstName} {a.doctor?.lastName}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{t(s.labelKey)}</span></td>
                        <td className="px-4 py-2 text-right">
                          {a.status !== "CANCELLED" && a.status !== "COMPLETED" && (
                            <button
                              type="button"
                              onClick={() => handleCancelAppointment(a)}
                              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                              aria-label={t("patients.agenda.cancelAppt")}
                              title={t("patients.agenda.cancelAppt")}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ===== TAB: FACTURACION ===== */}
          {/* ===== TAB: RADIOGRAFIAS ===== */}
          {tab === "radiografias" && (() => {
            if (!filesLoaded) loadFiles();
            return (
              <div className="space-y-4">
                {/* Upload bar */}
                <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold">{t("patients.xrays.title")}</h2>
                    <p className="text-xs text-muted-foreground">{t("patients.xrays.fileCount", { count: files.length })}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-brand-700 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    {uploadingFile ? t("patients.xrays.uploading") : t("patients.xrays.uploadFile")}
                    <input type="file" className="hidden" accept="image/*,application/pdf" onChange={uploadFile} disabled={uploadingFile} />
                  </label>
                </div>

                {files.length === 0 && filesLoaded && (
                  <div className="bg-card border border-border rounded-xl p-10 text-center">
                    <div className="text-3xl mb-2">🩻</div>
                    <p className="text-sm font-semibold text-muted-foreground">{t("patients.xrays.empty")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("patients.xrays.emptyHint")}</p>
                  </div>
                )}

                {/* File cards */}
                {files.map((f: any) => {
                  const isImage = f.mimeType?.startsWith("image/");
                  const result  = analyses[f.id];
                  const isExp   = expandedFile === f.id;
                  const openInViewer = () =>
                    router.push(`/dashboard/xrays/${patient.id}?fileId=${f.id}`);

                  return (
                    <div key={f.id} className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="flex gap-4 p-4">
                        {/* Thumbnail (click → visor con anotaciones) */}
                        {isImage && (
                          <button
                            type="button"
                            onClick={openInViewer}
                            className="w-32 h-24 bg-black rounded-lg overflow-hidden flex-shrink-0 relative cursor-pointer hover:opacity-90 transition-opacity group"
                            aria-label={t("patients.xrays.openViewerAria", { name: f.name })}
                          >
                            <img src={f.url} alt={f.name} className="w-full h-full object-cover opacity-90" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                              <span className="text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                {t("patients.xrays.openViewer")}
                              </span>
                            </div>
                          </button>
                        )}
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <button
                              type="button"
                              onClick={openInViewer}
                              className="text-sm font-bold truncate hover:text-brand-600 hover:underline text-left"
                            >
                              {f.name}
                            </button>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                              {FILE_CAT_LABELS[f.category] ? t(FILE_CAT_LABELS[f.category]) : f.category}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {f.toothNumber && <span>{t("patients.xrays.tooth", { num: f.toothNumber })} · </span>}
                            {f.size ? `${(f.size / 1024).toFixed(0)} KB · ` : ""}
                            {new Date(f.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                          </div>
                          {f.notes && <p className="text-xs text-muted-foreground mt-1">{f.notes}</p>}

                          {/* Action buttons */}
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {isImage && (
                              <button
                                type="button"
                                onClick={openInViewer}
                                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-card text-foreground border border-border hover:bg-muted/50 transition-colors"
                              >
                                <span>🔍</span> {t("patients.xrays.openInViewer")}
                              </button>
                            )}
                            {isImage && (
                              <button
                                type="button"
                                onClick={() => analyzeFile(f.id)}
                                disabled={analyzing === f.id}
                                className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
                                  result
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-violet-600 text-white hover:bg-violet-700"
                                } disabled:opacity-60`}
                              >
                                {analyzing === f.id ? (
                                  <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("patients.xrays.analyzing")}</>
                                ) : result ? (
                                  <><span>✓</span> {t("patients.xrays.findingsView", { count: result.analysis.findings?.length ?? 0 })}</>
                                ) : (
                                  <><span>🔬</span> {t("patients.xrays.analyzeAI")}</>
                                )}
                              </button>
                            )}
                            {result && (
                              <button
                                type="button"
                                onClick={() => setExpandedFile(isExp ? null : f.id)}
                                className="text-xs font-semibold text-muted-foreground border border-border px-3 py-1.5 rounded-lg hover:bg-muted/50"
                              >
                                {isExp ? t("patients.xrays.hideResults") : t("patients.xrays.showResults")}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteFile(f)}
                              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-rose-600 border border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                              aria-label={t("patients.xrays.deleteFileAria", { name: f.name })}
                              title={t("patients.xrays.deleteFileTitle")}
                            >
                              <Trash2 className="w-3 h-3" />
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* AI Analysis results (expanded) */}
                      {result && isExp && (
                        <div className="border-t border-border bg-muted p-4 space-y-3">
                          {/* Summary */}
                          <div className="bg-violet-50 border border-violet-200 rounded-xl p-3">
                            <h4 className="text-xs font-bold text-violet-700 mb-1">{t("patients.xrays.aiSummaryTitle")}</h4>
                            <p className="text-xs text-violet-900 leading-relaxed">{result.analysis.summary}</p>
                          </div>

                          {/* Findings */}
                          {result.analysis.findings?.map((finding: any, i: number) => {
                            const sev = SEV_STYLES[finding.severity] ?? SEV_STYLES.informativo;
                            return (
                              <div key={i} className={`border rounded-xl p-3 ${sev.bg}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold ${sev.text} bg-card border`}>
                                    {finding.id ?? i + 1}
                                  </span>
                                  <span className={`text-xs font-bold ${sev.text}`}>{finding.title}</span>
                                  <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${sev.bg} ${sev.text}`}>
                                    {t(sev.labelKey)}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground ml-7 leading-relaxed">{finding.description}</p>
                                {finding.tooth && (
                                  <p className="text-[10px] text-muted-foreground ml-7 mt-1">{finding.tooth}</p>
                                )}
                                <div className="flex items-center gap-1.5 ml-7 mt-1.5">
                                  <div className="w-14 h-1 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{
                                      width: `${finding.confidence}%`,
                                      backgroundColor: finding.confidence > 80 ? "#22c55e" : finding.confidence > 60 ? "#eab308" : "#ef4444",
                                    }} />
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">{t("patients.xrays.confidence", { pct: finding.confidence })}</span>
                                </div>
                              </div>
                            );
                          })}

                          {/* Recommendations */}
                          {result.analysis.recommendations && (
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                              <h4 className="text-xs font-bold text-blue-700 mb-1">{t("patients.xrays.recommendations")}</h4>
                              <p className="text-xs text-blue-900">{result.analysis.recommendations}</p>
                            </div>
                          )}

                          {/* Disclaimer + tokens */}
                          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[10px] text-amber-700 leading-relaxed">
                                <strong>{t("patients.xrays.disclaimerLead")}</strong> {t("patients.xrays.disclaimerBody")}
                              </p>
                              <p className="text-[10px] text-amber-600 mt-1">
                                {t("patients.xrays.tokens", {
                                  used: result.tokensUsed?.toLocaleString(),
                                  remaining: result.tokensRemaining?.toLocaleString(),
                                  limit: result.tokensLimit?.toLocaleString(),
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {tab === "modelos-3d" && (
            <Models3DTab patientId={patient.id} />
          )}

          {tab === "facturacion" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">{t("patients.billing.title")}</h2>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {[
                      { id: "invoice", label: t("patients.billing.colInvoice") },
                      { id: "date", label: t("common.date") },
                      { id: "amount", label: t("patients.billing.colAmount") },
                      { id: "paid", label: t("patients.billing.colPaid") },
                      { id: "balance", label: t("patients.billing.colBalance") },
                      { id: "status", label: t("common.status") },
                    ].map(h => (
                      <th key={h.id} className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{t("patients.billing.empty")}</td></tr>
                  ) : invoices.map(inv => {
                    const s = INV_STATUS[inv.status] ?? INV_STATUS.PENDING;
                    return (
                      <tr
                        key={inv.id}
                        className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                        onClick={() => setInvoiceDetailOpen(inv)}
                      >
                        <td className="px-4 py-2 font-mono font-bold">{inv.invoiceNumber}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(inv.createdAt)}</td>
                        <td className="px-4 py-2 font-bold">{formatCurrency(inv.total)}</td>
                        <td className="px-4 py-2 text-emerald-600 font-bold">{formatCurrency(inv.paid)}</td>
                        <td className="px-4 py-2 text-rose-600 font-bold">{formatCurrency(inv.balance)}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{t(s.labelKey)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          </div>
        </div>

        <SideCards
          nextAppointment={nextAppt ? {
            date: nextAppt.date,
            startTime: nextAppt.startTime ?? "",
            type: nextAppt.type,
            doctorName: nextAppt.doctor ? `${t("patients.doctorPrefix")} ${nextAppt.doctor.firstName} ${nextAppt.doctor.lastName}` : undefined,
          } : null}
          finance={{
            total: totalPlan,
            paid: totalPaid,
            balance: totalBalance,
            pct: pctPaid,
          }}
          patientId={patient.id}
          patientName={fullName}
          patientPhone={patient.phone ?? null}
          onReschedule={openNewAppointmentForPatient}
          onCancelAppt={() => setTab("agenda")}
          onCharge={openChargeShortcut}
        />
      </div>

      {/* Treatments detected modal — post-firmar consulta */}
      <TreatmentsModal
        open={treatmentsModal.open}
        appointmentId={treatmentsModal.appointmentId}
        initialTreatments={treatmentsModal.treatments}
        onClose={() => setTreatmentsModal((m) => ({ ...m, open: false }))}
        onInvoiced={() => {
          setTreatmentsModal((m) => ({ ...m, open: false }));
          router.refresh();
        }}
      />

      {/* Edit patient modal */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-foreground font-bold">{t("patients.edit.title")}</DialogTitle></DialogHeader>
          <div className="px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t("patients.edit.firstName")}</Label><Input value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{t("patients.edit.lastName")}</Label><Input value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t("patients.edit.email")}</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{t("patients.edit.phone")}</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t("patients.edit.dob")}</Label><DateField className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 disabled:opacity-50 transition-colors" value={editForm.dob} onChange={e => setEditForm(f => ({ ...f, dob: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{t("patients.edit.gender")}</Label>
                <select className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" value={editForm.gender} onChange={e => setEditForm(f => ({ ...f, gender: e.target.value }))}>
                  <option value="M">{t("patients.edit.genderMale")}</option><option value="F">{t("patients.edit.genderFemale")}</option><option value="OTHER">{t("patients.edit.genderOther")}</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>{t("patients.edit.address")}</Label><Input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} /></div>

            {/* NOM-024 — Identificación oficial */}
            <div className="space-y-1.5">
              <Label>{t("patients.edit.officialId")}</Label>
              <div className="flex gap-2">
                {(["COMPLETE","PENDING","FOREIGN"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEditForm(f => ({ ...f, curpStatus: s }))}
                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border ${editForm.curpStatus === s ? "bg-brand-600 text-white border-brand-600" : "bg-card text-foreground border-border"}`}
                  >
                    {s === "COMPLETE" ? t("patients.edit.haveCurp") : s === "PENDING" ? t("patients.edit.noCurp") : t("patients.edit.foreigner")}
                  </button>
                ))}
              </div>
            </div>
            {editForm.curpStatus === "COMPLETE" && (
              <div className="space-y-1.5">
                <Label>{t("patients.edit.curpLabel")}</Label>
                <Input
                  className="font-mono uppercase tracking-wide"
                  maxLength={18}
                  value={editForm.curp}
                  onChange={e => setEditForm(f => ({ ...f, curp: e.target.value.toUpperCase() }))}
                  placeholder="GOPA850623HDFRRR03"
                />
              </div>
            )}
            {editForm.curpStatus === "FOREIGN" && (
              <div className="space-y-1.5">
                <Label>{t("patients.edit.passportLabel")}</Label>
                <Input
                  maxLength={20}
                  value={editForm.passportNo}
                  onChange={e => setEditForm(f => ({ ...f, passportNo: e.target.value.trim() }))}
                  placeholder="A12345678"
                />
              </div>
            )}

            <div className="space-y-1.5"><Label>{t("patients.edit.allergiesLabel")}</Label><Input value={editForm.allergies} onChange={e => setEditForm(f => ({ ...f, allergies: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{t("common.notes")}</Label>
              <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
                value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* NOM-004 — Antecedentes */}
            <div className="space-y-1.5">
              <Label>{t("patients.edit.familyHistory")}</Label>
              <textarea
                className="flex min-h-[64px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-y"
                placeholder={t("patients.edit.familyHistoryPlaceholder")}
                value={editForm.familyHistory}
                onChange={e => setEditForm(f => ({ ...f, familyHistory: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("patients.edit.personalHistory")}</Label>
              <textarea
                className="flex min-h-[64px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-y"
                placeholder={t("patients.edit.personalHistoryPlaceholder")}
                value={editForm.personalNonPathologicalHistory}
                onChange={e => setEditForm(f => ({ ...f, personalNonPathologicalHistory: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>{t("common.cancel")}</Button>
            <Button disabled={editSaving || !editForm.firstName || !editForm.lastName} onClick={async () => {
              setEditSaving(true);
              try {
                const res = await fetch(`/api/patients/${patient.id}`, {
                  method: "PUT", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ...editForm,
                    allergies: editForm.allergies ? editForm.allergies.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
                    curp:        editForm.curpStatus === "COMPLETE" ? editForm.curp.toUpperCase() : null,
                    curpStatus:  editForm.curpStatus,
                    passportNo:  editForm.curpStatus === "FOREIGN" ? editForm.passportNo : null,
                  }),
                });
                if (!res.ok) throw new Error((await res.json()).error);
                toast.success(t("patients.edit.saved"));
                setShowEdit(false);
                router.refresh();
              } catch (err: any) { toast.error(err.message ?? t("patients.edit.saveError")); }
              finally { setEditSaving(false); }
            }}>{editSaving ? t("common.saving") : t("common.saveChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de detalle de nota SOAP — abre al hacer click en una row del
       *  tab Notas SOAP. */}
      <NoteDetailModal
        open={noteDetailOpen !== null}
        note={noteDetailOpen}
        onClose={() => setNoteDetailOpen(null)}
        onUpdated={(updated) => {
          setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
          setNoteDetailOpen(null);
        }}
      />

      {/* Modal de detalle de factura — abre al hacer click en una row del
       *  tab Facturación. Reusa el componente del módulo /dashboard/billing,
       *  que ya soporta editar precio, descuento, cancelar, cobrar y
       *  reembolsar. Tras una mutación, router.refresh() re-fetchea las
       *  facturas desde el servidor. */}
      <InvoiceDetailModal
        open={invoiceDetailOpen !== null}
        invoice={invoiceDetailOpen}
        patientName={fullName}
        onClose={() => setInvoiceDetailOpen(null)}
        onMutated={() => router.refresh()}
      />
    </div>
  );
}
