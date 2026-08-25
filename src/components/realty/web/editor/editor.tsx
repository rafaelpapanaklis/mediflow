"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL EDITOR DE LA WEB PÚBLICA (/inmobiliaria/mi-web).

   ── GUARDAR ES UNA DECISIÓN, NO UN AUTOGUARDADO ──────────────────
   Esta página es PÚBLICA. Un autoguardado publicaría cada letra a medio
   escribir en el sitio que la inmobiliaria manda por WhatsApp a sus
   clientes y que Google tiene indexado. La vista previa ya da la respuesta
   inmediata; publicar es un botón.

   ── UNA PETICIÓN EN VUELO, Y LAS PENDIENTES SE ENCOLAN ───────────
   `version` y `base` viven en REFS y no en el estado: si estuvieran en el
   estado, la petición en vuelo leería valores viejos por el cierre y el
   siguiente guardado compararía contra una base caducada, provocando
   conflictos donde no los hay. El doble clic no puede chocar consigo mismo
   porque el segundo se apunta en `pendiente` y sale solo al terminar el
   primero, ya con la versión nueva.

   ── EL 409, CUANDO DE VERDAD LO HAY ──────────────────────────────
   El servidor fusiona antes de rendirse (ver /api/realty/landing). Cuando
   aun así hay conflicto, dice QUÉ campos y devuelve el estado del
   servidor: aquí se ofrecen las dos salidas de verdad —quedarme con lo
   suyo o republicar lo mío— en vez de "recarga y pierde todo".
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REALTY_WEB_ACENTOS,
  REALTY_WEB_HISTORIA_MAX,
  REALTY_WEB_MAX_CREDENCIALES,
  REALTY_WEB_MAX_NUMEROS,
  REALTY_WEB_MAX_REQUISITOS,
  REALTY_WEB_MAX_TESTIMONIOS,
  REALTY_WEB_MAX_ZONAS,
  REALTY_WEB_SEO_DESCRIPCION_MAX,
  REALTY_WEB_SEO_TITULO_MAX,
  REALTY_WEB_TESTIMONIO_MAX,
  bloqueDef,
  bloquesVisibles,
  fusionarConfigRealtyWeb,
  fusionarPlantilla,
  hayDatosDe,
  manifiestoRealtyWeb,
  mismoValor,
  manifiestosDeModo,
  normalizarConfigRealtyWeb,
  ordenDeBloques,
  plantillaEfectiva,
  rutaWebInmobiliaria,
  type RealtyWebAcento,
  type RealtyWebConfig,
  type RealtyWebCredencial,
  type RealtyWebData,
  type RealtyWebNumero,
  type RealtyWebTemplateId,
  type RealtyWebTestimonio,
} from "@/lib/realty/landing";
import type { RealtyMode } from "@/lib/realty/types";
import { VistaPrevia, type ModoVista } from "@/components/realty/web/editor/vista-previa";
import {
  Campo,
  CampoTexto,
  EditorBloque,
  Interruptor,
  ListaSimple,
  Panel,
} from "@/components/realty/web/editor/controles";
import { Compartir } from "@/components/realty/web/editor/compartir";
import "@/components/realty/web/editor/editor.css";

export interface EditorWebProps {
  /** Los mismos datos que pinta la página pública. */
  data: RealtyWebData;
  template: string;
  config: unknown;
  version: number;
  publicada: boolean;
  modo: RealtyMode;
  urlPublica: string;
}

type Estado = "limpio" | "guardando" | "guardado" | "error";

interface Conflicto {
  mensaje: string;
  campos: string[];
  version: number;
  template: RealtyWebTemplateId;
  config: RealtyWebConfig;
}

