"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL EDITOR DE LA PÁGINA WEB DE LA BARBERÍA.

   Dos columnas: los controles a la izquierda, la página de verdad a la
   derecha. Lo que se escribe se ve al instante; lo que se publica se
   publica cuando la barbería lo dice.

   ── POR QUÉ NO HAY GUARDADO AUTOMÁTICO ────────────────────────────
   Esta página es PÚBLICA. Un autoguardado publicaría cada letra a
   medio escribir en el sitio que la barbería manda por WhatsApp a sus
   clientes. La vista previa ya da la respuesta inmediata; publicar es
   una decisión, y por eso es un botón.

   ── DOS GUARDADOS SEGUIDOS NO SE PISAN ────────────────────────────
   Solo hay una petición en vuelo a la vez. Si llega otra mientras la
   primera va en camino, se apunta como PENDIENTE y sale sola cuando la
   anterior contesta, ya con la versión nueva. Por eso apretar el botón
   dos veces rápido no puede producir un conflicto consigo mismo.

   ── Y DESDE OTRA PESTAÑA, TAMPOCO ─────────────────────────────────
   Cada guardado manda `version` (la que se cargó) y `base` (lo que esta
   pantalla tenía por publicado). El servidor FUSIONA campo por campo y
   solo devuelve 409 si las dos pestañas cambiaron LO MISMO a cosas
   distintas. Y hasta entonces hay salida: quedarse con lo del servidor,
   o volver a publicar lo propio encima.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeT, type Dictionary } from "@/i18n/t";
import {
  BARBER_WEB_ACCENTS,
  BARBER_WEB_DIAS,
  BARBER_WEB_TEMPLATE_DEFAULT,
  normalizarConfigBarberWeb,
  ordenDeSecciones,
  tieneHorario,
  type BarberWebAccentId,
  type BarberWebConfig,
  type BarberWebFuente,
  type BarberWebTemplateId,
} from "@/lib/barber/landing";
import { BARBER_WEB_MANIFEST_LIST, manifiestoBarberWeb } from "@/components/barber/templates/manifest";
import type {
  BarberWebBarbero,
  BarberWebData,
  BarberWebServicio,
  BarberWebShop,
} from "@/components/barber/templates/types";
import { Campo, CampoTexto, EditorSeccion, Interruptor, Panel, RanuraFoto, type TFn } from "./controles";
import { Compartir } from "./compartir";
import { MiniaturaPlantilla, VistaPrevia, type ModoVista } from "./vista-previa";
import { subirFoto } from "./imagen";
import "./editor.css";

export interface EditorProps {
  dict: Dictionary;
  shop: BarberWebShop;
  servicios: BarberWebServicio[];
  barberos: BarberWebBarbero[];
  template: string;
  config: unknown;
  version: number;
  publishedAtIso: string | null;
  urlPublica: string;
  /** true = la tabla barber_landing_configs todavía no existe en Supabase. */
  sinTabla?: boolean;
}

type Estado = "listo" | "guardando" | "guardado" | "error";

interface Conflicto {
  mensaje: string;
  campos: string[];
  version: number;
  template: string;
  config: BarberWebConfig;
}

