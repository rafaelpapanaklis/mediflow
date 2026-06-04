"use client";
import { useState, useEffect, useMemo } from "react";
import { FileText } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { CardNew } from "@/components/ui/design-system/card-new";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";
import { TreatmentTimeline } from "@/components/clinical/shared";
import { PrescriptionModal } from "@/components/clinical/shared/prescription-modal";
import { useT } from "@/i18n/i18n-provider";

interface CatalogProcedure { id: string; name: string; basePrice: number; category: string }
interface SelectedProcedure { id: string; name: string; price: number; quantity: number }

// labelKey resolves via t() at render time (never call t() at module scope).
const TOOTH_CONDITIONS: Record<string, { labelKey: string; color: string; bg: string; border: string }> = {
  healthy:      { labelKey: "clinical.dentalForm.condHealthy",     color: "#94a3b8", bg: "#fff",    border: "#94a3b8" },
  caries:       { labelKey: "clinical.dentalForm.condCaries",      color: "#7f1d1d", bg: "#fca5a5", border: "#ef4444" },
  restoration:  { labelKey: "clinical.dentalForm.condRestoration", color: "#1e3a8a", bg: "#bfdbfe", border: "#3b82f6" },
  crown:        { labelKey: "clinical.dentalForm.condCrown",       color: "#78350f", bg: "#fde68a", border: "#f59e0b" },
  endo:         { labelKey: "clinical.dentalForm.condEndo",        color: "#4c1d95", bg: "#c4b5fd", border: "#7c3aed" },
  absent:       { labelKey: "clinical.dentalForm.condAbsent",      color: "#94a3b8", bg: "#f1f5f9", border: "#cbd5e1" },
  extraction:   { labelKey: "clinical.dentalForm.condExtraction",  color: "#7c2d12", bg: "#fed7aa", border: "#f97316" },
  implant:      { labelKey: "clinical.dentalForm.condImplant",     color: "#064e3b", bg: "#a7f3d0", border: "#10b981" },
};

const UPPER_TEETH = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
const LOWER_TEETH = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

// Dentición temporal (FDI notation for primary teeth)
const UPPER_PRIMARY = [55,54,53,52,51, 61,62,63,64,65];
const LOWER_PRIMARY = [85,84,83,82,81, 71,72,73,74,75];
// Procedures are now loaded from /api/procedures catalog per clinic

// Surface keys: O=Oclusal/Incisal, M=Mesial, D=Distal, V=Vestibular, L=Lingual/Palatino
const SURFACES = ["O","M","D","V","L"] as const;
type Surface = typeof SURFACES[number];
type ToothSurfaces = Partial<Record<Surface, string>>;
// Whole-tooth conditions (applied to entire tooth, not per-surface)
const WHOLE_TOOTH_CONDITIONS = ["absent","extraction","implant","endo","crown"];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
  isChild?: boolean;
  /**
   * Cuando se pasa un record existente, el form arranca en modo EDIT:
   * pre-llena todos los campos con los datos del record y handleSave
   * hace PATCH al record (no POST nuevo).
   */
  initialRecord?: {
    id: string;
    subjective: string | null;
    objective: string | null;
    assessment: string | null;
    plan: string | null;
    specialtyData?: any;
  };
}