export function EditorWebInmuebles(props: EditorWebProps) {
  const [config, setConfig] = useState<RealtyWebConfig>(() => ({
    ...normalizarConfigRealtyWeb(props.config),
    publicada: props.publicada,
  }));
  const [template, setTemplate] = useState<RealtyWebTemplateId>(() =>
    plantillaEfectiva(props.template, props.modo),
  );
  const [modoVista, setModoVista] = useState<ModoVista>("escritorio");
  const [sucio, setSucio] = useState(false);
  const [estado, setEstado] = useState<Estado>("limpio");
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);

  // Refs y no estado: ver la cabecera.
  const version = useRef(props.version);
  const base = useRef<{ template: RealtyWebTemplateId; config: RealtyWebConfig }>({
    template: plantillaEfectiva(props.template, props.modo),
    config: { ...normalizarConfigRealtyWeb(props.config), publicada: props.publicada },
  });
  const actual = useRef<{ template: RealtyWebTemplateId; config: RealtyWebConfig }>({
    template,
    config,
  });
  const enVuelo = useRef(false);
  const pendiente = useRef(false);

  actual.current = { template, config };

  const manifest = useMemo(() => manifiestoRealtyWeb(template, props.modo), [template, props.modo]);
  const plantillas = useMemo(() => manifiestosDeModo(props.modo), [props.modo]);

  const data: RealtyWebData = useMemo(
    () => ({ ...props.data, config, manifest, editando: true }),
    [props.data, config, manifest],
  );

  const hayDatos = useMemo(() => hayDatosDe({ ...data, editando: false }), [data]);

  const cambiar = useCallback((fn: (c: RealtyWebConfig) => RealtyWebConfig) => {
    setConfig((c) => fn(c));
    setSucio(true);
    setEstado("limpio");
  }, []);

  /* ── Avisar antes de perder una tarde ──────────────────────────── */
  useEffect(() => {
    if (!sucio) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [sucio]);

  /* ── Orden de bloques ──────────────────────────────────────────── */

  const orden = useMemo(() => ordenDeBloques(manifest, config), [manifest, config]);

  const moverBloque = useCallback(
    (id: string, dir: -1 | 1) => {
      cambiar((c) => {
        const man = manifiestoRealtyWeb(actual.current.template, props.modo);
        const actualOrden = ordenDeBloques(man, c);
        const i = actualOrden.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= actualOrden.length) return c;
        const nuevo = [...actualOrden];
        nuevo[i] = actualOrden[j];
        nuevo[j] = actualOrden[i];
        return { ...c, orden: { ...c.orden, [man.id]: nuevo } };
      });
    },
    [cambiar, props.modo],
  );

  /* ── Fotos ─────────────────────────────────────────────────────── */

  const subirFoto = useCallback(
    async (slot: string, file: File) => {
      setSubiendo(slot);
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("destino", slot);
        const r = await fetch("/api/realty/landing/upload", { method: "POST", body: form });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.url) {
          setError(j?.error ?? "No se pudo subir la imagen.");
          return;
        }
        cambiar((c) => ({ ...c, fotos: { ...c.fotos, [slot]: j.url as string } }));
      } catch {
        setError("No se pudo subir la imagen.");
      } finally {
        setSubiendo(null);
      }
    },
    [cambiar],
  );

  const quitarFoto = useCallback(
    (slot: string) => {
      cambiar((c) => {
        const fotos = { ...c.fotos };
        delete fotos[slot];
        return { ...c, fotos };
      });
    },
    [cambiar],
  );

  /* ── Publicar ──────────────────────────────────────────────────── */

  const publicar = useCallback(async () => {
    if (enVuelo.current) {
      pendiente.current = true;
      return;
    }
    enVuelo.current = true;
    setEstado("guardando");
    setError(null);
    setConflicto(null);

    const envio = { ...actual.current };
    try {
      const r = await fetch("/api/realty/landing", {
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
        // 🔴 Sin `config` del servidor NO se puede ofrecer "quedarme con lo
        // suyo": normalizar un `undefined` devuelve la config VACÍA, y
        // adoptarla dejaría el editor en blanco —sin textos, sin fotos, sin
        // credenciales— y encima marcado como limpio, así que ni el aviso de
        // cerrar pestaña saltaría. Ese caso se trata como un error normal:
        // se conserva todo y se puede reintentar.
        if (!j || typeof j.config !== "object" || j.config === null) {
          setError(j?.error ?? "No se pudo guardar. Inténtalo otra vez.");
          setEstado("error");
          return;
        }
        setConflicto({
          mensaje: j.error ?? "Alguien más editó esta página.",
          campos: Array.isArray(j.campos) ? j.campos : [],
          version: Number(j.version ?? version.current),
          template: plantillaEfectiva(j.template, props.modo),
          config: normalizarConfigRealtyWeb(j.config),
        });
        setEstado("error");
        return;
      }
      if (!r.ok) {
        setError(j?.error ?? "No se pudo guardar. Inténtalo otra vez.");
        setEstado("error");
        return;
      }

      version.current = Number(j.version);
      const guardado = normalizarConfigRealtyWeb(j.config);
      const plantillaGuardada = plantillaEfectiva(j.template, props.modo);
      base.current = { template: plantillaGuardada, config: guardado };

      // 🔴 ¿La persona SIGUIÓ ESCRIBIENDO mientras la petición viajaba?
      //
      // Pisar la pantalla con lo guardado le borraría esas letras Y le diría
      // "Publicado", que es la peor combinación posible: pierde texto y
      // encima cree que está a salvo. Un guardado tarda uno o dos segundos y
      // nadie se queda mirando el botón; escribir mientras tanto es lo
      // normal, no el caso raro.
      //
      // Se compara con lo que se ENVIÓ, no con la base: si cambió, la
      // pantalla manda y se queda "sucia" para que el siguiente guardado la
      // recoja (y el aviso de cerrar pestaña siga activo).
      const siguioEscribiendo =
        !mismoValor(actual.current.config, envio.config) ||
        actual.current.template !== envio.template;

      if (!pendiente.current && !siguioEscribiendo) {
        setConfig(guardado);
        setTemplate(plantillaGuardada);
        setSucio(false);
        setEstado("guardado");
      } else if (!pendiente.current) {
        // Se guardó lo que se mandó, pero hay letras más nuevas en pantalla.
        setEstado("limpio");
        setSucio(true);
      }
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
      setEstado("error");
    } finally {
      enVuelo.current = false;
      if (pendiente.current) {
        pendiente.current = false;
        void publicar();
      }
    }
  }, [props.modo]);

  /** Me quedo con lo del servidor y descarto lo mío. */
  const usarDelServidor = useCallback(() => {
    if (!conflicto) return;
    version.current = conflicto.version;
    base.current = { template: conflicto.template, config: conflicto.config };
    setTemplate(conflicto.template);
    setConfig(conflicto.config);
    setConflicto(null);
    setSucio(false);
    setEstado("limpio");
  }, [conflicto]);

  /**
   * Republico lo mío.
   *
   * 🔴 "Lo mío" es lo que YO cambié, no "todo lo que tengo en pantalla".
   * Adoptar la base del servidor y republicar la pantalla tal cual habría
   * REVERTIDO en silencio todo lo que la otra pestaña tocó y yo no —
   * teléfono, fotos, interruptores, el título de Google— porque mi pantalla
   * los tiene como estaban cuando cargué. El aviso solo nombraba el campo
   * en disputa y el resto desaparecía sin dejar rastro.
   *
   * Así que se fusiona AQUÍ, con la misma regla de tres bandas del
   * servidor pero resolviendo los choques a mi favor: lo que él cambió y yo
   * no, entra; lo que cambiamos los dos, gana lo mío. Después se publica
   * ese resultado, que es lo que la persona cree que está publicando.
   */
  const publicarLoMio = useCallback(() => {
    if (!conflicto) return;
    const fusion = fusionarConfigRealtyWeb(
      base.current.config,
      actual.current.config,
      conflicto.config,
      "mio",
    );
    const plantilla = fusionarPlantilla(
      base.current.template,
      actual.current.template,
      conflicto.template,
      "mio",
    );
    version.current = conflicto.version;
    base.current = { template: conflicto.template, config: conflicto.config };
    setConfig(fusion.config);
    setTemplate(plantilla.template);
    actual.current = { template: plantilla.template, config: fusion.config };
    setConflicto(null);
    void publicar();
  }, [conflicto, publicar]);

  /* ── Render ────────────────────────────────────────────────────── */

  // Los paneles se listan en el ORDEN REAL, no en el del manifiesto: si no,
  // mover una sección con las flechas cambiaría la página pero no la lista
  // de aquí, y las flechas se sentirían rotas.
  const porId = new Map(manifest.bloques.map((b) => [b.id as string, b]));
  const bloquesDelManifiesto = orden
    .map((id) => porId.get(id))
    .filter((b): b is (typeof manifest.bloques)[number] => Boolean(b));
  // Los que se pintarían HOY en público: con los datos de verdad y con los
  // interruptores tal como están. No con `() => true`, que devolvería todos
  // y nunca avisaría de nada.
  const visibles = bloquesVisibles(manifest, config, hayDatos).map((b) => b.id);

  return (
    <div className="dcrwe">
      <header className="dcrwe-cabeza">
        <div>
          <h1 className="dcrwe-titulo">Mi web</h1>
          <p className="dcrwe-sub">
            {sucio ? "Tienes cambios sin publicar." : "Todo lo que ves aquí es lo que se publica."}
          </p>
        </div>
        <div className="dcrwe-cabeza-acciones">
          <a
            className="dcrwe-btn dcrwe-btn-sutil"
            href={props.urlPublica}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver mi web
          </a>
          <button
            type="button"
            className="dcrwe-btn dcrwe-btn-primario"
            disabled={estado === "guardando"}
            onClick={() => void publicar()}
          >
            {estado === "guardando" ? "Publicando…" : "Guardar y publicar"}
          </button>
        </div>
      </header>


      {estado === "guardado" ? (
        <p className="dcrwe-ok" role="status">
          Publicado. Tu web ya muestra los cambios.
        </p>
      ) : null}

      {error ? (
        <p className="dcrwe-alerta" role="alert">
          {error}
        </p>
      ) : null}

      {conflicto ? (
        <div className="dcrwe-conflicto" role="alert">
          <strong>{conflicto.mensaje}</strong>
          {conflicto.campos.length > 0 ? (
            <p>Lo que cambiaron los dos: {conflicto.campos.join(", ")}.</p>
          ) : null}
          <div className="dcrwe-conflicto-acciones">
            <button type="button" className="dcrwe-btn" onClick={usarDelServidor}>
              Quedarme con lo suyo
            </button>
            <button type="button" className="dcrwe-btn dcrwe-btn-primario" onClick={publicarLoMio}>
              Publicar lo mío
            </button>
          </div>
        </div>
      ) : null}

      <div className="dcrwe-cuerpo">
        <div className="dcrwe-controles">
          <Panel titulo="Plantilla" abierto>
            <p className="dcrwe-ayuda">
              Solo salen las plantillas de tu tipo de cuenta: son las que hablan de lo que tú
              vendes. Cambiar de plantilla NO pierde nada — lo que la nueva no pinta se queda
              guardado y vuelve si regresas.
            </p>
            <div className="dcrwe-plantillas">
              {plantillas.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`dcrwe-plantilla ${template === m.id ? "dcrwe-plantilla-activa" : ""}`}
                  aria-pressed={template === m.id}
                  onClick={() => {
                    setTemplate(m.id);
                    setSucio(true);
                    setEstado("limpio");
                  }}
                >
                  <strong>{m.nombre}</strong>
                  <span>{m.para}</span>
                  <small>{m.estructura}</small>
                </button>
              ))}
            </div>
          </Panel>

          <Panel titulo="Color">
            <p className="dcrwe-ayuda">
              Seis acentos escogidos: todos se leen bien con texto blanco encima. Un color libre
              rompería el contraste y los botones dejarían de leerse.
            </p>
            <div className="dcrwe-acentos">
              {REALTY_WEB_ACENTOS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`dcrwe-acento ${config.acento === a.id ? "dcrwe-acento-activo" : ""}`}
                  style={{ background: a.base }}
                  aria-label={a.nombre}
                  title={a.nombre}
                  aria-pressed={config.acento === a.id}
                  onClick={() => cambiar((c) => ({ ...c, acento: a.id as RealtyWebAcento }))}
                />
              ))}
            </div>
          </Panel>

          <Panel titulo="Publicación">
            <Interruptor
              etiqueta="Mi web está publicada"
              ayuda="Apagada, quien entre ve un aviso de «muy pronto» y Google deja de indexarla."
              activo={config.publicada}
              onChange={(v) => cambiar((c) => ({ ...c, publicada: v }))}
            />
          </Panel>

          <h2 className="dcrwe-seccion">Secciones</h2>
          {bloquesDelManifiesto.map((b) => (
            <EditorBloque
              key={b.id}
              bloque={b}
              primera={orden.indexOf(b.id) === 0}
              ultima={orden.indexOf(b.id) === orden.length - 1}
              visible={config.bloques[b.id]?.visible !== false}
              hayDatos={hayDatos}
              textoDe={(campo) => config.bloques[b.id]?.[campo] ?? ""}
              copiaDe={(clave) => config.copia[clave] ?? ""}
              fotoDe={(slot) => config.fotos[slot] ?? null}
              subiendo={subiendo}
              onVisible={(v) =>
                cambiar((c) => ({
                  ...c,
                  bloques: {
                    ...c.bloques,
                    [b.id]: {
                      visible: v,
                      titulo: c.bloques[b.id]?.titulo ?? null,
                      subtitulo: c.bloques[b.id]?.subtitulo ?? null,
                    },
                  },
                }))
              }
              onMover={(dir) => moverBloque(b.id, dir)}
              onTexto={(campo, v) =>
                cambiar((c) => ({
                  ...c,
                  bloques: {
                    ...c.bloques,
                    [b.id]: {
                      visible: c.bloques[b.id]?.visible !== false,
                      titulo: campo === "titulo" ? v || null : (c.bloques[b.id]?.titulo ?? null),
                      subtitulo:
                        campo === "subtitulo" ? v || null : (c.bloques[b.id]?.subtitulo ?? null),
                    },
                  },
                }))
              }
              onCopia={(clave, v) =>
                cambiar((c) => {
                  const copia = { ...c.copia };
                  // Vaciar BORRA la clave: así vuelve a salir el literal de
                  // la plantilla y cambiar de plantilla no arrastra el texto
                  // por defecto de la anterior.
                  if (v.trim()) copia[clave] = v;
                  else delete copia[clave];
                  return { ...c, copia };
                })
              }
              onFoto={(slot, file) => void subirFoto(slot, file)}
              onQuitarFoto={quitarFoto}
            />
          ))}
          {visibles.length <= 2 ? (
            <p className="dcrwe-aviso">
              Ahora mismo tu web solo pintaría {visibles.length}{" "}
              {visibles.length === 1 ? "sección" : "secciones"}. Las demás están apagadas o
              esperando datos (inmuebles publicados, asesores, zonas…).
            </p>
          ) : null}

          <h2 className="dcrwe-seccion">Contenido</h2>

          {bloqueDef("sobre-mi").modos.includes(props.modo) ? (
            <Panel titulo="Tu historia">
              <CampoTexto
                etiqueta="Historia"
                ayuda="Deja una línea en blanco entre párrafos."
                valor={config.historia}
                area
                filas={7}
                maxLen={REALTY_WEB_HISTORIA_MAX}
                onChange={(v) => cambiar((c) => ({ ...c, historia: v }))}
              />
            </Panel>
          ) : null}

          {bloqueDef("credenciales").modos.includes(props.modo) ? (
            <Panel titulo="Credenciales">
              <p className="dcrwe-ayuda">
                Solo el 10% de los asesores en México está capacitado y el 15% pertenece a una
                asociación. Poner aquí tu EC0110.02, tu AMPI o tu registro estatal es el
                diferenciador más barato que existe.
              </p>
              <EditorCredenciales
                items={config.credenciales}
                onChange={(v) => cambiar((c) => ({ ...c, credenciales: v }))}
              />
            </Panel>
          ) : null}

          {bloqueDef("zonas").modos.includes(props.modo) ? (
            <Panel titulo="Zonas">
              <ListaSimple
                etiqueta="Colonias y ciudades que trabajas"
                items={config.zonas}
                maxItems={REALTY_WEB_MAX_ZONAS}
                placeholder="Providencia"
                onChange={(v) => cambiar((c) => ({ ...c, zonas: v }))}
              />
            </Panel>
          ) : null}

          {bloqueDef("testimonios").modos.includes(props.modo) ? (
            <Panel titulo="Testimonios">
              <p className="dcrwe-ayuda">
                Se pintan en tu página. No se marcan como reseñas para Google: las escribes tú, y
                pedir estrellas con eso es motivo de penalización.
              </p>
              <EditorTestimonios
                items={config.testimonios}
                onChange={(v) => cambiar((c) => ({ ...c, testimonios: v }))}
              />
            </Panel>
          ) : null}

          {bloqueDef("requisitos-para-rentar").modos.includes(props.modo) ? (
            <Panel titulo="Requisitos para rentar">
              <ListaSimple
                etiqueta="Uno por renglón"
                ayuda="Ponerlos antes de que alguien se ilusione le ahorra el viaje y a ti veinte mensajes."
                items={config.requisitos}
                maxItems={REALTY_WEB_MAX_REQUISITOS}
                placeholder="Aval con propiedad en la ciudad"
                onChange={(v) => cambiar((c) => ({ ...c, requisitos: v }))}
              />
            </Panel>
          ) : null}

          {bloqueDef("numeros").modos.includes(props.modo) ? (
            <Panel titulo="Números de la empresa">
              <EditorNumeros
                items={config.numeros}
                onChange={(v) => cambiar((c) => ({ ...c, numeros: v }))}
              />
            </Panel>
          ) : null}

          <h2 className="dcrwe-seccion">Contacto y redes</h2>
          <Panel titulo="Cómo te contactan">
            <CampoTexto
              etiqueta="WhatsApp (10 dígitos)"
              ayuda="Si lo dejas vacío usamos el teléfono de la cuenta."
              valor={config.whatsapp}
              porDefecto="3312345678"
              maxLen={20}
              onChange={(v) => cambiar((c) => ({ ...c, whatsapp: v }))}
            />
            <CampoTexto
              etiqueta="Teléfono"
              valor={config.telefono}
              maxLen={24}
              onChange={(v) => cambiar((c) => ({ ...c, telefono: v }))}
            />
            <CampoTexto
              etiqueta="Correo"
              ayuda="Se publica tal cual en tu web. No pongas el correo con el que entras al panel: ese es tu usuario."
              valor={config.correo}
              maxLen={120}
              onChange={(v) => cambiar((c) => ({ ...c, correo: v }))}
            />
          </Panel>
          <Panel titulo="Redes sociales">
            <p className="dcrwe-ayuda">Solo el usuario, sin arroba y sin la liga completa.</p>
            {(
              [
                ["instagram", "Instagram"],
                ["facebook", "Facebook"],
                ["tiktok", "TikTok"],
                ["youtube", "YouTube"],
                ["linkedin", "LinkedIn"],
              ] as const
            ).map(([campo, etiqueta]) => (
              <CampoTexto
                key={campo}
                etiqueta={etiqueta}
                valor={config[campo]}
                maxLen={80}
                onChange={(v) => cambiar((c) => ({ ...c, [campo]: v }))}
              />
            ))}
          </Panel>

          <h2 className="dcrwe-seccion">Google</h2>
          <Panel titulo="Título y descripción">
            <p className="dcrwe-ayuda">
              Si los dejas vacíos, escribimos uno con el nombre de tu cuenta y tu ciudad.
            </p>
            <CampoTexto
              etiqueta="Título en Google"
              valor={config.seoTitulo}
              maxLen={REALTY_WEB_SEO_TITULO_MAX}
              onChange={(v) => cambiar((c) => ({ ...c, seoTitulo: v }))}
            />
            <CampoTexto
              etiqueta="Descripción en Google"
              valor={config.seoDescripcion}
              area
              filas={3}
              maxLen={REALTY_WEB_SEO_DESCRIPCION_MAX}
              onChange={(v) => cambiar((c) => ({ ...c, seoDescripcion: v }))}
            />
          </Panel>

          <h2 className="dcrwe-seccion">Compartir</h2>
          <Compartir url={props.urlPublica} nombre={props.data.cuenta.nombre} />
        </div>

        <div className="dcrwe-lienzo">
          <div className="dcrwe-lienzo-barra">
            <div className="dcrwe-modo">
              <button
                type="button"
                className={modoVista === "escritorio" ? "dcrwe-modo-activo" : ""}
                aria-pressed={modoVista === "escritorio"}
                onClick={() => setModoVista("escritorio")}
              >
                Escritorio
              </button>
              <button
                type="button"
                className={modoVista === "movil" ? "dcrwe-modo-activo" : ""}
                aria-pressed={modoVista === "movil"}
                onClick={() => setModoVista("movil")}
              >
                Móvil
              </button>
            </div>
            <span className="dcrwe-ruta">{rutaWebInmobiliaria(props.data.cuenta.slug)}</span>
          </div>
          <VistaPrevia data={data} modo={modoVista} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Editores de lista con forma propia
   ═══════════════════════════════════════════════════════════════════ */

