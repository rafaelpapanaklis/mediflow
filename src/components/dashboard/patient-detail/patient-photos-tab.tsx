"use client";
// Ficha v3 — tab "Fotos clínicas" (módulo ClinicalPhoto `general`).
// Diseño replicado del prototipo "Ficha Paciente DaleControl.dc.html":
// toolbar única (Subir + pills de etapa con count + filtros tipo/vista/rango
// + contador + limpiar), card Comparador antes/después (Deslizador · Lado a
// lado, A ámbar / B verde con swap) y galería agrupada por etapa con tiles
// 4:3, tag INT/EXT y overlay inferior. Lógica/acciones intactas: carga lazy
// vía listClinicalPhotosAction, upload con cuota/compresión, soft-delete.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Camera,
  GitCompare,
  ImagePlus,
  Info,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import {
  deleteClinicalPhotoAction,
  listClinicalPhotosAction,
  uploadClinicalPhotoAction,
} from "@/app/actions/clinical-shared/photos";
import { isFailure } from "@/lib/clinical-shared/result";
import type {
  ClinicalPhotoDTO,
  ClinicalPhotoStage,
  ClinicalPhotoType,
  GeneralPhotoType,
} from "@/lib/clinical-shared/photos/types";
import {
  GENERAL_EXTRAORAL_PHOTO_TYPES,
  GENERAL_INTRAORAL_PHOTO_TYPES,
  GENERAL_PHOTO_TYPE_LABELS,
  STAGE_LABELS,
} from "@/lib/clinical-shared/photos/types";
import { PhotoLightbox } from "@/components/clinical-shared/photos/PhotoLightbox";
import { PhotoCompareSlider } from "@/components/clinical-shared/photos/PhotoCompareSlider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STAGE_ORDER: ClinicalPhotoStage[] = ["pre", "during", "post", "control"];

/** Colores de etapa del PROTOTIPO: Antes=ámbar · Durante=azul · Después=verde
 *  · Control=gris. Tokens semánticos (dark mode automático). */
const STAGE_DOT: Record<ClinicalPhotoStage, string> = {
  pre: "var(--warning)",
  during: "var(--info)",
  post: "var(--success)",
  control: "var(--text-3)",
};

type TypeGroupFilter = "all" | "ext" | "int";
type RangeFilter = "all" | "m3" | "m6" | "m12";
const RANGE_MONTHS: Record<Exclude<RangeFilter, "all">, number> = {
  m3: 3,
  m6: 6,
  m12: 12,
};

/** Tag INT/EXT del tile (prototipo). `other` no lleva tag. */
function tagFor(type: ClinicalPhotoType): string | null {
  if (type.startsWith("extraoral")) return "EXT";
  if (type.startsWith("intraoral") || type.startsWith("occlusal")) return "INT";
  return null;
}

// Espejo de MAX_PHOTO_BYTES de lib/clinical-shared/photos/storage.ts (NO se
// importa: ese módulo instancia el client admin de Supabase, solo-server).
const MAX_BYTES = 25 * 1024 * 1024;

// Por arriba de este tamaño se intenta comprimir en el CLIENTE antes de
// mandar la server action: los runtimes serverless (Vercel) capan el body
// de la request (~4.5MB), así que una foto de cámara de 8-20MB no llegaría.
// El server igual re-comprime con sharp (2400px jpeg q85).
const CLIENT_COMPRESS_THRESHOLD = 3.5 * 1024 * 1024;

interface PreparedUpload {
  blob: Blob; // File original o Blob comprimido — se manda tal cual en el FormData
  fileName: string;
  size: number;
}

async function passthrough(file: File): Promise<PreparedUpload> {
  return { blob: file, fileName: file.name, size: file.size };
}

