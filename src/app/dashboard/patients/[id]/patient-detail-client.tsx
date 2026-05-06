"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Phone, Mail, Calendar, AlertTriangle, Plus, Printer, Edit, Download } from "lucide-react";
import { formatCurrency, formatDate, getInitials, avatarColor } from "@/lib/utils";
import { ageFromDob, fmtMXN } from "@/lib/format";
import { Odontogram } from "@/components/dashboard/odontogram/Odontogram";
import { HeroCard } from "@/components/dashboard/patient-detail/hero-card";
import { TreatmentsModal, type SuggestedTreatment } from "@/components/dashboard/patient-detail/treatments-modal";
import { QuickNav } from "@/components/dashboard/patient-detail/quick-nav";
import { SideCards } from "@/components/dashboard/patient-detail/side-cards";
import { ConsultBar } from "@/components/dashboard/patient-detail/consult-bar";
import { SoapEditorInline, type SoapDraft } from "@/components/dashboard/patient-detail/soap-editor-inline";
import { NoteDetailModal, type ClinicalNote } from "@/components/dashboard/patient-detail/note-detail-modal";
import { HistoriaTimeline } from "@/components/dashboard/patient-detail/historia-timeline";
import patientDetailStyles from "@/components/dashboard/patient-detail/patient-detail.module.css";
import { DentalForm }          from "@/components/clinical/dental-form";
import { NutritionForm }       from "@/components/clinical/nutrition-form";
import { PsychologyForm }      from "@/components/clinical/psychology-form";
import { GeneralMedicineForm } from "@/components/clinical/medicine-form";
import { EvolutionChart, TreatmentTimeline } from "@/components/clinical/shared";
import { ReferralsTab } from "@/components/dashboard/patients/referrals-tab";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { SoapPrefill } from "@/lib/types/endodontics";

// Pediatrics — lazy load del módulo. Solo carga el bundle cuando el doctor
// abre la pestaña, evitando inflar el bundle del paciente cuando no aplica.
const PediatricsTab = dynamicImport(
  () => import("@/components/patient-detail/pediatrics/PediatricsTab").then((m) => ({ default: m.PediatricsTab })),
  { ssr: false, loading: () => <div className="text-xs text-muted-foreground p-4">Cargando módulo de pediatría…</div> },
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
      <div className="text-xs text-muted-foreground p-4">Cargando módulo de periodoncia…</div>
    ),
  },
);

// MediFlow es DENTAL — el form de "Nueva consulta" siempre usa DentalForm.
// El parámetro `specialty` viene del Clinic.specialty (legacy) y se ignora.
// Si en el futuro MediFlow expande a otras specialties, restaurar la
// lógica de detección y los renders condicionales abajo.
function detectSpecialty(_raw: string) {
  return "dental";
}

const APPT_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "Pendiente",  cls: "bg-amber-50 text-amber-700 border border-amber-200"      },
  CONFIRMED: { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  COMPLETED: { label: "Completada", cls: "bg-muted text-muted-foreground border border-border"      },
  CANCELLED: { label: "Cancelada",  cls: "bg-rose-50 text-rose-700 border border-rose-200"          },
  NO_SHOW:   { label: "No asistió", cls: "bg-muted text-muted-foreground border border-border"       },
};

const INV_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pendiente", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  PARTIAL: { label: "Parcial",   cls: "bg-blue-50 text-blue-700 border border-blue-200"   },
  PAID:    { label: "Pagado",    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  OVERDUE: { label: "Vencido",   cls: "bg-rose-50 text-rose-700 border border-rose-200"   },
};

const TABS_BASE = [
  { id: "resumen",       label: "Resumen"             },
  { id: "historia",      label: "Historia clínica"     },
  { id: "odontograma",   label: "Odontograma"          },
  { id: "expediente",    label: "Nueva consulta"       },
  { id: "evolucion",     label: "Evolución / Notas"    },
  { id: "radiografias",  label: "Radiografías"         },
  { id: "tratamiento",   label: "Plan de tratamiento"  },
  { id: "referencias",   label: "Referencias"          },
  { id: "agenda",        label: "Citas"                },
  { id: "facturacion",   label: "Facturación"          },
];

