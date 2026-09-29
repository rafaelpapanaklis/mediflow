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
//   - «Quitar foto» (con confirmación y motivo) y «Agregar fotos extra» (ws1-t12)

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import { fmtDate } from "../atoms/format";
import { PHOTO_SLOTS, PhotoSlotIcon } from "./PhotoSlotIcon";
import { ElegirArchivoDelPaciente } from "../../imagen/ElegirArchivoDelPaciente";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";
import { juegoDeSeisMesesPendiente } from "@/lib/orthodontics/redesign/secciones-por-fase";
import { elegirSetParaFoto } from "@/lib/orthodontics/redesign/set-de-foto-por-visita";
import { isFailure } from "@/app/actions/orthodontics/result";
import { ETIQUETA_MAX, MOTIVO_MAX, nombreDeExtra, type FotoExtra } from "@/lib/orthodontics/fotos-del-juego";
import {
  agregarFotoExtra,
  quitarFotoDeVista,
  quitarFotoExtra,
} from "@/app/actions/orthodontics/fotosDelJuego";

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
  /** Fotos extra del juego (más allá de las 10 vistas), ya sin las quitadas. */
  extras?: FotoExtra[];
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
  /**
   * H55: elegir una foto que ya está en el expediente en vez de subirla otra
   * vez. Con `patientId` y este callback aparece «Elegir de los archivos del
   * paciente». Devuelve un texto solo si falló.
   */
  patientId?: string;
  onElegirExistente?: (stage: PhotoStage, slotId: string, fileId: string) => Promise<string | null | void> | string | null | void;
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

/** Qué foto se va a quitar: una de las vistas (`slotId`) o una extra (`extraId`). */
interface Quitando {
  setId: string;
  slotId?: string;
  extraId?: string;
  nombre: string;
}

type GrupoDeFoto = "extraoral" | "intraoral" | "extra";

interface ItemExtra {
  file: File;
  etiqueta: string;
}

const STAGE_LABEL: Record<PhotoStage, string> = {
  T0: "Inicial",
  T1: "3 meses",
  T2: "6 meses",
  CONTROL: "Control",
};