function EditorCredenciales({
  items,
  onChange,
}: {
  items: RealtyWebCredencial[];
  onChange: (v: RealtyWebCredencial[]) => void;
}) {
  const set = (i: number, parche: Partial<RealtyWebCredencial>) =>
    onChange(items.map((it, j) => (i === j ? { ...it, ...parche } : it)));

  return (
    <div className="dcrwe-fichas">
      {items.map((c, i) => (
        <div className="dcrwe-ficha" key={i}>
          <CampoTexto
            etiqueta="Nombre"
            valor={c.titulo}
            porDefecto="EC0110.02"
            maxLen={90}
            onChange={(v) => set(i, { titulo: v })}
          />
          <CampoTexto
            etiqueta="Folio"
            valor={c.folio ?? ""}
            maxLen={60}
            onChange={(v) => set(i, { folio: v })}
          />
          <CampoTexto
            etiqueta="Detalle"
            valor={c.detalle ?? ""}
            porDefecto="Vigente 2026"
            maxLen={60}
            onChange={(v) => set(i, { detalle: v })}
          />
          <button
            type="button"
            className="dcrwe-btn dcrwe-btn-sutil"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            Quitar
          </button>
        </div>
      ))}
      {items.length < REALTY_WEB_MAX_CREDENCIALES ? (
        <button
          type="button"
          className="dcrwe-btn"
          onClick={() => onChange([...items, { titulo: "" }])}
        >
          Agregar credencial
        </button>
      ) : null}
    </div>
  );
}

