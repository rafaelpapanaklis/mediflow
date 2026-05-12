"use client";
// Sección E — Fotos clínicas · 10 vistas anatómicas estándar AAO.
//
// Componentes:
//   - Toggle T0/T1/T2/CONTROL en header
//   - Botón "Comparar T0 vs actual" (abre ModalCompare)
//   - Banner G15 amber si monthCurrent ∈ [10,13] sin PhotoSet stage CONTROL
//   - Grid 5 cols Extraorales (3) + Intraorales (7) con SVG placeholders
//   - PhotoSlot: empty → file picker · upload → lightbox + delete
//   - Foto-sets históricos por etapa (T0/T1/T2/CONTROL) con grid 8 thumbs

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Loader2, Plus, Search, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import { fmtDate } from "../atoms/format";
import { PHOTO_SLOTS, PhotoSlotIcon } from "./PhotoSlotIcon";

export type PhotoStage = "T0" | "T1" | "T2" | "CONTROL";

export interface PhotoSetSummary {
  /** ID del OrthoPhotoSet — necesario para cablear uploadPhotoToSet. */
  setId?: string;
  stage: PhotoStage;
  /** Fecha ISO de captura. */
  date: string | null;
  /** Etiqueta como "Inicial" / "3 meses" / "6 meses". */
  label?: string | null;
  /** Cuántas de las 10 vistas se subieron. */
  photoCount: number;
  /** Map slotId → { url firmada, label fecha humana }. Lo usa el grid de
   *  slots para mostrar fotos pre-cargadas y persistir al recargar. */
  slots?: Record<string, { url: string; uploadedAt: string }>;
  hasRxPan: boolean;
  hasRxLatCef: boolean;
}

export interface SectionPhotosProps {
  monthCurrent: number;
  monthTotal: number;
  /** Foto-sets históricos por etapa (T0/T1/T2/CONTROL). */
  historicalSets: PhotoSetSummary[];
  /** Callback al subir un slot. La persistencia real va vía server action. */
  onUpload?: (stage: PhotoStage, slotId: string, file: File) => Promise<void> | void;
  /** Abrir comparativa T0 vs actual. */
  onCompare?: () => void;
  /** Programar foto-set + Rx panorámica para mes 12 (G15). */
  onScheduleG15?: () => void;
  /** Capturar nuevo set (T2 pendiente). */
  onCaptureSet?: () => void;
  /** Ver set completo (modal lightbox). */
  onViewSet?: (stage: PhotoStage) => void;
}

interface UploadEntry {
  url: string;
  uploadedAt: string;
}

const STAGE_LABEL: Record<PhotoStage, string> = {
  T0: "Inicial",
  T1: "3 meses",
  T2: "6 meses",
  CONTROL: "Control",
};