/** Clave estable de un juego: su id, o la etapa si aún no lo trae. */
export function claveDeJuego(set: Pick<PhotoSetSummary, "setId" | "stage" | "date">): string {
  return set.setId ?? `${set.stage}:${set.date ?? ""}`;
}

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
    group: GrupoDeFoto;
    photo: UploadEntry;
    quitar: Quitando | null;
  } | null>(null);
  const router = useRouter();
  const [quitando, setQuitando] = useState<Quitando | null>(null);
  // «Ver juego completo»: el juego que se abrió (por su clave, no por etapa:
  // en CONTROL hay uno por visita). Se busca en `historicalSets` en cada
  // pintado, así que al refrescar tras subir una foto se ve la nueva.
  const [juegoAbierto, setJuegoAbierto] = useState<string | null>(null);

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

  // El juego de la etapa que se está viendo (el mismo que pinta la rejilla).
  const setActivo = props.historicalSets.find((s) => s.stage === stage);
  // Solo se quita lo que ya está guardado: una vista previa que aún sube no.
  const quitarDeVista = (slot: (typeof PHOTO_SLOTS)[number]): Quitando | null =>
    setActivo?.setId && setActivo.slots?.[slot.id]
      ? { setId: setActivo.setId, slotId: slot.id, nombre: slot.label }
      : null;

  const abrirVisor = (
    label: string,
    group: GrupoDeFoto,
    photo: UploadEntry,
    quitar: Quitando | null,
    slotId = label,
  ) => setLightbox({ slotId, label, group, photo, quitar });

  /** Confirma «Quitar foto». Devuelve un texto solo si falló. */
  const confirmarQuitar = async (motivo: string): Promise<string | null> => {
    if (!quitando) return null;
    const q = quitando;
    const r = q.slotId
      ? await quitarFotoDeVista({ setId: q.setId, slotId: q.slotId, motivo })
      : await quitarFotoExtra({ setId: q.setId, extraId: q.extraId ?? "", motivo });
    if (isFailure(r)) return r.error;
    if (q.slotId && q.setId === setActivo?.setId) {
      const slotId = q.slotId;
      setUploads((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
    }
    setQuitando(null);
    setLightbox(null);
    router.refresh();
    return null;
  };

  /** Sube fotos extra al juego, una por una. Devuelve cuáles fallaron. */
  const subirExtras = async (
    setId: string,
    items: ItemExtra[],
  ): Promise<{ fallidas: number[]; error: string | null }> => {
    const fallidas: number[] = [];
    let error: string | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      try {
        const fd = new FormData();
        fd.append("file", item.file);
        fd.append("setId", setId);
        fd.append("view", "extra");
        const res = await fetch("/api/orthodontics/photos/upload", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.fileId) throw new Error(json?.error ?? "No se pudo subir la foto");
        const r = await agregarFotoExtra({ setId, fileId: json.fileId, etiqueta: item.etiqueta });
        if (isFailure(r)) throw new Error(r.error);
      } catch (e) {
        fallidas.push(i);
        error = e instanceof Error ? e.message : "No se pudo subir la foto";
      }
    }
    if (fallidas.length < items.length) router.refresh();
    return { fallidas, error };
  };

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

      {props.patientId && props.onElegirExistente ? (
        <ElegirFotoExistente
          patientId={props.patientId}
          stageLabel={STAGE_LABEL[stage]}
          onElegir={async (slotId, fileId) => {
            const r = await props.onElegirExistente?.(stage, slotId, fileId);
            return r ? String(r) : null;
          }}
        />
      ) : null}

      <PhotoGrid
        title="Extraorales · 3 vistas"
        slots={extraoral}
        uploads={uploads}
        pending={pending}
        onPick={onPick}
        onView={(s, p) => abrirVisor(s.label, s.group, p, quitarDeVista(s), s.id)}
        quitable={(s) => quitarDeVista(s) !== null}
        onQuitar={(s) => {
          const q = quitarDeVista(s);
          if (q) setQuitando(q);
        }}
      />

      <PhotoGrid
        title="Intraorales · 7 vistas"
        slots={intraoral}
        uploads={uploads}
        pending={pending}
        onPick={onPick}
        onView={(s, p) => abrirVisor(s.label, s.group, p, quitarDeVista(s), s.id)}
        quitable={(s) => quitarDeVista(s) !== null}
        onQuitar={(s) => {
          const q = quitarDeVista(s);
          if (q) setQuitando(q);
        }}
      />

      <FotosExtra
        set={setActivo}
        onView={(e, i) =>
          abrirVisor(
            nombreDeExtra(e.label, i),
            "extra",
            { url: e.url, uploadedAt: e.uploadedAt },
            setActivo?.setId
              ? { setId: setActivo.setId, extraId: e.id, nombre: nombreDeExtra(e.label, i) }
              : null,
            e.id,
          )
        }
        onQuitar={(e, i) => {
          if (setActivo?.setId) {
            setQuitando({ setId: setActivo.setId, extraId: e.id, nombre: nombreDeExtra(e.label, i) });
          }
        }}
        onSubir={(items) => (setActivo?.setId ? subirExtras(setActivo.setId, items) : Promise.resolve({ fallidas: [], error: null }))}
      />

      {/* Sin juegos guardados y sin ninguno pendiente todavía (antes del mes
          6), el título se quedaba solo sobre una rejilla vacía. */}
      {props.historicalSets.length > 0 || t2Pending ? (
        <div className="px-[18px] py-[16px]">
          <div className={`${orto.ceja} mb-3`}>Juegos de fotos por etapa</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[10px]">
            {props.historicalSets.map((p) => (
              <HistoricalSetCard
                key={claveDeJuego(p)}
                set={p}
                onView={() => {
                  // El padre puede ofrecer su propio visor; sin él, el juego
                  // se abre aquí (antes el botón no hacía nada sin `onViewSet`).
                  if (props.onViewSet) props.onViewSet(p.stage);
                  else setJuegoAbierto(claveDeJuego(p));
                }}
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

      {juegoAbierto
        ? (() => {
            const juego = props.historicalSets.find((j) => claveDeJuego(j) === juegoAbierto);
            if (!juego) return null;
            return (
              <JuegoCompleto
                set={juego}
                puedeSubir={
                  Boolean(props.onUpload) &&
                  Boolean(juego.setId) &&
                  elegirSetParaFoto(props.historicalSets, juego.stage) === juego.setId
                }
                onUpload={props.onUpload}
                onView={(slot, photo, quitar) =>
                  abrirVisor(slot.label, slot.group, photo, quitar, slot.id)
                }
                onViewExtra={(e, i, quitar) =>
                  abrirVisor(nombreDeExtra(e.label, i), "extra", { url: e.url, uploadedAt: e.uploadedAt }, quitar, e.id)
                }
                onQuitar={setQuitando}
                onSubirExtras={(items) => (juego.setId ? subirExtras(juego.setId, items) : Promise.resolve({ fallidas: [], error: null }))}
                onClose={() => setJuegoAbierto(null)}
              />
            );
          })()
        : null}

      {lightbox ? (
        <PhotoLightbox
          label={lightbox.label}
          group={lightbox.group}
          photo={lightbox.photo}
          onQuitar={lightbox.quitar ? () => setQuitando(lightbox.quitar) : undefined}
          onClose={() => setLightbox(null)}
        />
      ) : null}

      {quitando ? (
        <ConfirmarQuitarFoto
          nombre={quitando.nombre}
          esVista={Boolean(quitando.slotId)}
          onCancelar={() => setQuitando(null)}
          onConfirmar={confirmarQuitar}
        />
      ) : null}
    </Card>
  );
}

/** H55: «Elegir de los archivos del paciente» — elige la foto y en qué vista va. */
function ElegirFotoExistente({
  patientId,
  stageLabel,
  onElegir,
}: {
  patientId: string;
  stageLabel: string;
  onElegir: (slotId: string, fileId: string) => Promise<string | null>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [slotId, setSlotId] = useState(PHOTO_SLOTS[0]?.id ?? "");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const poner = async () => {
    if (!fileId) return;
    setEnviando(true);
    setAviso(null);
    try {
      const error = await onElegir(slotId, fileId);
      if (error) {
        setAviso(error);
        return;
      }
      setAbierto(false);
      setFileId(null);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="px-[18px] py-[10px] border-b border-[color:var(--pr-borde-suave)]">
      <div className="flex items-center gap-2 flex-wrap">
        <Btn variant="secondary" size="sm" onClick={() => setAbierto((v) => !v)}>
          Elegir de los archivos del paciente
        </Btn>
        <span className="text-xs text-[color:var(--pr-texto-3)]">Sin subirla otra vez · etapa {stageLabel}</span>
      </div>
      {abierto ? (
        <>
          <ElegirArchivoDelPaciente
            patientId={patientId}
            tipo="imagen"
            titulo="Fotos del expediente"
            onElegir={(a) => setFileId(a.id)}
            onCerrar={() => setAbierto(false)}
          />
          {fileId ? (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <label className="text-xs" htmlFor="orto-foto-vista">¿En qué vista va?</label>
              <select id="orto-foto-vista" value={slotId} onChange={(e) => setSlotId(e.target.value)} className={orto.entrada}>
                {PHOTO_SLOTS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <Btn variant="primary" size="sm" onClick={poner} disabled={enviando}>
                {enviando ? "Poniendo…" : "Poner esta foto"}
              </Btn>
            </div>
          ) : null}
          {aviso ? <div className="mt-1 text-xs" role="alert">{aviso}</div> : null}
        </>
      ) : null}
    </div>
  );
}

function PhotoGrid({
  title,
  slots,
  uploads,
  pending,
  onPick,
  onView,
  quitable,
  onQuitar,
}: {
  title: string;
  slots: typeof PHOTO_SLOTS;
  uploads: Record<string, UploadEntry>;
  pending: Record<string, boolean>;
  onPick: (slotId: string, file: File) => void;
  onView: (slot: (typeof PHOTO_SLOTS)[number], photo: UploadEntry) => void;
  quitable: (slot: (typeof PHOTO_SLOTS)[number]) => boolean;
  onQuitar: (slot: (typeof PHOTO_SLOTS)[number]) => void;
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
            onQuitar={quitable(slot) ? () => onQuitar(slot) : undefined}
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
  onQuitar,
}: {
  slot: (typeof PHOTO_SLOTS)[number];
  photo: UploadEntry | undefined;
  isPending: boolean;
  onPick: (file: File) => void;
  onView: (photo: UploadEntry) => void;
  /** Sin esto no se ofrece «Quitar foto» (vista sin guardar todavía). */
  onQuitar?: () => void;
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
      {has && onQuitar && !isPending ? (
        <button
          type="button"
          onClick={onQuitar}
          className={`${orto.enlace} ${orto.enlacePeligro} mt-1`}
          aria-label={`Quitar foto: ${slot.label}`}
        >
          Quitar foto
        </button>
      ) : null}
    </div>
  );
}

function PhotoLightbox({
  label,
  group,
  photo,
  onQuitar,
  onClose,
}: {
  label: string;
  group: GrupoDeFoto;
  photo: UploadEntry;
  onQuitar?: () => void;
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
          {group === "extraoral" ? "Extraoral" : group === "intraoral" ? "Intraoral" : "Foto extra"}
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
      {onQuitar ? (
        <button
          type="button"
          className={orto.visorQuitar}
          onClick={(e) => {
            e.stopPropagation();
            onQuitar();
          }}
        >
          <Trash2 className="w-4 h-4" aria-hidden />
          Quitar foto
        </button>
      ) : null}
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
          {set.extras && set.extras.length > 0 ? (
            <div>+ {set.extras.length} extra{set.extras.length === 1 ? "" : "s"}</div>
          ) : null}
          <div>Panorámica {set.hasRxPan ? "✓" : "—"}</div>
          <div>Lateral {set.hasRxLatCef ? "✓" : "—"}</div>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {PHOTO_SLOTS.map((slot) => {
          const url = set.slots?.[slot.id]?.url;
          return url ? (
            <MiniaturaDeFoto key={slot.id} url={url} label={slot.label} />
          ) : (
            <div
              key={slot.id}
              className="aspect-square rounded-[8px] bg-[color:var(--pr-tarjeta-2)] border border-dashed border-[color:var(--pr-borde)]"
              aria-hidden
            />
          );
        })}
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

/** Miniatura de una vista del juego. Si la imagen no carga (URL caducada), queda el recuadro gris. */
function MiniaturaDeFoto({ url, label }: { url: string; label: string }) {
  const [fallo, setFallo] = useState(false);
  return (
    <div
      className="aspect-square rounded-[8px] overflow-hidden bg-[color:var(--pr-borde)]"
      title={label}
    >
      {fallo ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={label}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setFallo(true)}
        />
      )}
    </div>
  );
}

/**
 * «Ver juego completo»: las 10 vistas del juego. Las subidas se abren en
 * grande; los huecos ofrecen subir la foto — solo si la subida caería en ESTE
 * juego (el mismo criterio que usa la pestaña al subir: en CONTROL sube al de
 * hoy, no a uno viejo). Las dos vistas sin columna (sobremordida, resalte) no
 * se pueden guardar todavía y lo dicen en vez de fallar.
 */
function JuegoCompleto({
  set,
  puedeSubir,
  onUpload,
  onView,
  onViewExtra,
  onQuitar,
  onSubirExtras,
  onClose,
}: {
  set: PhotoSetSummary;
  puedeSubir: boolean;
  onUpload?: SectionPhotosProps["onUpload"];
  onView: (slot: (typeof PHOTO_SLOTS)[number], photo: UploadEntry, quitar: Quitando | null) => void;
  onViewExtra: (extra: FotoExtra, indice: number, quitar: Quitando | null) => void;
  onQuitar: (q: Quitando) => void;
  onSubirExtras: (items: ItemExtra[]) => Promise<{ fallidas: number[]; error: string | null }>;
  onClose: () => void;
}) {
  const ventanaRef = useCajon<HTMLDivElement>(onClose);
  // Vista previa optimista de lo recién subido, hasta que el refresco traiga la firmada.
  const [locales, setLocales] = useState<Record<string, UploadEntry>>({});
  const [subiendo, setSubiendo] = useState<Record<string, boolean>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const blobs = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = blobs.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);
  useEffect(() => {
    // Llegó el juego recargado: manda lo del servidor.
    blobs.current.forEach((u) => URL.revokeObjectURL(u));
    blobs.current.clear();
    setLocales({});
  }, [set.slots]);

  const fotoDe = (id: string): UploadEntry | undefined => set.slots?.[id] ?? locales[id];
  // Solo se quita lo ya guardado (no la vista previa de una subida en curso).
  const quitarDe = (slot: (typeof PHOTO_SLOTS)[number]): Quitando | null =>
    set.setId && set.slots?.[slot.id] && !subiendo[slot.id]
      ? { setId: set.setId, slotId: slot.id, nombre: slot.label }
      : null;
  const subidas = PHOTO_SLOTS.filter((s) => fotoDe(s.id)).length;

  const subir = async (slotId: string, file: File) => {
    if (!onUpload) return;
    setAviso(null);
    const url = URL.createObjectURL(file);
    blobs.current.add(url);
    setLocales((p) => ({ ...p, [slotId]: { url, uploadedAt: "Subiendo…" } }));
    setSubiendo((p) => ({ ...p, [slotId]: true }));
    try {
      await onUpload(set.stage, slotId, file);
    } catch {
      URL.revokeObjectURL(url);
      blobs.current.delete(url);
      setLocales((p) => {
        const n = { ...p };
        delete n[slotId];
        return n;
      });
      setAviso("No se pudo subir la foto. Inténtalo de nuevo.");
    } finally {
      setSubiendo((p) => {
        const n = { ...p };
        delete n[slotId];
        return n;
      });
    }
  };

  const grupo = (titulo: string, slots: typeof PHOTO_SLOTS) => (
    <div className="mb-4">
      <div className={`${orto.ceja} mb-2`}>{titulo}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-[10px]">
        {slots.map((slot) => {
          const foto = fotoDe(slot.id);
          const sinColumna = slot.id === "sobremordida" || slot.id === "resalte";
          return (
            <div key={slot.id} className="flex flex-col items-center">
              {foto ? (
                <button
                  type="button"
                  onClick={() => onView(slot, foto, quitarDe(slot))}
                  aria-label={`Expandir ${slot.label}`}
                  className="relative w-full aspect-[4/3] rounded-[10px] border border-[color:var(--orto-violeta-borde)] overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto.url} alt={slot.label} className="absolute inset-0 w-full h-full object-cover" />
                  {subiendo[slot.id] ? (
                    <span className="absolute inset-0 bg-[color:var(--orto-velo)] flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-[color:var(--pr-activo-texto)]" aria-hidden />
                    </span>
                  ) : null}
                </button>
              ) : (
                <HuecoParaSubir
                  slot={slot}
                  puedeSubir={puedeSubir && !sinColumna}
                  nota={sinColumna ? "Aún no se guarda" : puedeSubir ? null : "Sin foto"}
                  onPick={(f) => subir(slot.id, f)}
                />
              )}
              <div className="text-xs font-semibold text-[color:var(--pr-texto-2)] mt-[6px] text-center">
                {slot.label}
              </div>
              {quitarDe(slot) ? (
                <button
                  type="button"
                  onClick={() => onQuitar(quitarDe(slot)!)}
                  className={`${orto.enlace} ${orto.enlacePeligro} mt-1`}
                  aria-label={`Quitar foto: ${slot.label}`}
                >
                  Quitar foto
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <div className={orto.velo} onClick={onClose} aria-hidden />
      <div className={orto.ventanaMarco}>
        <div
          ref={ventanaRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="juego-completo-titulo"
          className="bg-[color:var(--pr-tarjeta)] rounded-[14px] shadow-xl border border-[color:var(--pr-borde)] w-full max-w-4xl pointer-events-auto max-h-[90vh] flex flex-col outline-none"
        >
          <header className={orto.cajonCabeza}>
            <div>
              <div className={orto.cajonCeja}>Juego de fotos</div>
              <h3 id="juego-completo-titulo" className="text-[17px] font-semibold text-[color:var(--pr-texto)]">
                {set.label ?? STAGE_LABEL[set.stage]} · {fmtDate(set.date)}
              </h3>
              <div className="text-xs text-[color:var(--pr-texto-3)] mt-0.5">
                {subidas} de {PHOTO_SLOTS.length} fotos
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className={orto.botonIcono}>
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">
            {aviso ? (
              <div className="mb-3 text-xs" role="alert">
                {aviso}
              </div>
            ) : null}
            {grupo("Extraorales · 3 vistas", PHOTO_SLOTS.filter((s) => s.group === "extraoral"))}
            {grupo("Intraorales · 7 vistas", PHOTO_SLOTS.filter((s) => s.group === "intraoral"))}
            <FotosExtra
              set={set}
              enModal
              onView={(e, i) =>
                onViewExtra(
                  e,
                  i,
                  set.setId ? { setId: set.setId, extraId: e.id, nombre: nombreDeExtra(e.label, i) } : null,
                )
              }
              onQuitar={(e, i) => {
                if (set.setId) onQuitar({ setId: set.setId, extraId: e.id, nombre: nombreDeExtra(e.label, i) });
              }}
              onSubir={onSubirExtras}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function HuecoParaSubir({
  slot,
  puedeSubir,
  nota,
  onPick,
}: {
  slot: (typeof PHOTO_SLOTS)[number];
  puedeSubir: boolean;
  nota: string | null;
  onPick: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="relative w-full">
      <button
        type="button"
        disabled={!puedeSubir}
        onClick={() => fileRef.current?.click()}
        aria-label={puedeSubir ? `Subir ${slot.label}` : `${slot.label}: ${nota ?? "sin foto"}`}
        className="group relative w-full aspect-[4/3] rounded-[10px] border border-dashed border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta-2)] overflow-hidden enabled:hover:border-[color:var(--pr-activo)] enabled:hover:bg-[color:var(--pr-activo-suave)] disabled:cursor-default"
      >
        <div className="absolute inset-3 opacity-70">
          <PhotoSlotIcon kind={slot.icon} />
        </div>
        <div className="absolute bottom-1.5 left-0 right-0 flex items-center justify-center gap-1 text-[11px] font-semibold text-[color:var(--orto-violeta)]">
          {puedeSubir ? (
            <>
              <Plus className="w-3 h-3" aria-hidden /> Subir foto
            </>
          ) : (
            <span className="text-[color:var(--pr-texto-3)] font-normal">{nota}</span>
          )}
        </div>
      </button>
      {puedeSubir ? (
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
      ) : null}
    </div>
  );
}

/**
 * «Quitar foto»: confirmación con motivo corto opcional. La foto no se borra
 * (NOM-004): el servidor anota quién, cuándo y por qué, y conserva el archivo.
 */
function ConfirmarQuitarFoto({
  nombre,
  esVista,
  onCancelar,
  onConfirmar,
}: {
  nombre: string;
  /** Una de las 10 vistas (queda libre para otra) o una foto extra. */
  esVista: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => Promise<string | null>;
}) {
  const ventanaRef = useCajon<HTMLDivElement>(onCancelar);
  const [motivo, setMotivo] = useState("");
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quitar = async () => {
    setQuitando(true);
    setError(null);
    try {
      const fallo = await onConfirmar(motivo);
      if (fallo) setError(fallo);
    } catch {
      setError("No se pudo quitar la foto. Inténtalo de nuevo.");
    } finally {
      setQuitando(false);
    }
  };
  return (
    <>
      <div className={orto.veloEncima} onClick={quitando ? undefined : onCancelar} aria-hidden />
      <div className={orto.marcoEncima}>
        <div
          ref={ventanaRef}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="quitar-foto-titulo"
          aria-describedby="quitar-foto-texto"
          className={`${orto.ventana} ${orto.ventanaChica}`}
        >
          <header className={orto.cajonCabeza}>
            <div className={orto.cajonTextos}>
              <div className={orto.cajonCeja}>Expediente clínico</div>
              <h3 id="quitar-foto-titulo" className={orto.cajonTitulo}>
                ¿Quitar la foto «{nombre}»?
              </h3>
            </div>
          </header>
          <div className={orto.cajonCuerpoRelleno}>
            <p id="quitar-foto-texto" className="m-0 mb-3 text-[13px] text-[color:var(--pr-texto-2)]">
              {esVista
                ? "Deja de verse en el juego y la vista queda libre para subir otra. "
                : "Deja de verse en el juego. "}
              Por ser parte del expediente el archivo no se borra: queda anotado quién la quitó, cuándo y el motivo.
            </p>
            <div className={orto.campo}>
              <label htmlFor="quitar-foto-motivo" className={orto.campoEtiqueta}>
                Motivo (opcional)
              </label>
              <textarea
                id="quitar-foto-motivo"
                className={orto.entrada}
                rows={2}
                maxLength={MOTIVO_MAX}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej. no era la foto del paciente"
                disabled={quitando}
              />
            </div>
            {error ? (
              <p role="alert" className={`m-0 mt-2 text-xs ${orto.tonoPeligro}`}>
                {error}
              </p>
            ) : null}
          </div>
          <footer className={orto.cajonPie}>
            <Btn variant="secondary" onClick={onCancelar} disabled={quitando}>
              Cancelar
            </Btn>
            <Btn variant="rose" onClick={quitar} disabled={quitando}>
              {quitando ? "Quitando…" : "Quitar foto"}
            </Btn>
          </footer>
        </div>
      </div>
    </>
  );
}

interface FotoPorSubir {
  clave: string;
  file: File;
  vista: string;
  etiqueta: string;
}

/**
 * Fotos extra de un juego, después de las 10 vistas: se eligen varias a la vez,
 * cada una con nombre opcional, y se ven (y se quitan) igual que las demás.
 */
function FotosExtra({
  set,
  onView,
  onQuitar,
  onSubir,
  enModal = false,
}: {
  set: PhotoSetSummary | undefined;
  onView: (extra: FotoExtra, indice: number) => void;
  onQuitar: (extra: FotoExtra, indice: number) => void;
  onSubir: (items: ItemExtra[]) => Promise<{ fallidas: number[]; error: string | null }>;
  enModal?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [porSubir, setPorSubir] = useState<FotoPorSubir[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const vistas = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = vistas.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const extras = set?.extras ?? [];
  const puede = Boolean(set?.setId);

  const elegir = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const nuevas: FotoPorSubir[] = Array.from(files).map((file, i) => {
      const vista = URL.createObjectURL(file);
      vistas.current.add(vista);
      return { clave: `${Date.now()}-${i}-${file.name}`, file, vista, etiqueta: "" };
    });
    setAviso(null);
    setPorSubir((prev) => [...prev, ...nuevas]);
  };
  const descartar = (clave: string) =>
    setPorSubir((prev) => {
      const quitada = prev.find((f) => f.clave === clave);
      if (quitada) {
        URL.revokeObjectURL(quitada.vista);
        vistas.current.delete(quitada.vista);
      }
      return prev.filter((f) => f.clave !== clave);
    });
  const subir = async () => {
    if (porSubir.length === 0) return;
    setSubiendo(true);
    setAviso(null);
    try {
      const lote = porSubir;
      const { fallidas, error } = await onSubir(lote.map((f) => ({ file: f.file, etiqueta: f.etiqueta })));
      lote.forEach((f, i) => {
        if (fallidas.includes(i)) return;
        URL.revokeObjectURL(f.vista);
        vistas.current.delete(f.vista);
      });
      setPorSubir(lote.filter((_, i) => fallidas.includes(i)));
      if (fallidas.length > 0) {
        setAviso(
          `Se subieron ${lote.length - fallidas.length} de ${lote.length}. ${error ?? ""} Las que faltan siguen aquí para reintentar.`.trim(),
        );
      }
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className={enModal ? "mb-2" : "px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]"}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className={orto.ceja}>Fotos extra{extras.length > 0 ? ` · ${extras.length}` : ""}</div>
        <Btn
          variant="secondary"
          size="sm"
          icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
          onClick={() => inputRef.current?.click()}
          disabled={!puede || subiendo}
        >
          Agregar fotos extra
        </Btn>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Agregar fotos extra"
          onChange={(e) => {
            elegir(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {!puede ? (
        <p className="m-0 text-xs text-[color:var(--pr-texto-3)]">
          Sube primero una de las vistas para abrir este juego; después podrás agregar fotos extra.
        </p>
      ) : null}

      {porSubir.length > 0 ? (
        <div className="mb-3 rounded-[10px] border border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta-2)] p-[10px]">
          <ul className="m-0 p-0 list-none grid gap-2">
            {porSubir.map((f, i) => (
              <li key={f.clave} className="flex items-center gap-[10px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.vista} alt="" className="w-[52px] h-[52px] rounded-[8px] object-cover flex-shrink-0" />
                <input
                  className={orto.entrada}
                  value={f.etiqueta}
                  maxLength={ETIQUETA_MAX}
                  disabled={subiendo}
                  aria-label={`Nombre de la foto ${i + 1} (opcional)`}
                  placeholder="Nombre (opcional) · ej. Frenillo"
                  onChange={(e) =>
                    setPorSubir((prev) => prev.map((x) => (x.clave === f.clave ? { ...x, etiqueta: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className={orto.botonIcono}
                  onClick={() => descartar(f.clave)}
                  disabled={subiendo}
                  aria-label={`Descartar ${f.file.name}`}
                >
                  <X className="w-4 h-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-[10px] flex items-center gap-2 flex-wrap">
            <Btn variant="primary" size="sm" onClick={subir} disabled={subiendo}>
              {subiendo ? "Subiendo…" : porSubir.length === 1 ? "Subir 1 foto" : `Subir ${porSubir.length} fotos`}
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              disabled={subiendo}
              onClick={() => porSubir.slice().forEach((f) => descartar(f.clave))}
            >
              Cancelar
            </Btn>
          </div>
        </div>
      ) : null}

      {aviso ? (
        <p role="alert" className={`m-0 mb-3 text-xs ${orto.tonoPeligro}`}>
          {aviso}
        </p>
      ) : null}

      {extras.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-[12px]">
          {extras.map((e, i) => {
            const nombre = nombreDeExtra(e.label, i);
            return (
              <div key={e.id} className="flex flex-col items-center min-w-0 w-full">
                <button
                  type="button"
                  onClick={() => onView(e, i)}
                  aria-label={`Expandir ${nombre}`}
                  className="relative w-full aspect-[4/3] rounded-[10px] border border-[color:var(--orto-violeta-borde)] bg-[color:var(--pr-tarjeta)] overflow-hidden hover:border-[color:var(--pr-activo)] transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.url} alt={nombre} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                </button>
                <div
                  className="text-xs font-semibold text-[color:var(--pr-texto-2)] mt-[6px] text-center max-w-full truncate"
                  title={nombre}
                >
                  {nombre}
                </div>
                <div className="text-[11px] text-[color:var(--pr-texto-3)] mt-0.5">{e.uploadedAt}</div>
                <button
                  type="button"
                  onClick={() => onQuitar(e, i)}
                  className={`${orto.enlace} ${orto.enlacePeligro} mt-1`}
                  aria-label={`Quitar foto: ${nombre}`}
                >
                  Quitar foto
                </button>
              </div>
            );
          })}
        </div>
      ) : puede && porSubir.length === 0 ? (
        <p className="m-0 text-xs text-[color:var(--pr-texto-3)]">
          Para lo que no cabe en las 10 vistas: una lesión, un frenillo, una fractura… Puedes elegir varias a la vez.
        </p>
      ) : null}
    </div>
  );
}