export function DentalForm({ patientId, onSaved, isChild = false, initialRecord }: Props) {
  const t = useT();
  const isEditing = !!initialRecord;
  const initialSpec = (initialRecord?.specialtyData ?? {}) as any;
  const [saving,     setSaving]     = useState(false);
  const [activeTool, setActiveTool] = useState<keyof typeof TOOTH_CONDITIONS>("caries");
  // NEW: per-surface odontogram — Record<toothNumber, { O?: condition, M?: condition, ... }>
  const [odontogram, setOdontogram] = useState<Record<number, ToothSurfaces>>(() => {
    const raw = initialSpec.odontogram as Record<string, ToothSurfaces> | undefined;
    if (!raw) return {};
    const result: Record<number, ToothSurfaces> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(k);
      if (!isNaN(n) && v) result[n] = v;
    }
    return result;
  });
  const upperTeeth = isChild ? UPPER_PRIMARY : UPPER_TEETH;
  const lowerTeeth = isChild ? LOWER_PRIMARY : LOWER_TEETH;
  const [catalog, setCatalog] = useState<CatalogProcedure[]>([]);
  const [selectedProcs, setSelectedProcs] = useState<SelectedProcedure[]>(() => {
    const raw = initialSpec.procedures;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p: any) => p && typeof p === "object" && p.id && p.name)
      .map((p: any) => ({
        id: String(p.id),
        name: String(p.name),
        price: Number(p.price) || 0,
        quantity: Number(p.quantity) || 1,
      }));
  });
  const [procSearch, setProcSearch] = useState("");
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);

  // Receta NOM-024 — la receta se emite standalone (sin consulta asociada)
  // para no contaminar el histórico clínico con medicalRecord huérfanos.
  // Si el doctor quiere vincularla a una consulta, primero debe "Guardar
  // consulta"; la vinculación post-guardado queda como follow-up.
  const [rxOpen, setRxOpen] = useState(false);
  const [rxResult, setRxResult] = useState<{ id: string; verifyUrl: string } | null>(null);

  // Load procedure catalog on mount
  useEffect(() => {
    fetch("/api/procedures")
      .then(r => { if (!r.ok) throw new Error("Error"); return r.json(); })
      .then((data: CatalogProcedure[]) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]));
  }, []);

  const [treatmentPlans, setTreatmentPlans] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/treatments?patientId=${patientId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setTreatmentPlans(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [patientId]);

  const orthoMilestones = useMemo(() => {
    const plan = treatmentPlans.find(p => {
      const name = (p?.name || "").toLowerCase();
      return (name.includes("ortodoncia") || name.includes("ortho")) && p.status === "ACTIVE";
    }) ?? treatmentPlans.find(p => {
      const name = (p?.name || "").toLowerCase();
      return name.includes("ortodoncia") || name.includes("ortho");
    });
    if (!plan?.startDate) return null;
    const start = new Date(plan.startDate);
    const end = plan.endDate ? new Date(plan.endDate) : new Date(start.getTime() + (plan.totalSessions ?? 12) * (plan.sessionIntervalDays ?? 30) * 86400000);
    const months: { date: string; title: string; status: "completed" | "current" | "pending"; notes?: string }[] = [];
    const now = new Date();
    const cursor = new Date(start);
    let i = 0;
    while (cursor <= end && i < 36) {
      const isCompleted = cursor < now && (cursor.getFullYear() < now.getFullYear() || cursor.getMonth() < now.getMonth());
      const isCurrent = cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth();
      months.push({
        date: cursor.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }),
        title: t("clinical.dentalForm.month", { n: i + 1 }),
        status: isCompleted ? "completed" : isCurrent ? "current" : "pending",
      });
      cursor.setMonth(cursor.getMonth() + 1);
      i++;
    }
    return { plan, months };
  }, [treatmentPlans]);

  const filteredCatalog = useMemo(() => {
    const q = procSearch.toLowerCase().trim();
    if (!q) return catalog;
    return catalog.filter(p => p.name.toLowerCase().includes(q));
  }, [catalog, procSearch]);

  const proceduresTotal = useMemo(
    () => selectedProcs.reduce((sum, p) => sum + (p.price * p.quantity), 0),
    [selectedProcs]
  );
  const [form, setForm] = useState(() => ({
    subjective:  initialRecord?.subjective ?? "",
    objective:   initialRecord?.objective ?? "",
    assessment:  initialRecord?.assessment ?? "",
    plan:        initialRecord?.plan ?? "",
    periodontal: initialSpec.periodontal ?? { plaque: "", calculus: "", gingival: "", pocketDepth: "", bleeding: false },
    occlusal:    initialSpec.occlusal ?? { molarClass: "", bite: [] as string[], overbite: "", overjet: "" },
    tmj:         initialSpec.tmj ?? { opening: "", clicking: "", pain: "", guard: "" },
    hygieneInstructions: Array.isArray(initialSpec.hygieneInstructions) ? initialSpec.hygieneInstructions : [],
    xrays:       initialSpec.xrays ?? "",
    nextVisit:   initialSpec.nextVisit ?? "",
  }));
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function clickSurface(num: number, surface: Surface) {
    setSelectedTooth(num);
    if (WHOLE_TOOTH_CONDITIONS.includes(activeTool)) {
      // Whole-tooth conditions apply to all surfaces at once
      const all: ToothSurfaces = {};
      SURFACES.forEach(s => { all[s] = activeTool; });
      setOdontogram(o => ({ ...o, [num]: all }));
    } else {
      // Per-surface condition (caries, restoration)
      setOdontogram(o => {
        const prev = o[num] ?? {};
        const current = prev[surface];
        // Toggle: if already same condition, clear it
        const next = current === activeTool ? undefined : activeTool;
        const updated = { ...prev, [surface]: next };
        // Clean up undefined
        if (!next) delete updated[surface];
        return { ...o, [num]: updated };
      });
    }
  }

  function toggleProc(cat: CatalogProcedure) {
    setSelectedProcs(prev => {
      const exists = prev.find(p => p.id === cat.id);
      if (exists) return prev.filter(p => p.id !== cat.id);
      return [...prev, { id: cat.id, name: cat.name, price: cat.basePrice, quantity: 1 }];
    });
  }

  function updateProcPrice(id: string, price: number) {
    setSelectedProcs(prev => prev.map(p => p.id === id ? { ...p, price: Math.max(0, price) } : p));
  }

  function updateProcQty(id: string, qty: number) {
    setSelectedProcs(prev => prev.map(p => p.id === id ? { ...p, quantity: Math.max(1, qty) } : p));
  }

  function removeProc(id: string) {
    setSelectedProcs(prev => prev.filter(p => p.id !== id));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) {
      toast.error(t("clinical.dentalForm.reasonOrDiagnosisRequired"));
      return;
    }
    setSaving(true);
    try {
      const specialtyData = {
        type: "dental",
        odontogram,
        procedures: selectedProcs,
        proceduresTotal,
        periodontal: form.periodontal,
        occlusal: form.occlusal,
        tmj: form.tmj,
        hygieneInstructions: form.hygieneInstructions,
        xrays: form.xrays,
        nextVisit: form.nextVisit,
      };

      let record: any;
      if (isEditing && initialRecord) {
        // PATCH — actualiza el record existente. No incluye autoInvoice
        // (la factura, si existia, ya se creo al crear la consulta original).
        const res = await fetch(`/api/clinical-notes/${initialRecord.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjective: form.subjective,
            objective: form.objective,
            assessment: form.assessment,
            plan: form.plan,
            specialtyData,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? t("clinical.dentalForm.updateError"));
        const body = await res.json();
        record = body.note ?? body;
        toast.success(t("clinical.dentalForm.updatedToast"));
      } else {
        // POST — crea record nuevo. autoInvoice si hay procedimientos con precio.
        const res = await fetch("/api/clinical", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            subjective: form.subjective,
            objective: form.objective,
            assessment: form.assessment,
            plan: form.plan,
            autoInvoice: selectedProcs.length > 0,
            specialtyData,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? t("clinical.dentalForm.saveError"));
        record = await res.json();
        if (selectedProcs.length > 0) {
          toast.success(`✅ ${t("clinical.dentalForm.savedWithInvoiceToast", { total: formatCurrency(proceduresTotal) })}`);
        } else {
          toast.success(t("clinical.dentalForm.savedToast"));
        }
      }
      onSaved(record);
    } catch (err: any) {
      toast.error(err.message ?? (isEditing ? t("clinical.dentalForm.updateError") : t("clinical.dentalForm.saveError")));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Abre el modal de receta NOM-024 sin tocar el expediente clínico. La
   * receta se emite standalone (medicalRecordId = null); PrescriptionModal
   * hace su propio POST a /api/prescriptions con FK a CUMS + firma opcional.
   */
  function openPrescriptionModal() {
    setRxOpen(true);
  }

  function getSurfaceColor(num: number, surface: Surface): string {
    const cond = odontogram[num]?.[surface];
    return cond ? (TOOTH_CONDITIONS[cond]?.bg ?? "#fff") : "#fff";
  }
  function getSurfaceBorder(num: number, surface: Surface): string {
    const cond = odontogram[num]?.[surface];
    return cond ? (TOOTH_CONDITIONS[cond]?.border ?? "#94a3b8") : "#94a3b8";
  }
  function isWholeTooth(num: number): string | null {
    const surfaces = odontogram[num];
    if (!surfaces) return null;
    const vals = Object.values(surfaces);
    if (vals.length === 5 && WHOLE_TOOTH_CONDITIONS.includes(vals[0]!) && vals.every(v => v === vals[0])) return vals[0]!;
    return null;
  }

  // Classic 5-surface tooth diagram (cross pattern)
  //        ┌──V──┐
  //        │╲   ╱│
  //        │M│O│D│
  //        │╱   ╲│
  //        └──L──┘
  const SZ = 48;       // total size — large enough to click comfortably
  const INNER = 18;    // center oclusal square
  const PAD = (SZ - INNER) / 2; // = 15
  // Centroids for surface labels
  const LABEL: Record<Surface, { x: number; y: number }> = {
    V: { x: SZ / 2,          y: PAD / 2 },
    L: { x: SZ / 2,          y: SZ - PAD / 2 },
    M: { x: PAD / 2,         y: SZ / 2 },
    D: { x: SZ - PAD / 2,    y: SZ / 2 },
    O: { x: SZ / 2,          y: SZ / 2 },
  };

  const renderTooth = (num: number) => {
    const isSelected = selectedTooth === num;
    const wholeCond = isWholeTooth(num);
    const wholeStyle = wholeCond ? TOOTH_CONDITIONS[wholeCond] : null;

    return (
      <div key={num} className="flex flex-col items-center gap-1">
        <span className="text-[10px] text-muted-foreground font-mono font-bold leading-none">{num}</span>
        {wholeCond && wholeStyle ? (
          /* Whole-tooth condition — single colored block */
          <div
            className="flex items-center justify-center rounded-lg border-2 cursor-pointer transition-all hover:scale-105"
            style={{ width: SZ, height: SZ, background: wholeStyle.bg, borderColor: isSelected ? "#2563eb" : wholeStyle.border, color: wholeStyle.color, boxShadow: isSelected ? "0 0 0 3px rgba(37,99,235,0.4)" : "none" }}
            onClick={() => clickSurface(num, "O")}
            title={`#${num} — ${t(wholeStyle.labelKey)}`}
          >
            <span className="text-sm font-bold">
              {wholeCond === "absent" ? "✕" : wholeCond === "implant" ? "I" : wholeCond === "endo" ? "E" : wholeCond === "crown" ? "C" : "EX"}
            </span>
          </div>
        ) : (
          /* Per-surface SVG diagram */
          <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`}
            className={`cursor-pointer transition-all hover:scale-105 rounded-lg ${isSelected ? "ring-2 ring-brand-600 ring-offset-1" : ""}`}
            style={{ filter: isSelected ? "drop-shadow(0 0 4px rgba(37,99,235,0.35))" : "none" }}>
            {/* Outer border */}
            <rect x="0" y="0" width={SZ} height={SZ} rx="6" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />

            {/* V - Vestibular (top) */}
            <polygon
              points={`1,1 ${SZ-1},1 ${PAD+INNER},${PAD} ${PAD},${PAD}`}
              fill={getSurfaceColor(num,"V")}
              stroke={getSurfaceBorder(num,"V")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"V")}
              className="hover:brightness-90 transition-all"
            ><title>V (Vestibular) #{num}</title></polygon>

            {/* L - Lingual (bottom) */}
            <polygon
              points={`${PAD},${PAD+INNER} ${PAD+INNER},${PAD+INNER} ${SZ-1},${SZ-1} 1,${SZ-1}`}
              fill={getSurfaceColor(num,"L")}
              stroke={getSurfaceBorder(num,"L")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"L")}
              className="hover:brightness-90 transition-all"
            ><title>L (Lingual) #{num}</title></polygon>

            {/* M - Mesial (left) */}
            <polygon
              points={`1,1 ${PAD},${PAD} ${PAD},${PAD+INNER} 1,${SZ-1}`}
              fill={getSurfaceColor(num,"M")}
              stroke={getSurfaceBorder(num,"M")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"M")}
              className="hover:brightness-90 transition-all"
            ><title>M (Mesial) #{num}</title></polygon>

            {/* D - Distal (right) */}
            <polygon
              points={`${PAD+INNER},${PAD} ${SZ-1},1 ${SZ-1},${SZ-1} ${PAD+INNER},${PAD+INNER}`}
              fill={getSurfaceColor(num,"D")}
              stroke={getSurfaceBorder(num,"D")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"D")}
              className="hover:brightness-90 transition-all"
            ><title>D (Distal) #{num}</title></polygon>

            {/* O - Oclusal (center) */}
            <rect
              x={PAD} y={PAD} width={INNER} height={INNER}
              fill={getSurfaceColor(num,"O")}
              stroke={getSurfaceBorder(num,"O")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"O")}
              className="hover:brightness-90 transition-all"
            ><title>O (Oclusal) #{num}</title></rect>

            {/* Surface labels */}
            {SURFACES.map(s => (
              <text key={s} x={LABEL[s].x} y={LABEL[s].y} textAnchor="middle" dominantBaseline="central"
                fontSize="8" fontWeight="700" fill={odontogram[num]?.[s] ? TOOTH_CONDITIONS[odontogram[num]![s]!]?.color ?? "#94a3b8" : "#94a3b8"}
                pointerEvents="none" className="select-none">
                {s}
              </text>
            ))}
          </svg>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {orthoMilestones && orthoMilestones.months.length > 0 && (
        <CardNew title={`${t("clinical.dentalForm.timelineTitle")} — ${orthoMilestones.plan.name}`} sub={t("clinical.dentalForm.orthoPlanMonthly")}>
          <TreatmentTimeline milestones={orthoMilestones.months} />
        </CardNew>
      )}

      {/* ANAMNESIS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.dentalForm.reasonLabel")}</label>
          <textarea
            className="input-new"
            style={{ height: 80, paddingTop: 8, resize: "vertical" }}
            placeholder={t("clinical.dentalForm.reasonPlaceholder")}
            value={form.subjective}
            onChange={e => set("subjective", e.target.value)}
          />
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.dentalForm.medicalHistoryLabel")}</label>
          <textarea
            className="input-new"
            style={{ height: 80, paddingTop: 8, resize: "vertical" }}
            placeholder={t("clinical.dentalForm.medicalHistoryPlaceholder")}
            value={form.objective}
            onChange={e => set("objective", e.target.value)}
          />
        </div>
      </div>

      {/* ODONTOGRAMA */}
      <div style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{
            fontSize: 13, fontWeight: 600, color: "var(--text-1)",
            margin: 0, display: "flex", alignItems: "center", gap: 6,
          }}>
            🦷 {t("clinical.dentalForm.odontogramTitle")}
          </h3>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {selectedTooth
              ? t("clinical.dentalForm.toothSelected", { n: selectedTooth })
              : t("clinical.dentalForm.clickSurfaceHint")}
          </span>
        </div>

        {/* Tool selector */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6,
          marginBottom: 16, paddingBottom: 12,
          borderBottom: "1px solid var(--border-soft)",
        }}>
          {Object.entries(TOOTH_CONDITIONS).map(([key, val]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTool(key as keyof typeof TOOTH_CONDITIONS)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                border: `1px solid ${val.border}`,
                background: activeTool === key ? val.bg : "transparent",
                color: val.color,
                cursor: "pointer",
                transition: "all .12s",
                boxShadow: activeTool === key ? `0 0 0 1px ${val.color}40` : "none",
              }}
            >
              {t(val.labelKey)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setOdontogram({}); setSelectedTooth(null); }}
            className="btn-new btn-new--ghost btn-new--sm"
            style={{ marginLeft: "auto" }}
          >
            {t("clinical.dentalForm.clearAll")}
          </button>
        </div>

        {/* Canvas */}
        <div style={{
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius)",
          padding: 20,
        }}>
          <div style={{
            fontSize: 10, textAlign: "center",
            color: "var(--text-3)", marginBottom: 10,
            textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
          }}>
            {t("clinical.dentalForm.upperJaw")}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {upperTeeth.map(renderTooth)}
          </div>
          <div style={{
            borderTop: "2px dashed var(--border-soft)",
            margin: "14px 32px",
          }} />
          <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {lowerTeeth.map(renderTooth)}
          </div>
          <div style={{
            fontSize: 10, textAlign: "center",
            color: "var(--text-3)", marginTop: 10,
            textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
          }}>
            {t("clinical.dentalForm.lowerJaw")}
          </div>
        </div>

        {/* Selected tooth detail */}
        {selectedTooth && odontogram[selectedTooth] && Object.keys(odontogram[selectedTooth]!).length > 0 && (
          <div style={{
            marginTop: 12, paddingTop: 12,
            borderTop: "1px solid var(--border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>
                {t("clinical.dentalForm.toothLabel", { n: selectedTooth })}:
              </span>
              {SURFACES.map(s => {
                const cond = odontogram[selectedTooth!]?.[s];
                if (!cond) return null;
                const style = TOOTH_CONDITIONS[cond];
                const surfaceLabels: Record<Surface, string> = {
                  O: t("clinical.dentalForm.surfaceOcclusal"),
                  M: t("clinical.dentalForm.surfaceMesial"),
                  D: t("clinical.dentalForm.surfaceDistal"),
                  V: t("clinical.dentalForm.surfaceVestibular"),
                  L: t("clinical.dentalForm.surfaceLingual"),
                };
                return (
                  <span
                    key={s}
                    style={{
                      fontSize: 10, fontWeight: 600,
                      padding: "2px 8px", borderRadius: 12,
                      background: style.bg, border: `1px solid ${style.border}`,
                      color: style.color,
                    }}
                  >
                    {surfaceLabels[s]}: {t(style.labelKey)}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 10,
          marginTop: 12, paddingTop: 12,
          borderTop: "1px solid var(--border-soft)",
        }}>
          {Object.entries(TOOTH_CONDITIONS).map(([, val]) => (
            <div key={val.labelKey} style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 10, color: "var(--text-3)",
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: 3,
                background: val.bg, border: `1px solid ${val.border}`,
              }} />
              {t(val.labelKey)}
            </div>
          ))}
        </div>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 10,
          marginTop: 8, fontSize: 10, color: "var(--text-4)",
        }}>
          <span className="mono" style={{ fontWeight: 600 }}>{t("clinical.dentalForm.surfacesLabel")}</span>
          <span>O = {t("clinical.dentalForm.surfaceOcclusal")}</span>
          <span>M = {t("clinical.dentalForm.surfaceMesial")}</span>
          <span>D = {t("clinical.dentalForm.surfaceDistal")}</span>
          <span>V = {t("clinical.dentalForm.surfaceVestibular")}</span>
          <span>L = {t("clinical.dentalForm.surfaceLingualPalatal")}</span>
        </div>
      </div>

      {/* PERIODONTAL */}
      <CardNew title={t("clinical.dentalForm.periodontalTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: "plaque",     label: t("clinical.dentalForm.plaqueIndexLabel"),     placeholder: t("clinical.dentalForm.plaqueIndexPlaceholder") },
            { key: "calculus",   label: t("clinical.dentalForm.calculusLabel"),        placeholder: t("clinical.dentalForm.calculusPlaceholder") },
            { key: "gingival",   label: t("clinical.dentalForm.gingivalLabel"),        placeholder: t("clinical.dentalForm.gingivalPlaceholder") },
            { key: "pocketDepth",label: t("clinical.dentalForm.pocketDepthLabel"),     placeholder: t("clinical.dentalForm.pocketDepthPlaceholder") },
          ].map(f => (
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <input className="input-new"
                placeholder={f.placeholder}
                value={(form.periodontal as any)[f.key] ?? ""}
                onChange={e => set("periodontal", { ...form.periodontal, [f.key]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input type="checkbox" id="bleeding" checked={form.periodontal.bleeding}
            onChange={e => set("periodontal", { ...form.periodontal, bleeding: e.target.checked })}
            className="w-4 h-4 accent-brand-600" />
          <label htmlFor="bleeding" className="text-sm font-medium">{t("clinical.dentalForm.bleedingOnProbing")}</label>
        </div>
      </CardNew>

      {/* EVALUACIÓN OCLUSAL */}
      <CardNew title={t("clinical.dentalForm.occlusalTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dentalForm.molarClassLabel")}</label>
            <select
              className="input-new"
              value={form.occlusal.molarClass}
              onChange={e => set("occlusal", { ...form.occlusal, molarClass: e.target.value })}
            >
              <option value="">{t("clinical.dentalForm.selectPlaceholder")}</option>
              <option value="Clase I">{t("clinical.dentalForm.molarClassI")}</option>
              <option value="Clase II div 1">{t("clinical.dentalForm.molarClassII1")}</option>
              <option value="Clase II div 2">{t("clinical.dentalForm.molarClassII2")}</option>
              <option value="Clase III">{t("clinical.dentalForm.molarClassIII")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dentalForm.overbiteLabel")}</label>
            <input type="number" className="input-new"
              placeholder={t("clinical.dentalForm.overbitePlaceholder")} value={form.occlusal.overbite}
              onChange={e => set("occlusal", { ...form.occlusal, overbite: e.target.value })} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dentalForm.overjetLabel")}</label>
            <input type="number" className="input-new"
              placeholder={t("clinical.dentalForm.overjetPlaceholder")} value={form.occlusal.overjet}
              onChange={e => set("occlusal", { ...form.occlusal, overjet: e.target.value })} />
          </div>
        </div>
        <div className="mt-3">
          <label className="field-new__label">{t("clinical.dentalForm.biteLabel")}</label>
          <div className="flex flex-wrap gap-3 mt-1.5">
            {[
              { value: "Abierta anterior", labelKey: "clinical.dentalForm.biteOpenAnterior" },
              { value: "Cruzada posterior", labelKey: "clinical.dentalForm.biteCrossPosterior" },
              { value: "Cruzada anterior", labelKey: "clinical.dentalForm.biteCrossAnterior" },
              { value: "Profunda", labelKey: "clinical.dentalForm.biteDeep" },
              { value: "Normal", labelKey: "clinical.dentalForm.biteNormal" },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="w-4 h-4 accent-brand-600"
                  checked={form.occlusal.bite.includes(opt.value)}
                  onChange={e => {
                    const bite = e.target.checked
                      ? [...form.occlusal.bite, opt.value]
                      : form.occlusal.bite.filter((b: string) => b !== opt.value);
                    set("occlusal", { ...form.occlusal, bite });
                  }} />
                {t(opt.labelKey)}
              </label>
            ))}
          </div>
        </div>
      </CardNew>

      {/* EVALUACIÓN ATM / BRUXISMO */}
      <CardNew title={t("clinical.dentalForm.tmjTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dentalForm.mouthOpeningLabel")}</label>
            <input type="number" className="input-new"
              placeholder={t("clinical.dentalForm.mouthOpeningPlaceholder")} value={form.tmj.opening}
              onChange={e => set("tmj", { ...form.tmj, opening: e.target.value })} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dentalForm.clickingLabel")}</label>
            <select
              className="input-new"
              value={form.tmj.clicking}
              onChange={e => set("tmj", { ...form.tmj, clicking: e.target.value })}
            >
              <option value="">{t("clinical.dentalForm.selectPlaceholder")}</option>
              <option value="Ninguno">{t("clinical.dentalForm.clickingNone")}</option>
              <option value="Clic derecho">{t("clinical.dentalForm.clickingRight")}</option>
              <option value="Clic izquierdo">{t("clinical.dentalForm.clickingLeft")}</option>
              <option value="Bilateral">{t("clinical.dentalForm.clickingBilateral")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dentalForm.tmjPainLabel")}</label>
            <select
              className="input-new"
              value={form.tmj.pain}
              onChange={e => set("tmj", { ...form.tmj, pain: e.target.value })}
            >
              <option value="">{t("clinical.dentalForm.selectPlaceholder")}</option>
              <option value="Sin dolor">{t("clinical.dentalForm.painNone")}</option>
              <option value="Leve">{t("clinical.dentalForm.painMild")}</option>
              <option value="Moderado">{t("clinical.dentalForm.painModerate")}</option>
              <option value="Severo">{t("clinical.dentalForm.painSevere")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dentalForm.occlusalGuardLabel")}</label>
            <select
              className="input-new"
              value={form.tmj.guard}
              onChange={e => set("tmj", { ...form.tmj, guard: e.target.value })}
            >
              <option value="">{t("clinical.dentalForm.selectPlaceholder")}</option>
              <option value="No usa">{t("clinical.dentalForm.guardNotUsed")}</option>
              <option value="Usa — buen estado">{t("clinical.dentalForm.guardGoodCondition")}</option>
              <option value="Usa — desgastada">{t("clinical.dentalForm.guardWorn")}</option>
              <option value="Recomendada">{t("clinical.dentalForm.guardRecommended")}</option>
            </select>
          </div>
        </div>
      </CardNew>

      {/* INSTRUCCIONES DE HIGIENE ORAL */}
      <CardNew title={t("clinical.dentalForm.hygieneTitle")}>
        <div className="flex flex-wrap gap-3">
          {[
            { value: "Técnica de cepillado enseñada (Bass modificada)", labelKey: "clinical.dentalForm.hygieneBrushing" },
            { value: "Uso de hilo dental instruido", labelKey: "clinical.dentalForm.hygieneFloss" },
            { value: "Enjuague con fluoruro recomendado", labelKey: "clinical.dentalForm.hygieneFluoride" },
            { value: "Dieta baja en azúcares refinados discutida", labelKey: "clinical.dentalForm.hygieneDiet" },
            { value: "Cepillo interdental recomendado", labelKey: "clinical.dentalForm.hygieneInterdental" },
            { value: "Profilaxis con pasta fluorada aplicada", labelKey: "clinical.dentalForm.hygieneProphylaxis" },
          ].map(opt => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-brand-600"
                checked={form.hygieneInstructions.includes(opt.value)}
                onChange={e => {
                  const updated = e.target.checked
                    ? [...form.hygieneInstructions, opt.value]
                    : form.hygieneInstructions.filter((h: string) => h !== opt.value);
                  set("hygieneInstructions", updated);
                }} />
              {t(opt.labelKey)}
            </label>
          ))}
        </div>
      </CardNew>

      {/* PROCEDIMIENTOS Y FACTURACIÓN */}
      <CardNew
        title={`💰 ${t("clinical.dentalForm.proceduresTitle")}`}
        action={selectedProcs.length > 0 ? (
          <div className="text-sm font-bold text-brand-700 dark:text-brand-400">
            {t("common.total")}: {formatCurrency(proceduresTotal)}
          </div>
        ) : undefined}
      >
        {/* Selected procedures table */}
        {selectedProcs.length > 0 && (
          <div className="mb-3 rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-3 py-2 font-bold">{t("clinical.dentalForm.procedureCol")}</th>
                  <th className="text-center px-2 py-2 font-bold w-16">{t("clinical.dentalForm.qtyCol")}</th>
                  <th className="text-right px-2 py-2 font-bold w-24">{t("clinical.dentalForm.priceCol")}</th>
                  <th className="text-right px-3 py-2 font-bold w-24">{t("clinical.dentalForm.subtotalCol")}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {selectedProcs.map(p => (
                  <tr key={p.id} className="border-t border-border/50">
                    <td className="px-3 py-1.5 font-semibold">{p.name}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="1" value={p.quantity}
                        onChange={e => updateProcQty(p.id, parseInt(e.target.value) || 1)}
                        className="w-14 h-7 text-center rounded border border-border bg-card text-xs" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" value={p.price}
                        onChange={e => updateProcPrice(p.id, parseFloat(e.target.value) || 0)}
                        className="w-20 h-7 text-right rounded border border-border bg-card text-xs" />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold">{formatCurrency(p.price * p.quantity)}</td>
                    <td className="pr-2">
                      <button type="button" onClick={() => removeProc(p.id)} className="text-rose-500 hover:text-rose-700 text-sm">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-brand-600/15">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-bold">{t("clinical.dentalForm.totalRow")}</td>
                  <td className="px-3 py-2 text-right font-mono font-extrabold text-brand-700 dark:text-brand-400">{formatCurrency(proceduresTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Catalog search */}
        <div className="mb-2">
          <input
            type="text"
            placeholder={t("clinical.dentalForm.searchProcedurePlaceholder")}
            className="input-new"
            value={procSearch}
            onChange={e => setProcSearch(e.target.value)}
          />
        </div>

        {/* Available procedures */}
        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
          {filteredCatalog.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">
              {catalog.length === 0
                ? t("clinical.dentalForm.noProceduresCatalog")
                : t("common.noResults")}
            </div>
          ) : filteredCatalog.map(p => {
            const isSelected = selectedProcs.some(sp => sp.id === p.id);
            return (
              <button key={p.id} type="button" onClick={() => toggleProc(p)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${isSelected ? "bg-brand-600 text-white border-brand-600" : "bg-card text-muted-foreground border-border hover:border-brand-300 hover:text-brand-600"}`}>
                {isSelected && "✓"} {p.name}
                <span className={`text-[10px] ${isSelected ? "text-white/80" : "text-brand-600"}`}>
                  {formatCurrency(p.basePrice)}
                </span>
              </button>
            );
          })}
        </div>

        {selectedProcs.length > 0 && (
          <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
            💡 {t("clinical.dentalForm.draftInvoiceTip")}
          </div>
        )}
      </CardNew>

      {/* PRESCRIPCIÓN — NOM-024 con CUMS + firma electrónica opcional */}
      <CardNew
        title={`💊 ${t("clinical.dentalForm.prescriptionTitle")}`}
        action={(
          <ButtonNew
            type="button"
            size="sm"
            variant="ghost"
            icon={<FileText size={14} />}
            onClick={openPrescriptionModal}
          >
            {t("clinical.dentalForm.createPrescription")}
          </ButtonNew>
        )}
      >
        <p className="text-xs text-muted-foreground">
          {t("clinical.dentalForm.prescriptionHelp")}
        </p>
        {rxResult && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
            ✓ {t("clinical.dentalForm.prescriptionCreated")}{" "}
            <a href={rxResult.verifyUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 font-semibold hover:underline">
              {t("clinical.dentalForm.viewVerifiablePrescription")}
            </a>
          </div>
        )}
      </CardNew>

      {/* DIAGNÓSTICO Y PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="field-new">
          <label className="field-new__label">{t("clinical.dentalForm.clinicalObservationsLabel")}</label>
          <textarea className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.dentalForm.clinicalObservationsPlaceholder")} value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.dentalForm.futurePlanLabel")}</label>
          <textarea className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.dentalForm.futurePlanPlaceholder")} value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="field-new">
          <label className="field-new__label">{t("clinical.dentalForm.xraysLabel")}</label>
          <input className="input-new"
            placeholder={t("clinical.dentalForm.xraysPlaceholder")} value={form.xrays} onChange={e => set("xrays", e.target.value)} />
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.dentalForm.nextVisitLabel")}</label>
          <input className="input-new"
            placeholder={t("clinical.dentalForm.nextVisitPlaceholder")} value={form.nextVisit} onChange={e => set("nextVisit", e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving
            ? (isEditing ? t("clinical.dentalForm.savingChanges") : t("common.saving"))
            : (isEditing ? t("common.saveChanges") : t("clinical.dentalForm.saveConsultation"))}
        </ButtonNew>
      </div>

      <PrescriptionModal
        open={rxOpen}
        patientId={patientId}
        medicalRecordId={null}
        onClose={() => setRxOpen(false)}
        onCreated={(rx) => setRxResult(rx)}
      />
    </form>
  );
}
