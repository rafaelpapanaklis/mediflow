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
  Eraser,
  X as XIcon,
  FileDown,
  Menu,
} from "lucide-react";
import toast from "react-hot-toast";
import styles from "./xrays.module.css";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";

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
  mode?: "GENERAL" | "PERIODONTAL_BONE_LOSS" | "PERIIMPLANT_BONE_LOSS";
  measurements?: unknown;
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
  /** ID del paciente activo (forzado desde la ruta /xrays/[patientId]). */
  initialPatientId?: string;
  /** ID del archivo activo. Si se pasa, abre directamente esa radiografía. */
  initialFileId?: string;
  /** Si true, el viewer está bloqueado al paciente y no permite cambiar. */
  lockedToPatient?: boolean;
}

const CATEGORIES = [
  { id: "XRAY_PERIAPICAL",   labelKey: "pages.xrays.catPeriapical" },
  { id: "XRAY_PANORAMIC",    labelKey: "pages.xrays.catPanoramic" },
  { id: "XRAY_CEPHALOMETRIC", labelKey: "pages.xrays.catCephalometric" },
  { id: "XRAY_BITEWING",     labelKey: "pages.xrays.catBitewing" },
  { id: "PHOTO_INTRAORAL",   labelKey: "pages.xrays.catIntraoralPhoto" },
  { id: "OTHER",             labelKey: "pages.xrays.catOther" },
];

const SEV_COLOR: Record<AiFinding["severity"], string> = {
  alta: "#ef4444",
  media: "#f59e0b",
  baja: "#06b6d4",
  informativo: "#10b981",
};
const SEV_LABEL_KEY: Record<AiFinding["severity"], string> = {
  alta: "pages.xrays.sevHigh",
  media: "pages.xrays.sevMedium",
  baja: "pages.xrays.sevLow",
  informativo: "pages.xrays.sevInfo",
};

type Tab = "ai" | "measurements" | "notes";
type Tool = "pan" | "zoom" | "rotate" | "measure" | "angle" | "annotate";

/** Coordenadas normalizadas (0..1) relativas al rect natural de la imagen,
 *  para que las anotaciones se mantengan estables a cualquier zoom/tamaño. */
interface Pt { x: number; y: number; }
interface Annotation {
  id: string;
  type: "ruler" | "angle" | "freehand";
  points: Pt[];
  label?: string;
  color?: string;
  createdAt?: string;
}

/** DPI asumido para mostrar distancias en mm. La mayoría de radiografías
 *  digitales rondan 300 DPI; sin metadata DICOM real es la mejor aproximación. */
const ASSUMED_DPI = 300;
const MM_PER_INCH = 25.4;

