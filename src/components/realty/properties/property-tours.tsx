"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import { ExternalLink, ImagePlus, Link2, Loader2, Play, Trash2, View } from "lucide-react";
import type { RealtyPropertyTourDTO } from "@/lib/realty/types";
import { REALTY_TOUR_KIND_LABELS } from "@/lib/realty/types";
import {
  REALTY_TOUR_PROVIDERS,
  checkRealtyTourUrl,
  realtyTourEmbedUrl,
  realtyTourProviderLabel,
} from "@/lib/realty/tours";
import { RealtyTourEmbed } from "@/components/realty/tours/tour-embed";
import type { RealtyStorageUsage } from "@/lib/realty/properties-shared";
import { apiCall, Field, formatBytes, styles as s, useRealtyT } from "./ui";
import { ImagenNoLegible, ImagenPesada, pareceEquirectangular, prepararPanoramica } from "./image";

/**
 * Recorridos virtuales — el diferenciador del vertical.
 *
 * Dos caminos en la misma pantalla:
 *   1. PEGAR UNA LIGA (cero storage). El proveedor se DETECTA solo con la
 *      allowlist única de src/lib/realty/tours.ts. Una liga fuera de la
 *      lista se rechaza diciendo cuáles sí entran.
 *   2. SUBIR PANORÁMICAS PROPIAS. Esas sí ocupan cupo y se ven en el visor
 *      de la casa (pano-viewer, sobre three).
 *
 * 🔴 EL IFRAME NO SE CARGA DE ENTRADA. Un Matterport son varios megabytes
 * de JavaScript y WebGL: con dos o tres recorridos, abrir la ficha en un
 * celular se vuelve inusable. Por eso cada recorrido enseña una PORTADA con
 * botón de reproducir y el <iframe> se monta al pulsarlo. Además va con
 * sandbox y loading="lazy".
 *
 * 🔴 Si un recorrido sale EN BLANCO sin error en consola, es la CSP: el
 * dominio no está en src/lib/realty/tour-hosts.json (que es lo que arma el
 * frame-src en next.config.mjs). No es que el proveedor esté caído.
 */

const PanoViewer = dynamic(() => import("./pano-viewer"), {
  ssr: false,
  loading: () => (
    <div className={s.panoStage}>
      <div className={s.panoStatus}>
        <Loader2 size={16} className={s.spin} />
      </div>
    </div>
  ),
});

export interface PropertyToursProps {
  propertyId: string;
  tours: RealtyPropertyTourDTO[];
  usage: RealtyStorageUsage;
  canEdit: boolean;
  t: ReturnType<typeof useRealtyT>;
  onChanged: () => void;
}