function EditorTestimonios({
  items,
  onChange,
}: {
  items: RealtyWebTestimonio[];
  onChange: (v: RealtyWebTestimonio[]) => void;
}) {
  const set = (i: number, parche: Partial<RealtyWebTestimonio>) =>
    onChange(items.map((it, j) => (i === j ? { ...it, ...parche } : it)));

  return (
    <div className="dcrwe-fichas">
      {items.map((t, i) => (
        <div className="dcrwe-ficha" key={i}>
          <CampoTexto
            etiqueta="Quién lo dice"
            valor={t.nombre}
            maxLen={70}
            onChange={(v) => set(i, { nombre: v })}
          />
          <CampoTexto
            etiqueta="Qué dice"
            valor={t.texto}
            area
            filas={3}
            maxLen={REALTY_WEB_TESTIMONIO_MAX}
            onChange={(v) => set(i, { texto: v })}
          />
          <CampoTexto
            etiqueta="Contexto"
            valor={t.contexto ?? ""}
            porDefecto="Compró en Providencia"
            maxLen={70}
            onChange={(v) => set(i, { contexto: v })}
          />
          <button
            type="button"
            className="dcrwe-btn dcrwe-btn-sutil"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            Quitar
          </button>
        </div>
      ))}
      {items.length < REALTY_WEB_MAX_TESTIMONIOS ? (
        <button
          type="button"
          className="dcrwe-btn"
          onClick={() => onChange([...items, { nombre: "", texto: "" }])}
        >
          Agregar testimonio
        </button>
      ) : null}
    </div>
  );
}