function makeAnnotationId() {
  return `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function distanceMm(a: Pt, b: Pt, naturalW: number, naturalH: number): number {
  const dxPx = (b.x - a.x) * naturalW;
  const dyPx = (b.y - a.y) * naturalH;
  const px = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
  return (px / ASSUMED_DPI) * MM_PER_INCH;
}

function angleDeg(a: Pt, b: Pt, c: Pt, naturalW: number, naturalH: number): number {
  const v1x = (a.x - b.x) * naturalW;
  const v1y = (a.y - b.y) * naturalH;
  const v2x = (c.x - b.x) * naturalW;
  const v2y = (c.y - b.y) * naturalH;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

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
  initialPatientId,
  initialFileId,
  lockedToPatient = false,
}: Props) {
  const t = useT();
  const askConfirm = useConfirm();
  const [files, setFiles] = useState<PatientFile[]>(initialFiles);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    initialPatientId ?? initialFiles[0]?.patient.id ?? null,
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(
    (initialFileId && initialFiles.some((f) => f.id === initialFileId))
      ? initialFileId
      : (initialFiles[0]?.id ?? null),
  );
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

  // ── Transformaciones del visor ──
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  // ── Anotaciones ──
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drafting, setDrafting] = useState<Annotation | null>(null);
  const [savingAnn, setSavingAnn] = useState(false);
  const drawingRef = useRef<boolean>(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mobile drawer del timeline (lista de pacientes/historial). En desktop
  // el aside está visible permanentemente; en mobile pasa a off-canvas.
  const [mobileTimelineOpen, setMobileTimelineOpen] = useState(false);
  useEffect(() => {
    if (!mobileTimelineOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileTimelineOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileTimelineOpen]);

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

  // Reset notes draft, transformaciones y anotaciones cuando cambia file activo.
  useEffect(() => {
    setNotesDraft(activeFile?.doctorNotes ?? "");
    setHighlightedFindingId(null);
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setDrafting(null);
    setNaturalSize({ w: 0, h: 0 });
    if (!activeFileId) {
      setAnnotations([]);
      return;
    }
    // Carga anotaciones del server con fallback a localStorage por archivo.
    let cancelled = false;
    const lsKey = `mf:xray-annotations:${activeFileId}`;
    (async () => {
      try {
        const res = await fetch(`/api/xrays/${activeFileId}/annotations`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.annotations) && data.annotations.length > 0) {
            setAnnotations(data.annotations);
            return;
          }
        }
      } catch {/* silent — fallback localStorage */}
      // Fallback localStorage
      try {
        const raw = window.localStorage.getItem(lsKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setAnnotations(parsed);
        } else {
          setAnnotations([]);
        }
      } catch {
        setAnnotations([]);
      }
    })();
    return () => { cancelled = true; };
  }, [activeFileId, activeFile?.doctorNotes]);

  // Persistencia debounced de anotaciones (server + localStorage).
  useEffect(() => {
    if (!activeFileId) return;
    const id = activeFileId;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(
          `mf:xray-annotations:${id}`,
          JSON.stringify(annotations),
        );
      } catch {/* quota — ignore */}
      setSavingAnn(true);
      void fetch(`/api/xrays/${id}/annotations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations }),
      }).catch(() => {/* silent */}).finally(() => setSavingAnn(false));
    }, 600);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [annotations, activeFileId]);

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
      toast.error(t("pages.xrays.selectPatientFirst"));
      return;
    }
    fileInputRef.current?.click();
  }, [selectedPatient, t]);

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
        throw new Error(err.error ?? t("pages.xrays.uploadError"));
      }
      const record = await res.json();
      setFiles((prev) => [{ ...record, patient: selectedPatient }, ...prev]);
      setActiveFileId(record.id);
      toast.success(t("pages.xrays.uploadSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pages.xrays.uploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [selectedPatient, t]);

  const handleAnalyze = useCallback(
    async (mode: "GENERAL" | "PERIODONTAL_BONE_LOSS" | "PERIIMPLANT_BONE_LOSS" = "GENERAL") => {
      if (!activeFile) return;
      setAnalyzing(true);
      try {
        const url = `/api/xrays/${activeFile.id}/analyze?mode=${mode}${mode !== "GENERAL" ? "&refresh=true" : ""}`;
        const res = await fetch(url, { method: "POST" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? t("pages.xrays.analyzeError"));
        }
        const data = await res.json();
        setFiles((prev) =>
          prev.map((f) =>
            f.id === activeFile.id
              ? {
                  ...f,
                  xrayAnalysis: {
                    ...data.analysis,
                    mode: data.mode,
                    measurements: data.measurements ?? null,
                  },
                }
              : f,
          ),
        );
        toast.success(
          mode === "PERIODONTAL_BONE_LOSS"
            ? t("pages.xrays.analyzePeriodontalDone")
            : mode === "PERIIMPLANT_BONE_LOSS"
              ? t("pages.xrays.analyzePeriimplantDone")
              : t("pages.xrays.analyzeAiDone"),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("pages.xrays.analyzeError"));
      } finally {
        setAnalyzing(false);
      }
    },
    [activeFile, t],
  );

  const handleDelete = useCallback(async () => {
    if (!activeFile) return;
    if (!(await askConfirm({
      title: t("pages.xrays.deleteConfirmTitle", { name: activeFile.name }),
      description: t("pages.xrays.deleteConfirmDesc"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    try {
      const res = await fetch(`/api/xrays/${activeFile.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setFiles((prev) => prev.filter((f) => f.id !== activeFile.id));
      setActiveFileId((prev) => (prev === activeFile.id ? null : prev));
      toast.success(t("pages.xrays.deleteSuccess"));
    } catch {
      toast.error(t("pages.xrays.deleteError"));
    }
  }, [activeFile, askConfirm, t]);

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
      toast.success(t("pages.xrays.notesSaved"));
    } catch {
      toast.error(t("pages.xrays.notesSaveError"));
    }
  }, [activeFile, notesDraft, t]);

  const handleGeneratePlan = useCallback(() => {
    if (findings.length === 0) {
      toast(t("pages.xrays.noFindingsAnalyzeFirst"), { icon: "ℹ️" });
      return;
    }
    const total = findings.length;
    toast.success(t("pages.xrays.planGenerated", { count: total }));
  }, [findings, t]);

  const toggleCompare = useCallback(() => {
    if (compareMode) {
      setCompareMode(false);
      setCompareFileId(null);
      return;
    }
    if (filteredFiles.length < 2) {
      toast(t("pages.xrays.needTwoXrays"), { icon: "ℹ️" });
      return;
    }
    setCompareMode(true);
    // Si no hay segunda asignada, usa la siguiente
    if (!compareFileId && activeFileId) {
      const other = filteredFiles.find((f) => f.id !== activeFileId);
      if (other) setCompareFileId(other.id);
    }
  }, [compareMode, filteredFiles, activeFileId, compareFileId, t]);

  const aiPercent = aiLimit > 0 ? Math.min(100, Math.round((aiUsed / aiLimit) * 100)) : 0;

  /* ─── Herramientas del visor ─── */

  /** Convierte coords de pantalla a coords [0..1] del rect natural de la imagen.
   *  Devuelve null si el click cae fuera de la imagen visible. */
  const eventToImagePoint = useCallback((e: React.MouseEvent | MouseEvent): Pt | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const finalizeAnnotation = useCallback((ann: Annotation) => {
    setAnnotations((prev) => [...prev, ann]);
    setDrafting(null);
  }, []);

  const handleStageMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (compareMode) return;
    if (e.button !== 0) return;

    if (tool === "pan") {
      panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      return;
    }

    if (tool === "rotate") {
      // Click rota 90° a la derecha cada vez.
      setRotation((r) => (r + 90) % 360);
      return;
    }

    if (tool === "zoom") {
      // Click izquierdo zoom in, shift+click zoom out
      setZoom((z) => Math.max(0.25, Math.min(6, z * (e.shiftKey ? 0.85 : 1.15))));
      return;
    }

    if (tool === "annotate") {
      const pt = eventToImagePoint(e);
      if (!pt) return;
      const id = makeAnnotationId();
      setDrafting({
        id,
        type: "freehand",
        points: [pt],
        color: "#7c3aed",
        createdAt: new Date().toISOString(),
      });
      drawingRef.current = true;
      return;
    }

    if (tool === "measure") {
      const pt = eventToImagePoint(e);
      if (!pt) return;
      if (!drafting || drafting.type !== "ruler") {
        setDrafting({
          id: makeAnnotationId(),
          type: "ruler",
          points: [pt],
          color: "#10b981",
          createdAt: new Date().toISOString(),
        });
        return;
      }
      // Segundo click: cierra
      finalizeAnnotation({ ...drafting, points: [...drafting.points, pt] });
      return;
    }

    if (tool === "angle") {
      const pt = eventToImagePoint(e);
      if (!pt) return;
      if (!drafting || drafting.type !== "angle") {
        setDrafting({
          id: makeAnnotationId(),
          type: "angle",
          points: [pt],
          color: "#f59e0b",
          createdAt: new Date().toISOString(),
        });
        return;
      }
      const next = [...drafting.points, pt];
      if (next.length === 3) {
        finalizeAnnotation({ ...drafting, points: next });
      } else {
        setDrafting({ ...drafting, points: next });
      }
      return;
    }
  }, [compareMode, tool, pan.x, pan.y, eventToImagePoint, drafting, finalizeAnnotation]);

  const handleStageMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (panStartRef.current && tool === "pan") {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.px + dx, y: panStartRef.current.py + dy });
      return;
    }

    if (tool === "annotate" && drawingRef.current && drafting?.type === "freehand") {
      const pt = eventToImagePoint(e);
      if (!pt) return;
      setDrafting((prev) =>
        prev && prev.type === "freehand" ? { ...prev, points: [...prev.points, pt] } : prev,
      );
    }
  }, [tool, drafting, eventToImagePoint]);

  const handleStageMouseUp = useCallback(() => {
    panStartRef.current = null;
    if (tool === "annotate" && drawingRef.current && drafting?.type === "freehand") {
      drawingRef.current = false;
      if (drafting.points.length >= 2) {
        finalizeAnnotation(drafting);
      } else {
        setDrafting(null);
      }
    }
  }, [tool, drafting, finalizeAnnotation]);

  const handleStageWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (compareMode) return;
    if (tool !== "zoom" && tool !== "pan") return;
    e.preventDefault();
    const delta = -e.deltaY;
    setZoom((z) => Math.max(0.25, Math.min(6, z * (delta > 0 ? 1.1 : 1 / 1.1))));
  }, [compareMode, tool]);

  const handleClearAnnotations = useCallback(async () => {
    if (annotations.length === 0 && !drafting) return;
    if (!(await askConfirm({
      title: t("pages.xrays.clearAnnotationsTitle"),
      description: t("pages.xrays.clearAnnotationsDesc"),
      variant: "danger",
      confirmText: t("pages.xrays.clearAnnotationsConfirm"),
    }))) return;
    setAnnotations([]);
    setDrafting(null);
    toast.success(t("pages.xrays.annotationsCleared"));
  }, [annotations.length, drafting, askConfirm, t]);

  const handleZoomBtn = useCallback((dir: "in" | "out" | "fit") => {
    if (dir === "fit") {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      return;
    }
    setZoom((z) => Math.max(0.25, Math.min(6, z * (dir === "in" ? 1.2 : 1 / 1.2))));
  }, []);

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setNaturalSize({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
  }, []);

  // Esc cancela un draft en progreso.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drafting) setDrafting(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drafting]);

  /* ─── Render ─── */

  return (
    <div
      className={styles.page}
      data-active-mode="xrays"
      data-mobile-timeline-open={mobileTimelineOpen || undefined}
    >
      {/* Backdrop del drawer en mobile. */}
      {mobileTimelineOpen && (
        <button
          type="button"
          aria-label={t("pages.xrays.closeHistory")}
          className={styles.mobileBackdrop}
          onClick={() => setMobileTimelineOpen(false)}
        />
      )}
      {/* ── Topbar ── */}
      <div className={styles.topbar}>
        {/* Hamburger sólo visible en mobile (oculto vía media query). */}
        <button
          type="button"
          className={styles.mobileMenuBtn}
          onClick={() => setMobileTimelineOpen(true)}
          aria-label={t("pages.xrays.openHistory")}
        >
          <Menu size={16} aria-hidden />
        </button>
        <div className={styles.topbarTitle}>
          <span className={styles.topbarTitleIcon}><Sparkles size={14} aria-hidden /></span>
          {t("pages.xrays.title")}
        </div>
        {lockedToPatient ? (
          <a
            href="/dashboard/xrays"
            className={styles.topbarBtn}
            title={t("pages.xrays.backToPatientList")}
          >
            ← {t("pages.xrays.changePatient")}
          </a>
        ) : (
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
            <option value="">{t("pages.xrays.allPatients")}</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName} · {p.patientNumber}
              </option>
            ))}
          </select>
        )}
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
          <FileDown size={13} aria-hidden /> {t("common.export")}
        </button>
        <button
          type="button"
          className={`${styles.topbarBtn} ${styles.topbarBtnPrimary}`}
          onClick={handleUploadClick}
          disabled={uploading}
        >
          <Upload size={13} aria-hidden /> {uploading ? t("pages.xrays.uploading") : t("pages.xrays.uploadXray")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.dcm"
          className={styles.uploadInput}
          onChange={handleFileChange}
        />
      </div>

      {/* ── Timeline lateral (drawer en mobile) ── */}
      <aside
        className={styles.timeline}
        role={mobileTimelineOpen ? "dialog" : undefined}
        aria-modal={mobileTimelineOpen ? "true" : undefined}
        aria-label={t("pages.xrays.xrayHistory")}
      >
        <div className={styles.timelineHeader}>
          <span className={styles.timelineLabel}>{t("pages.xrays.historyLabel")} · {filteredFiles.length}</span>
          <div style={{ position: "relative" }}>
            <Search size={11} aria-hidden style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input
              type="text"
              placeholder={t("common.searchPlaceholder")}
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
          <Upload size={12} aria-hidden /> {t("pages.xrays.uploadXray")}
        </button>
        <div className={styles.timelineList}>
          {filteredFiles.length === 0 ? (
            <div className={styles.emptyState}>
              {selectedPatient
                ? t("pages.xrays.timelineEmptyUploadFirst")
                : t("pages.xrays.timelineEmptySelectPatient")}
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
                    // Cierra el drawer si estaba abierto en mobile.
                    setMobileTimelineOpen(false);
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
                      {(() => {
                        const cat = CATEGORIES.find((c) => c.id === f.category);
                        return cat ? t(cat.labelKey) : t("pages.xrays.catOther");
                      })()}
                    </span>
                    <span className={styles.xrayCardDate}>{formatDate(f.takenAt ?? f.createdAt)}</span>
                    {findingsCount > 0 && (
                      <span className={styles.xrayCardFindings}>
                        <span className={styles.xrayCardFindingsDot} aria-hidden />
                        {t("pages.xrays.findingsCount", { count: findingsCount })}
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
        <div className={styles.viewerToolbar} role="toolbar" aria-label={t("pages.xrays.viewerTools")}>
          {/* Mapa de etiquetas humanas para tools — title críptico
              ("pan", "zoom") + aria-label descriptivo. data-active y
              aria-pressed comunican estado al lector de pantalla. */}
          {(
            [
              { id: "pan", label: t("pages.xrays.toolPan") },
              { id: "zoom", label: t("pages.xrays.toolZoom") },
              { id: "rotate", label: t("pages.xrays.toolRotate") },
            ] as Array<{ id: Tool; label: string }>
          ).map((ti) => {
            const Icon = ti.id === "pan" ? Move : ti.id === "zoom" ? ZoomIn : RotateCw;
            const isActive = tool === ti.id;
            return (
              <button
                key={ti.id}
                type="button"
                className={styles.toolBtn}
                data-active={isActive}
                aria-pressed={isActive}
                onClick={() => setTool(ti.id)}
                title={ti.label}
                aria-label={ti.label}
              >
                <Icon size={15} aria-hidden />
              </button>
            );
          })}
          <span className={styles.toolDivider} />
          {(
            [
              { id: "measure", label: t("pages.xrays.toolRuler") },
              { id: "angle", label: t("pages.xrays.toolAngle") },
              { id: "annotate", label: t("pages.xrays.toolPencil") },
            ] as Array<{ id: Tool; label: string }>
          ).map((ti) => {
            const Icon = ti.id === "measure" ? Ruler : ti.id === "angle" ? Triangle : Pencil;
            const isActive = tool === ti.id;
            return (
              <button
                key={ti.id}
                type="button"
                className={styles.toolBtn}
                data-active={isActive}
                aria-pressed={isActive}
                onClick={() => setTool(ti.id)}
                title={ti.label}
                aria-label={ti.label}
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
            aria-pressed={inverted}
            onClick={() => setInverted((v) => !v)}
            title={t("pages.xrays.invertColors")}
            aria-label={t("pages.xrays.invertColors")}
          >
            <Contrast size={15} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            title={t("pages.xrays.flipHorizontal")}
            aria-label={t("pages.xrays.flipHorizontal")}
          >
            <FlipHorizontal size={15} aria-hidden />
          </button>
          <span className={styles.toolDivider} />
          <button
            type="button"
            className={styles.toolBtn}
            onClick={handleClearAnnotations}
            disabled={annotations.length === 0}
            title={t("pages.xrays.clearAllAnnotations")}
            aria-label={t("pages.xrays.clearAllAnnotations")}
          >
            <Eraser size={15} aria-hidden />
          </button>
          <span className={styles.toolDivider} />
          <label className={styles.toolSlider}>
            {t("pages.xrays.brightness")}
            <input
              type="range" min={50} max={150} value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              aria-label={t("pages.xrays.brightnessValue", { value: brightness })}
              aria-valuenow={brightness}
              aria-valuemin={50}
              aria-valuemax={150}
            />
            <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{brightness}%</strong>
          </label>
          <label className={styles.toolSlider}>
            {t("pages.xrays.contrast")}
            <input
              type="range" min={50} max={200} value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
              aria-label={t("pages.xrays.contrastValue", { value: contrast })}
              aria-valuenow={contrast}
              aria-valuemin={50}
              aria-valuemax={200}
            />
            <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{contrast}%</strong>
          </label>
          <span className={styles.toolSpacer} />
          <button
            type="button"
            className={`${styles.toolBtn} ${styles.toolBtnText}`}
            data-active={compareMode}
            aria-pressed={compareMode}
            onClick={toggleCompare}
            title={t("pages.xrays.compareTooltip")}
            aria-label={t("pages.xrays.compareTooltip")}
          >
            <GitCompareArrows size={13} aria-hidden /> {t("pages.xrays.compare")}
          </button>
          <button
            type="button"
            className={`${styles.toolBtn} ${styles.toolBtnText}`}
            data-active={aiVisible}
            aria-pressed={aiVisible}
            onClick={() => setAiVisible((v) => !v)}
            title={aiVisible ? t("pages.xrays.hideAiOverlays") : t("pages.xrays.showAiOverlays")}
            aria-label={aiVisible ? t("pages.xrays.hideAiOverlays") : t("pages.xrays.showAiOverlays")}
          >
            {aiVisible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
            {t("pages.xrays.aiLabel")}
            {findings.length > 0 && <span className={styles.aiCount}>{findings.length}</span>}
          </button>
        </div>

        <div
          ref={stageRef}
          className={styles.viewerStage}
          data-compare={compareMode && compareFile ? "true" : "false"}
          data-tool={tool}
          style={{ ["--brightness" as never]: `${brightness}%`, ["--contrast" as never]: `${contrast}%` }}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onMouseLeave={handleStageMouseUp}
          onWheel={handleStageWheel}
        >
          {!activeFile ? (
            <div className={styles.viewerEmpty}>
              <Sparkles size={40} aria-hidden style={{ opacity: 0.3, marginBottom: 12 }} />
              <div>
                {selectedPatient
                  ? t("pages.xrays.viewerEmptyNoXrays")
                  : t("pages.xrays.viewerEmptySelectPatient")}
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
                  <div className={styles.viewerEmpty}>{t("pages.xrays.fileNotImage")}</div>
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
                  <div className={styles.viewerEmpty}>{t("pages.xrays.fileNotImage")}</div>
                )}
              </div>
            </>
          ) : (
            <>
              {isImage(activeFile.mimeType) ? (
                <div
                  className={styles.viewerImgWrap}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                  }}
                >
                  <img
                    ref={imgRef}
                    src={activeFile.url}
                    alt={activeFile.name}
                    onLoad={handleImageLoad}
                    draggable={false}
                    className={inverted ? styles.viewerImgInverted : styles.viewerImg}
                  />
                  <AnnotationsOverlay
                    annotations={annotations}
                    drafting={drafting}
                    naturalSize={naturalSize}
                  />
                </div>
              ) : (
                <div className={styles.viewerEmpty}>
                  {t("pages.xrays.fileNotImageLong")} <br />
                  <a href={activeFile.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
                    {t("pages.xrays.openInNewTab")} →
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
                  {(() => {
                    const cat = CATEGORIES.find((c) => c.id === activeFile.category);
                    return cat ? t(cat.labelKey) : t("pages.xrays.title");
                  })()}
                </span>
                <span className={styles.viewerInfoCardMeta}>
                  {formatDate(activeFile.takenAt ?? activeFile.createdAt)}
                </span>
                {activeFile.toothNumber && (
                  <span className={styles.viewerInfoCardMeta}>
                    {t("pages.xrays.tooth")}: {activeFile.toothNumber}
                  </span>
                )}
              </div>

              <div className={styles.zoomControls}>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  title={t("pages.xrays.zoomIn")}
                  onClick={() => handleZoomBtn("in")}
                >
                  <Plus size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  title={t("pages.xrays.zoomOut")}
                  onClick={() => handleZoomBtn("out")}
                >
                  <Minus size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  title={t("pages.xrays.fitToViewer")}
                  onClick={() => handleZoomBtn("fit")}
                >
                  <Maximize2 size={13} aria-hidden />
                </button>
              </div>
              <div className={styles.statusBar}>
                {t("pages.xrays.statusZoom")}: {Math.round(zoom * 100)}% · {t("pages.xrays.statusRotation")}: {rotation}° · {t("pages.xrays.brightness")}: {brightness}% · {t("pages.xrays.contrast")}: {contrast}% · {t("pages.xrays.statusTool")}: {tool}
                {savingAnn && <> · <em style={{ color: "#a78bfa" }}>{t("common.saving")}</em></>}
                {drafting && <> · <em>{drafting.type === "ruler" ? t("pages.xrays.draftClickTwoPoints") : drafting.type === "angle" ? t("pages.xrays.draftAnglePoints", { count: drafting.points.length }) : t("pages.xrays.draftDrawing")}</em></>}
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
            {t("pages.xrays.tabAiFindings")}
            {findings.length > 0 && <span className={styles.rightTabBadge}>{findings.length}</span>}
          </button>
          <button
            type="button"
            className={`${styles.rightTab} ${tab === "measurements" ? styles.rightTabActive : ""}`}
            onClick={() => setTab("measurements")}
          >
            {t("pages.xrays.tabMeasurements")}
          </button>
          <button
            type="button"
            className={`${styles.rightTab} ${tab === "notes" ? styles.rightTabActive : ""}`}
            onClick={() => setTab("notes")}
          >
            {t("common.notes")}
          </button>
        </div>

        <div className={styles.rightBody}>
          {tab === "ai" && (
            <>
              {!activeFile ? (
                <div className={styles.emptyState}>{t("pages.xrays.selectXrayForFindings")}</div>
              ) : !aiAnalysis ? (
                <>
                  <div className={styles.aiSummary}>
                    <div className={styles.aiSummaryTitle}>
                      <Sparkles size={13} aria-hidden /> {t("pages.xrays.aiAnalysisPending")}
                    </div>
                    <div className={styles.aiSummaryText}>
                      {t("pages.xrays.aiAnalysisPendingDesc")}
                    </div>
                  </div>
                  <div className={styles.actionsRow} style={{ flexDirection: "column", gap: 6 }}>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                      onClick={() => handleAnalyze("GENERAL")}
                      disabled={analyzing || aiUsed >= aiLimit}
                    >
                      <Sparkles size={13} aria-hidden />
                      {analyzing ? t("pages.xrays.analyzing") : t("pages.xrays.analyzeWithAi")}
                    </button>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => handleAnalyze("PERIODONTAL_BONE_LOSS")}
                        disabled={analyzing || aiUsed >= aiLimit}
                        title={t("pages.xrays.periodontalTooltip")}
                        style={{ flex: 1, fontSize: 11 }}
                      >
                        {t("pages.xrays.periodontal")}
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => handleAnalyze("PERIIMPLANT_BONE_LOSS")}
                        disabled={analyzing || aiUsed >= aiLimit}
                        title={t("pages.xrays.periimplantTooltip")}
                        style={{ flex: 1, fontSize: 11 }}
                      >
                        {t("pages.xrays.periimplant")}
                      </button>
                    </div>
                  </div>
                  {aiLimit > 0 && (
                    <div style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center" }}>
                      {t("pages.xrays.aiUsage")}: {aiUsed.toLocaleString()} / {aiLimit.toLocaleString()} ({aiPercent}%)
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.aiSummary}>
                    <div className={styles.aiSummaryTitle}>
                      <Sparkles size={13} aria-hidden /> {t("pages.xrays.aiSummary")}
                      {aiAnalysis.mode && aiAnalysis.mode !== "GENERAL" && (
                        <span
                          className={styles.aiSummaryVersion}
                          style={{
                            background: "rgba(56, 189, 248, 0.18)",
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                          }}
                        >
                          {aiAnalysis.mode === "PERIODONTAL_BONE_LOSS"
                            ? t("pages.xrays.periodontal")
                            : t("pages.xrays.periimplant")}
                        </span>
                      )}
                      {aiAnalysis.modelVersion && (
                        <span className={styles.aiSummaryVersion}>· {aiAnalysis.modelVersion}</span>
                      )}
                    </div>
                    <div className={styles.aiSummaryText}>{aiAnalysis.summary}</div>
                    {avgConfidence > 0 && (
                      <div className={styles.confidenceWrap}>
                        <div className={styles.confidenceLabel}>
                          <span>{t("pages.xrays.globalConfidence")}</span>
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
                      {t("pages.xrays.findingsDetected", { count: findings.length })}
                    </span>
                    <button type="button" className={styles.findingsHeaderSort}>{t("pages.xrays.bySeverity")}</button>
                  </div>

                  <div className={styles.findingsList}>
                    {findings.map((f) => (
                      // div + role="button" porque dentro hay sub-botones
                      // Aceptar/Rechazar y los buttons no se anidan en HTML
                      // válido. Mantenemos accesibilidad por teclado con
                      // tabIndex y onKeyDown (Enter/Space).
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        className={styles.finding}
                        data-highlighted={highlightedFindingId === f.id}
                        style={{ ["--mf-region-color" as never]: SEV_COLOR[f.severity] }}
                        onMouseEnter={() => setHighlightedFindingId(f.id)}
                        onMouseLeave={() => setHighlightedFindingId(null)}
                        onClick={() => setHighlightedFindingId(f.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setHighlightedFindingId(f.id);
                          }
                        }}
                        aria-label={t("pages.xrays.findingAriaLabel", { id: f.id, title: f.title, severity: t(SEV_LABEL_KEY[f.severity]) })}
                      >
                        <span className={styles.findingIcon}>F{f.id}</span>
                        <div className={styles.findingBody}>
                          <div className={styles.findingTitle}>
                            {f.title}
                            {f.tooth && <span style={{ color: "var(--text-3)", fontWeight: 500 }}> · {t("pages.xrays.toothInline", { tooth: f.tooth })}</span>}
                          </div>
                          <div className={styles.findingMeta}>
                            <span className={styles.findingMetaSev} style={{ color: SEV_COLOR[f.severity] }}>
                              {t(SEV_LABEL_KEY[f.severity])}
                            </span>
                            {f.confidence != null && <span>· {Math.round(f.confidence * 100)}%</span>}
                          </div>
                        </div>
                        <div className={styles.findingActions}>
                          <button
                            type="button"
                            className={styles.findingActionBtn}
                            title={t("pages.xrays.accept")}
                            aria-label={t("pages.xrays.acceptFinding", { title: f.title })}
                            onClick={(e) => { e.stopPropagation(); toast.success(t("pages.xrays.accepted", { title: f.title })); }}
                          >
                            <Check size={11} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={styles.findingActionBtn}
                            title={t("pages.xrays.reject")}
                            aria-label={t("pages.xrays.rejectFinding", { title: f.title })}
                            onClick={(e) => { e.stopPropagation(); toast(t("pages.xrays.rejected", { title: f.title }), { icon: "✕" }); }}
                          >
                            <XIcon size={11} aria-hidden />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={styles.severityKey}>
                    <span className={styles.severityKeyItem}>
                      <span className={styles.severityKeyDot} style={{ background: SEV_COLOR.alta }} /> {t("pages.xrays.sevHigh")}
                    </span>
                    <span className={styles.severityKeyItem}>
                      <span className={styles.severityKeyDot} style={{ background: SEV_COLOR.media }} /> {t("pages.xrays.sevMedium")}
                    </span>
                    <span className={styles.severityKeyItem}>
                      <span className={styles.severityKeyDot} style={{ background: SEV_COLOR.baja }} /> {t("pages.xrays.sevLow")}
                    </span>
                  </div>

                  <div className={styles.actionsRow}>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                      onClick={handleGeneratePlan}
                    >
                      <Sparkles size={13} aria-hidden /> {t("pages.xrays.generateTxPlan")}
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => activeFile && window.open(activeFile.url, "_blank")}
                    >
                      <FileDown size={13} aria-hidden /> {t("common.export")}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "measurements" && (
            <div className={styles.emptyState}>
              {t("pages.xrays.measurementsEmpty")}
            </div>
          )}

          {tab === "notes" && (
            <>
              {!activeFile ? (
                <div className={styles.emptyState}>{t("pages.xrays.selectXray")}</div>
              ) : (
                <>
                  <textarea
                    className={styles.notesArea}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder={t("pages.xrays.notesPlaceholder")}
                  />
                  <div className={styles.actionsRow}>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                      onClick={handleSaveNotes}
                      disabled={notesDraft === (activeFile.doctorNotes ?? "")}
                    >
                      {t("pages.xrays.saveNote")}
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={handleDelete}
                      style={{ color: "#dc2626" }}
                    >
                      <Trash2 size={13} aria-hidden /> {t("pages.xrays.deleteFile")}
                    </button>
                  </div>
                  {activeFile.doctorNotesUpdatedAt && (
                    <div style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center" }}>
                      {t("pages.xrays.updatedAt")}: {formatDate(activeFile.doctorNotesUpdatedAt)}
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

/* ──────────────────────────────────────────────────────────────────────
 * Overlay SVG con anotaciones (regla, ángulo, lápiz). Coords [0..1]
 * relativas al rect natural; el SVG cubre la imagen al 100%.
 * ────────────────────────────────────────────────────────────────────── */
function AnnotationsOverlay({
  annotations,
  drafting,
  naturalSize,
}: {
  annotations: Annotation[];
  drafting: Annotation | null;
  naturalSize: { w: number; h: number };
}) {
  const all = drafting ? [...annotations, drafting] : annotations;

  return (
    <svg
      className={styles.annotationSvg}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      pointerEvents="none"
      aria-hidden
    >
      {all.map((a) => {
        if (a.type === "ruler") {
          const [p1, p2] = a.points;
          if (!p1 || !p2) {
            // En medio de un draft con sólo 1 punto — render dot
            const p = p1 ?? p2;
            return p ? (
              <circle key={a.id} cx={p.x * 1000} cy={p.y * 1000} r={5} fill={a.color ?? "#10b981"} />
            ) : null;
          }
          const mm = naturalSize.w > 0
            ? distanceMm(p1, p2, naturalSize.w, naturalSize.h)
            : 0;
          const mx = (p1.x + p2.x) / 2 * 1000;
          const my = (p1.y + p2.y) / 2 * 1000;
          return (
            <g key={a.id}>
              <line
                x1={p1.x * 1000} y1={p1.y * 1000}
                x2={p2.x * 1000} y2={p2.y * 1000}
                stroke={a.color ?? "#10b981"} strokeWidth={3}
                strokeLinecap="round"
              />
              <circle cx={p1.x * 1000} cy={p1.y * 1000} r={5} fill={a.color ?? "#10b981"} />
              <circle cx={p2.x * 1000} cy={p2.y * 1000} r={5} fill={a.color ?? "#10b981"} />
              <rect
                x={mx - 32} y={my - 18} width={64} height={20} rx={4}
                fill="rgba(0,0,0,0.78)"
              />
              <text
                x={mx} y={my - 4}
                fill="#fff" fontSize={13} fontWeight={700}
                textAnchor="middle"
                style={{ fontFamily: "monospace" }}
              >
                {mm.toFixed(1)} mm
              </text>
            </g>
          );
        }

        if (a.type === "angle") {
          const pts = a.points;
          if (pts.length < 1) return null;
          const elements: React.ReactNode[] = [];
          // Lines
          for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i];
            const p2 = pts[i + 1];
            elements.push(
              <line
                key={`${a.id}-l-${i}`}
                x1={p1.x * 1000} y1={p1.y * 1000}
                x2={p2.x * 1000} y2={p2.y * 1000}
                stroke={a.color ?? "#f59e0b"} strokeWidth={3}
                strokeLinecap="round"
              />,
            );
          }
          // Dots
          pts.forEach((p, i) => {
            elements.push(
              <circle
                key={`${a.id}-c-${i}`}
                cx={p.x * 1000} cy={p.y * 1000} r={5}
                fill={a.color ?? "#f59e0b"}
              />,
            );
          });
          // Label cuando ya hay 3 puntos
          if (pts.length === 3 && naturalSize.w > 0) {
            const deg = angleDeg(pts[0]!, pts[1]!, pts[2]!, naturalSize.w, naturalSize.h);
            const lx = pts[1].x * 1000;
            const ly = pts[1].y * 1000 - 18;
            elements.push(
              <g key={`${a.id}-label`}>
                <rect x={lx - 30} y={ly - 16} width={60} height={20} rx={4} fill="rgba(0,0,0,0.78)" />
                <text
                  x={lx} y={ly - 2}
                  fill="#fff" fontSize={13} fontWeight={700}
                  textAnchor="middle"
                  style={{ fontFamily: "monospace" }}
                >
                  {deg.toFixed(1)}°
                </text>
              </g>,
            );
          }
          return <g key={a.id}>{elements}</g>;
        }

        if (a.type === "freehand") {
          if (a.points.length < 2) return null;
          const d = a.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${p.x * 1000} ${p.y * 1000}`)
            .join(" ");
          return (
            <path
              key={a.id}
              d={d}
              fill="none"
              stroke={a.color ?? "#7c3aed"}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        }
        return null;
      })}
    </svg>
  );
}
