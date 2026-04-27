"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Trash2,
  Search,
  Sparkles,
  Move,
  ZoomIn,
  RotateCw,
  Ruler,
  Triangle,
  Pencil,
  FlipHorizontal,
  Contrast,
  GitCompareArrows,
  Eye,
  EyeOff,
  Plus,
  Minus,
  Maximize2,
  Check,
  X as XIcon,
  FileDown,
} from "lucide-react";
import toast from "react-hot-toast";
import styles from "./xrays.module.css";

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber: string;
  _count: { files: number };
}

interface AiFinding {
  id: string;
  title: string;
  description?: string;
  tooth?: string | number;
  severity: "alta" | "media" | "baja" | "informativo";
  confidence?: number;
  /** Posición en % dentro de la imagen para el overlay bidireccional. */
  region?: { x: number; y: number; w: number; h: number };
}

interface XrayAnalysis {
  summary: string;
  findings: AiFinding[];
  recommendations?: unknown;
  modelVersion?: string;
}

interface PatientFile {
  id: string;
  name: string;
  url: string;
  category: string;
  mimeType: string;
  size: number;
  notes: string | null;
  toothNumber: number | null;
  takenAt: string | null;
  createdAt: string;
  doctorNotes: string | null;
  doctorNotesUpdatedAt: string | null;
  patient: { id: string; firstName: string; lastName: string; patientNumber: string };
  xrayAnalysis?: XrayAnalysis | null;
}

interface Props {
  patients: Patient[];
  recentFiles: PatientFile[];
  clinicId: string;
  aiUsed: number;
  aiLimit: number;
}

const CATEGORIES = [
  { id: "XRAY_PERIAPICAL",   label: "Periapical" },
  { id: "XRAY_PANORAMIC",    label: "Panorámica" },
  { id: "XRAY_CEPHALOMETRIC", label: "Cefalométrica" },
  { id: "XRAY_BITEWING",     label: "Bitewing" },
  { id: "PHOTO_INTRAORAL",   label: "Foto intraoral" },
  { id: "OTHER",             label: "Otro" },
];

const SEV_COLOR: Record<AiFinding["severity"], string> = {
  alta: "#ef4444",
  media: "#f59e0b",
  baja: "#06b6d4",
  informativo: "#10b981",
};
const SEV_LABEL: Record<AiFinding["severity"], string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
  informativo: "Info",
};

type Tab = "ai" | "measurements" | "notes";
type Tool = "pan" | "zoom" | "rotate" | "measure" | "angle" | "annotate";

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function getInitials(p?: { firstName: string; lastName: string } | null) {
  if (!p) return "?";
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

/**
 * Asigna una región de overlay a cada finding usando coords reales si vienen
 * en el JSON; si no, distribuye automáticamente en una grilla 4x2 dentro del
 * 60% central de la imagen para que se vean al menos como referencia visual.
 */
function findingRegions(findings: AiFinding[]): Array<AiFinding & { region: NonNullable<AiFinding["region"]> }> {
  const cols = 4;
  const sx = 12;   // margen izq %
  const sy = 18;   // margen sup %
  const w = 18;    // ancho box %
  const h = 22;    // alto box %
  const gx = 2.5;  // gap x %
  const gy = 6;    // gap y %
  return findings.map((f, i) => {
    if (f.region) return { ...f, region: f.region };
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...f,
      region: {
        x: sx + col * (w + gx),
        y: sy + row * (h + gy),
        w,
        h,
      },
    };
  });
}