interface PatientTab {
  id: string;
  label: string;
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
}): PatientTab[] {
  const out: PatientTab[] = [...TABS_BASE];
  // Insertar "Pediatría" entre "Historia clínica" y "Odontograma" según spec §1.2.
  if (opts.pediatrics.state !== "hidden") {
    out.splice(2, 0, {
      id:             "pediatria",
      label:          "Pediatría",
      disabled:       opts.pediatrics.state === "disabled",
      disabledReason: opts.pediatrics.state === "disabled" ? opts.pediatrics.reason : undefined,
    });
  }
  // Insertar "Periodoncia" justo antes de "Odontograma" — entre Historia
  // clínica/Pediatría y Odontograma. Si Pediatría está, queda en posición
  // 3; si no, queda en posición 2.
  if (opts.showPeriodontics) {
    const odontoIdx = out.findIndex((t) => t.id === "odontograma");
    out.splice(odontoIdx >= 0 ? odontoIdx : 2, 0, { id: "periodoncia", label: "Periodoncia" });
  }
  return out;
}

const SEV_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  alta:        { bg: "bg-rose-50 border-rose-200",    text: "text-rose-700",    label: "Prioridad alta"  },
  media:       { bg: "bg-amber-50 border-amber-200",  text: "text-amber-700",   label: "Prioridad media" },
  baja:        { bg: "bg-blue-50 border-blue-200",    text: "text-blue-700",    label: "Prioridad baja"  },
  informativo: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", label: "Informativo" },
};

const FILE_CAT_LABELS: Record<string, string> = {
  XRAY_PERIAPICAL: "Periapical", XRAY_PANORAMIC: "Panorámica", XRAY_BITEWING: "Bitewing",
  XRAY_OCCLUSAL: "Oclusal", PHOTO_INTRAORAL: "Foto intraoral", PHOTO_EXTRAORAL: "Foto extraoral",
  PHOTO_PROGRESS: "Progreso", CONSENT_FORM: "Consentimiento", OTHER: "Otro",
};

interface Props {
  patient:      any;
  records:      any[];
  appointments: any[];
  invoices:     any[];
  doctors:      { id: string; firstName: string; lastName: string }[];
  currentUser:  { id: string; firstName: string; lastName: string };
  specialty:    string;
  totalPaid:    number;
  totalBalance: number;
  totalPlan:    number;
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
  endoSoapPrefill?: SoapPrefill | null;
}

