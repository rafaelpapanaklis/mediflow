"use client";
// Ficha v3 — tab "Fotos clínicas" (módulo ClinicalPhoto `general`).
// Fotos extraorales/intraorales agrupadas por etapa Antes/Durante/Después/
// Control, con filtros, lightbox, comparador slider y upload multi-archivo
// (cámara en móvil). Carga lazy al abrir el tab vía listClinicalPhotosAction.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Camera,
  GitCompare,
  ImagePlus,
  LayoutGrid,
  Trash2,
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

const STAGE_ORDER: ClinicalPhotoStage[] = ["pre", "during", "post", "control"];

/** Punto del subhead por etapa — tokens semánticos (dark mode automático). */
const STAGE_DOT: Record<ClinicalPhotoStage, string> = {
  pre: "var(--info)",
  during: "var(--warning)",
  post: "var(--success)",
  control: "var(--brand)",
};

/** Pill de etapa (subheads de la galería) — soft + strong por estado. */
const STAGE_PILL: Record<ClinicalPhotoStage, string> = {
  pre: "bg-[var(--info-soft)] text-[var(--info-strong)]",
  during: "bg-[var(--warning-soft)] text-[var(--warning-strong)]",
  post: "bg-[var(--success-soft)] text-[var(--success-strong)]",
  control: "bg-[var(--brand-soft)] text-[var(--brand)]",
};

// Espejo de MAX_PHOTO_BYTES de lib/clinical-shared/photos/storage.ts (NO se
// importa: ese módulo instancia el client admin de Supabase, solo-server).
const MAX_BYTES = 25 * 1024 * 1024;

// Por arriba de este tamaño se intenta comprimir en el CLIENTE antes de
// mandar la server action: los runtimes serverless (Vercel) capan el body
// de la request (~4.5MB), así que una foto de cámara de 8-20MB no llegaría.
// El server igual re-comprime con sharp (2400px jpeg q85).
const CLIENT_COMPRESS_THRESHOLD = 3.5 * 1024 * 1024;

interface PreparedUpload {
  body: ArrayBuffer;
  contentType: string;
  fileName: string;
  size: number;
}