export function XraysClient({
  patients,
  recentFiles: initialFiles,
  clinicId: _clinicId,
  aiUsed,
  aiLimit,
}: Props) {
  const [files, setFiles] = useState<PatientFile[]>(initialFiles);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    initialFiles[0]?.patient.id ?? null,
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(initialFiles[0]?.id ?? null);
  const [compareFileId, setCompareFileId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [tab, setTab] = useState<Tab>("ai");
  const [tool, setTool] = useState<Tool>("pan");
  const [inverted, setInverted] = useState(false);
  const [aiVisible, setAiVisible] = useState(true);
  const [highlightedFindingId, setHighlightedFindingId] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [search, setSearch] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === selectedPatientId) ?? null,
    [patients, selectedPatientId],
  );

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = selectedPatientId
      ? files.filter((f) => f.patient.id === selectedPatientId)
      : files;
    if (q) {
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q) ||
          `${f.patient.firstName} ${f.patient.lastName}`.toLowerCase().includes(q),
      );
    }
    return list;
  }, [files, selectedPatientId, search]);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? null,
    [files, activeFileId],
  );
  const compareFile = useMemo(
    () => files.find((f) => f.id === compareFileId) ?? null,
    [files, compareFileId],
  );

  // Reset notes draft cuando cambia file activo
  useEffect(() => {
    setNotesDraft(activeFile?.doctorNotes ?? "");
    setHighlightedFindingId(null);
  }, [activeFileId, activeFile?.doctorNotes]);

  // Refresca files al cambiar paciente
  useEffect(() => {
    if (!selectedPatientId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/xrays?patientId=${selectedPatientId}`);
        if (!res.ok) return;
        const data: PatientFile[] = await res.json();
        if (cancelled) return;
        // Mergea sin perder los recientes de otros pacientes
        setFiles((prev) => {
          const others = prev.filter((f) => f.patient.id !== selectedPatientId);
          const enriched = data.map((f) => ({
            ...f,
            patient: f.patient ?? prev.find((x) => x.id === f.id)?.patient,
          }));
          return [...enriched, ...others];
        });
      } catch {/* silent */}
    })();
    return () => { cancelled = true; };
  }, [selectedPatientId]);

  const aiAnalysis: XrayAnalysis | null = activeFile?.xrayAnalysis ?? null;
  const findings: Array<AiFinding & { region: NonNullable<AiFinding["region"]> }> = useMemo(
    () => (aiAnalysis?.findings ? findingRegions(aiAnalysis.findings) : []),
    [aiAnalysis],
  );
  const avgConfidence = useMemo(() => {
    if (findings.length === 0) return 0;
    const sum = findings.reduce((acc, f) => acc + (f.confidence ?? 0), 0);
    return Math.round((sum / findings.length) * 100) / 100;
  }, [findings]);

  /* ─── Acciones ─── */

  const handleUploadClick = useCallback(() => {
    if (!selectedPatient) {
      toast.error("Selecciona primero un paciente");
      return;
    }
    fileInputRef.current?.click();
  }, [selectedPatient]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPatient) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("patientId", selectedPatient.id);
      form.append("category", "XRAY_PANORAMIC");
      const res = await fetch("/api/xrays", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Error al subir");
      }
      const record = await res.json();
      setFiles((prev) => [{ ...record, patient: selectedPatient }, ...prev]);
      setActiveFileId(record.id);
      toast.success("Radiografía subida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [selectedPatient]);

  const handleAnalyze = useCallback(async () => {
    if (!activeFile) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/xrays/${activeFile.id}/analyze`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Error al analizar");
      }
      const data = await res.json();
      setFiles((prev) =>
        prev.map((f) => (f.id === activeFile.id ? { ...f, xrayAnalysis: data.analysis } : f)),
      );
      toast.success("Análisis IA completo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al analizar");
    } finally {
      setAnalyzing(false);
    }
  }, [activeFile]);

  const handleDelete = useCallback(async () => {
    if (!activeFile) return;
    if (!confirm(`¿Eliminar "${activeFile.name}"?`)) return;
    try {
      const res = await fetch(`/api/xrays/${activeFile.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setFiles((prev) => prev.filter((f) => f.id !== activeFile.id));
      setActiveFileId((prev) => (prev === activeFile.id ? null : prev));
      toast.success("Radiografía eliminada");
    } catch {
      toast.error("Error al eliminar");
    }
  }, [activeFile]);

  const handleSaveNotes = useCallback(async () => {
    if (!activeFile) return;
    try {
      const res = await fetch(`/api/xrays/${activeFile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorNotes: notesDraft }),
      });
      if (!res.ok) throw new Error();
      setFiles((prev) =>
        prev.map((f) =>
          f.id === activeFile.id
            ? { ...f, doctorNotes: notesDraft, doctorNotesUpdatedAt: new Date().toISOString() }
            : f,
        ),
      );
      toast.success("Notas guardadas");
    } catch {
      toast.error("Error al guardar notas");
    }
  }, [activeFile, notesDraft]);

  const handleGeneratePlan = useCallback(() => {
    if (findings.length === 0) {
      toast("Sin hallazgos · primero analiza con IA", { icon: "ℹ️" });
      return;
    }
    const total = findings.length;
    toast.success(`Plan generado · ${total} procedimiento${total === 1 ? "" : "s"} sugerido${total === 1 ? "" : "s"}`);
  }, [findings]);

  const toggleCompare = useCallback(() => {
    if (compareMode) {
      setCompareMode(false);
      setCompareFileId(null);
      return;
    }
    if (filteredFiles.length < 2) {
      toast("Necesitas al menos 2 radiografías", { icon: "ℹ️" });
      return;
    }
    setCompareMode(true);
    // Si no hay segunda asignada, usa la siguiente
    if (!compareFileId && activeFileId) {
      const other = filteredFiles.find((f) => f.id !== activeFileId);
      if (other) setCompareFileId(other.id);
    }
  }, [compareMode, filteredFiles, activeFileId, compareFileId]);

  const aiPercent = aiLimit > 0 ? Math.min(100, Math.round((aiUsed / aiLimit) * 100)) : 0;

  /* ─── Render ─── */

  return (
    <div className={styles.page} data-active-mode="xrays">
      {/* ── Topbar ── */}
      <div className={styles.topbar}>
        <div className={styles.topbarTitle}>
          <span className={styles.topbarTitleIcon}><Sparkles size={14} aria-hidden /></span>
          Radiografías
        </div>
        <select
          value={selectedPatientId ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            setSelectedPatientId(id);
            const firstFile = files.find((f) => f.patient.id === id);
            if (firstFile) setActiveFileId(firstFile.id);
          }}
          className={styles.topbarBtn}
          style={{ minWidth: 200, fontFamily: "inherit" }}
        >
          <option value="">Todos los pacientes</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName} · {p.patientNumber}
            </option>
          ))}
        </select>
        <div className={styles.topbarSpacer} />
        {selectedPatient && (
          <div className={styles.topbarPatient}>
            <span className={styles.topbarPatientAvatar}>{getInitials(selectedPatient)}</span>
            <strong>{selectedPatient.firstName} {selectedPatient.lastName}</strong>
            <span className={styles.topbarPatientId}>· {selectedPatient.patientNumber}</span>
          </div>
        )}
        <button
          type="button"
          className={styles.topbarBtn}
          onClick={() => activeFile && window.open(activeFile.url, "_blank")}
          disabled={!activeFile}
        >
          <FileDown size={13} aria-hidden /> Exportar
        </button>
        <button
          type="button"
          className={`${styles.topbarBtn} ${styles.topbarBtnPrimary}`}
          onClick={handleUploadClick}
          disabled={uploading}
        >
          <Upload size={13} aria-hidden /> {uploading ? "Subiendo…" : "Subir radiografía"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.dcm"
          className={styles.uploadInput}
          onChange={handleFileChange}
        />
      </div>

      {/* ── Timeline lateral ── */}
      <aside className={styles.timeline}>
        <div className={styles.timelineHeader}>
          <span className={styles.timelineLabel}>Historial · {filteredFiles.length}</span>
          <div style={{ position: "relative" }}>
            <Search size={11} aria-hidden style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input
              type="text"
              placeholder="Buscar…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.timelineSearch}
              style={{ paddingLeft: 26 }}
            />
          </div>
        </div>
        <button
          type="button"
          className={styles.timelineUploadCta}
          onClick={handleUploadClick}
          disabled={uploading}
        >
          <Upload size={12} aria-hidden /> Subir radiografía
        </button>
        <div className={styles.timelineList}>
          {filteredFiles.length === 0 ? (
            <div className={styles.emptyState}>
              {selectedPatient
                ? "Sin radiografías. Sube la primera arriba."
                : "Selecciona un paciente para ver su historial."}
            </div>
          ) : (
            filteredFiles.map((f) => {
              const isActive = f.id === activeFileId;
              const isCompare = f.id === compareFileId && compareMode;
              const findingsCount = (f.xrayAnalysis?.findings ?? []).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={[
                    styles.xrayCard,
                    isActive ? styles.xrayCardActive : "",
                    isCompare ? styles.xrayCardCompare : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (compareMode && !isActive) {
                      setCompareFileId(f.id);
                    } else {
                      setActiveFileId(f.id);
                    }
                  }}
                  title={f.name}
                >
                  <div className={styles.xrayCardThumb}>
                    {isImage(f.mimeType) ? (
                      <img src={f.url} alt="" loading="lazy" />
                    ) : (
                      <Sparkles size={20} aria-hidden />
                    )}
                    {f.xrayAnalysis && <span className={styles.xrayCardAiBadge}>IA</span>}
                  </div>
                  <div className={styles.xrayCardInfo}>
                    <span className={styles.xrayCardType}>
                      {CATEGORIES.find((c) => c.id === f.category)?.label ?? "Otro"}
                    </span>
                    <span className={styles.xrayCardDate}>{formatDate(f.takenAt ?? f.createdAt)}</span>
                    {findingsCount > 0 && (
                      <span className={styles.xrayCardFindings}>
                        <span className={styles.xrayCardFindingsDot} aria-hidden />
                        {findingsCount} hallazgo{findingsCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Visor central (DARK) ── */}
      <main className={styles.viewer}>
        <div className={styles.viewerToolbar}>
          {(["pan", "zoom", "rotate"] as Tool[]).map((t) => {
            const Icon = t === "pan" ? Move : t === "zoom" ? ZoomIn : RotateCw;
            return (
              <button
                key={t}
                type="button"
                className={styles.toolBtn}
                data-active={tool === t}
                onClick={() => setTool(t)}
                title={t}
              >
                <Icon size={15} aria-hidden />
              </button>
            );
          })}
          <span className={styles.toolDivider} />
          {(["measure", "angle", "annotate"] as Tool[]).map((t) => {
            const Icon = t === "measure" ? Ruler : t === "angle" ? Triangle : Pencil;
            return (
              <button
                key={t}
                type="button"
                className={styles.toolBtn}
                data-active={tool === t}
                onClick={() => setTool(t)}
                title={t}
              >
                <Icon size={15} aria-hidden />
              </button>
            );
          })}
          <span className={styles.toolDivider} />
          <button
            type="button"
            className={styles.toolBtn}
            data-active={inverted}
            onClick={() => setInverted((v) => !v)}
            title="Invertir colores"
          >
            <Contrast size={15} aria-hidden />
          </button>
          <button type="button" className={styles.toolBtn} title="Voltear horizontal">
            <FlipHorizontal size={15} aria-hidden />
          </button>
          <span className={styles.toolDivider} />
          <span className={styles.toolSlider}>
            Brillo
            <input
              type="range" min={50} max={150} value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
            />
            <strong style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{brightness}%</strong>
          </span>
          <span className={styles.toolSlider}>
            Contraste
            <input
              type="range" min={50} max={200} value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
            />
            <strong style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{contrast}%</strong>
          </span>
          <span className={styles.toolSpacer} />
          <button
            type="button"
            className={`${styles.toolBtn} ${styles.toolBtnText}`}
            data-active={compareMode}
            onClick={toggleCompare}
            title="Modo compare"
          >
            <GitCompareArrows size={13} aria-hidden /> Compare
          </button>
          <button
            type="button"
            className={`${styles.toolBtn} ${styles.toolBtnText}`}
            data-active={aiVisible}
            onClick={() => setAiVisible((v) => !v)}
            title="Mostrar/ocultar overlays IA"
          >
            {aiVisible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
            IA
            {findings.length > 0 && <span className={styles.aiCount}>{findings.length}</span>}
          </button>
        </div>

        <div
          className={styles.viewerStage}
          data-compare={compareMode && compareFile ? "true" : "false"}
          style={{ ["--brightness" as never]: `${brightness}%`, ["--contrast" as never]: `${contrast}%` }}
        >
          {!activeFile ? (
            <div className={styles.viewerEmpty}>
              <Sparkles size={40} aria-hidden style={{ opacity: 0.3, marginBottom: 12 }} />
              <div>
                {selectedPatient
                  ? "Sin radiografías para este paciente."
                  : "Selecciona un paciente arriba para empezar."}
              </div>
            </div>
          ) : compareMode && compareFile ? (
            <>
              <div className={styles.compareSlot}>
                <span className={styles.compareSlotLabel}>
                  A · {formatDate(activeFile.takenAt ?? activeFile.createdAt)}
                </span>
                {isImage(activeFile.mimeType) ? (
                  <img
                    src={activeFile.url}
                    alt=""
                    className={inverted ? styles.viewerImgInverted : styles.viewerImg}
                  />
                ) : (
                  <div className={styles.viewerEmpty}>Archivo no es imagen</div>
                )}
              </div>
              <div className={styles.compareSlot}>
                <span className={styles.compareSlotLabel}>
                  B · {formatDate(compareFile.takenAt ?? compareFile.createdAt)}
                </span>
                {isImage(compareFile.mimeType) ? (
                  <img
                    src={compareFile.url}
                    alt=""
                    className={inverted ? styles.viewerImgInverted : styles.viewerImg}
                  />
                ) : (
                  <div className={styles.viewerEmpty}>Archivo no es imagen</div>
                )}
              </div>
            </>
          ) : (
            <>
              {isImage(activeFile.mimeType) ? (
                <img
                  src={activeFile.url}
                  alt={activeFile.name}
                  className={inverted ? styles.viewerImgInverted : styles.viewerImg}
                />
              ) : (
                <div className={styles.viewerEmpty}>
                  Este archivo no es una imagen. <br />
                  <a href={activeFile.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
                    Abrir en pestaña nueva →
                  </a>
                </div>
              )}

              {/* AI overlays */}
              <div className={styles.aiOverlay} data-visible={aiVisible}>
                {findings.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    className={styles.findingRegion}
                    data-highlighted={highlightedFindingId === f.id}
                    style={{
                      ["--mf-region-color" as never]: SEV_COLOR[f.severity],
                      left: `${f.region.x}%`,
                      top: `${f.region.y}%`,
                      width: `${f.region.w}%`,
                      height: `${f.region.h}%`,
                    }}
                    onMouseEnter={() => setHighlightedFindingId(f.id)}
                    onMouseLeave={() => setHighlightedFindingId(null)}
                    onClick={() => setHighlightedFindingId(f.id)}
                    title={f.title}
                  >
                    <span className={styles.findingRegionLabel}>F{f.id}</span>
                  </button>
                ))}
              </div>

              <div className={styles.viewerInfoCard}>
                <span className={styles.viewerInfoCardTitle}>
                  {CATEGORIES.find((c) => c.id === activeFile.category)?.label ?? "Radiografía"}
                </span>
                <span className={styles.viewerInfoCardMeta}>
                  {formatDate(activeFile.takenAt ?? activeFile.createdAt)}
                </span>
                {activeFile.toothNumber && (
                  <span className={styles.viewerInfoCardMeta}>
                    Diente: {activeFile.toothNumber}
                  </span>
                )}
              </div>

              <div className={styles.zoomControls}>
                <button type="button" className={styles.zoomBtn} title="Zoom +"><Plus size={13} aria-hidden /></button>
                <button type="button" className={styles.zoomBtn} title="Zoom -"><Minus size={13} aria-hidden /></button>
                <button type="button" className={styles.zoomBtn} title="Ajustar"><Maximize2 size={13} aria-hidden /></button>
              </div>
              <div className={styles.statusBar}>
                Brillo: {brightness}% · Contraste: {contrast}% · Tool: {tool}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ── Panel derecho ── */}
      <aside className={styles.rightPanel}>
        <div className={styles.rightTabs}>
          <button
            type="button"
            className={`${styles.rightTab} ${tab === "ai" ? styles.rightTabActive : ""}`}
            onClick={() => setTab("ai")}
          >
            Hallazgos IA
            {findings.length > 0 && <span className={styles.rightTabBadge}>{findings.length}</span>}
          </button>
          <button
            type="button"
            className={`${styles.rightTab} ${tab === "measurements" ? styles.rightTabActive : ""}`}
            onClick={() => setTab("measurements")}
          >
            Mediciones
          </button>
          <button
            type="button"
            className={`${styles.rightTab} ${tab === "notes" ? styles.rightTabActive : ""}`}
            onClick={() => setTab("notes")}
          >
            Notas
          </button>
        </div>

        <div className={styles.rightBody}>
          {tab === "ai" && (
            <>
              {!activeFile ? (
                <div className={styles.emptyState}>Selecciona una radiografía para ver hallazgos IA.</div>
              ) : !aiAnalysis ? (
                <>
                  <div className={styles.aiSummary}>
                    <div className={styles.aiSummaryTitle}>
                      <Sparkles size={13} aria-hidden /> Análisis IA pendiente
                    </div>
                    <div className={styles.aiSummaryText}>
                      Esta radiografía aún no ha sido analizada. Genera el análisis automático
                      para detectar caries, lesiones periapicales, calidad ósea y más.
                    </div>
                  </div>
                  <div className={styles.actionsRow}>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                      onClick={handleAnalyze}
                      disabled={analyzing || aiUsed >= aiLimit}
                    >
                      <Sparkles size={13} aria-hidden />
                      {analyzing ? "Analizando…" : "Analizar con IA"}
                    </button>
                  </div>
                  {aiLimit > 0 && (
                    <div style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center" }}>
                      Uso IA: {aiUsed.toLocaleString()} / {aiLimit.toLocaleString()} ({aiPercent}%)
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.aiSummary}>
                    <div className={styles.aiSummaryTitle}>
                      <Sparkles size={13} aria-hidden /> Resumen IA
                      {aiAnalysis.modelVersion && (
                        <span className={styles.aiSummaryVersion}>· {aiAnalysis.modelVersion}</span>
                      )}
                    </div>
                    <div className={styles.aiSummaryText}>{aiAnalysis.summary}</div>
                    {avgConfidence > 0 && (
                      <div className={styles.confidenceWrap}>
                        <div className={styles.confidenceLabel}>
                          <span>Confianza global</span>
                          <strong>{Math.round(avgConfidence * 100)}%</strong>
                        </div>
                        <div className={styles.confidenceBar}>
                          <div
                            className={styles.confidenceFill}
                            style={{ width: `${avgConfidence * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={styles.findingsHeader}>
                    <span className={styles.findingsHeaderLabel}>
                      Hallazgos detectados ({findings.length})
                    </span>
                    <button type="button" className={styles.findingsHeaderSort}>Por severidad</button>
                  </div>

                  <div className={styles.findingsList}>
                    {findings.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={styles.finding}
                        data-highlighted={highlightedFindingId === f.id}
                        style={{ ["--mf-region-color" as never]: SEV_COLOR[f.severity] }}
                        onMouseEnter={() => setHighlightedFindingId(f.id)}
                        onMouseLeave={() => setHighlightedFindingId(null)}
                        onClick={() => setHighlightedFindingId(f.id)}
                      >
                        <span className={styles.findingIcon}>F{f.id}</span>
                        <div className={styles.findingBody}>
                          <div className={styles.findingTitle}>
                            {f.title}
                            {f.tooth && <span style={{ color: "var(--text-3)", fontWeight: 500 }}> · diente {f.tooth}</span>}
                          </div>
                          <div className={styles.findingMeta}>
                            <span className={styles.findingMetaSev} style={{ color: SEV_COLOR[f.severity] }}>
                              {SEV_LABEL[f.severity]}
                            </span>
                            {f.confidence != null && <span>· {Math.round(f.confidence * 100)}%</span>}
                          </div>
                        </div>
                        <div className={styles.findingActions}>
                          <span
                            className={styles.findingActionBtn}
                            title="Aceptar"
                            onClick={(e) => { e.stopPropagation(); toast.success(`Aceptado: ${f.title}`); }}
                          >
                            <Check size={11} aria-hidden />
                          </span>
                          <span
                            className={styles.findingActionBtn}
                            title="Rechazar"
                            onClick={(e) => { e.stopPropagation(); toast(`Rechazado: ${f.title}`, { icon: "✕" }); }}
                          >
                            <XIcon size={11} aria-hidden />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className={styles.severityKey}>
                    <span className={styles.severityKeyItem}>
                      <span className={styles.severityKeyDot} style={{ background: SEV_COLOR.alta }} /> Alta
                    </span>
                    <span className={styles.severityKeyItem}>
                      <span className={styles.severityKeyDot} style={{ background: SEV_COLOR.media }} /> Media
                    </span>
                    <span className={styles.severityKeyItem}>
                      <span className={styles.severityKeyDot} style={{ background: SEV_COLOR.baja }} /> Baja
                    </span>
                  </div>

                  <div className={styles.actionsRow}>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                      onClick={handleGeneratePlan}
                    >
                      <Sparkles size={13} aria-hidden /> Generar plan tx
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => activeFile && window.open(activeFile.url, "_blank")}
                    >
                      <FileDown size={13} aria-hidden /> Exportar
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "measurements" && (
            <div className={styles.emptyState}>
              Las mediciones se guardarán al usar las herramientas de regla y ángulo.
            </div>
          )}

          {tab === "notes" && (
            <>
              {!activeFile ? (
                <div className={styles.emptyState}>Selecciona una radiografía.</div>
              ) : (
                <>
                  <textarea
                    className={styles.notesArea}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Notas del doctor sobre esta radiografía…"
                  />
                  <div className={styles.actionsRow}>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                      onClick={handleSaveNotes}
                      disabled={notesDraft === (activeFile.doctorNotes ?? "")}
                    >
                      Guardar nota
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={handleDelete}
                      style={{ color: "#dc2626" }}
                    >
                      <Trash2 size={13} aria-hidden /> Eliminar archivo
                    </button>
                  </div>
                  {activeFile.doctorNotesUpdatedAt && (
                    <div style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center" }}>
                      Actualizado: {formatDate(activeFile.doctorNotesUpdatedAt)}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