export function PatientDetailClient({
  patient, records: initialRecords, appointments, invoices,
  doctors, currentUser, specialty, totalPaid, totalBalance, totalPlan, treatments, portalUrl,
  pediatricsData,
  pediatricsModuleActive = false,
  perioData,
  endoSoapPrefill,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pediatricsState = derivePediatricsTabState({
    hasData:      Boolean(pediatricsData),
    moduleActive: pediatricsModuleActive,
  });
  const showPediatrics = pediatricsState === "enabled";
  const showPeriodontics = Boolean(perioData);
  const tabs = useMemo(
    () => buildTabs({
      pediatrics:      { state: pediatricsState, reason: PEDIATRICS_DISABLED_REASON },
      showPeriodontics,
    }),
    [pediatricsState, showPeriodontics],
  );
  const tabFromUrl = searchParams.get("tab");
  const initialTab =
    tabFromUrl === "pediatria" && showPediatrics
      ? "pediatria"
      : tabFromUrl === "periodoncia" && showPeriodontics
        ? "periodoncia"
        : "resumen";
  const [tab, setTab]         = useState(initialTab);
  const [consultPaused, setConsultPaused] = useState(false);
  const [consultClosed, setConsultClosed] = useState(false);
  const [noteDetailOpen, setNoteDetailOpen] = useState<ClinicalNote | null>(null);
  const [treatmentsModal, setTreatmentsModal] = useState<{
    open: boolean;
    appointmentId: string;
    treatments: SuggestedTreatment[];
  }>({ open: false, appointmentId: "", treatments: [] });
  const [records, setRecords] = useState(initialRecords);
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
  const [showNewAppt, setShowNewAppt] = useState(false);
  const [apptForm, setApptForm] = useState({
    doctorId: currentUser.id, type: "Consulta general",
    date: new Date().toISOString().split("T")[0],
    startTime: "09:00", endTime: "09:30", notes: "",
  });
  const [savingAppt, setSavingAppt] = useState(false);
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
      toast.success("Archivo subido");
    } catch (err: any) {
      toast.error(err.message ?? "Error al subir");
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
      toast.success(`Análisis completado — ${data.analysis.findings?.length ?? 0} hallazgos`);
    } catch (err: any) {
      toast.error(err.message ?? "Error al analizar");
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
      toast.success("🔗 Link del portal copiado al portapapeles");
    } catch (err: any) {
      toast.error(err.message ?? "Error al generar portal");
    } finally {
      setGeneratingPortal(false);
    }
  }

  const detectedSpecialty = detectSpecialty(specialty);

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
      return { data, metric: "Peso", color: "#fbbf24", unit: "kg" as string | undefined, normalRange: undefined as { min: number; max: number } | undefined };
    }
    if (detectedSpecialty === "psychology") {
      const data = records
        .filter((r: any) => r?.specialtyData?.scales?.phq9?.score !== undefined)
        .map((r: any) => ({
          date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
          value: Number(r.specialtyData.scales.phq9.score),
        }))
        .reverse();
      return { data, metric: "PHQ-9 · Depresión", color: "#38bdf8", unit: undefined, normalRange: { min: 0, max: 4 } };
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
    return { data: data.reverse(), metric: "TA Sistólica", color: "#34d399", unit: "mmHg", normalRange: { min: 90, max: 120 } };
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
        title: `Sesión ${i + 1}`,
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
  const pctPaid  = totalPlan > 0 ? Math.round((totalPaid / totalPlan) * 100) : 0;

  function handleRecordSaved(record: any) {
    setRecords(prev => [record, ...prev]);
    toast.success("Expediente guardado");
    setTab("evolucion");
  }

  async function createAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (savingAppt) return;
    setSavingAppt(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...apptForm, patientId: patient.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Cita agendada");
      setShowNewAppt(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? "Error al agendar");
    } finally {
      setSavingAppt(false);
    }
  }

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
          err instanceof Error ? err.message : "No se pudo crear borrador",
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
        toast.success("Archivo adjunto");
        return {
          id: uploaded.id,
          name: uploaded.name ?? file.name,
          mime: uploaded.mimeType ?? file.type,
        };
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo adjuntar");
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
      toast.success("Consulta completada y firmada");
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
      toast.error(err instanceof Error ? err.message : "No se pudo completar");
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
      ? `Dr/a. ${activeAppointment.doctor.firstName} ${activeAppointment.doctor.lastName ?? ""}`.trim()
      : null;

  return (
    <div style={{ padding: "20px 28px 28px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
        <Link href="/dashboard/patients" style={{ color: "var(--text-3)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ArrowLeft size={12} /> Pacientes
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
          title="Exportar expediente en formato HL7 CDA R2 (NOM-024)"
        >
          <Download size={11} aria-hidden /> Exportar CDA HL7
        </button>
      </div>

      {/* Hero card permanente — audit Opción C ajuste 1 */}
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
          allergies: patient.allergies ?? [],
          chronicConditions: patient.chronicConditions ?? [],
          currentMedications: patient.currentMedications ?? [],
        }}
        nextAppointment={nextAppt ? {
          id: nextAppt.id,
          date: nextAppt.date,
          startTime: nextAppt.startTime ?? "",
          type: nextAppt.type,
          doctorName: nextAppt.doctor ? `Dr/a. ${nextAppt.doctor.firstName} ${nextAppt.doctor.lastName}` : undefined,
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
        onReschedule={() => {
          // Por ahora redirige al tab Citas; en una futura iteración abrir picker inline.
          setTab("agenda");
        }}
        onCharge={() => setTab("facturacion")}
      />

      {/* Pediatrics — chips informativos cuando aplica el módulo (spec §1.3) */}
      {pediatricsData && (
        <div className="flex flex-wrap items-center gap-2 px-1 -mt-2 mb-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200">
            <span className="font-mono">{pediatricsData.ageFormatted}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold capitalize">
            Dentición {pediatricsData.dentition}
          </span>
          {pediatricsData.latestCambra ? (
            <span className={`cambra-chip cambra-chip--${pediatricsData.latestCambra.category}`}>
              <span className="cambra-chip__dot" aria-hidden />
              CAMBRA {pediatricsData.latestCambra.category}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setTab("pediatria")}
            className="ml-auto text-xs font-semibold text-violet-700 hover:underline dark:text-violet-200"
          >
            Ir a Pediatría →
          </button>
        </div>
      )}

      {/* Layout 3 columnas — audit Opción C ajuste 3 */}
      <div
        className={`${patientDetailStyles.layout} ${
          tab === "odontograma" ? patientDetailStyles.layoutWide : ""
        }`}
      >
        <QuickNav
          activeTab={tab}
          onSelect={setTab}
          counts={{
            historia: records.length,
            evolucion: records.length,
            radiografias: filesLoaded ? files.length : undefined,
            tratamiento: treatments.length,
            agenda: appointments.length,
            facturacion: invoices.length,
            pediatria: pediatricsData?.pendingConsents.length ?? 0,
            periodoncia: perioData?.recordsCount ?? 0,
          }}
          hasBalance={totalBalance > 0}
          pediatrics={{ state: pediatricsState, reason: PEDIATRICS_DISABLED_REASON }}
          showPeriodontics={showPeriodontics}
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
            aria-label="Secciones del paciente"
          >
            {tabs.map((t) => {
              const isActive = tab === t.id;
              const count = tabCounts[t.id];
              const isDisabled = t.disabled === true;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`patient-tab-${t.id}`}
                  aria-selected={isActive}
                  aria-controls={`patient-panel-${t.id}`}
                  aria-disabled={isDisabled || undefined}
                  disabled={isDisabled}
                  title={isDisabled ? t.disabledReason : undefined}
                  className={`${patientDetailStyles.mobileTabBtn} ${
                    isActive ? patientDetailStyles.mobileTabBtnActive : ""
                  } ${isDisabled ? patientDetailStyles.mobileTabBtnDisabled : ""}`}
                  onClick={() => { if (!isDisabled) setTab(t.id); }}
                >
                  {t.label}
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
                  <span className="text-xs font-bold">Resumen clínico</span>
                </div>
                {records.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin registros clínicos aún.</p>
                ) : (
                  <div className="space-y-1.5">
                    {[
                      { label: "Motivo último consulta", val: records[0]?.subjective?.slice(0, 50) ?? "—" },
                      { label: "Diagnóstico",            val: records[0]?.assessment?.slice(0, 50) ?? "—" },
                      { label: "Plan",                   val: records[0]?.plan?.slice(0, 50) ?? "—" },
                    ].map(r => (
                      <div key={r.label} className="flex justify-between items-start py-1.5 border-b border-slate-50 text-xs">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-semibold text-right max-w-[55%]">{r.val}</span>
                      </div>
                    ))}
                  </div>
                )}
                {records[0]?.specialtyData?.periodontal && (
                  <div className="mt-3">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Semáforo clínico</div>
                    <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold text-center">
                      <div className="bg-emerald-50 text-emerald-700 rounded-lg py-1.5">✓ Higiene<br/>Buena</div>
                      <div className="bg-amber-50 text-amber-700 rounded-lg py-1.5">⚠ Caries<br/>Moderado</div>
                      <div className="bg-rose-50 text-rose-700 rounded-lg py-1.5">✕ Perio<br/>{records[0]?.specialtyData?.periodontal?.gingival ?? "Sin datos"}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold">Historia clínica</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {[
                    { label: "Enfermedades sistémicas", val: patient.chronicConditions?.join(", ") || "Ninguna" },
                    { label: "Alergias",                val: patient.allergies?.join(", ") || "Ninguna" },
                    { label: "Medicamentos",            val: patient.currentMedications?.join(", ") || "Ninguno" },
                    { label: "Tipo de sangre",          val: patient.bloodType || "No registrado" },
                    { label: "Seguro",                  val: patient.insuranceProvider || "Sin seguro" },
                    { label: "Notas",                   val: patient.notes?.slice(0, 60) || "—" },
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
                    <span className="text-xs font-bold">Próxima cita</span>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <div className="text-sm font-extrabold text-brand-700">{formatDate(nextAppt.date)}</div>
                    <div className="text-xs text-foreground mt-1">{nextAppt.type}</div>
                    <div className="text-[10px] text-muted-foreground">{nextAppt.startTime}h · Dr/a. {nextAppt.doctor?.firstName} {nextAppt.doctor?.lastName}</div>
                  </div>
                </div>
              )}

              {/* Finanzas resumen */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs font-bold">Finanzas</span>
                </div>
                <div className="space-y-1.5 text-xs mb-3">
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-muted-foreground">Total plan</span>
                    <span className="font-bold">{formatCurrency(totalPlan)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-muted-foreground">Pagado</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-muted-foreground">Pendiente</span>
                    <span className="font-bold text-rose-600">{formatCurrency(totalBalance)}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pctPaid}%` }} />
                </div>
                <div className="text-[10px] text-muted-foreground text-right mt-1">{pctPaid}% cubierto</div>
              </div>
            </div>
          )}

          {/* ===== TAB: HISTORIA CLINICA ===== */}
          {tab === "historia" && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-sm font-bold">Historia clínica</h2>
                <p className="text-xs text-muted-foreground">
                  Timeline cronológica de todos los eventos clínicos del paciente.
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

          {/* ===== TAB: ODONTOGRAMA ===== */}
          {tab === "odontograma" && (
            <Odontogram patientId={patient.id} />
          )}

          {/* ===== TAB: NUEVA CONSULTA (specialty form) ===== */}
          {tab === "expediente" && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-bold mb-4">
                {detectedSpecialty === "dental"     ? "🦷 Nueva consulta dental" :
                 detectedSpecialty === "nutrition"  ? "🥗 Nueva consulta nutricional" :
                 detectedSpecialty === "psychology" ? "🧠 Nueva sesión" :
                 "🩺 Nueva consulta médica"}
              </h2>
              {detectedSpecialty === "dental"     && <DentalForm          patientId={patient.id} isChild={!!patient.isChild} onSaved={handleRecordSaved} />}
              {detectedSpecialty === "nutrition"  && <NutritionForm       patientId={patient.id} patient={patient} onSaved={handleRecordSaved} />}
              {detectedSpecialty === "psychology" && <PsychologyForm      patientId={patient.id} sessionNum={records.length + 1} onSaved={handleRecordSaved} />}
              {detectedSpecialty === "medicine"   && <GeneralMedicineForm patientId={patient.id} onSaved={handleRecordSaved} />}
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
                          Agrega 2+ consultas para ver evolución de {mainChart.metric}
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
                <h2 className="text-sm font-bold">Evolución clínica — {records.length} consulta{records.length !== 1 ? "s" : ""}</h2>
                <button onClick={() => setTab("expediente")} className="text-xs font-semibold text-brand-600 hover:underline">+ Nueva nota SOAP</button>
              </div>
              <div className="p-5">
                {records.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-3">No hay notas clínicas aún</p>
                    <button onClick={() => setTab("expediente")} className="text-xs font-semibold text-brand-600 hover:underline">Crear primera consulta →</button>
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
                          aria-label={`Ver detalle de consulta del ${formatDate(record.visitDate)}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">{formatDate(record.visitDate)}</span>
                              <span
                                className={`${patientDetailStyles.noteRowStatusBadge} ${
                                  isSigned ? patientDetailStyles.signed : patientDetailStyles.draft
                                }`}
                              >
                                {isSigned ? "Firmada" : "Borrador"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-brand-600">Dr/a. {record.doctor?.firstName} {record.doctor?.lastName}</span>
                              <span className={patientDetailStyles.noteRowChevron} aria-hidden>›</span>
                            </div>
                          </div>
                          {record.subjective && (
                            <p className="text-xs text-foreground mb-1.5 leading-relaxed">{record.subjective}</p>
                          )}
                          {record.assessment && (
                            <div className="text-xs"><span className="font-bold text-muted-foreground">Dx:</span> {record.assessment}</div>
                          )}
                          {record.plan && (
                            <div className="text-xs mt-1"><span className="font-bold text-muted-foreground">Plan:</span> {record.plan}</div>
                          )}
                          {/* Specialty badges */}
                          {record.specialtyData?.procedures?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {record.specialtyData.procedures.map((p: any) => {
                                const label = typeof p === "string" ? p : (p?.name ?? "Procedimiento");
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
                              {record.specialtyData.anthropometrics.weight && <span>Peso: <strong>{record.specialtyData.anthropometrics.weight}kg</strong></span>}
                              {record.specialtyData.anthropometrics.bmi    && <span>IMC: <strong>{record.specialtyData.anthropometrics.bmi}</strong></span>}
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
          {tab === "tratamiento" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">Planes de tratamiento</h2>
                <a href="/dashboard/treatments" className="text-xs font-semibold text-brand-600 hover:underline">
                  + Nuevo plan →
                </a>
              </div>
              {treatments.length === 0 ? (
                <div className="bg-card border border-border rounded-xl px-5 py-10 text-center text-muted-foreground">
                  <div className="text-3xl mb-2">💊</div>
                  <div className="text-sm font-semibold">Sin planes de tratamiento</div>
                  <a href="/dashboard/treatments" className="text-xs text-brand-600 hover:underline mt-1 block">
                    Crear primer plan →
                  </a>
                </div>
              ) : treatments.map((t: any) => {
                const pct = t.totalSessions > 0 ? Math.round((t.sessions.length / t.totalSessions) * 100) : 0;
                const STATUS_CFG: Record<string,{label:string;cls:string}> = {
                  ACTIVE:    { label:"Activo",     cls:"bg-emerald-50 text-emerald-700 border-emerald-200" },
                  COMPLETED: { label:"Completado", cls:"bg-muted text-muted-foreground border-border"      },
                  ABANDONED: { label:"Abandonado", cls:"bg-rose-50 text-rose-700 border-rose-200"          },
                  PAUSED:    { label:"Pausado",    cls:"bg-amber-50 text-amber-700 border-amber-200"       },
                };
                const cfg = STATUS_CFG[t.status] ?? STATUS_CFG.ACTIVE;
                return (
                  <div key={t.id} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="font-bold text-sm">{t.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Dr/a. {t.doctor?.firstName} {t.doctor?.lastName}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-muted-foreground">
                        {t.sessions.length}/{t.totalSessions} sesiones
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>💰 {formatCurrency(t.totalCost)}</span>
                      <span>📅 Cada {t.sessionIntervalDays} días</span>
                      {t.nextExpectedDate && (
                        <span>⏰ Próxima: {new Date(t.nextExpectedDate).toLocaleDateString("es-MX",{day:"numeric",month:"short"})}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ===== TAB: CITAS ===== */}
          {/* ===== TAB: REFERENCIAS ===== */}
          {tab === "referencias" && (
            <ReferralsTab patientId={patient.id} />
          )}

          {tab === "agenda" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">Citas — {appointments.length} total</h2>
                <button onClick={() => setShowNewAppt(true)} className="text-xs font-semibold text-brand-600 hover:underline">+ Agendar</button>
              </div>

              {showNewAppt && (
                <div className="border-b border-border p-4 bg-brand-600/15">
                  <h3 className="text-xs font-bold text-brand-700 mb-3">Nueva cita para {patient.firstName} {patient.lastName}</h3>
                  <form onSubmit={createAppointment} className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Doctor</label>
                      <select className="flex h-8 w-full rounded-lg border border-border bg-card px-2 text-xs mt-0.5"
                        value={apptForm.doctorId} onChange={e => setApptForm(f => ({ ...f, doctorId: e.target.value }))}>
                        {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Tipo</label>
                      <select className="flex h-8 w-full rounded-lg border border-border bg-card px-2 text-xs mt-0.5"
                        value={apptForm.type} onChange={e => setApptForm(f => ({ ...f, type: e.target.value }))}>
                        {["Consulta general","Control","Urgencia","Primera vez","Cirugía","Seguimiento","Otro"].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Fecha</label>
                      <input type="date" className="flex h-8 w-full rounded-lg border border-border bg-card px-2 text-xs mt-0.5"
                        value={apptForm.date} onChange={e => setApptForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Hora inicio</label>
                      <input type="time" className="flex h-8 w-full rounded-lg border border-border bg-card px-2 text-xs mt-0.5"
                        value={apptForm.startTime} onChange={e => setApptForm(f => ({ ...f, startTime: e.target.value }))} />
                    </div>
                    <div className="col-span-2 lg:col-span-4 flex gap-2 mt-1">
                      <button type="submit" disabled={savingAppt} className="text-xs font-bold bg-brand-600 text-white px-4 py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-50">
                        {savingAppt ? "Agendando…" : "Confirmar cita"}
                      </button>
                      <button type="button" onClick={() => setShowNewAppt(false)} className="text-xs font-semibold border border-border px-4 py-1.5 rounded-lg hover:bg-muted">Cancelar</button>
                    </div>
                  </form>
                </div>
              )}

              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {["Fecha","Hora","Tipo","Doctor","Estado"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {appointments.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Sin citas registradas</td></tr>
                  ) : appointments.map(a => {
                    const s = APPT_STATUS[a.status] ?? APPT_STATUS.PENDING;
                    return (
                      <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 font-medium">{formatDate(a.date)}</td>
                        <td className="px-4 py-2 text-muted-foreground font-mono">{a.startTime}</td>
                        <td className="px-4 py-2">{a.type}</td>
                        <td className="px-4 py-2 text-muted-foreground">{a.doctor?.firstName} {a.doctor?.lastName}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span></td>
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
                    <h2 className="text-sm font-bold">Radiografías y archivos</h2>
                    <p className="text-xs text-muted-foreground">{files.length} archivo{files.length !== 1 ? "s" : ""}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-brand-700 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    {uploadingFile ? "Subiendo…" : "Subir archivo"}
                    <input type="file" className="hidden" accept="image/*,application/pdf" onChange={uploadFile} disabled={uploadingFile} />
                  </label>
                </div>

                {files.length === 0 && filesLoaded && (
                  <div className="bg-card border border-border rounded-xl p-10 text-center">
                    <div className="text-3xl mb-2">🩻</div>
                    <p className="text-sm font-semibold text-muted-foreground">Sin radiografías</p>
                    <p className="text-xs text-muted-foreground mt-1">Sube la primera radiografía para poder analizarla con IA</p>
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
                            aria-label={`Abrir ${f.name} en visor con anotaciones`}
                          >
                            <img src={f.url} alt={f.name} className="w-full h-full object-cover opacity-90" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                              <span className="text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                Abrir visor
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
                              {FILE_CAT_LABELS[f.category] ?? f.category}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {f.toothNumber && <span>Pieza #{f.toothNumber} · </span>}
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
                                <span>🔍</span> Abrir en visor
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
                                  <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analizando…</>
                                ) : result ? (
                                  <><span>✓</span> {result.analysis.findings?.length ?? 0} hallazgos — Ver</>
                                ) : (
                                  <><span>🔬</span> Analizar con IA</>
                                )}
                              </button>
                            )}
                            {result && (
                              <button
                                type="button"
                                onClick={() => setExpandedFile(isExp ? null : f.id)}
                                className="text-xs font-semibold text-muted-foreground border border-border px-3 py-1.5 rounded-lg hover:bg-muted/50"
                              >
                                {isExp ? "Ocultar" : "Mostrar"} resultados
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* AI Analysis results (expanded) */}
                      {result && isExp && (
                        <div className="border-t border-border bg-muted p-4 space-y-3">
                          {/* Summary */}
                          <div className="bg-violet-50 border border-violet-200 rounded-xl p-3">
                            <h4 className="text-xs font-bold text-violet-700 mb-1">Resumen del análisis IA</h4>
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
                                    {sev.label}
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
                                  <span className="text-[10px] text-muted-foreground">Confianza: {finding.confidence}%</span>
                                </div>
                              </div>
                            );
                          })}

                          {/* Recommendations */}
                          {result.analysis.recommendations && (
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                              <h4 className="text-xs font-bold text-blue-700 mb-1">Recomendaciones</h4>
                              <p className="text-xs text-blue-900">{result.analysis.recommendations}</p>
                            </div>
                          )}

                          {/* Disclaimer + tokens */}
                          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[10px] text-amber-700 leading-relaxed">
                                <strong>Herramienta de apoyo diagnóstico.</strong> Este análisis es generado por IA y NO sustituye el juicio clínico del profesional.
                              </p>
                              <p className="text-[10px] text-amber-600 mt-1">
                                Tokens usados: {result.tokensUsed?.toLocaleString()} · Restantes: {result.tokensRemaining?.toLocaleString()} / {result.tokensLimit?.toLocaleString()}
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

          {tab === "facturacion" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">Facturación</h2>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {["Factura","Fecha","Monto","Pagado","Saldo","Estado"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Sin facturas</td></tr>
                  ) : invoices.map(inv => {
                    const s = INV_STATUS[inv.status] ?? INV_STATUS.PENDING;
                    return (
                      <tr key={inv.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono font-bold">{inv.invoiceNumber}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(inv.createdAt)}</td>
                        <td className="px-4 py-2 font-bold">{formatCurrency(inv.total)}</td>
                        <td className="px-4 py-2 text-emerald-600 font-bold">{formatCurrency(inv.paid)}</td>
                        <td className="px-4 py-2 text-rose-600 font-bold">{formatCurrency(inv.balance)}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span></td>
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
            doctorName: nextAppt.doctor ? `Dr/a. ${nextAppt.doctor.firstName} ${nextAppt.doctor.lastName}` : undefined,
          } : null}
          finance={{
            total: totalPlan,
            paid: totalPaid,
            balance: totalBalance,
            pct: pctPaid,
          }}
          patientName={fullName}
          patientPhone={patient.phone ?? null}
          onReschedule={() => setTab("agenda")}
          onCancelAppt={() => setTab("agenda")}
          onCharge={() => setTab("facturacion")}
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
          <DialogHeader><DialogTitle className="text-foreground font-bold">Editar paciente</DialogTitle></DialogHeader>
          <div className="px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Nombre *</Label><Input value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Apellido *</Label><Input value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Teléfono</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Fecha de nacimiento</Label><Input type="date" value={editForm.dob} onChange={e => setEditForm(f => ({ ...f, dob: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Género</Label>
                <select className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" value={editForm.gender} onChange={e => setEditForm(f => ({ ...f, gender: e.target.value }))}>
                  <option value="M">Masculino</option><option value="F">Femenino</option><option value="OTHER">Otro</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Dirección</Label><Input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} /></div>

            {/* NOM-024 — Identificación oficial */}
            <div className="space-y-1.5">
              <Label>Identificación oficial</Label>
              <div className="flex gap-2">
                {(["COMPLETE","PENDING","FOREIGN"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEditForm(f => ({ ...f, curpStatus: s }))}
                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border ${editForm.curpStatus === s ? "bg-brand-600 text-white border-brand-600" : "bg-card text-foreground border-border"}`}
                  >
                    {s === "COMPLETE" ? "Tengo CURP" : s === "PENDING" ? "No la tengo" : "Extranjero"}
                  </button>
                ))}
              </div>
            </div>
            {editForm.curpStatus === "COMPLETE" && (
              <div className="space-y-1.5">
                <Label>CURP *</Label>
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
                <Label>Pasaporte *</Label>
                <Input
                  maxLength={20}
                  value={editForm.passportNo}
                  onChange={e => setEditForm(f => ({ ...f, passportNo: e.target.value.trim() }))}
                  placeholder="A12345678"
                />
              </div>
            )}

            <div className="space-y-1.5"><Label>Alergias (separadas por comas)</Label><Input value={editForm.allergies} onChange={e => setEditForm(f => ({ ...f, allergies: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Notas</Label>
              <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
                value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* NOM-004 — Antecedentes */}
            <div className="space-y-1.5">
              <Label>Antecedentes heredofamiliares</Label>
              <textarea
                className="flex min-h-[64px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-y"
                placeholder="Madre con DM2, padre HTA, hermano cardiopatía isquémica…"
                value={editForm.familyHistory}
                onChange={e => setEditForm(f => ({ ...f, familyHistory: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Antecedentes personales no patológicos</Label>
              <textarea
                className="flex min-h-[64px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-y"
                placeholder="Alimentación, higiene, alcohol, tabaco, ejercicio, vivienda…"
                value={editForm.personalNonPathologicalHistory}
                onChange={e => setEditForm(f => ({ ...f, personalNonPathologicalHistory: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancelar</Button>
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
                toast.success("Paciente actualizado");
                setShowEdit(false);
                router.refresh();
              } catch (err: any) { toast.error(err.message ?? "Error al guardar"); }
              finally { setEditSaving(false); }
            }}>{editSaving ? "Guardando…" : "Guardar cambios"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de detalle de nota SOAP — abre al hacer click en una row del
       *  tab Evolución / Notas. */}
      <NoteDetailModal
        open={noteDetailOpen !== null}
        note={noteDetailOpen}
        onClose={() => setNoteDetailOpen(null)}
        onUpdated={(updated) => {
          setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
          setNoteDetailOpen(null);
        }}
      />
    </div>
  );
}