async function passthrough(file: File): Promise<PreparedUpload> {
  return {
    body: await file.arrayBuffer(),
    contentType: file.type || "image/jpeg",
    fileName: file.name,
    size: file.size,
  };
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
      body: await blob.arrayBuffer(),
      contentType: "image/jpeg",
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
  const [view, setView] = useState<"gallery" | "compare">("gallery");
  const [stageFilter, setStageFilter] = useState<"all" | ClinicalPhotoStage>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ClinicalPhotoType>("all");
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

  // Fotos visibles según filtros, en el MISMO orden en que se pintan
  // (por etapa y fecha desc) — el lightbox navega sobre esta lista plana.
  const filtered = useMemo(
    () =>
      photos.filter(
        (p) =>
          (stageFilter === "all" || p.stage === stageFilter) &&
          (typeFilter === "all" || p.photoType === typeFilter),
      ),
    [photos, stageFilter, typeFilter],
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
    const base = photos.filter((p) => typeFilter === "all" || p.photoType === typeFilter);
    const out: Record<ClinicalPhotoStage, number> = { pre: 0, during: 0, post: 0, control: 0 };
    for (const p of base) out[p.stage] += 1;
    return out;
  }, [photos, typeFilter]);

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
          const res = await uploadClinicalPhotoAction({
            patientId,
            module: "general",
            photoType: uploadType,
            stage: uploadStage,
            toothFdi: null,
            notes: null,
            contentType: prepared.contentType,
            fileName: prepared.fileName,
            size: prepared.size,
            body: prepared.body,
          });
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
        } catch {
          errors.push(t("patients.fotosTab.uploadErrorGeneric", { name: file.name }));
        }
        setUploading({ done: i + 1, total: files.length });
      }
      setUploading(null);
      setUploadErrors(errors);
      if (okCount > 0) {
        await reload();
        if (errors.length === 0) {
          toast.success(t("patients.fotosTab.uploadSuccess", { count: okCount }));
        } else {
          toast(t("patients.fotosTab.uploadPartial", { ok: okCount, failed: errors.length }));
        }
      } else if (errors.length > 0 && !quotaHit) {
        toast.error(errors[0]);
      }
    },
    [patientId, uploadStage, uploadType, uploading, quotaHit, reload, t],
  );

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

  const typeSelectOptions = (
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
    "h-9 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-soft)] focus:border-[var(--border-brand)]";

  return (
    <div className="space-y-4">
      {/* Header del tab */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-[var(--shadow-1)] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Camera size={17} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-[15px] font-bold tracking-[-0.01em]">
              {t("patients.fotosTab.title")}
            </h2>
            <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
              {t("patients.fotosTab.count", { count: photos.length })} · {t("patients.fotosTab.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-[var(--bg-elev-2)] p-0.5">
            {([
              { id: "gallery", icon: LayoutGrid, label: t("patients.fotosTab.viewGallery") },
              { id: "compare", icon: GitCompare, label: t("patients.fotosTab.viewCompare") },
            ] as const).map((opt) => {
              const Icon = opt.icon;
              const active = view === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setView(opt.id)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
                    active
                      ? "bg-card text-[var(--brand)] shadow-[var(--shadow-1)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={13} strokeWidth={1.75} aria-hidden /> {opt.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setUploadOpen((v) => !v)}
            aria-expanded={uploadOpen}
            style={{ background: "var(--brand-grad)" }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-3.5 h-9 rounded-lg shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)] motion-safe:hover:-translate-y-px transition duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] active:scale-[0.98]"
          >
            <ImagePlus size={14} strokeWidth={1.75} aria-hidden /> {t("patients.fotosTab.upload")}
          </button>
        </div>
      </div>

      {/* Cuota de storage alcanzada → CTA de plan */}
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

      {/* Panel de subida */}
      {uploadOpen && (
        <div className="bg-card border border-border rounded-xl p-4 shadow-[var(--shadow-1)] space-y-3">
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
                {typeSelectOptions}
              </select>
            </label>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading !== null}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg border border-border bg-card text-foreground hover:bg-[var(--bg-hover)] hover:border-[var(--border-brand)] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] disabled:opacity-[.45] disabled:cursor-not-allowed"
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
            className={`flex flex-col items-center gap-1.5 rounded-[10px] border-2 border-dashed px-6 py-7 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
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
      )}

      {/* Filtros */}
      {!loading && photos.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", ...STAGE_ORDER] as const).map((s) => {
            const active = stageFilter === s;
            const label = s === "all" ? t("patients.fotosTab.filterAllStages") : STAGE_LABELS[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStageFilter(s)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 min-h-[36px] rounded-full border px-3 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)] ${
                  active
                    ? "border-[var(--border-brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-[var(--bg-hover)]"
                }`}
              >
                {label}
                {s !== "all" && (
                  <span className="tabular-nums text-[10.5px] opacity-80">{stageCounts[s]}</span>
                )}
              </button>
            );
          })}
          <select
            aria-label={t("patients.fotosTab.typeLabel")}
            className={`${selectCls} ml-auto`}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | ClinicalPhotoType)}
          >
            <option value="all">{t("patients.fotosTab.filterAllTypes")}</option>
            {typeSelectOptions}
          </select>
        </div>
      )}

      {/* Contenido */}
      {loading ? (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5"
          aria-busy="true"
          aria-label={t("patients.fotosTab.loading")}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-[var(--danger-border-strong)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-strong)]" role="alert">
          {loadError}
        </div>
      ) : photos.length === 0 ? (
        <div className="rounded-2xl bg-[var(--brand-softer)] border border-[var(--border-brand)] px-5 py-14 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)] shadow-[var(--shadow-1)]">
            <Camera size={24} strokeWidth={1.75} aria-hidden />
          </span>
          <p className="text-sm font-bold text-foreground">{t("patients.fotosTab.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto">
            {t("patients.fotosTab.emptyHint")}
          </p>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            style={{ background: "var(--brand-grad)" }}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-lg text-white shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)] motion-safe:hover:-translate-y-px focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] active:scale-[.98] transition duration-150"
          >
            <ImagePlus size={13} strokeWidth={1.75} aria-hidden /> {t("patients.fotosTab.upload")}
          </button>
        </div>
      ) : view === "compare" ? (
        <PhotoCompareSlider
          photos={filtered}
          labels={{
            sideA: t("patients.fotosTab.sideA"),
            sideB: t("patients.fotosTab.sideB"),
            needTwo: t("patients.fotosTab.compareNeedTwo"),
            sliderAria: t("patients.fotosTab.sliderAria"),
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl px-5 py-8 text-center text-xs text-muted-foreground">
          {t("patients.fotosTab.noMatches")}
        </div>
      ) : (
        <div className="space-y-5">
          {STAGE_ORDER.filter((s) => grouped[s].length > 0).map((stage) => (
            <section key={stage} aria-label={STAGE_LABELS[stage]}>
              <div className="flex items-center gap-2 mb-2.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${STAGE_PILL[stage]}`}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: STAGE_DOT[stage] }}
                    aria-hidden
                  />
                  {STAGE_LABELS[stage]}
                  <span className="tabular-nums opacity-75">{grouped[stage].length}</span>
                </span>
                <span className="h-px flex-1 bg-[var(--border-soft)]" aria-hidden />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {grouped[stage].map((photo) => {
                  const flatIndex = orderedPhotos.findIndex((p) => p.id === photo.id);
                  const label = typeLabelFor(photo.photoType);
                  return (
                    <figure
                      key={photo.id}
                      className="group relative m-0 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-1)] transition-all duration-200 hover:shadow-[var(--shadow-2)] hover:border-[var(--border-brand)] motion-safe:hover:-translate-y-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => setLightboxIndex(flatIndex)}
                        aria-label={t("patients.fotosTab.photoAlt", { type: label })}
                        className="block w-full overflow-hidden focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.thumbnailUrl ?? photo.blobUrl}
                          alt={photo.notes ?? label}
                          loading="lazy"
                          className="aspect-square w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]"
                        />
                      </button>
                      <figcaption className="flex items-center justify-between gap-1 px-2.5 py-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{ background: STAGE_DOT[photo.stage] }}
                            aria-hidden
                          />
                          <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--text-2)]" title={label}>
                            {label}
                          </span>
                        </span>
                        <span className="flex-shrink-0 text-[10px] tabular-nums text-[var(--text-3)]">
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
                        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-black/50 text-white opacity-0 backdrop-blur-[2px] transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--ring)] hover:bg-[var(--danger)]"
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
