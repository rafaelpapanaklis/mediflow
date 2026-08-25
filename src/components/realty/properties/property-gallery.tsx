"use client";

import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import { GripVertical, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import type { RealtyPropertyPhotoDTO } from "@/lib/realty/types";
import type { RealtyStorageUsage } from "@/lib/realty/properties-shared";
import { apiCall, formatBytes, styles as s, useRealtyT } from "./ui";
import { ImagenNoLegible, ImagenPesada, prepararFoto } from "./image";

/**
 * Galería del inmueble: subir arrastrando, reordenar arrastrando, marcar
 * portada y borrar.
 *
 * ── REORDENAR SIN DEPENDENCIAS ─────────────────────────────────────────
 * `@dnd-kit/sortable` NO está instalado (solo core y utilities, que la
 * agenda usa para otra cosa) y `package.json` no es un archivo del
 * vertical. Así que el arrastre es HTML5 nativo, calcando el patrón que ya
 * funciona en el panel dental (resources-manager): se reordena en memoria
 * mientras se arrastra y se persiste UNA vez al soltar. Si el guardado
 * falla, se vuelve al orden anterior — no se deja al asesor creyendo que
 * quedó algo que no quedó.
 *
 * ── SE SUBE DE UNA EN UNA ──────────────────────────────────────────────
 * A propósito, no por simplicidad: son fotos de celular y media docena
 * subiendo a la vez por datos móviles se estorban entre ellas. Además, en
 * serie el contador de cupo del servidor va cuadrando foto a foto en vez de
 * competir consigo mismo.
 */

export interface PropertyGalleryProps {
  propertyId: string;
  photos: RealtyPropertyPhotoDTO[];
  usage: RealtyStorageUsage;
  canEdit: boolean;
  hasLogo: boolean;
  t: ReturnType<typeof useRealtyT>;
  onChanged: () => void;
}

export function PropertyGallery({
  propertyId,
  photos,
  usage,
  canEdit,
  hasLogo,
  t,
  onChanged,
}: PropertyGalleryProps) {
  const [items, setItems] = useState<RealtyPropertyPhotoDTO[]>(photos);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [watermark, setWatermark] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const beforeDragRef = useRef<RealtyPropertyPhotoDTO[] | null>(null);

  // El padre vuelve a montar la sección tras router.refresh(); mientras
  // tanto se trabaja sobre la copia local para que la UI no dé saltos.
  const sync = useCallback((next: RealtyPropertyPhotoDTO[]) => setItems(next), []);

  async function uploadFiles(files: File[]) {
    if (!canEdit || files.length === 0) return;
    if (usage.full) {
      toast.error(
        t("storage.full", {
          used: formatBytes(usage.usedBytes),
          total: formatBytes(usage.quotaBytes),
        }),
      );
      return;
    }

    setBusy({ done: 0, total: files.length });
    let uploaded = 0;
    for (let i = 0; i < files.length; i++) {
      setBusy({ done: i, total: files.length });
      const file = files[i];
      try {
        const ready = await prepararFoto(file);
        const form = new FormData();
        form.append("file", ready);
        form.append("watermark", watermark ? "1" : "0");
        const res = await fetch(`/api/realty/properties/${propertyId}/photos`, {
          method: "POST",
          body: form,
        });
        const json = (await res.json().catch(() => ({}))) as {
          photo?: RealtyPropertyPhotoDTO;
          error?: string;
          code?: string;
        };
        if (!res.ok) {
          toast.error(json.error ?? t("errors.uploadFailed"));
          // Sin cupo, el resto de la tanda rebotaría igual: se corta.
          if (json.code === "STORAGE_FULL") break;
          continue;
        }
        if (json.photo) {
          uploaded += 1;
          sync([...items, json.photo]);
        }
      } catch (e) {
        if (e instanceof ImagenPesada || e instanceof ImagenNoLegible) toast.error(e.message);
        else toast.error(t("errors.uploadFailed"));
      }
    }
    setBusy(null);
    if (uploaded > 0) {
      toast.success(t("gallery.uploaded", { count: uploaded }));
      onChanged();
    }
  }

  function pickFiles(list: FileList | null) {
    if (!list) return;
    void uploadFiles(Array.from(list));
    // Sin esto, elegir la MISMA foto dos veces seguidas no dispara change.
    if (inputRef.current) inputRef.current.value = "";
  }

  // ── Reordenar ────────────────────────────────────────────────────────
  function moveTo(to: number) {
    if (dragIndex === null || dragIndex === to) return;
    const next = items.slice();
    const [moved] = next.splice(dragIndex, 1);
    if (moved) next.splice(to, 0, moved);
    setItems(next.map((p, i) => ({ ...p, sortOrder: i })));
    setDragIndex(to);
  }

  async function commitOrder() {
    const before = beforeDragRef.current;
    beforeDragRef.current = null;
    if (!before) return;
    const ids = items.map((p) => p.id);
    // Nada cambió: no se molesta al servidor.
    if (before.length === ids.length && before.every((p, i) => p.id === ids[i])) return;
    try {
      await apiCall(`/api/realty/properties/${propertyId}/photos/order`, {
        method: "PATCH",
        json: { ids },
      });
      toast.success(t("gallery.orderSaved"));
      onChanged();
    } catch (e) {
      setItems(before); // vuelta atrás: el orden guardado sigue siendo el viejo
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    }
  }

  async function setCover(id: string) {
    try {
      await apiCall(`/api/realty/properties/${propertyId}/photos/${id}`, {
        method: "PATCH",
        json: { isCover: true },
      });
      setItems((prev) => prev.map((p) => ({ ...p, isCover: p.id === id })));
      toast.success(t("gallery.coverSaved"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("gallery.confirmDelete"))) return;
    try {
      await apiCall(`/api/realty/properties/${propertyId}/photos/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((p) => p.id !== id));
      toast.success(t("gallery.deleted"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    }
  }

  const pct = Math.round(usage.percent);

  return (
    <div>
      {canEdit ? (
        <>
          <div
            className={`${s.dropZone} ${dragOver ? s.dropZoneActive : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
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
              pickFiles(e.dataTransfer.files);
            }}
          >
            {busy ? (
              <>
                <Loader2 size={22} className={s.spin} />
                <span className={s.dropTitle}>
                  {t("gallery.uploading", { done: busy.done + 1, total: busy.total })}
                </span>
              </>
            ) : (
              <>
                <ImagePlus size={22} />
                <span className={s.dropTitle}>{t("gallery.drop")}</span>
                <span className={s.dropHint}>{t("gallery.dropHint")}</span>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => pickFiles(e.target.files)}
          />

          <label
            className={s.checkRow}
            style={{ marginTop: 12 }}
            title={hasLogo ? undefined : t("gallery.watermarkNoLogo")}
          >
            <input
              type="checkbox"
              checked={watermark && hasLogo}
              disabled={!hasLogo}
              onChange={(e) => setWatermark(e.target.checked)}
            />
            <span className={s.checkBody}>
              <span className={s.checkTitle}>{t("gallery.watermark")}</span>
              <span className={s.hint} style={{ display: "block" }}>
                {hasLogo ? t("gallery.watermarkHint") : t("gallery.watermarkNoLogo")}
              </span>
            </span>
          </label>

          <div className={s.quota}>
            <div className={s.quotaTop}>
              <span>{t("storage.label")}</span>
              <span>
                {usage.isUnlimited
                  ? t("storage.unlimited")
                  : t("storage.used", {
                      used: formatBytes(usage.usedBytes),
                      total: formatBytes(usage.quotaBytes),
                    })}
              </span>
            </div>
            {!usage.isUnlimited ? (
              <div className={s.quotaBar}>
                <div
                  className={`${s.quotaFill} ${
                    usage.full ? s.quotaFillFull : usage.nearLimit ? s.quotaFillWarn : ""
                  }`}
                  style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                />
              </div>
            ) : null}
          </div>

          {!usage.isUnlimited && usage.nearLimit ? (
            <div
              className={`${s.notice} ${usage.full ? s.noticeDanger : s.noticeWarn}`}
              style={{ marginTop: 10 }}
            >
              <span>
                {usage.full
                  ? t("storage.full", {
                      used: formatBytes(usage.usedBytes),
                      total: formatBytes(usage.quotaBytes),
                    })
                  : t("storage.near", { percent: pct })}
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {items.length === 0 ? (
        <p className={s.hint} style={{ marginTop: 14 }}>
          {t("gallery.empty")}
        </p>
      ) : (
        <>
          {canEdit ? (
            <p className={s.hint} style={{ marginTop: 14 }}>
              {t("gallery.reorderHint")}
            </p>
          ) : null}
          <div className={s.photoGrid}>
            {items.map((photo, i) => (
              <div
                key={photo.id}
                className={`${s.photo} ${dragIndex === i ? s.photoDragging : ""}`}
                draggable={canEdit}
                onDragStart={() => {
                  beforeDragRef.current = items.slice();
                  setDragIndex(i);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  moveTo(i);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  void commitOrder();
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={s.photoImg} src={photo.url} alt="" loading="lazy" />
                {photo.isCover ? <span className={s.photoCover}>{t("gallery.cover")}</span> : null}
                {canEdit ? (
                  <>
                    <span className={s.photoHandle} aria-hidden="true">
                      <GripVertical size={13} />
                    </span>
                    <div className={s.photoBar}>
                      <button
                        type="button"
                        className={`${s.photoBtn} ${photo.isCover ? s.photoBtnOn : ""}`}
                        onClick={() => void setCover(photo.id)}
                        disabled={photo.isCover}
                        aria-label={t("gallery.setCover")}
                        title={t("gallery.setCover")}
                      >
                        <Star size={12} />
                      </button>
                      <button
                        type="button"
                        className={s.photoBtn}
                        onClick={() => void remove(photo.id)}
                        aria-label={t("gallery.delete")}
                        title={t("gallery.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