export function EditorWebBarberia(props: EditorProps) {
  const t = useMemo<TFn>(() => {
    const tt = makeT(props.dict);
    return (k, vars) => tt(`barber.web.${k}`, vars);
  }, [props.dict]);

  const inicial = useMemo(() => normalizarConfigBarberWeb(props.config), [props.config]);

  const [config, setConfig] = useState<BarberWebConfig>(inicial);
  const [template, setTemplate] = useState<string>(props.template || BARBER_WEB_TEMPLATE_DEFAULT);
  const [sucio, setSucio] = useState(false);
  const [estado, setEstado] = useState<Estado>("listo");
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);
  const [modo, setModo] = useState<ModoVista>("movil");
  const [publicado, setPublicado] = useState<string | null>(props.publishedAtIso);
  const [fecha, setFecha] = useState<string | null>(null);
  const [abrePlantillas, setAbrePlantillas] = useState(false);

  /* `version` y `base` viven en refs: cambian dentro del guardado y no
     tienen que repintar nada. Meterlos en el estado provocaría que la
     petición en vuelo leyera valores viejos por el cierre. */
  const version = useRef(props.version);
  const base = useRef<{ template: string; config: BarberWebConfig }>({
    template: props.template || BARBER_WEB_TEMPLATE_DEFAULT,
    config: inicial,
  });
  const enVuelo = useRef(false);
  const pendiente = useRef(false);
  const actual = useRef({ config, template });
  actual.current = { config, template };

  /* La fecha se pinta DESPUÉS de montar: `toLocaleString` da un resultado
     distinto en el servidor (UTC) y en el navegador (zona de la barbería),
     y eso rompe la hidratación. */
  useEffect(() => {
    if (!publicado) {
      setFecha(null);
      return;
    }
    const d = new Date(publicado);
    setFecha(
      Number.isNaN(d.getTime())
        ? null
        : d.toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" }),
    );
  }, [publicado]);

  /* Aviso al salir con cambios sin publicar. Es lo único que impide que
     una tarde de trabajo se pierda al cerrar la pestaña. */
  useEffect(() => {
    if (!sucio) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  /* ── Cambios locales ─────────────────────────────────────────── */

  const cambiar = useCallback((f: (c: BarberWebConfig) => BarberWebConfig) => {
    setConfig((c) => f(c));
    setSucio(true);
    setEstado("listo");
  }, []);

  const setSeccion = useCallback(
    (id: string, parche: { visible?: boolean; titulo?: string; subtitulo?: string }) => {
      cambiar((c) => {
        const previo = c.secciones[id] ?? { visible: true, titulo: null, subtitulo: null };
        const nuevo = { ...previo };
        if (parche.visible !== undefined) nuevo.visible = parche.visible;
        // Vaciar el campo BORRA el valor: vuelve a salir el literal de la
        // plantilla. Guardar "" dejaría la sección con el título en blanco.
        if (parche.titulo !== undefined) nuevo.titulo = parche.titulo.trim() ? parche.titulo : null;
        if (parche.subtitulo !== undefined) {
          nuevo.subtitulo = parche.subtitulo.trim() ? parche.subtitulo : null;
        }
        return { ...c, secciones: { ...c.secciones, [id]: nuevo } };
      });
    },
    [cambiar],
  );

  const setCopia = useCallback(
    (clave: string, v: string) => {
      cambiar((c) => {
        const copia = { ...c.copia };
        if (v.trim()) copia[clave] = v;
        else delete copia[clave];
        return { ...c, copia };
      });
    },
    [cambiar],
  );

  const setFoto = useCallback(
    (slot: string, url: string | null) => {
      cambiar((c) => {
        const fotos = { ...c.fotos };
        if (url) fotos[slot] = url;
        else delete fotos[slot];
        return { ...c, fotos };
      });
    },
    [cambiar],
  );

  const moverSeccion = useCallback(
    (id: string, dir: -1 | 1) => {
      cambiar((c) => {
        const man = manifiestoBarberWeb(actual.current.template);
        const orden = ordenDeSecciones(man, c);
        const i = orden.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= orden.length) return c;
        const nuevo = [...orden];
        nuevo[i] = orden[j];
        nuevo[j] = orden[i];
        return { ...c, orden: { ...c.orden, [man.id]: nuevo } };
      });
    },
    [cambiar],
  );

  const elegirPlantilla = useCallback((id: BarberWebTemplateId) => {
    setTemplate(id);
    setSucio(true);
    setEstado("listo");
  }, []);

  /* ── Publicar ────────────────────────────────────────────────── */

  const publicar = useCallback(async () => {
    if (enVuelo.current) {
      // Ya hay una en camino: se apunta y sale sola al terminar aquella,
      // con la versión que devuelva. Así el doble clic no se pisa.
      pendiente.current = true;
      return;
    }
    enVuelo.current = true;
    setEstado("guardando");
    setError(null);
    setConflicto(null);

    const envio = { ...actual.current };

    try {
      const r = await fetch("/api/barber/landing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: version.current,
          template: envio.template,
          config: envio.config,
          base: base.current,
        }),
      });
      const j = await r.json().catch(() => ({}));

      if (r.status === 409) {
        setConflicto({
          mensaje: j?.error ?? t("conflictoTitulo"),
          campos: Array.isArray(j?.campos) ? j.campos : [],
          version: Number(j?.version ?? version.current),
          template: String(j?.template ?? envio.template),
          config: normalizarConfigBarberWeb(j?.config),
        });
        setEstado("error");
        return;
      }

      if (!r.ok) {
        setError(j?.error ?? t("errorGenerico"));
        setEstado("error");
        return;
      }

      version.current = Number(j.version);
      const guardado = normalizarConfigBarberWeb(j.config);
      const plantillaGuardada = String(j.template ?? envio.template);
      base.current = { template: plantillaGuardada, config: guardado };
      setPublicado(j.publishedAt ?? new Date().toISOString());

      /* El servidor pudo FUSIONAR con lo de otra pestaña, así que lo que
         quedó guardado no siempre es lo que se mandó. Se adopta lo
         guardado — pero solo si nadie siguió escribiendo mientras tanto:
         pisar la pantalla debajo de los dedos de quien escribe es peor
         que dejar la pantalla un guardado por delante. */
      if (!pendiente.current) {
        setConfig(guardado);
        setTemplate(plantillaGuardada);
        setSucio(false);
        setEstado("guardado");
      }
    } catch {
      setError(t("errorGenerico"));
      setEstado("error");
    } finally {
      enVuelo.current = false;
      if (pendiente.current) {
        pendiente.current = false;
        void publicar();
      }
    }
  }, [t]);

  const usarDelServidor = useCallback(() => {
    if (!conflicto) return;
    version.current = conflicto.version;
    base.current = { template: conflicto.template, config: conflicto.config };
    setConfig(conflicto.config);
    setTemplate(conflicto.template);
    setConflicto(null);
    setSucio(false);
    setEstado("listo");
  }, [conflicto]);

  const publicarLoMio = useCallback(() => {
    if (!conflicto) return;
    /* Se adopta la VERSIÓN y la BASE del servidor sin tocar lo que hay en
       pantalla: en la fusión siguiente, base == servidor para los campos
       en disputa, así que gana lo de esta pestaña. Nada se pierde de lo
       que el otro cambió y esta pestaña no tocó. */
    version.current = conflicto.version;
    base.current = { template: conflicto.template, config: conflicto.config };
    setConflicto(null);
    void publicar();
  }, [conflicto, publicar]);

  /* ── Datos para la vista previa ──────────────────────────────── */

  const manifest = useMemo(() => manifiestoBarberWeb(template), [template]);

  const data: BarberWebData = useMemo(
    () => ({
      shop: props.shop,
      config,
      manifest,
      servicios: props.servicios,
      barberos: props.barberos,
      editando: true,
    }),
    [props.shop, props.servicios, props.barberos, config, manifest],
  );

  const hayDatos = useCallback(
    (f: BarberWebFuente): boolean => {
      switch (f) {
        case "servicios":
          return props.servicios.length > 0;
        case "barberos":
          return props.barberos.length > 0;
        case "galeria":
          return config.galeria.length > 0;
        case "resenas":
          return config.resenas.length > 0;
        case "horario":
          return tieneHorario(config);
        default:
          return true;
      }
    },
    [props.servicios, props.barberos, config],
  );

  const orden = useMemo(() => ordenDeSecciones(manifest, config), [manifest, config]);
  const secciones = useMemo(
    () => orden.map((id) => manifest.secciones.find((s) => s.id === id)!).filter(Boolean),
    [orden, manifest],
  );
  const movibles = secciones.filter((s) => !s.obligatoria).map((s) => s.id);

  return (
    <div className="dcbwe">
      {/* ── Cabecera ───────────────────────────────────────────── */}
      <header className="dcbwe-cab">
        <div>
          <h1>{t("titulo")}</h1>
          <p className="dcbwe-ayuda">{t("subtitulo")}</p>
        </div>
        <div className="dcbwe-cab-acciones">
          <span className={`dcbwe-estado dcbwe-estado-${estado}`}>
            {estado === "guardando"
              ? t("guardando")
              : sucio
                ? t("cambiosSinGuardar")
                : fecha
                  ? t("publicadoEl", { fecha })
                  : publicado
                    ? t("sinCambios")
                    : t("nuncaPublicado")}
          </span>
          <a href={props.urlPublica} target="_blank" rel="noopener noreferrer" className="dcbwe-btn dcbwe-btn-texto">
            {t("verPagina")}
          </a>
          <button
            type="button"
            className="dcbwe-btn dcbwe-btn-primario"
            onClick={() => void publicar()}
            disabled={estado === "guardando" || (!sucio && !!publicado)}
          >
            {estado === "guardando" ? t("guardando") : t("guardar")}
          </button>
        </div>
      </header>

      {props.sinTabla && (
        <div className="dcbwe-alerta dcbwe-alerta-dura">
          <strong>{t("sinTablaTitulo")}</strong>
          <p>{t("sinTablaCuerpo")}</p>
        </div>
      )}

      {error && <div className="dcbwe-alerta dcbwe-alerta-dura">{error}</div>}

      {conflicto && (
        <div className="dcbwe-alerta">
          <strong>{t("conflictoTitulo")}</strong>
          <p>{conflicto.mensaje}</p>
          <div className="dcbwe-alerta-acciones">
            <button type="button" className="dcbwe-btn dcbwe-btn-suave" onClick={usarDelServidor}>
              {t("conflictoUsarServidor")}
            </button>
            <button type="button" className="dcbwe-btn dcbwe-btn-primario" onClick={publicarLoMio}>
              {t("conflictoReintentar")}
            </button>
          </div>
        </div>
      )}

      <div className="dcbwe-cuerpo">
        {/* ── Columna de controles ─────────────────────────────── */}
        <div className="dcbwe-controles">
          {/* Plantilla */}
          <Panel
            titulo={`${t("plantillaTitulo")} · ${manifest.nombre}`}
            ayuda={t("plantillaAyuda")}
            abierto={false}
            onToggle={setAbrePlantillas}
          >
            {/* Las ocho miniaturas son ocho plantillas COMPLETAS montadas a
                la vez. Se montan solo con el panel abierto: cerrado, el
                <details> las dejaría en el DOM ocupando memoria y trabajo
                de pintado para algo que nadie está mirando. */}
            <div className="dcbwe-plantillas">
              {BARBER_WEB_MANIFEST_LIST.map((m) => (
                <div
                  key={m.id}
                  className={`dcbwe-plantilla ${m.id === manifest.id ? "dcbwe-plantilla-activa" : ""}`}
                >
                  {abrePlantillas ? (
                    <MiniaturaPlantilla data={{ ...data, manifest: m }} />
                  ) : (
                    <div className="dcbwe-mini dcbwe-mini-hueco" />
                  )}
                  <div className="dcbwe-plantilla-txt">
                    <strong>{m.nombre}</strong>
                    <p>{m.para}</p>
                    <p className="dcbwe-plantilla-estructura">{m.estructura}</p>
                    {m.id === manifest.id ? (
                      <span className="dcbwe-pastilla">{t("plantillaActual")}</span>
                    ) : (
                      <button
                        type="button"
                        className="dcbwe-btn dcbwe-btn-suave"
                        onClick={() => elegirPlantilla(m.id)}
                      >
                        {t("plantillaUsar")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Acento */}
          <Panel titulo={t("acentoTitulo")} ayuda={t("acentoAyuda")}>
            <div className="dcbwe-acentos">
              {BARBER_WEB_ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`dcbwe-acento ${config.acento === a.id ? "dcbwe-acento-activo" : ""}`}
                  style={{ background: a.base }}
                  aria-label={a.nombre}
                  title={a.nombre}
                  aria-pressed={config.acento === a.id}
                  onClick={() => cambiar((c) => ({ ...c, acento: a.id as BarberWebAccentId }))}
                />
              ))}
            </div>
          </Panel>

          {/* Secciones — TODO esto sale del manifiesto */}
          <Panel titulo={t("seccionesTitulo")} ayuda={t("seccionesAyuda")} abierto>
            {secciones.map((s) => (
              <EditorSeccion
                key={s.id}
                t={t}
                seccion={s}
                config={config}
                hayDatos={hayDatos}
                primera={movibles[0] === s.id}
                ultima={movibles[movibles.length - 1] === s.id}
                onSeccion={setSeccion}
                onCopia={setCopia}
                onFoto={setFoto}
                onMover={moverSeccion}
              />
            ))}
          </Panel>

          {/* Portafolio */}
          <Panel titulo={t("galeriaTitulo")} ayuda={t("galeriaAyuda")}>
            <Galeria t={t} urls={config.galeria} onChange={(g) => cambiar((c) => ({ ...c, galeria: g }))} />
          </Panel>

          {/* Reseñas */}
          <Panel titulo={t("resenasTitulo")} ayuda={t("resenasAyuda")}>
            <Resenas t={t} items={config.resenas} onChange={(r) => cambiar((c) => ({ ...c, resenas: r }))} />
          </Panel>

          {/* Horario */}
          <Panel titulo={t("horarioTitulo")} ayuda={t("horarioAyuda")}>
            <Horario t={t} dias={config.horario} onChange={(h) => cambiar((c) => ({ ...c, horario: h }))} />
          </Panel>

          {/* Contacto y redes */}
          <Panel titulo={t("contactoTitulo")}>
            <CampoTexto
              etiqueta={t("contactoWhatsapp")}
              ayuda={t("contactoWhatsappAyuda")}
              valor={config.whatsapp}
              porDefecto="55 1234 5678"
              maxLen={20}
              onChange={(v) => cambiar((c) => ({ ...c, whatsapp: v || null }))}
            />
            <CampoTexto
              etiqueta={t("contactoInstagram")}
              valor={config.instagram}
              porDefecto="tubarberia"
              maxLen={80}
              onChange={(v) => cambiar((c) => ({ ...c, instagram: v || null }))}
            />
            <CampoTexto
              etiqueta={t("contactoFacebook")}
              valor={config.facebook}
              porDefecto="tubarberia"
              maxLen={120}
              onChange={(v) => cambiar((c) => ({ ...c, facebook: v || null }))}
            />
            <CampoTexto
              etiqueta={t("contactoTiktok")}
              valor={config.tiktok}
              porDefecto="tubarberia"
              maxLen={80}
              onChange={(v) => cambiar((c) => ({ ...c, tiktok: v || null }))}
            />
            <CampoTexto
              etiqueta={t("contactoMapa")}
              ayuda={t("contactoMapaAyuda")}
              valor={config.mapaEmbed}
              porDefecto="https://www.google.com/maps/embed?..."
              maxLen={2048}
              onChange={(v) => cambiar((c) => ({ ...c, mapaEmbed: v || null }))}
            />
          </Panel>

          {/* SEO */}
          <Panel titulo={t("seoTitulo")} ayuda={t("seoAyuda")}>
            <CampoTexto
              etiqueta={t("seoTituloCampo")}
              valor={config.seoTitulo}
              porDefecto={`${props.shop.name} — Barbería${props.shop.city ? ` en ${props.shop.city}` : ""}`}
              maxLen={70}
              onChange={(v) => cambiar((c) => ({ ...c, seoTitulo: v || null }))}
            />
            <CampoTexto
              etiqueta={t("seoDescripcion")}
              valor={config.seoDescripcion}
              porDefecto="Corte de cabello, barba y afeitado. Reserva tu cita en línea."
              maxLen={180}
              area
              onChange={(v) => cambiar((c) => ({ ...c, seoDescripcion: v || null }))}
            />
            <RanuraFoto
              t={t}
              nombre={t("seoImagen")}
              ayuda={t("seoImagenAyuda")}
              proporcion="1200 × 630"
              destino="og"
              url={config.ogImagen}
              onChange={(u) => cambiar((c) => ({ ...c, ogImagen: u }))}
            />
          </Panel>

          {/* Publicación y compartir */}
          <Panel titulo={t("publicacionTitulo")} abierto>
            <p className="dcbwe-ayuda">
              {config.oculta ? t("publicacionOculta") : t("publicacionVisible")}
            </p>
            <Interruptor
              etiqueta={config.oculta ? t("publicacionEncender") : t("publicacionApagar")}
              activo={!config.oculta}
              onChange={(v) => cambiar((c) => ({ ...c, oculta: !v }))}
            />
            <Compartir t={t} url={props.urlPublica} slug={props.shop.slug} />
          </Panel>
        </div>

        {/* ── Columna de vista previa ──────────────────────────── */}
        <div className="dcbwe-previa">
          <div className="dcbwe-previa-cab">
            <span className="dcbwe-etiqueta">{t("vistaTitulo")}</span>
            <div className="dcbwe-modos" role="group" aria-label={t("vistaTitulo")}>
              <button
                type="button"
                className={`dcbwe-modo ${modo === "movil" ? "dcbwe-modo-activo" : ""}`}
                aria-pressed={modo === "movil"}
                onClick={() => setModo("movil")}
              >
                {t("vistaMovil")}
              </button>
              <button
                type="button"
                className={`dcbwe-modo ${modo === "escritorio" ? "dcbwe-modo-activo" : ""}`}
                aria-pressed={modo === "escritorio"}
                onClick={() => setModo("escritorio")}
              >
                {t("vistaEscritorio")}
              </button>
            </div>
          </div>
          <VistaPrevia data={data} modo={modo} />
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Portafolio
   ══════════════════════════════════════════════════════════════ */

function Galeria({
  t,
  urls,
  onChange,
}: {
  t: TFn;
  urls: string[];
  onChange: (v: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [peso, setPeso] = useState<string | null>(null);

  async function agregar(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSubiendo(true);
    setAviso(null);
    const nuevas: string[] = [];
    let total = 0;
    // En serie y no en paralelo: son fotos de celular y varias subidas a
    // la vez en una red de datos se estorban entre ellas.
    for (const f of Array.from(files)) {
      try {
        const r = await subirFoto(f, "galeria");
        nuevas.push(r.url);
        total += r.bytes;
      } catch (e) {
        setAviso((e as Error)?.message ?? t("errorGenerico"));
      }
    }
    if (nuevas.length > 0) {
      onChange([...urls, ...nuevas]);
      setPeso(
        total >= 1024 * 1024 ? `${(total / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(total / 1024)} KB`,
      );
    }
    setSubiendo(false);
    if (input.current) input.current.value = "";
  }

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= urls.length) return;
    const c = [...urls];
    c[i] = urls[j];
    c[j] = urls[i];
    onChange(c);
  }

  return (
    <div>
      <div className="dcbwe-galeria">
        {urls.map((u, i) => (
          <figure key={`${u}-${i}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" />
            <figcaption>
              <button
                type="button"
                className="dcbwe-btn dcbwe-btn-icono"
                aria-label={`${t("galeriaMover")} ←`}
                onClick={() => mover(i, -1)}
                disabled={i === 0}
              >
                ←
              </button>
              <button
                type="button"
                className="dcbwe-btn dcbwe-btn-icono"
                aria-label={`${t("galeriaMover")} →`}
                onClick={() => mover(i, 1)}
                disabled={i === urls.length - 1}
              >
                →
              </button>
              <button
                type="button"
                className="dcbwe-btn dcbwe-btn-icono"
                aria-label={t("galeriaQuitar")}
                onClick={() => onChange(urls.filter((_, k) => k !== i))}
              >
                ×
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
      {urls.length === 0 && <p className="dcbwe-ayuda">{t("galeriaVacia")}</p>}
      {peso && <p className="dcbwe-ayuda">{t("fotoPeso", { peso })}</p>}
      {aviso && <p className="dcbwe-error">{aviso}</p>}
      <button
        type="button"
        className="dcbwe-btn dcbwe-btn-suave"
        onClick={() => input.current?.click()}
        disabled={subiendo}
      >
        {subiendo ? t("fotoSubiendo") : t("galeriaAgregar")}
      </button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => agregar(e.target.files)} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Reseñas
   ══════════════════════════════════════════════════════════════ */

function Resenas({
  t,
  items,
  onChange,
}: {
  t: TFn;
  items: BarberWebConfig["resenas"];
  onChange: (v: BarberWebConfig["resenas"]) => void;
}) {
  function editar(i: number, parche: Partial<BarberWebConfig["resenas"][number]>) {
    onChange(items.map((r, k) => (k === i ? { ...r, ...parche } : r)));
  }
  return (
    <div>
      {items.length === 0 && <p className="dcbwe-ayuda">{t("resenasVacia")}</p>}
      {items.map((r, i) => (
        <div key={i} className="dcbwe-resena">
          <CampoTexto
            etiqueta={t("resenaNombre")}
            valor={r.nombre}
            maxLen={80}
            onChange={(v) => editar(i, { nombre: v })}
          />
          <CampoTexto
            etiqueta={t("resenaTexto")}
            valor={r.texto}
            maxLen={600}
            area
            onChange={(v) => editar(i, { texto: v })}
          />
          <div className="dcbwe-resena-pie">
            <Campo etiqueta={t("resenaEstrellas")}>
              <select
                className="dcbwe-input"
                value={r.estrellas}
                onChange={(e) => editar(i, { estrellas: Number(e.target.value) })}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {"★".repeat(n)}
                  </option>
                ))}
              </select>
            </Campo>
            <button
              type="button"
              className="dcbwe-btn dcbwe-btn-texto"
              onClick={() => onChange(items.filter((_, k) => k !== i))}
            >
              {t("resenaQuitar")}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="dcbwe-btn dcbwe-btn-suave"
        onClick={() => onChange([...items, { nombre: "", texto: "", estrellas: 5 }])}
      >
        {t("resenasAgregar")}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Horario
   ══════════════════════════════════════════════════════════════ */

function Horario({
  t,
  dias,
  onChange,
}: {
  t: TFn;
  dias: BarberWebConfig["horario"];
  onChange: (v: BarberWebConfig["horario"]) => void;
}) {
  const porDia = new Map(dias.map((d) => [d.dia, d]));
  const filas = BARBER_WEB_DIAS.map((etiqueta, i) => ({
    etiqueta,
    d: porDia.get(i) ?? { dia: i, abierto: false, desde: "09:00", hasta: "20:00" },
  }));

  function editar(dia: number, parche: Partial<BarberWebConfig["horario"][number]>) {
    const base = filas.map((f) => f.d);
    onChange(base.map((d) => (d.dia === dia ? { ...d, ...parche } : d)));
  }

  return (
    <div className="dcbwe-horario">
      {filas.map(({ etiqueta, d }) => (
        <div key={d.dia} className={`dcbwe-horario-fila ${d.abierto ? "" : "dcbwe-horario-cerrado"}`}>
          <Interruptor
            etiqueta={etiqueta}
            activo={d.abierto}
            onChange={(v) => editar(d.dia, { abierto: v })}
          />
          <div className="dcbwe-horario-horas">
            <input
              type="time"
              className="dcbwe-input"
              value={d.desde}
              disabled={!d.abierto}
              aria-label={`${etiqueta} · ${t("horarioDesde")}`}
              onChange={(e) => editar(d.dia, { desde: e.target.value })}
            />
            <span aria-hidden>–</span>
            <input
              type="time"
              className="dcbwe-input"
              value={d.hasta}
              disabled={!d.abierto}
              aria-label={`${etiqueta} · ${t("horarioHasta")}`}
              onChange={(e) => editar(d.dia, { hasta: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