export function SectionPhotos(props: SectionPhotosProps) {
  const [stage, setStage] = useState<PhotoStage>("T0");
  // `uploads` se pre-popula desde historicalSets[stage].slots (URLs firmadas
  // de fotos ya persistidas) y se actualiza optimistamente al subir nuevas.
  // Cada vez que cambia stage o el set para esa stage, recargamos.
  const [uploads, setUploads] = useState<Record<string, UploadEntry>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<{
    slotId: string;
    label: string;
    group: "extraoral" | "intraoral";
    photo: UploadEntry;
  } | null>(null);

  // Pre-pobla `uploads` con los slots persistidos del set activo.
  useEffect(() => {
    const set = props.historicalSets.find((s) => s.stage === stage);
    setUploads(set?.slots ?? {});
  }, [stage, props.historicalSets]);

  const showG15 = props.monthCurrent >= 10 && props.monthCurrent <= 13;
  const hasControlSet = props.historicalSets.some((s) => s.stage === "CONTROL");
  const showG15Final = showG15 && !hasControlSet;

  const onPick = async (slotId: string, file: File) => {
    // Optimistic preview con blob URL — se reemplaza cuando router.refresh()
    // re-pinta el componente con la signed URL real.
    const blobUrl = URL.createObjectURL(file);
    const optimisticEntry: UploadEntry = {
      url: blobUrl,
      uploadedAt: new Date().toLocaleString("es-MX", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setUploads((prev) => ({ ...prev, [slotId]: optimisticEntry }));
    setPending((prev) => ({ ...prev, [slotId]: true }));

    try {
      if (props.onUpload) {
        await props.onUpload(stage, slotId, file);
      }
    } catch (e) {
      // Si el upload falla, revierte la previsualización.
      setUploads((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
      throw e;
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
    }
  };

  const onDelete = (slotId: string) => {
    setUploads((prev) => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  };

  const extraoral = PHOTO_SLOTS.filter((s) => s.group === "extraoral");
  const intraoral = PHOTO_SLOTS.filter((s) => s.group === "intraoral");
  const total = PHOTO_SLOTS.length;
  const uploaded = Object.keys(uploads).length;

  // Card extra al final para "Capturar set" si T2 está pendiente.
  const t2Pending = !props.historicalSets.some((s) => s.stage === "T2");

  return (
    <Card
      id="photos"
      eyebrow="Sección E"
      title="Fotos clínicas · 10 vistas anatómicas estándar"
      action={
        <div className="flex items-center gap-2">
          <div
            className="flex bg-slate-100 rounded-md p-0.5 dark:bg-slate-800"
            role="tablist"
            aria-label="Etapa fotográfica"
          >
            {(["T0", "T1", "T2", "CONTROL"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={stage === s}
                onClick={() => setStage(s)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  stage === s
                    ? "bg-white text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {props.onCompare ? (
            <Btn
              variant="primary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onCompare}
            >
              Comparar T0 vs actual
            </Btn>
          ) : null}
        </div>
      }
    >
      {showG15Final ? (
        <div className="mx-6 mt-5 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 dark:bg-amber-900/20 dark:border-amber-800">
          <AlertTriangle
            className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5 dark:text-amber-400"
            aria-hidden
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              G15 · Faltan registros mid-treatment a los 12 meses
            </div>
            <div className="text-xs text-amber-800 mt-0.5 dark:text-amber-300">
              El sistema dispara automáticamente foto-set 10 vistas + RX panorámica +
              comparativa con T0 al cumplirse 12m del tratamiento. Próxima ventana: en{" "}
              {Math.max(0, 12 - props.monthCurrent)} mes
              {Math.max(0, 12 - props.monthCurrent) === 1 ? "" : "es"}.
            </div>
          </div>
          {props.onScheduleG15 ? (
            <Btn variant="secondary" size="sm" onClick={props.onScheduleG15}>
              Programar ahora
            </Btn>
          ) : null}
        </div>
      ) : null}

      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex items-center gap-3">
          <Pill color="violet" size="xs">
            Etapa {stage}
          </Pill>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Click en un slot para subir · click en una foto subida para expandir
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-600 font-mono dark:text-slate-400">
            {uploaded}/{total} capturadas
          </div>
          <div className="w-32">
            <ProgressBar value={uploaded} max={total} color="violet" />
          </div>
        </div>
      </div>

      <PhotoGrid
        title="Extraorales · 3 vistas faciales"
        slots={extraoral}
        uploads={uploads}
        pending={pending}
        onPick={onPick}
        onDelete={onDelete}
        onView={(s, p) => setLightbox({ slotId: s.id, label: s.label, group: s.group, photo: p })}
      />

      <PhotoGrid
        title="Intraorales · 7 vistas dentales"
        slots={intraoral}
        uploads={uploads}
        pending={pending}
        onPick={onPick}
        onDelete={onDelete}
        onView={(s, p) => setLightbox({ slotId: s.id, label: s.label, group: s.group, photo: p })}
      />

      <div className="px-6 py-5">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-3 dark:text-slate-400">
          Foto-sets históricos por etapa
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {props.historicalSets.map((p) => (
            <HistoricalSetCard
              key={p.stage}
              set={p}
              onView={() => props.onViewSet?.(p.stage)}
            />
          ))}
          {t2Pending ? (
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 flex flex-col items-center justify-center text-center dark:border-slate-700">
              <Pill color="slate" size="xs">
                T2
              </Pill>
              <div className="text-sm font-semibold text-slate-700 mt-2 dark:text-slate-300">
                6 meses · pendiente
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                Ventana ago 2026
              </div>
              {props.onCaptureSet ? (
                <Btn
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
                  className="mt-3"
                  onClick={props.onCaptureSet}
                >
                  Capturar set
                </Btn>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {lightbox ? (
        <PhotoLightbox
          label={lightbox.label}
          group={lightbox.group}
          photo={lightbox.photo}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </Card>
  );
}

function PhotoGrid({
  title,
  slots,
  uploads,
  pending,
  onPick,
  onDelete,
  onView,
}: {
  title: string;
  slots: typeof PHOTO_SLOTS;
  uploads: Record<string, UploadEntry>;
  pending: Record<string, boolean>;
  onPick: (slotId: string, file: File) => void;
  onDelete: (slotId: string) => void;
  onView: (slot: (typeof PHOTO_SLOTS)[number], photo: UploadEntry) => void;
}) {
  return (
    <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-3 dark:text-slate-400">
        {title}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {slots.map((slot) => (
          <PhotoSlot
            key={slot.id}
            slot={slot}
            photo={uploads[slot.id]}
            isPending={Boolean(pending[slot.id])}
            onPick={(f) => onPick(slot.id, f)}
            onDelete={() => onDelete(slot.id)}
            onView={(p) => onView(slot, p)}
          />
        ))}
      </div>
    </div>
  );
}

function PhotoSlot({
  slot,
  photo,
  isPending,
  onPick,
  onDelete,
  onView,
}: {
  slot: (typeof PHOTO_SLOTS)[number];
  photo: UploadEntry | undefined;
  isPending: boolean;
  onPick: (file: File) => void;
  onDelete: () => void;
  onView: (photo: UploadEntry) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const has = !!photo;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full">
        <button
          type="button"
          onClick={() => (has ? onView(photo) : fileRef.current?.click())}
          className={`group relative w-full aspect-[4/3] rounded-lg border-2 overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-violet-300 ${
            has
              ? "border-violet-300 bg-white hover:border-violet-500 hover:shadow-md dark:bg-slate-900 dark:border-violet-700"
              : "border-dashed border-slate-300 bg-slate-50 hover:border-violet-400 hover:bg-violet-50/40 dark:bg-slate-900/40 dark:border-slate-700"
          }`}
          aria-label={has ? `Expandir ${slot.label}` : `Subir ${slot.label}`}
        >
          {has ? (
            <>
              <img
                src={photo.url}
                alt={slot.label}
                className="absolute inset-0 w-full h-full object-cover"
              />
              {isPending ? (
                <div className="absolute inset-0 bg-slate-900/40 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-white animate-spin" aria-hidden />
                </div>
              ) : (
                <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <span className="bg-white/95 text-slate-900 text-[11px] font-medium px-2.5 py-1 rounded-full flex items-center gap-1">
                    <Search className="w-3 h-3" aria-hidden />
                    Expandir
                  </span>
                </div>
              )}
              <span
                className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-white ${
                  isPending ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
                }`}
                aria-hidden
              />
            </>
          ) : (
            <>
              <div className="absolute inset-3 opacity-70 group-hover:opacity-100 transition-opacity">
                <PhotoSlotIcon kind={slot.icon} />
              </div>
              <div className="absolute bottom-1.5 left-0 right-0 flex items-center justify-center gap-1 text-[10px] font-medium text-violet-700 opacity-0 group-hover:opacity-100 transition-opacity dark:text-violet-300">
                <Plus className="w-3 h-3" aria-hidden /> Subir foto
              </div>
            </>
          )}
        </button>
        {has ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Eliminar foto"
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300 flex items-center justify-center shadow-sm"
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
          aria-label={`Subir ${slot.label}`}
        />
      </div>
      <div className="text-[11px] font-medium text-slate-700 mt-2 text-center dark:text-slate-300">
        {slot.label}
      </div>
      {has ? (
        <div className="text-[9px] text-slate-400 mt-0.5 dark:text-slate-500">
          {photo.uploadedAt}
        </div>
      ) : null}
    </div>
  );
}

function PhotoLightbox({
  label,
  group,
  photo,
  onClose,
}: {
  label: string;
  group: "extraoral" | "intraoral";
  photo: UploadEntry;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${label}`}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
      >
        <X className="w-5 h-5" aria-hidden />
      </button>
      <div className="absolute top-4 left-4 text-white">
        <div className="text-[10px] uppercase tracking-wider text-violet-300 font-medium">
          {group === "extraoral" ? "Extraoral" : "Intraoral"}
        </div>
        <div className="text-lg font-semibold">{label}</div>
        <div className="text-xs text-slate-300 mt-0.5">{photo.uploadedAt}</div>
      </div>
      <img
        src={photo.url}
        alt={label}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function HistoricalSetCard({
  set,
  onView,
}: {
  set: PhotoSetSummary;
  onView?: () => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 dark:border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <div>
          <Pill color="violet" size="xs">
            {set.stage}
          </Pill>
          <div className="text-sm font-semibold text-slate-900 mt-1.5 dark:text-slate-100">
            {set.label ?? STAGE_LABEL[set.stage]}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {fmtDate(set.date)}
          </div>
        </div>
        <div className="text-right text-[10px] text-slate-400 dark:text-slate-500">
          <div>{set.photoCount}/10 fotos</div>
          <div>{set.hasRxPan ? "Pan ✓" : "Pan —"}</div>
          <div>{set.hasRxLatCef ? "Cef ✓" : "Cef —"}</div>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className={`aspect-square rounded-sm ${
              i < set.photoCount
                ? "bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600"
                : "bg-slate-50 border border-dashed border-slate-200 dark:bg-slate-900/40 dark:border-slate-700"
            }`}
            aria-hidden
          />
        ))}
      </div>
      {onView ? (
        <Btn
          variant="violet-soft"
          size="sm"
          className="mt-3 w-full justify-center"
          onClick={onView}
          icon={<Camera className="w-3.5 h-3.5" aria-hidden />}
        >
          Ver set completo
        </Btn>
      ) : null}
    </div>
  );
}