export function PropertyTours({
  propertyId,
  tours,
  usage,
  canEdit,
  t,
  onChanged,
}: PropertyToursProps) {
  const [tab, setTab] = useState<"link" | "pano">("link");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const providerList = useMemo(
    () => REALTY_TOUR_PROVIDERS.map((p) => p.label).join(", "),
    [],
  );

  /**
   * Veredicto EN VIVO mientras el asesor pega.
   *
   * 🔴 Antes aquí solo se preguntaba por el dominio, y ese era el bug: una
   * liga de `matterport.com/discover/space/…` daba proveedor "Matterport",
   * habilitaba el botón, se guardaba… y en la ficha salía el marco gris.
   * Reconocer el dominio NO es lo mismo que poder embeberlo. Ahora se usa
   * el MISMO `checkRealtyTourUrl` que manda en el route handler, así que
   * lo que la pantalla habilita es exactamente lo que el servidor acepta.
   */
  const veredicto = useMemo(() => {
    const clean = url.trim();
    if (!clean) return null;
    // 🔴 NO SE JUZGA UNA URL A MEDIO ESCRIBIR. Sin esto, teclear "h" ya
    // pintaba el recuadro rojo con el párrafo largo de proveedores, ponía
    // el campo en aria-invalid y —lo peor— un lector de pantalla volvía a
    // leer los ~150 caracteres EN CADA TECLA. Hasta que no hay una URL
    // completa, el campo solo enseña su pista neutra.
    try {
      new URL(clean);
    } catch {
      return null;
    }
    return checkRealtyTourUrl(clean);
  }, [url]);
  const detected = veredicto?.provider ?? null;
  const puedeAgregar = veredicto?.ok === true;

  const embedded = tours.filter((x) => x.kind !== "PANO_PROPIA" && x.externalUrl);
  const panos = tours.filter((x) => x.kind === "PANO_PROPIA" && x.fileUrl);

  async function addLink() {
    const clean = url.trim();
    if (!clean) return;
    // La misma reja que deshabilita el botón, por si se llegó por el Enter.
    const check = checkRealtyTourUrl(clean);
    if (!check.ok) {
      toast.error(check.error ?? t("errors.badTourUrl"));
      return;
    }
    setAdding(true);
    try {
      await apiCall(`/api/realty/properties/${propertyId}/tours`, {
        method: "POST",
        json: { externalUrl: clean },
      });
      setUrl("");
      toast.success(t("tours.added"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.badTourUrl"));
    } finally {
      setAdding(false);
    }
  }

  async function uploadPanos(files: File[]) {
    if (files.length === 0) return;
    if (usage.full) {
      toast.error(
        t("storage.full", {
          used: formatBytes(usage.usedBytes),
          total: formatBytes(usage.quotaBytes),
        }),
      );
      return;
    }
    setUploading(true);
    let ok = 0;
    for (const file of files) {
      try {
        const looksRight = await pareceEquirectangular(file);
        if (!looksRight) {
          // No se bloquea: hay panorámicas legítimas que no son 2:1 exacto.
          // Pero se avisa, porque el 90 % de las veces es una foto normal.
          toast(t("tours.panoHint"), { icon: "📐" });
        }
        const ready = await prepararPanoramica(file);
        const form = new FormData();
        form.append("file", ready);
        const res = await fetch(`/api/realty/properties/${propertyId}/tours/pano`, {
          method: "POST",
          body: form,
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (!res.ok) {
          toast.error(json.error ?? t("errors.uploadFailed"));
          if (json.code === "STORAGE_FULL") break;
          continue;
        }
        ok += 1;
      } catch (e) {
        if (e instanceof ImagenPesada || e instanceof ImagenNoLegible) toast.error(e.message);
        else toast.error(t("errors.uploadFailed"));
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (ok > 0) {
      toast.success(t("tours.added"));
      onChanged();
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("tours.confirmDelete"))) return;
    try {
      await apiCall(`/api/realty/properties/${propertyId}/tours/${id}`, { method: "DELETE" });
      toast.success(t("tours.deleted"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    }
  }

  return (
    <div>
      {canEdit ? (
        <>
          <div className={s.tabs} role="tablist" aria-label={t("tours.title")}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "link"}
              className={`${s.tab} ${tab === "link" ? s.tabActive : ""}`}
              onClick={() => setTab("link")}
            >
              <Link2 size={13} />
              {t("tours.tabLink")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "pano"}
              className={`${s.tab} ${tab === "pano" ? s.tabActive : ""}`}
              onClick={() => setTab("pano")}
            >
              <ImagePlus size={13} />
              {t("tours.tabUpload")}
            </button>
          </div>

          {tab === "link" ? (
            <div style={{ display: "grid", gap: 10 }}>
              {/* El hint dice UNA de tres cosas, en este orden:
                  · la liga sirve      → "Detectamos Matterport"
                  · la liga NO sirve   → qué copiar, con el ejemplo (abajo)
                  · no hay nada escrito → la lista de proveedores
                  El caso del medio es el que faltaba: antes decía
                  "Detectamos Matterport" para una liga que Matterport se
                  niega a embeber, y el asesor la guardaba convencido. */}
              <Field
                label={t("tours.urlLabel")}
                htmlFor="tour-url"
                hint={
                  puedeAgregar && detected
                    ? t("tours.detected", { provider: detected.label })
                    : t("tours.providers", { list: providerList })
                }
              >
                <input
                  id="tour-url"
                  className={s.input}
                  type="url"
                  inputMode="url"
                  placeholder={t("tours.urlPlaceholder")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-invalid={veredicto ? !veredicto.ok : undefined}
                  aria-describedby={veredicto && !veredicto.ok ? "tour-url-error" : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && puedeAgregar && !adding) {
                      e.preventDefault();
                      void addLink();
                    }
                  }}
                />
              </Field>
              {veredicto && !veredicto.ok && veredicto.error ? (
                // `role="status"` y no `"alert"`: el mensaje cambia mientras
                // se termina de teclear el identificador, y `alert` es
                // assertive — interrumpiría al lector de pantalla en cada
                // cambio. Cortés basta: se anuncia en la primera pausa.
                <p id="tour-url-error" role="status" className={s.tourUrlError}>
                  {veredicto.error}
                </p>
              ) : null}
              <div>
                <button
                  type="button"
                  className={`${s.btn} realty-btn-primary`}
                  onClick={() => void addLink()}
                  disabled={adding || !puedeAgregar}
                >
                  {adding ? <Loader2 size={14} className={s.spin} /> : <Link2 size={14} />}
                  {adding ? t("tours.adding") : t("tours.add")}
                </button>
              </div>
            </div>
          ) : (
            <div>
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
                  void uploadPanos(Array.from(e.dataTransfer.files));
                }}
              >
                {uploading ? (
                  <>
                    <Loader2 size={22} className={s.spin} />
                    <span className={s.dropTitle}>{t("documents.uploading")}</span>
                  </>
                ) : (
                  <>
                    <View size={22} />
                    <span className={s.dropTitle}>{t("tours.panoDrop")}</span>
                    <span className={s.dropHint}>{t("tours.panoHint")}</span>
                  </>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(e) => void uploadPanos(Array.from(e.target.files ?? []))}
              />
            </div>
          )}
        </>
      ) : null}

      <div className={s.tourList} style={{ marginTop: 16 }}>
        {panos.length > 0 ? (
          <div className={s.tourItem}>
            <div className={s.tourHead}>
              <span className={s.tourInfo}>
                <View size={14} />
                <span className={s.tourName}>{REALTY_TOUR_KIND_LABELS.PANO_PROPIA}</span>
                <span className={s.hint}>{panos.length}</span>
              </span>
              {canEdit ? (
                <span className={s.rowActions}>
                  {panos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      className={s.iconBtn}
                      onClick={() => void remove(p.id)}
                      aria-label={`${t("tours.delete")} ${i + 1}`}
                      title={`${t("tours.panoScene", { n: i + 1 })} · ${t("tours.delete")}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
            <PanoLauncher panos={panos} t={t} />
          </div>
        ) : null}

        {embedded.map((tour) => (
          <TourFrame key={tour.id} tour={tour} t={t} canEdit={canEdit} onRemove={remove} />
        ))}

        {tours.length === 0 ? <p className={s.hint}>{t("tours.empty")}</p> : null}
      </div>
    </div>
  );
}

/** El visor 360 tampoco arranca solo: three se carga al pulsar. */
function PanoLauncher({
  panos,
  t,
}: {
  panos: RealtyPropertyTourDTO[];
  t: ReturnType<typeof useRealtyT>;
}) {
  const [open, setOpen] = useState(false);
  const scenes = panos
    .map((p) => ({ id: p.id, url: p.fileUrl ?? "" }))
    .filter((x) => !!x.url);

  if (!open) {
    return (
      <div className={s.tourStage}>
        <button type="button" className={s.tourPoster} onClick={() => setOpen(true)}>
          <span className={s.tourPlay}>
            <Play size={22} />
          </span>
          <span className={s.tourPosterLabel}>{t("tours.play")}</span>
          <span className={s.tourPosterHint}>{t("tours.playHint")}</span>
        </button>
      </div>
    );
  }

  return (
    <PanoViewer
      scenes={scenes}
      labels={{
        loading: t("tours.panoLoading"),
        unsupported: t("tours.panoUnsupported"),
        drag: t("tours.panoDrag"),
        scene: (n: number) => t("tours.panoScene", { n }),
      }}
    />
  );
}

function TourFrame({
  tour,
  t,
  canEdit,
  onRemove,
}: {
  tour: RealtyPropertyTourDTO;
  t: ReturnType<typeof useRealtyT>;
  canEdit: boolean;
  onRemove: (id: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const src = tour.externalUrl ? realtyTourEmbedUrl(tour.externalUrl) : null;

  return (
    <div className={s.tourItem}>
      <div className={s.tourHead}>
        <span className={s.tourInfo}>
          <View size={14} />
          <span className={s.tourName}>{realtyTourProviderLabel(tour.provider)}</span>
          <span className={s.hint}>{REALTY_TOUR_KIND_LABELS[tour.kind]}</span>
        </span>
        <span className={s.rowActions}>
          {tour.externalUrl ? (
            <a
              className={s.iconBtn}
              href={tour.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t("tours.openExternal")}
              title={t("tours.openExternal")}
            >
              <ExternalLink size={12} />
            </a>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={s.iconBtn}
              onClick={() => onRemove(tour.id)}
              aria-label={t("tours.delete")}
              title={t("tours.delete")}
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </span>
      </div>
      <div className={s.tourStage}>
        {playing && src ? (
          /* RealtyTourEmbed y no un <iframe> pelado: un marco de tercero que
             no carga NO avisa —ni error, ni onError, ni consola—, se queda
             en gris. Aquí el asesor ve el aviso y la liga para abrirla
             aparte, que es lo que le dice si el problema es la liga o la
             red. Es el MISMO componente que la web pública, para que lo que
             ve él sea lo que ve su cliente. */
          <RealtyTourEmbed
            src={src}
            href={tour.externalUrl ?? undefined}
            title={realtyTourProviderLabel(tour.provider)}
            className={s.tourFrame}
            avisoTitulo={t("tours.frameFailed")}
            avisoCuerpo={t("tours.frameFailedHint")}
            avisoAbrir={t("tours.openExternal")}
            avisoCerrar={t("tours.frameKeepWaiting")}
          />
        ) : (
          <button
            type="button"
            className={s.tourPoster}
            onClick={() => setPlaying(true)}
            disabled={!src}
          >
            <span className={s.tourPlay}>
              <Play size={22} />
            </span>
            {/* Sin `src` la liga guardada ya no se puede embeber (por
                ejemplo, un Matterport que no es el de Compartir, guardado
                antes de que esto se validara al pegar). El cartel dice QUÉ
                pasa y qué copiar, en vez del genérico de antes. */}
            <span className={s.tourPosterLabel}>
              {src ? t("tours.play") : t("tours.notEmbeddable")}
            </span>
            <span className={s.tourPosterHint}>
              {src ? t("tours.playHint") : t("tours.notEmbeddableHint")}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
