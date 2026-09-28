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
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";
import { juegoDeSeisMesesPendiente } from "@/lib/orthodontics/redesign/secciones-por-fase";

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
  // Blob URLs de previews optimistas vivos. Se revocan al ser reemplazados
  // por la signed URL (recarga de slots), al descartarse y al desmontar.
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const revokeIfTracked = (url?: string) => {
    if (!url || !objectUrlsRef.current.has(url)) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };
  const [lightbox, setLightbox] = useState<{
    slotId: string;
    label: string;
    group: "extraoral" | "intraoral";
    photo: UploadEntry;
  } | null>(null);

  // Pre-pobla `uploads` con los slots persistidos del set activo.
  useEffect(() => {
    const set = props.historicalSets.find((s) => s.stage === stage);
    // Todo preview blob pendiente queda reemplazado por la signed URL o
    // descartado al cambiar de etapa: revócalo antes de recargar.
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current.clear();
    setUploads(set?.slots ?? {});
  }, [stage, props.historicalSets]);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const showG15 = props.monthCurrent >= 10 && props.monthCurrent <= 13;
  const hasControlSet = props.historicalSets.some((s) => s.stage === "CONTROL");
  const showG15Final = showG15 && !hasControlSet;

  const onPick = async (slotId: string, file: File) => {
    // Optimistic preview con blob URL — se reemplaza cuando router.refresh()
    // re-pinta el componente con la signed URL real.
    revokeIfTracked(uploads[slotId]?.url);
    const blobUrl = URL.createObjectURL(file);
    objectUrlsRef.current.add(blobUrl);
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
      revokeIfTracked(blobUrl);
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

  // Ola 1 (ws1-t6) — A8: aquí vivía un `onDelete` que solo hacía
  // `setUploads` local (nunca tocaba el servidor). Al recargar la pantalla
  // la foto volvía porque `historicalSets` (server-sourced) nunca cambió:
  // el botón "borrar" mentía. El alcance ofrece dos arreglos válidos —
  // borrar de verdad, o quitar el botón — y aquí se quita, porque tocar
  // Storage/PatientFile no está en el reparto de esta parte. Se puede volver
  // a añadir cuando exista una action real de borrado.

  const extraoral = PHOTO_SLOTS.filter((s) => s.group === "extraoral");
  const intraoral = PHOTO_SLOTS.filter((s) => s.group === "intraoral");
  const total = PHOTO_SLOTS.length;
  const uploaded = Object.keys(uploads).length;

  // Card extra al final para "Capturar set" si T2 está pendiente — desde el
  // mes 6, no antes (fila 26, ws1-t4 ronda 6: en el mes 2 ya salía «pendiente»).
  const t2Pending = juegoDeSeisMesesPendiente({
    mesActual: props.monthCurrent,
    yaHayJuego: props.historicalSets.some((s) => s.stage === "T2"),
  });

  return (
    <Card
      id="photos"
      icon={<Camera size={15} strokeWidth={1.75} />}
      title="Fotos clínicas"
      eyebrow="10 vistas estándar por etapa"
      action={
        <>
          <div className={orto.segmento} role="tablist" aria-label="Etapa fotográfica">
            {(["T0", "T1", "T2", "CONTROL"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={stage === s}
                onClick={() => setStage(s)}
                title={`Etapa ${s}`}
                className={[orto.segmentoBoton, stage === s ? orto.segmentoActivo : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                {STAGE_LABEL[s]}
              </button>
            ))}
          </div>
          {props.onCompare ? (
            <Btn
              variant="primary"
              size="sm"
              icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
              onClick={props.onCompare}
            >
              Comparar inicio y actual
            </Btn>
          ) : null}
        </>
      }
    >
      {showG15Final ? (
        <div className={`${orto.aviso} ${orto.avisoAlerta} mx-[18px] mt-[16px]`} style={{ alignItems: "flex-start" }}>
          <AlertTriangle
            size={17}
            strokeWidth={1.75}
            className={`${orto.tonoAlerta} flex-shrink-0 mt-[1px]`}
            aria-hidden
          />
          <div className={orto.avisoTexto}>
            <strong>Tocan los registros de los 12 meses.</strong>{" "}
            Juego de 10 fotos, radiografía panorámica y comparativa con el inicio. Próxima
            ventana: en {Math.max(0, 12 - props.monthCurrent)} mes
            {Math.max(0, 12 - props.monthCurrent) === 1 ? "" : "es"}.
          </div>
          {props.onScheduleG15 ? (
            <Btn variant="secondary" size="sm" onClick={props.onScheduleG15}>
              Programar ahora
            </Btn>
          ) : null}
        </div>
      ) : null}

      <div className="px-[18px] py-[12px] border-b border-[color:var(--pr-borde-suave)] flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Pill color="violet">{STAGE_LABEL[stage]}</Pill>
          <div className="text-xs text-[color:var(--pr-texto-3)]">
            Pulsa un recuadro para subir la foto; pulsa una foto para verla en grande.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold text-[color:var(--pr-texto-2)] tabular-nums whitespace-nowrap">
            {uploaded} de {total}
          </div>
          <div className="w-28">
            <ProgressBar value={uploaded} max={total} color="violet" />
          </div>
        </div>
      </div>

      <PhotoGrid
        title="Extraorales · 3 vistas"
        slots={extraoral}
        uploads={uploads}
        pending={pending}
        onPick={onPick}
        onView={(s, p) => setLightbox({ slotId: s.id, label: s.label, group: s.group, photo: p })}
      />

      <PhotoGrid
        title="Intraorales · 7 vistas"
        slots={intraoral}
        uploads={uploads}
        pending={pending}
        onPick={onPick}
        onView={(s, p) => setLightbox({ slotId: s.id, label: s.label, group: s.group, photo: p })}
      />

      {/* Sin juegos guardados y sin ninguno pendiente todavía (antes del mes
          6), el título se quedaba solo sobre una rejilla vacía. */}
      {props.historicalSets.length > 0 || t2Pending ? (
        <div className="px-[18px] py-[16px]">
          <div className={`${orto.ceja} mb-3`}>Juegos de fotos por etapa</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[10px]">
            {props.historicalSets.map((p) => (
              <HistoricalSetCard
                key={p.stage}
                set={p}
                onView={() => props.onViewSet?.(p.stage)}
              />
            ))}
            {t2Pending ? (
              <div className={orto.vacio}>
                <Pill color="slate" size="xs">
                  {STAGE_LABEL.T2}
                </Pill>
                <p className={orto.vacioTitulo}>Juego de los 6 meses pendiente</p>
                <p className={orto.vacioPista}>
                  Elige la etapa «{STAGE_LABEL.T2}» arriba y sube las fotos.
                </p>
                {props.onCaptureSet ? (
                  <Btn
                    variant="secondary"
                    size="sm"
                    icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
                    className="mt-1"
                    onClick={props.onCaptureSet}
                  >
                    Capturar juego
                  </Btn>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
  onView,
}: {
  title: string;
  slots: typeof PHOTO_SLOTS;
  uploads: Record<string, UploadEntry>;
  pending: Record<string, boolean>;
  onPick: (slotId: string, file: File) => void;
  onView: (slot: (typeof PHOTO_SLOTS)[number], photo: UploadEntry) => void;
}) {
  return (
    <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
      <div className={`${orto.ceja} mb-3`}>
        {title}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-[12px]">
        {slots.map((slot) => (
          <PhotoSlot
            key={slot.id}
            slot={slot}
            photo={uploads[slot.id]}
            isPending={Boolean(pending[slot.id])}
            onPick={(f) => onPick(slot.id, f)}
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
  onView,
}: {
  slot: (typeof PHOTO_SLOTS)[number];
  photo: UploadEntry | undefined;
  isPending: boolean;
  onPick: (file: File) => void;
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
          className={`group relative w-full aspect-[4/3] rounded-[10px] border overflow-hidden transition-colors ${
            has
              ? "border-[color:var(--orto-violeta-borde)] bg-[color:var(--pr-tarjeta)] hover:border-[color:var(--pr-activo)]"
              : "border-dashed border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta-2)] hover:border-[color:var(--pr-activo)] hover:bg-[color:var(--pr-activo-suave)]"
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
                <div className="absolute inset-0 bg-[color:var(--orto-velo)] flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-[color:var(--pr-activo-texto)] animate-spin" aria-hidden />
                </div>
              ) : (
                <div className="absolute inset-0 group-hover:bg-[color:var(--orto-velo)] group-focus-visible:bg-[color:var(--orto-velo)] transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span className="bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto)] text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
                    <Search className="w-3 h-3" aria-hidden />
                    Ver en grande
                  </span>
                </div>
              )}
              <span
                className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-[color:var(--pr-tarjeta)] ${
                  isPending ? "bg-[color:var(--pr-alerta)] animate-pulse" : "bg-[color:var(--pr-exito)]"
                }`}
                aria-hidden
              />
            </>
          ) : (
            <>
              <div className="absolute inset-3 opacity-70 group-hover:opacity-100 transition-opacity">
                <PhotoSlotIcon kind={slot.icon} />
              </div>
              <div className="absolute bottom-1.5 left-0 right-0 flex items-center justify-center gap-1 text-[11px] font-semibold text-[color:var(--orto-violeta)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                <Plus className="w-3 h-3" aria-hidden /> Subir foto
              </div>
            </>
          )}
        </button>
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
      <div className="text-xs font-semibold text-[color:var(--pr-texto-2)] mt-[6px] text-center">
        {slot.label}
      </div>
      {has ? (
        <div className="text-[11px] text-[color:var(--pr-texto-3)] mt-0.5">
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
  // Escape cierra el visor y el foco vuelve a la foto que lo abrió.
  const visorRef = useCajon<HTMLDivElement>(onClose);
  return (
    <div
      ref={visorRef}
      tabIndex={-1}
      className={orto.visor}
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${label}`}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className={orto.visorCerrar}
      >
        <X className="w-5 h-5" aria-hidden />
      </button>
      <div className={orto.visorRotulo}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-70">
          {group === "extraoral" ? "Extraoral" : "Intraoral"}
        </div>
        <div className="text-[17px] font-semibold">{label}</div>
        <div className="text-xs opacity-70 mt-0.5">{photo.uploadedAt}</div>
      </div>
      <img
        src={photo.url}
        alt={label}
        className="max-w-full max-h-full object-contain rounded-[10px]"
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
    <div className={orto.caja} style={{ padding: "12px 14px" }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <Pill color="violet" size="xs">
            {STAGE_LABEL[set.stage]}
          </Pill>
          <div className="text-[13px] font-semibold text-[color:var(--pr-texto)] mt-1.5">
            {set.label ?? STAGE_LABEL[set.stage]}
          </div>
          <div className="text-[11px] text-[color:var(--pr-texto-3)]">
            {fmtDate(set.date)}
          </div>
        </div>
        <div className="text-right text-[11px] text-[color:var(--pr-texto-3)]">
          <div className="font-semibold text-[color:var(--pr-texto-2)]">{set.photoCount} de 10 fotos</div>
          <div>Panorámica {set.hasRxPan ? "✓" : "—"}</div>
          <div>Lateral {set.hasRxLatCef ? "✓" : "—"}</div>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className={`aspect-square rounded-[8px] ${
              i < set.photoCount
                ? "bg-[color:var(--pr-borde)]"
                : "bg-[color:var(--pr-tarjeta-2)] border border-dashed border-[color:var(--pr-borde)]"
            }`}
            aria-hidden
          />
        ))}
      </div>
      {onView ? (
        <Btn
          variant="violet-soft"
          size="sm"
          className="mt-3 w-full"
          onClick={onView}
          icon={<Camera size={14} strokeWidth={1.75} aria-hidden />}
        >
          Ver juego completo
        </Btn>
      ) : null}
    </div>
  );
}