async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (file.size <= CLIENT_COMPRESS_THRESHOLD) return passthrough(file);
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
    const MAX_EDGE = 2400;
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) {
      bitmap.close();
      return passthrough(file);
    }
    ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) return passthrough(file);
    return {
      blob,
      fileName: `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
      size: blob.size,
    };
  } catch {
    // HEIC u otro formato que el browser no decodifica → se manda el
    // original y el server intenta con sharp.
    return passthrough(file);
  }
}

export interface PatientPhotosTabProps {
  patientId: string;
  /** Notifica el total vivo de fotos (para el badge del menú). */
  onCountChange?: (count: number) => void;
}

export function PatientPhotosTab({ patientId, onCountChange }: PatientPhotosTabProps) {
  const t = useT();

  const [photos, setPhotos] = useState<ClinicalPhotoDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filtros del toolbar (prototipo): etapa + tipo (ext/int) + vista + rango.
  const [stageFilter, setStageFilter] = useState<"all" | ClinicalPhotoStage>("all");
  const [typeGroup, setTypeGroup] = useState<TypeGroupFilter>("all");
  const [viewFilter, setViewFilter] = useState<"all" | ClinicalPhotoType>("all");
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>("all");
  const [compareMode, setCompareMode] = useState<"slider" | "side">("slider");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadStage, setUploadStage] = useState<ClinicalPhotoStage>("pre");
  const [uploadType, setUploadType] = useState<ClinicalPhotoType>("extraoral_front");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [quotaHit, setQuotaHit] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    const res = await listClinicalPhotosAction({ patientId, module: "general" });
    if (isFailure(res)) {
      setLoadError(res.error);
    } else {
      setLoadError(null);
      setPhotos(res.data);
      onCountChange?.(res.data.length);
    }
    setLoading(false);
  }, [patientId, onCountChange]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const typeLabelFor = useCallback(
    (type: ClinicalPhotoType): string =>
      GENERAL_PHOTO_TYPE_LABELS[type as GeneralPhotoType] ??
      (type === "other" ? t("patients.fotosTab.typeOther") : type),
    [t],
  );

  const matchesGroup = useCallback((p: ClinicalPhotoDTO, group: TypeGroupFilter) => {
    if (group === "all") return true;
    if (group === "ext") return p.photoType.startsWith("extraoral");
    return p.photoType.startsWith("intraoral") || p.photoType.startsWith("occlusal");
  }, []);

  const matchesRange = useCallback((p: ClinicalPhotoDTO, range: RangeFilter) => {
    if (range === "all") return true;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RANGE_MONTHS[range]);
    return new Date(p.capturedAt) >= cutoff;
  }, []);

  // Base = todos los filtros MENOS etapa (para los counts de las pills).
  const baseFiltered = useMemo(
    () =>
      photos.filter(
        (p) =>
          matchesGroup(p, typeGroup) &&
          (viewFilter === "all" || p.photoType === viewFilter) &&
          matchesRange(p, rangeFilter),
      ),
    [photos, typeGroup, viewFilter, rangeFilter, matchesGroup, matchesRange],
  );
  const filtered = useMemo(
    () => baseFiltered.filter((p) => stageFilter === "all" || p.stage === stageFilter),
    [baseFiltered, stageFilter],
  );
  const grouped = useMemo(() => {
    const out: Record<ClinicalPhotoStage, ClinicalPhotoDTO[]> = {
      pre: [],
      during: [],
      post: [],
      control: [],
    };
    for (const p of filtered) out[p.stage].push(p);
    return out;
  }, [filtered]);
  const orderedPhotos = useMemo(
    () => STAGE_ORDER.flatMap((s) => grouped[s]),
    [grouped],
  );
  const stageCounts = useMemo(() => {
    const out: Record<ClinicalPhotoStage, number> = { pre: 0, during: 0, post: 0, control: 0 };
    for (const p of baseFiltered) out[p.stage] += 1;
    return out;
  }, [baseFiltered]);
  const filtersActive =
    stageFilter !== "all" || typeGroup !== "all" || viewFilter !== "all" || rangeFilter !== "all";
  const clearFilters = () => {
    setStageFilter("all");
    setTypeGroup("all");
    setViewFilter("all");
    setRangeFilter("all");
  };

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || uploading) return;
      setUploadErrors([]);
      setQuotaHit(false);
      setUploading({ done: 0, total: files.length });
      const errors: string[] = [];
      let okCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const prepared = await prepareUpload(file);
          if (prepared.size > MAX_BYTES) {
            errors.push(`${file.name}: ${t("patients.fotosTab.maxSize")}`);
            setUploading({ done: i + 1, total: files.length });
            continue;
          }
          const fd = new FormData();
          fd.append("file", prepared.blob, prepared.fileName);
          fd.append("patientId", patientId);
          fd.append("module", "general");
          fd.append("photoType", uploadType);
          fd.append("stage", uploadStage);
          const res = await uploadClinicalPhotoAction(fd);
          if (isFailure(res)) {
            if (res.code === "PLAN_LIMIT_STORAGE") {
              setQuotaHit(true);
              errors.push(`${file.name}: ${res.error}`);
              setUploading({ done: i + 1, total: files.length });
              break; // el resto también rebotaría contra la cuota
            }
            errors.push(`${file.name}: ${res.error}`);
          } else {
            okCount += 1;
          }
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
        setUploading({ done: i + 1, total: files.length });
      }
      setUploading(null);
      setUploadErrors(errors);
      if (okCount > 0) {
        await reload();
        if (errors.length === 0) {
          toast.success(t("patients.fotosTab.uploadSuccess", { count: okCount }));
          setUploadOpen(false); // tanda 100% OK → cierra el modal (el toast confirma)
        } else {
          // Con errores/cuota el modal SE QUEDA ABIERTO mostrando la lista.
          toast(t("patients.fotosTab.uploadPartial", { ok: okCount, failed: errors.length }));
        }
      } else if (errors.length > 0 && !quotaHit) {
        toast.error(errors[0]);
      }
    },
    [patientId, uploadStage, uploadType, uploading, quotaHit, reload, t],
  );

  // Al abrir el modal, descarta los errores/cuota de la tanda anterior.
  const openUploadModal = useCallback(() => {
    setUploadErrors([]);
    setQuotaHit(false);
    setUploadOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (photo: ClinicalPhotoDTO) => {
      if (!window.confirm(t("patients.fotosTab.deleteConfirm"))) return;
      const res = await deleteClinicalPhotoAction({ id: photo.id });
      if (isFailure(res)) {
        toast.error(res.error);
        return;
      }
      setLightboxIndex(null);
      setPhotos((prev) => {
        const next = prev.filter((p) => p.id !== photo.id);
        onCountChange?.(next.length);
        return next;
      });
      toast.success(t("patients.fotosTab.deleted"));
    },
    [onCountChange, t],
  );

  const viewSelectOptions = (
    <>
      <optgroup label={t("patients.fotosTab.typeExtraoralGroup")}>
        {GENERAL_EXTRAORAL_PHOTO_TYPES.map((type) => (
          <option key={type} value={type}>
            {GENERAL_PHOTO_TYPE_LABELS[type]}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("patients.fotosTab.typeIntraoralGroup")}>
        {GENERAL_INTRAORAL_PHOTO_TYPES.map((type) => (
          <option key={type} value={type}>
            {GENERAL_PHOTO_TYPE_LABELS[type]}
          </option>
        ))}
      </optgroup>
      <option value="other">{t("patients.fotosTab.typeOther")}</option>
    </>
  );

  const selectCls =
    "h-[34px] rounded-[10px] border border-border bg-card px-2.5 pr-7 text-xs font-semibold text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-soft)] focus:border-[var(--border-brand)]";
  const solidBtnCls =
    "inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--brand)] text-white text-xs font-bold shadow-[var(--shadow-1)] transition duration-150 hover:bg-[var(--violet-700)] motion-safe:hover:-translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--ring)] active:scale-[.98]";

  return (
    <div className="space-y-5">
      {/* ── Toolbar única (prototipo) ─────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl shadow-[var(--shadow-1)] px-4 py-3 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={openUploadModal}
          aria-haspopup="dialog"
          className={`${solidBtnCls} h-9 px-3.5`}
        >
          <Upload size={14} strokeWidth={2} aria-hidden /> {t("patients.fotosTab.upload")}
        </button>
        <span className="hidden sm:block w-px h-6 bg-border" aria-hidden />

        {/* Pills de etapa con count (segmented del prototipo). */}
        <div className="flex flex-wrap gap-0.5 rounded-[10px] bg-[var(--bg-elev-2)] p-[3px]">
          {(["all", ...STAGE_ORDER] as const).map((s) => {
            const active = stageFilter === s;
            const label = s === "all" ? t("patients.fotosTab.filterAllStages") : STAGE_LABELS[s];
            const n = s === "all" ? baseFiltered.length : stageCounts[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStageFilter(s)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
                  active
                    ? "bg-card text-foreground shadow-[var(--shadow-1)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                <span className="text-[10.5px] font-bold tabular-nums opacity-60">{n}</span>
              </button>
            );
          })}
        </div>

        <select
          aria-label={t("patients.fotosTab.filterAllTypeGroups")}
          className={selectCls}
          value={typeGroup}
          onChange={(e) => setTypeGroup(e.target.value as TypeGroupFilter)}
        >
          <option value="all">{t("patients.fotosTab.filterAllTypeGroups")}</option>
          <option value="ext">{t("patients.fotosTab.filterExtraoral")}</option>
          <option value="int">{t("patients.fotosTab.filterIntraoral")}</option>
        </select>
        <select
          aria-label={t("patients.fotosTab.filterAllTypes")}
          className={selectCls}
          value={viewFilter}
          onChange={(e) => setViewFilter(e.target.value as "all" | ClinicalPhotoType)}
        >
          <option value="all">{t("patients.fotosTab.filterAllTypes")}</option>
          {viewSelectOptions}
        </select>
        <select
          aria-label={t("patients.fotosTab.rangeAll")}
          className={selectCls}
          value={rangeFilter}
          onChange={(e) => setRangeFilter(e.target.value as RangeFilter)}
        >
          <option value="all">{t("patients.fotosTab.rangeAll")}</option>
          <option value="m3">{t("patients.fotosTab.rangeM3")}</option>
          <option value="m6">{t("patients.fotosTab.rangeM6")}</option>
          <option value="m12">{t("patients.fotosTab.rangeM12")}</option>
        </select>

        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {t("patients.fotosTab.shownOf", { shown: filtered.length, total: photos.length })}
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-[7px] px-2 py-1 text-xs font-semibold text-[var(--brand)] transition-colors duration-150 hover:bg-[var(--brand-soft)] focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
            >
              {t("patients.fotosTab.clearFilters")}
            </button>
          )}
        </div>
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────── */}
      {loading ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(175px,1fr))] gap-3"
          aria-busy="true"
          aria-label={t("patients.fotosTab.loading")}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-[var(--danger-border-strong)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-strong)]" role="alert">
          {loadError}
        </div>
      ) : (
        <>
          {/* ── Card Comparador antes / después (prototipo) — SIEMPRE visible ─ */}
          <section className="bg-card border border-border rounded-2xl shadow-[var(--shadow-1)] p-4 sm:px-5">
            <div className="mb-3 flex items-center gap-2.5 flex-wrap">
              <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                <GitCompare size={15} strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h2 className="text-[15px] font-bold tracking-[-0.01em]">
                  {t("patients.fotosTab.compareTitle")}
                </h2>
                <div className="text-[11.5px] text-muted-foreground mt-0.5">
                  {t("patients.fotosTab.compareSub")}
                </div>
              </div>
              <div className="ml-auto flex gap-0.5 rounded-[10px] bg-[var(--bg-elev-2)] p-[3px]">
                <button
                  type="button"
                  onClick={() => setCompareMode("slider")}
                  aria-pressed={compareMode === "slider"}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
                    compareMode === "slider"
                      ? "bg-card text-foreground shadow-[var(--shadow-1)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m9 7-5 5 5 5" />
                    <path d="m15 7 5 5-5 5" />
                  </svg>
                  {t("patients.fotosTab.modeSlider")}
                </button>
                <button
                  type="button"
                  onClick={() => setCompareMode("side")}
                  aria-pressed={compareMode === "side"}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
                    compareMode === "side"
                      ? "bg-card text-foreground shadow-[var(--shadow-1)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="3" width="7" height="18" rx="1" />
                    <rect x="14" y="3" width="7" height="18" rx="1" />
                  </svg>
                  {t("patients.fotosTab.modeSide")}
                </button>
              </div>
            </div>

            <PhotoCompareSlider
              photos={filtered.length >= 2 ? filtered : photos}
              mode={compareMode}
              labels={{
                needTwo: t("patients.fotosTab.compareNeedTwo"),
                sliderAria: t("patients.fotosTab.sliderAria"),
                swapAria: t("patients.fotosTab.swapAria"),
              }}
            />

            <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Info size={12} strokeWidth={1.75} className="flex-shrink-0" aria-hidden />
              {t("patients.fotosTab.compareTip")}
            </div>
          </section>

          {/* ── Galería agrupada por etapa (prototipo) ────────────────── */}
          {photos.length === 0 ? (
            /* Empty total (prototipo): circle violeta + copy + CTA que abre el modal. */
            <section className="flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[var(--border-strong)] bg-[var(--bg-elev-2)] px-8 py-12 text-center">
              <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                <Camera size={22} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="text-[15px] font-bold text-foreground">{t("patients.fotosTab.empty")}</div>
              <div className="max-w-[380px] text-xs text-muted-foreground">
                {t("patients.fotosTab.emptyHint")}
              </div>
              <button
                type="button"
                onClick={openUploadModal}
                className={`${solidBtnCls} mt-1 h-9 px-4`}
              >
                <Upload size={14} strokeWidth={2} aria-hidden /> {t("patients.fotosTab.emptyCta")}
              </button>
            </section>
          ) : filtered.length === 0 ? (
            <section className="flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[var(--border-strong)] bg-[var(--bg-elev-2)] px-8 py-9 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                <Search size={19} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="text-sm font-bold text-foreground">
                {t("patients.fotosTab.noResultsTitle")}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("patients.fotosTab.noResultsHint")}
              </div>
              <button
                type="button"
                onClick={clearFilters}
                className={`${solidBtnCls} mt-1 h-[34px] px-3.5`}
              >
                {t("patients.fotosTab.clearFilters")}
              </button>
            </section>
          ) : (
            <div className="space-y-5">
              {STAGE_ORDER.filter((s) => grouped[s].length > 0).map((stage) => (
                <section key={stage} aria-label={STAGE_LABELS[stage]} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-[9px] w-[9px] rounded-full"
                      style={{ background: STAGE_DOT[stage] }}
                      aria-hidden
                    />
                    <h3 className="text-[14.5px] font-bold tracking-[-0.01em] text-foreground">
                      {STAGE_LABELS[stage]}
                    </h3>
                    <span className="inline-flex h-[21px] items-center whitespace-nowrap rounded-full border border-border bg-card px-2 text-[10.5px] font-bold tabular-nums text-muted-foreground">
                      {grouped[stage].length}
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(175px,1fr))] gap-3">
                    {grouped[stage].map((photo) => {
                      const flatIndex = orderedPhotos.findIndex((p) => p.id === photo.id);
                      const label = typeLabelFor(photo.photoType);
                      const tag = tagFor(photo.photoType);
                      return (
                        <figure
                          key={photo.id}
                          className="group relative m-0 aspect-[4/3] overflow-hidden rounded-xl border border-border bg-black shadow-[var(--shadow-1)] transition-all duration-200 hover:shadow-[var(--shadow-2)] motion-safe:hover:-translate-y-0.5"
                        >
                          <button
                            type="button"
                            onClick={() => setLightboxIndex(flatIndex)}
                            aria-label={t("patients.fotosTab.photoAlt", { type: label })}
                            className="absolute inset-0 block w-full cursor-zoom-in focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.thumbnailUrl ?? photo.blobUrl}
                              alt={photo.notes ?? label}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.03]"
                            />
                          </button>
                          {tag && (
                            <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wider text-white">
                              {tag}
                            </span>
                          )}
                          <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6">
                            <span className="min-w-0 truncate text-[11.5px] font-bold text-white" title={label}>
                              {label}
                            </span>
                            <span className="flex-shrink-0 whitespace-nowrap text-[10.5px] font-semibold tabular-nums text-white/75">
                              {new Date(photo.capturedAt).toLocaleDateString("es-MX", {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                          </figcaption>
                          <button
                            type="button"
                            onClick={() => void handleDelete(photo)}
                            aria-label={t("patients.fotosTab.deleteAria")}
                            className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-black/50 text-white opacity-0 backdrop-blur-[2px] transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--ring)] hover:bg-[var(--danger)]"
                          >
                            <Trash2 size={13} strokeWidth={1.75} aria-hidden />
                          </button>
                        </figure>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Modal de subida (Radix Dialog, sin stopPropagation) ───────── */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-xl border border-border bg-card">
          <DialogHeader className="border-b border-border px-5 pb-4 pt-5">
            <DialogTitle className="mb-0 text-[15px]">
              {t("patients.fotosTab.uploadModalTitle")}
            </DialogTitle>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {t("patients.fotosTab.uploadModalSub")}
            </p>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <div className="flex items-end gap-3 flex-wrap">
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("patients.fotosTab.stageLabel")}
                <select
                  className={selectCls}
                  value={uploadStage}
                  onChange={(e) => setUploadStage(e.target.value as ClinicalPhotoStage)}
                >
                  {STAGE_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("patients.fotosTab.typeLabel")}
                <select
                  className={selectCls}
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value as ClinicalPhotoType)}
                >
                  {viewSelectOptions}
                </select>
              </label>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={uploading !== null}
                className="inline-flex items-center gap-1.5 h-[34px] px-3 text-xs font-semibold rounded-[10px] border border-border bg-card text-foreground hover:bg-[var(--bg-hover)] hover:border-[var(--border-brand)] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] disabled:opacity-[.45] disabled:cursor-not-allowed"
              >
                <Camera size={14} strokeWidth={1.75} aria-hidden /> {t("patients.fotosTab.takePhoto")}
              </button>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files) void handleFiles(Array.from(e.dataTransfer.files));
              }}
              aria-busy={uploading !== null}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
                dragOver
                  ? "border-[var(--brand)] bg-[var(--brand-softer)]"
                  : "border-border bg-[var(--bg-elev-2)] hover:border-[var(--border-brand)]"
              } ${uploading ? "cursor-wait opacity-70" : "cursor-pointer"}`}
            >
              <ImagePlus size={20} strokeWidth={1.75} className="text-[var(--text-3)]" aria-hidden />
              <span className="text-sm font-medium text-foreground">
                {uploading
                  ? t("patients.fotosTab.uploadingProgress", {
                      done: uploading.done,
                      total: uploading.total,
                    })
                  : t("patients.fotosTab.dropHint")}
              </span>
              <span className="text-[11px] text-muted-foreground">{t("patients.fotosTab.maxSize")}</span>
              {uploading && (
                <div className="mt-1 h-1.5 w-48 max-w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[var(--brand)] transition-all duration-200"
                    style={{ width: `${Math.round((uploading.done / uploading.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {uploadErrors.length > 0 && (
              <ul className="space-y-1 text-xs text-[var(--danger)]">
                {uploadErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}

            {/* Cuota de storage alcanzada → CTA de plan (dentro del modal) */}
            {quotaHit && (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-[var(--radius-lg)] border border-[var(--warning-border-strong)] bg-[var(--warning-soft)] px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-[var(--warning-strong)]">
                  <AlertTriangle size={16} strokeWidth={1.75} className="flex-shrink-0" aria-hidden />
                  <span>{t("patients.fotosTab.quotaTitle")}</span>
                </div>
                <Link
                  href="/dashboard/settings?tab=subscription"
                  className="text-xs font-bold px-3.5 py-2.5 rounded-lg bg-[var(--brand)] text-white hover:bg-[var(--violet-700)] focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] active:scale-[.98] transition duration-150 flex-shrink-0 no-underline"
                >
                  {t("patients.fotosTab.quotaCta")}
                </Link>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void handleFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            {/* capture="environment" abre directo la cámara trasera en móvil */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void handleFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={orderedPhotos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}

/** Mini-grid de fotos recientes para el tab Resumen. Lazy: solo pide la
 *  lista si el server reportó count > 0; con count 0 muestra empty state
 *  accionable que manda al tab Fotos. */
export function RecentPhotosStrip({
  patientId,
  count,
  onOpenTab,
}: {
  patientId: string;
  count: number;
  onOpenTab: () => void;
}) {
  const t = useT();
  const [thumbs, setThumbs] = useState<ClinicalPhotoDTO[] | null>(null);

  useEffect(() => {
    if (count <= 0) return;
    let cancelled = false;
    (async () => {
      const res = await listClinicalPhotosAction({ patientId, module: "general" });
      if (!cancelled && !isFailure(res)) setThumbs(res.data.slice(0, 4));
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, count]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-[var(--text-3)] uppercase tracking-wide flex items-center gap-1.5">
          <Camera size={12} strokeWidth={1.75} aria-hidden /> {t("patients.summary.recentPhotos")}
        </div>
        {count > 0 && (
          <button
            type="button"
            onClick={onOpenTab}
            className="text-[11px] font-semibold text-[var(--brand)] hover:underline rounded-[4px] focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
          >
            {t("patients.summary.viewAllPhotos")} →
          </button>
        )}
      </div>
      {count <= 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-[var(--brand-softer)] border border-[var(--border-brand)] px-3 py-2.5">
          <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
            <Camera size={14} strokeWidth={1.75} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">{t("patients.summary.noPhotosYet")}</span>
          <button
            type="button"
            onClick={onOpenTab}
            className="flex-shrink-0 text-[11px] font-bold text-[var(--brand)] hover:underline rounded-[4px] focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
          >
            {t("patients.summary.uploadPhotos")} →
          </button>
        </div>
      ) : thumbs === null ? (
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: Math.min(4, count) }).map((_, i) => (
            <div key={i} className="aspect-square rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {thumbs.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={onOpenTab}
              aria-label={t("patients.summary.viewAllPhotos")}
              className="overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumbnailUrl ?? p.blobUrl}
                alt={p.notes ?? STAGE_LABELS[p.stage]}
                loading="lazy"
                className="aspect-square w-full object-cover transition-transform duration-150 hover:scale-105"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