function EditorNumeros({
  items,
  onChange,
}: {
  items: RealtyWebNumero[];
  onChange: (v: RealtyWebNumero[]) => void;
}) {
  const set = (i: number, parche: Partial<RealtyWebNumero>) =>
    onChange(items.map((it, j) => (i === j ? { ...it, ...parche } : it)));

  return (
    <div className="dcrwe-fichas">
      {items.map((n, i) => (
        <div className="dcrwe-ficha" key={i}>
          <Campo etiqueta="Número">
            <input
              type="text"
              className="dcrwe-input"
              maxLength={16}
              value={n.valor}
              placeholder="18"
              onChange={(e) => set(i, { valor: e.target.value })}
            />
          </Campo>
          <CampoTexto
            etiqueta="Qué significa"
            valor={n.etiqueta}
            porDefecto="años acompañando familias"
            maxLen={48}
            onChange={(v) => set(i, { etiqueta: v })}
          />
          <button
            type="button"
            className="dcrwe-btn dcrwe-btn-sutil"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            Quitar
          </button>
        </div>
      ))}
      {items.length < REALTY_WEB_MAX_NUMEROS ? (
        <button
          type="button"
          className="dcrwe-btn"
          onClick={() => onChange([...items, { valor: "", etiqueta: "" }])}
        >
          Agregar número
        </button>
      ) : null}
    </div>
  );
}
