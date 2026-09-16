"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Copy, ExternalLink, Tv, Save } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { RaizPequenas } from "./raiz";
import { Boton, BotonIcono, Cabecera, Campo, Cargando, Etiqueta, Modal, Vacio, estilos as s } from "./piezas";

/**
 * Pantallas TV (la lista de administración del panel), vestida con el
 * lenguaje del menú de dos niveles.
 *
 * ⛔ Esto NO es la pantalla pública `/tv/[slug]` que se ve en la tele a tres
 * metros: esa no se toca. Aquí solo está la lista de pantallas y su
 * formulario, que se usan desde una computadora.
 *
 * Los DATOS siguen viviendo en `TvModesClient` (la misma llamada a
 * /api/tv-displays de siempre); esto pinta lo que le llega y devuelve los
 * mismos eventos: crear, editar, borrar, activar/desactivar, copiar la URL y
 * abrirla. Mismos botones, mismos clics, todo a la vista.
 *
 * Los tipos se declaran aquí igual que en el cliente de siempre (que no los
 * exporta y no se toca): son la forma de la respuesta de la API.
 */
export interface PantallaTv {
  id: string;
  name: string;
  mode: "OPERATIONAL" | "MARKETING" | "HYBRID";
  config: ConfigPantallaTv;
  publicSlug: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigPantallaTv {
  promotions?: Array<{ title: string; description: string; durationSec: number }>;
  testimonials?: Array<{ author: string; text: string }>;
  showWaitTimes?: boolean;
  brandLogo?: string | null;
  brandColor?: string | null;
}

type Modo = PantallaTv["mode"];

const CLAVES_MODO: Record<Modo, string> = {
  OPERATIONAL: "pages.tvModes.modeOperationalLabel",
  MARKETING: "pages.tvModes.modeMarketingLabel",
  HYBRID: "pages.tvModes.modeHybridLabel",
};

const CLAVES_DESCRIPCION_MODO: Record<Modo, string> = {
  OPERATIONAL: "pages.tvModes.modeOperationalDesc",
  MARKETING: "pages.tvModes.modeMarketingDesc",
  HYBRID: "pages.tvModes.modeHybridDesc",
};

const CONFIG_VACIA: ConfigPantallaTv = {
  promotions: [],
  testimonials: [],
  showWaitTimes: true,
  brandLogo: null,
  brandColor: null,
};

export function TvModesRediseno({
  displays,
  loading,
  creating,
  editing,
  onNueva,
  onEditar,
  onCerrar,
  onGuardado,
  onBorrar,
  onAlternar,
  onCopiar,
}: {
  displays: PantallaTv[];
  loading: boolean;
  creating: boolean;
  editing: PantallaTv | null;
  onNueva: () => void;
  onEditar: (d: PantallaTv) => void;
  onCerrar: () => void;
  onGuardado: () => void;
  onBorrar: (d: PantallaTv) => void;
  onAlternar: (d: PantallaTv) => void;
  onCopiar: (slug: string) => void;
}) {
  const t = useT();

  return (
    <RaizPequenas ancho="medio">
      <Cabecera
        icono={<Tv size={18} strokeWidth={1.75} />}
        titulo={t("pages.tvModes.title")}
        subtitulo={t("pages.tvModes.subtitle")}
        acciones={
          <Boton principal onClick={onNueva}>
            <Plus size={15} strokeWidth={2} aria-hidden /> {t("pages.tvModes.createScreen")}
          </Boton>
        }
      />

      {loading ? (
        <Cargando texto={t("common.loading")} />
      ) : displays.length === 0 ? (
        <Vacio
          icono={<Tv size={20} strokeWidth={1.75} />}
          titulo={t("pages.tvModes.emptyTitle")}
          pista={t("pages.tvModes.emptyDesc")}
        >
          <Boton principal onClick={onNueva}>{t("pages.tvModes.createFirstScreen")}</Boton>
        </Vacio>
      ) : (
        <div className={s.lista}>
          {displays.map((d) => (
            <article key={d.id} className={`${s.tarjeta} ${d.active ? "" : s.tarjetaApagada}`.trim()}>
              <div className={s.tarjetaCuerpo}>
                <div className={s.tarjetaCabeza}>
                  <div className={s.tarjetaTextos}>
                    <div className={s.tarjetaTituloFila}>
                      <h3 className={s.tarjetaTitulo}>{d.name}</h3>
                      {!d.active && <Etiqueta tono="neutra">{t("pages.tvModes.inactiveBadge")}</Etiqueta>}
                    </div>
                    <p className={s.tarjetaSub}>
                      {t(CLAVES_MODO[d.mode])} · {t(CLAVES_DESCRIPCION_MODO[d.mode])}
                    </p>
                  </div>
                  <div className={s.tarjetaAcciones}>
                    <BotonIcono etiqueta={t("common.edit")} onClick={() => onEditar(d)}>
                      <Pencil size={14} strokeWidth={1.75} aria-hidden />
                    </BotonIcono>
                    <BotonIcono etiqueta={t("common.delete")} onClick={() => onBorrar(d)} peligro>
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                    </BotonIcono>
                  </div>
                </div>

                <div className={s.codigo}>
                  <span className={s.codigoTexto}>/tv/{d.publicSlug}</span>
                  <BotonIcono etiqueta={t("pages.tvModes.copyPublicUrl")} onClick={() => onCopiar(d.publicSlug)} peq>
                    <Copy size={12} strokeWidth={1.75} aria-hidden />
                  </BotonIcono>
                  <BotonIcono etiqueta={t("pages.tvModes.openPublicView")} href={`/tv/${d.publicSlug}`} peq>
                    <ExternalLink size={12} strokeWidth={1.75} aria-hidden />
                  </BotonIcono>
                </div>

                <button
                  type="button"
                  onClick={() => onAlternar(d)}
                  className={`${s.enlace} ${d.active ? s.enlacePeligro : s.enlaceExito}`}
                >
                  {d.active ? t("pages.tvModes.deactivate") : t("pages.tvModes.activate")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {creating && <FormularioPantallaTv onCerrar={onCerrar} onGuardado={onGuardado} />}
      {editing && <FormularioPantallaTv display={editing} onCerrar={onCerrar} onGuardado={onGuardado} />}
    </RaizPequenas>
  );
}

/**
 * El formulario de crear/editar: los MISMOS campos que hoy (nombre, modo,
 * color y logo de marca, promociones, tiempos de espera), contra los mismos
 * endpoints. No hay ningún campo que el panel no tenga ya.
 */
function FormularioPantallaTv({
  display,
  onCerrar,
  onGuardado,
}: {
  display?: PantallaTv;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(display?.name ?? "");
  const [mode, setMode] = useState<Modo>(display?.mode ?? "OPERATIONAL");
  const [config, setConfig] = useState<ConfigPantallaTv>(display?.config ?? CONFIG_VACIA);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error(t("pages.tvModes.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(display ? `/api/tv-displays/${display.id}` : "/api/tv-displays", {
        method: display ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mode, config }),
      });
      if (!res.ok) throw new Error();
      toast.success(display ? t("pages.tvModes.updated") : t("pages.tvModes.created"));
      onGuardado();
    } catch {
      toast.error(t("pages.tvModes.saveError"));
    } finally {
      setSaving(false);
    }
  }

  function addPromo() {
    setConfig({
      ...config,
      promotions: [...(config.promotions ?? []), { title: "", description: "", durationSec: 8 }],
    });
  }
  function removePromo(idx: number) {
    setConfig({ ...config, promotions: (config.promotions ?? []).filter((_, i) => i !== idx) });
  }
  function patchPromo(idx: number, cambio: Partial<{ title: string; description: string; durationSec: number }>) {
    const promos = [...(config.promotions ?? [])];
    promos[idx] = { ...promos[idx]!, ...cambio };
    setConfig({ ...config, promotions: promos });
  }

  const promociones = config.promotions ?? [];

  return (
    <Modal
      tituloId="tv-modal-title"
      titulo={display ? t("pages.tvModes.editTitle", { name: display.name }) : t("pages.tvModes.newScreenTitle")}
      etiquetaCerrar={t("common.close")}
      onCerrar={onCerrar}
      pie={
        <>
          <Boton suave onClick={onCerrar}>{t("common.cancel")}</Boton>
          <Boton principal onClick={save} disabled={saving}>
            <Save size={14} strokeWidth={1.75} aria-hidden />
            {saving ? t("common.saving") : display ? t("common.update") : t("common.create")}
          </Boton>
        </>
      }
    >
      <Campo etiqueta={t("common.name")}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("pages.tvModes.namePlaceholder")}
          className={`${s.entrada} ${s.entradaAncha}`}
        />
      </Campo>

      <Campo etiqueta={t("pages.tvModes.modeLabel")} ayuda={t(CLAVES_DESCRIPCION_MODO[mode])}>
        <select value={mode} onChange={(e) => setMode(e.target.value as Modo)} className={`${s.entrada} ${s.entradaAncha}`}>
          <option value="OPERATIONAL">{t("pages.tvModes.modeOperationalLabel")}</option>
          <option value="MARKETING">{t("pages.tvModes.modeMarketingLabel")}</option>
          <option value="HYBRID">{t("pages.tvModes.modeHybridLabel")}</option>
        </select>
      </Campo>

      {(mode === "MARKETING" || mode === "HYBRID") && (
        <>
          <Campo etiqueta={t("pages.tvModes.brandColorLabel")}>
            <input
              type="text"
              value={config.brandColor ?? ""}
              onChange={(e) => setConfig({ ...config, brandColor: e.target.value })}
              placeholder="#7c3aed"
              className={`${s.entrada} ${s.entradaAncha}`}
            />
          </Campo>
          <Campo etiqueta={t("pages.tvModes.brandLogoLabel")}>
            <input
              type="url"
              value={config.brandLogo ?? ""}
              onChange={(e) => setConfig({ ...config, brandLogo: e.target.value })}
              placeholder="https://…"
              className={`${s.entrada} ${s.entradaAncha}`}
            />
          </Campo>
          <div>
            <div className={s.campoFila}>
              <span className={s.campoEtiqueta}>{t("pages.tvModes.promotionsLabel")}</span>
              <button type="button" onClick={addPromo} className={`${s.enlace} ${s.enlaceActivo}`}>
                <Plus size={12} strokeWidth={2} aria-hidden /> {t("common.add")}
              </button>
            </div>
            {promociones.map((p, idx) => (
              <div key={idx} className={s.rejillaPromo}>
                <input
                  type="text"
                  value={p.title}
                  onChange={(e) => patchPromo(idx, { title: e.target.value })}
                  placeholder={t("pages.tvModes.promoTitlePlaceholder")}
                  className={s.entrada}
                />
                <input
                  type="text"
                  value={p.description}
                  onChange={(e) => patchPromo(idx, { description: e.target.value })}
                  placeholder={t("common.description")}
                  className={s.entrada}
                />
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={p.durationSec}
                  onChange={(e) => patchPromo(idx, { durationSec: Number(e.target.value) || 8 })}
                  placeholder={t("pages.tvModes.promoSecPlaceholder")}
                  className={s.entrada}
                />
                <BotonIcono etiqueta={t("pages.tvModes.removePromo")} onClick={() => removePromo(idx)} peligro>
                  <Trash2 size={12} strokeWidth={1.75} aria-hidden />
                </BotonIcono>
              </div>
            ))}
            {promociones.length === 0 && (
              <div className={s.campoAyuda} style={{ padding: 8, textAlign: "center" }}>
                {t("pages.tvModes.noPromotions")}
              </div>
            )}
          </div>
        </>
      )}

      {mode === "HYBRID" && (
        <Campo etiqueta={t("pages.tvModes.showWaitTimesLabel")}>
          <span className={s.casilla}>
            <input
              type="checkbox"
              checked={config.showWaitTimes ?? true}
              onChange={(e) => setConfig({ ...config, showWaitTimes: e.target.checked })}
            />
            {t("pages.tvModes.showWaitTimesCheckbox")}
          </span>
        </Campo>
      )}
    </Modal>
  );
}
