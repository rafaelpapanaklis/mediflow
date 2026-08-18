"use client";
/* ============================================================
   EL EDITOR VISUAL DE LA MINI-WEB.

   La pantalla es el sitio. Se hace clic sobre un texto y se edita ahí
   mismo; se suelta una foto sobre su hueco y se ve al instante. Todo
   eso pasa DENTRO del iframe (_shared/edit-runtime.tsx); aquí fuera
   solo vive lo que no puede vivir dentro:

     · el borrador y qué columnas se tocaron,
     · Deshacer / Descartar / Guardar,
     · comprimir y subir las fotos (el iframe manda el File),
     · el color de acento y su aviso de contraste.

   ── LO QUE NO HACE, A PROPÓSITO ──────────────────────────────
   NO guarda solo. El PATCH de /api/clinic-landing PUBLICA y revalida
   tres rutas, así que un autosave cada segundo y medio sería publicar
   a un sitio vivo cada segundo y medio.

   NO arma el cuerpo del guardado comparando objetos. Se manda una
   LISTA LITERAL de las columnas que se tocaron. Diffear el objeto
   `clinic` fue lo que causó la fuga del commit 0424d5ab.

   NO edita fondos: los define la plantilla, y así se le dice a la
   clínica en la barra de arriba.

   ── EL LIENZO ────────────────────────────────────────────────
   Un iframe a /landing-preview/<slug>?preview=<tpl>&edit=1 CON SU
   PROPIO SCROLL, escalado solo por ancho. No se estira al alto del
   contenido: eso reventaría los hero de 100vh, las barras sticky y
   los botones fixed de las ocho plantillas.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, ExternalLink, Monitor, RotateCcw, Undo2, AlertTriangle } from "lucide-react";
import {
  parseLiveMessage, postLivePreview,
  type LivePreviewPatch,
} from "@/app/[slug]/_shared/live-preview";
import { leerMensajeDeEdicion, responderAlLienzo } from "@/app/[slug]/_shared/edit-bus";
import { manifestOf, plantillaInstrumentada } from "@/app/[slug]/_shared/template-manifest";
import {
  aplicarDireccion, leerDireccion,
  type BorradorLanding, type ColumnaDeTexto,
} from "@/lib/landing-address";
import { prepararImagen } from "@/lib/image-client";

/** Ancho de referencia del lienzo. El escalado es solo por ancho. */
const ANCHO_LIENZO = 1280;
/** Debajo de esto el editor visual no se ofrece; se usa el formulario. */
const MINIMO_ESCRITORIO = 1024;
/** Cuánto se espera antes de mandar el parche al iframe. */
const RETARDO = 200;

export interface ClinicaDelEditor extends BorradorLanding {
  slug: string;
  updatedAt: string;
  landingActive: boolean;
  landingTemplate: string | null;
  landingThemeColor: string | null;
}

/**
 * Las columnas que el lienzo puede escribir, más el acento de la barra.
 *
 * `ColumnaDeTexto` (@/lib/landing-address) ya es la intersección de la
 * allowlist del PATCH con la de la vista previa, así que si una columna se
 * cayera de cualquiera de las dos listas esto dejaría de compilar.
 */
type Columna = ColumnaDeTexto | "landingThemeColor";

/**
 * Cómo se llama cada columna cuando hay que contarle a la clínica que se movió.
 * El servidor manda nombres de columna; "landingTestimonials" no le dice nada
 * a nadie.
 */
const NOMBRE_DE_COLUMNA: Record<string, string> = {
  name:                "el nombre de la clínica",
  phone:               "el teléfono",
  address:             "la dirección",
  description:         "la descripción",
  landingTagline:      "el eslogan",
  landingPatients:     "los pacientes atendidos",
  landingUrgentText:   "el aviso de urgencias",
  landingSections:     "los textos de las secciones",
  landingServices:     "los servicios",
  landingFaqs:         "las preguntas frecuentes",
  landingTestimonials: "los testimonios",
  landingPhotos:       "las fotos",
  landingCopy:         "los textos de los botones y las etiquetas",
  landingThemeColor:   "el color de acento",
};

/** "A", "A y B", "A, B y C". */
function enumerar(cosas: string[]): string {
  if (cosas.length === 0) return "algo de tu página";
  if (cosas.length === 1) return cosas[0];
  return `${cosas.slice(0, -1).join(", ")} y ${cosas[cosas.length - 1]}`;
}

/** Lo que devuelve el servidor cuando alguien SÍ tocó lo mismo que tú. */
interface Conflicto {
  campos: Columna[];
  /** Lo que hay ahora publicado, solo de esas columnas. */
  actual: Record<string, unknown>;
  updatedAt: string;
}

/* ── contraste: aviso, no bloqueo ───────────────────────────────
   Las ocho plantillas pintan texto BLANCO sobre el acento. Por debajo de
   4.5:1 ese texto deja de leerse para mucha gente. Se avisa y ya: es la
   marca de la clínica, no nuestra. */
function luminancia(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const c = [0, 2, 4].map(i => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrasteConBlanco(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 21;
  return 1.05 / (luminancia(hex) + 0.05);
}

/* ============================================================ */

export function EditorVisual({ inicial }: { inicial: ClinicaDelEditor }) {
  const tpl = inicial.landingTemplate ?? "classic";
  const manifiesto = manifestOf(tpl);
  const editable = plantillaInstrumentada(tpl);

  const [borrador, setBorrador] = useState<ClinicaDelEditor>(inicial);
  const [publicado, setPublicado] = useState<ClinicaDelEditor>(inicial);
  const [tocados, setTocados] = useState<Columna[]>([]);
  const [historial, setHistorial] = useState<{ b: ClinicaDelEditor; t: Columna[] }[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);
  const [anchoDisponible, setAnchoDisponible] = useState(ANCHO_LIENZO);
  const [ventanaChica, setVentanaChica] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lienzoRef = useRef<HTMLDivElement | null>(null);
  const borradorRef = useRef(borrador);
  useEffect(() => { borradorRef.current = borrador; }, [borrador]);
  const tocadosRef = useRef(tocados);
  useEffect(() => { tocadosRef.current = tocados; }, [tocados]);

  const sinGuardar = tocados.length > 0;
  const acento = borrador.landingThemeColor ?? "#2563eb";
  const ratio = contrasteConBlanco(acento);

  /* ── escribir en el borrador ─────────────────────────────── */
  const escribir = useCallback((columna: Columna, valor: unknown) => {
    setHistorial(h => [...h.slice(-29), { b: borradorRef.current, t: tocadosRef.current }]);
    setBorrador(b => ({ ...b, [columna]: valor }));
    setTocados(t => (t.includes(columna) ? t : [...t, columna]));
  }, []);

  const deshacer = useCallback(() => {
    setHistorial(h => {
      if (h.length === 0) return h;
      const ultimo = h[h.length - 1];
      setBorrador(ultimo.b);
      setTocados(ultimo.t);
      return h.slice(0, -1);
    });
  }, []);

  /* ── el parche que ve el lienzo ──────────────────────────── */
  const patch = useMemo<LivePreviewPatch>(() => ({
    name:                borrador.name,
    phone:               borrador.phone,
    address:             borrador.address,
    description:         borrador.description,
    landingThemeColor:   borrador.landingThemeColor,
    landingTagline:      borrador.landingTagline,
    landingPatients:     borrador.landingPatients,
    landingUrgentText:   borrador.landingUrgentText,
    landingSections:     Array.isArray(borrador.landingSections) ? borrador.landingSections : [],
    landingServices:     Array.isArray(borrador.landingServices) ? borrador.landingServices : [],
    landingFaqs:         Array.isArray(borrador.landingFaqs) ? borrador.landingFaqs : [],
    landingTestimonials: Array.isArray(borrador.landingTestimonials) ? borrador.landingTestimonials : [],
    landingPhotos:       (borrador.landingPhotos && typeof borrador.landingPhotos === "object" && !Array.isArray(borrador.landingPhotos))
                           ? borrador.landingPhotos : {},
    landingCopy:         (borrador.landingCopy && typeof borrador.landingCopy === "object" && !Array.isArray(borrador.landingCopy))
                           ? borrador.landingCopy : {},
  }), [borrador]);

  const patchRef = useRef(patch);
  useEffect(() => { patchRef.current = patch; }, [patch]);

  useEffect(() => {
    const id = setTimeout(() => postLivePreview(iframeRef.current?.contentWindow, inicial.slug, patch), RETARDO);
    return () => clearTimeout(id);
  }, [patch, inicial.slug]);

  /* El iframe avisa cuando ya puede recibir (al cargar y en cada recarga). */
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = parseLiveMessage(ev, inicial.slug);
      if (!msg || msg.kind !== "ready") return;
      postLivePreview(iframeRef.current?.contentWindow, inicial.slug, patchRef.current);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [inicial.slug]);

  /* ── subir una foto ──────────────────────────────────────── */
  const motivoDelFallo = useCallback(async (res: Response): Promise<string> => {
    if (res.status === 403) return "No tienes permiso para editar la página web. Pídeselo al dueño de la clínica.";
    if (res.status === 413) return "El archivo pesa demasiado para enviarlo.";
    try {
      const j = await res.json();
      if (j?.error) return String(j.error);
    } catch { /* respuesta HTML del runtime: no hay JSON que leer */ }
    return "No pudimos guardar. Vuelve a intentarlo.";
  }, []);

  const subirFoto = useCallback(async (slot: string, file: File) => {
    const win = iframeRef.current?.contentWindow;
    try {
      // Se comprime FUERA del iframe, con la misma pieza que el formulario de
      // siempre: el runtime corta el cuerpo en ~4.5 MB y una foto de celular
      // pesa el triple. Los errores ya vienen escritos para la clínica.
      const listo = await prepararImagen(file);
      const fd = new FormData();
      fd.append("file", listo);
      fd.append("field", slot);
      const res = await fetch("/api/landing-upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await motivoDelFallo(res));
      const { url } = await res.json();

      const escritura = aplicarDireccion(borradorRef.current, { tipo: "foto", ranura: slot }, url);
      if (!escritura) throw new Error("Esa ranura de foto no existe en esta plantilla.");
      escribir(escritura.columna, escritura.valor);
      // El parche va ANTES de soltar la vista previa local: si no, el hueco
      // parpadea vacío entre que se quita el blob y llega la url real.
      postLivePreview(win, inicial.slug, { landingPhotos: escritura.valor });
      responderAlLienzo(win, inicial.slug, { kind: "photo-ok", slot });
      toast.success("Foto lista. Guarda para publicarla.");
    } catch (e: any) {
      responderAlLienzo(win, inicial.slug, { kind: "photo-fail", slot });
      toast.error(e?.message ?? "No pudimos subir la foto.");
    }
  }, [escribir, inicial.slug, motivoDelFallo]);

  /* ── lo que llega del lienzo ─────────────────────────────── */
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = leerMensajeDeEdicion(ev, inicial.slug);
      if (!msg) return;

      if (msg.kind === "aviso") { toast(msg.texto); return; }

      if (msg.kind === "photo") { void subirFoto(msg.slot, msg.file); return; }

      if (msg.kind === "photo-clear") {
        // NO se borra el objeto de Storage: quitarla de la página es una cosa
        // y destruir el archivo del cliente es otra. Los huérfanos se barren
        // aparte.
        const escritura = aplicarDireccion(borradorRef.current, { tipo: "foto", ranura: msg.slot }, null);
        if (escritura) escribir(escritura.columna, escritura.valor);
        return;
      }

      // "edit": la dirección se traduce contra un juego CERRADO de formas y
      // aterriza siempre en una columna ya permitida. El lienzo nunca escribe
      // una ruta libre.
      const dir = leerDireccion(msg.campo);
      if (!dir) return;
      const escritura = aplicarDireccion(borradorRef.current, dir, msg.valor);
      if (!escritura) return;
      escribir(escritura.columna, escritura.valor);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [escribir, inicial.slug, subirFoto]);

  /* ── guardar / descartar ─────────────────────────────────── */
  /**
   * Publica lo que se tocó.
   *
   * Viaja LA MARCA con la que cargó esta pantalla y LA BASE: lo que esta
   * pantalla tenía por publicado en esas mismas columnas. La base es lo que
   * permite al servidor distinguir "otra pestaña me pisó" de "la fila se movió
   * por el webhook de Stripe" — sin ella, el segundo caso salía como conflicto
   * y el editor no guardaba nunca.
   *
   * `sobre` es la salida de "publicar de todos modos": se reintenta con la
   * marca y los valores que acaba de devolver el servidor, así que el guardado
   * entra y sustituye lo de la otra pestaña. Es una decisión de la clínica, y
   * se le dice con esas palabras.
   */
  async function guardar(sobre?: { actual: Record<string, unknown>; updatedAt: string }) {
    if (!sinGuardar || guardando) return;
    setGuardando(true);
    try {
      // LISTA LITERAL. Nada de comparar el objeto clinic para deducir qué
      // cambió: ese patrón es el que causó 0424d5ab.
      const base: Record<string, unknown> = {};
      for (const columna of tocados) {
        base[columna] = sobre && columna in sobre.actual
          ? sobre.actual[columna]
          : (publicado as any)[columna];
      }
      const cuerpo: Record<string, unknown> = {
        esperadoUpdatedAt: sobre?.updatedAt ?? borrador.updatedAt,
        base,
      };
      for (const columna of tocados) cuerpo[columna] = (borrador as any)[columna];

      const res = await fetch("/api/clinic-landing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      if (res.status === 409) {
        const j = await res.json().catch(() => null);
        setConflicto({
          campos:    Array.isArray(j?.campos) ? j.campos : [],
          actual:    (j?.actual && typeof j.actual === "object") ? j.actual : {},
          updatedAt: typeof j?.updatedAt === "string" ? j.updatedAt : borrador.updatedAt,
        });
        return;
      }
      if (!res.ok) throw new Error(await motivoDelFallo(res));
      const { updatedAt } = await res.json();

      const publicadoAhora = { ...borrador, updatedAt: updatedAt ?? borrador.updatedAt };
      setBorrador(publicadoAhora);
      setPublicado(publicadoAhora);
      setTocados([]);
      setHistorial([]);
      // Lo que se ve tras guardar sale del SERVIDOR, no de un parche: es la
      // red de seguridad de que lo publicado es de verdad esto.
      setNonce(n => n + 1);
      toast.success("Publicado. Tu sitio ya se ve así.");
    } catch (e: any) {
      toast.error(e?.message ?? "No pudimos publicar.");
    } finally {
      setGuardando(false);
    }
  }

  function descartar() {
    if (!sinGuardar) return;
    setBorrador(publicado);
    setTocados([]);
    setHistorial([]);
    setNonce(n => n + 1);
    toast("Se volvió a lo publicado.");
  }

  /* ── las dos salidas del conflicto ───────────────────────────
     "Recarga y pierde lo que escribiste" no es una salida. Estas dos sí:
     o gana lo tuyo, o gana lo de la otra pestaña, y en los dos casos lo
     decides tú sabiendo QUÉ cambió. */

  /** Lo mío encima. Se reintenta con la marca y los valores que hay ahora. */
  function publicarDeTodosModos() {
    if (!conflicto) return;
    const c = conflicto;
    setConflicto(null);
    void guardar({ actual: c.actual, updatedAt: c.updatedAt });
  }

  /**
   * Lo de la otra pestaña gana, PERO solo en las columnas que de verdad
   * chocaron: lo que escribiste en las demás sigue aquí, sin publicar.
   */
  function traerLoDeLaOtraPestana() {
    if (!conflicto) return;
    const c = conflicto;
    const traido = c.actual as Partial<ClinicaDelEditor>;
    setBorrador(b => ({ ...b, ...traido, updatedAt: c.updatedAt }));
    setPublicado(p => ({ ...p, ...traido, updatedAt: c.updatedAt }));
    setTocados(t => t.filter(x => !c.campos.includes(x)));
    setHistorial([]);
    setConflicto(null);
    setNonce(n => n + 1);
    toast("Traído lo que se publicó en la otra pestaña.");
  }

  /* ── avisar al cerrar con cambios ────────────────────────── */
  useEffect(() => {
    if (!sinGuardar) return;
    function alSalir(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [sinGuardar]);

  /* ── medir el lienzo ─────────────────────────────────────── */
  useEffect(() => {
    const el = lienzoRef.current;
    if (!el) return;
    const medir = () => {
      setAnchoDisponible(el.clientWidth);
      setVentanaChica(window.innerWidth < MINIMO_ESCRITORIO);
    };
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    window.addEventListener("resize", medir);
    return () => { obs.disconnect(); window.removeEventListener("resize", medir); };
  }, [editable]);

  const escala = Math.min(1, anchoDisponible / ANCHO_LIENZO);

  /* ══════════════════════════════════════════════════════════
     Pantallas que NO son el lienzo
     ══════════════════════════════════════════════════════════ */

  if (!editable) {
    return (
      <Aviso
        titulo={`«${manifiesto.nombre}» todavía no se edita desde el lienzo`}
        cuerpo={
          "Esta plantilla aún no está preparada para editarse haciendo clic encima. " +
          "Cámbiala por una que sí lo esté, o edítala desde el formulario de siempre — " +
          "que sigue funcionando igual."
        }
      />
    );
  }

  if (ventanaChica) {
    return (
      <Aviso
        titulo="El editor visual necesita una pantalla grande"
        cuerpo={
          `Tu sitio se edita a tamaño real, y para eso hacen falta al menos ${MINIMO_ESCRITORIO} px de ancho. ` +
          "Desde el teléfono usa el formulario de siempre: hace exactamente lo mismo."
        }
      />
    );
  }

  /* ══════════════════════════════════════════════════════════
     El lienzo
     ══════════════════════════════════════════════════════════ */

  return (
    /* fixed y no absolute: el editor ocupa la pantalla entera por encima del
       panel. Ningún ancestro de /dashboard crea contexto de contención
       (container-type / transform), así que el fixed se ancla al viewport. */
    <div className="fixed inset-0 z-[70] flex flex-col bg-[color:var(--bg)]">

      {/* ── BARRA ─────────────────────────────────────────── */}
      <header className="flex items-center gap-3 shrink-0 h-14 px-4 border-b border-[color:var(--border-soft)] bg-card">
        <Link
          href="/dashboard/landing"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] text-sm font-medium text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition"
        >
          <ArrowLeft size={15} /> Salir
        </Link>

        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[color:var(--text-1)] truncate">{borrador.name}</div>
          <div className="text-[11px] text-[color:var(--text-3)] truncate">
            Plantilla «{manifiesto.nombre}»
            {!borrador.landingActive && " · sin publicar"}
          </div>
        </div>

        {sinGuardar && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-[color:var(--warning-soft)] text-[color:var(--warning-strong)] border border-[color:var(--warning-border-strong)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--warning)]" />
            Sin publicar
          </span>
        )}

        {/* Color de acento. Los FONDOS no se editan: los define la plantilla,
            y decirlo aquí evita la pregunta de soporte. */}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-2)]">
            <span className="hidden xl:inline">Color de acento</span>
            <input
              type="color"
              value={acento}
              onChange={e => escribir("landingThemeColor", e.target.value)}
              aria-label="Color de acento"
              className="w-9 h-9 rounded-[var(--radius-sm)] border border-[color:var(--border-soft)] cursor-pointer bg-transparent p-0.5"
            />
          </label>

          {ratio < 4.5 && (
            <span
              title={`El texto blanco sobre este color queda en ${ratio.toFixed(1)}:1. Por debajo de 4.5:1 cuesta leerlo.`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-1 bg-[color:var(--warning-soft)] text-[color:var(--warning-strong)]"
            >
              <AlertTriangle size={13} /> {ratio.toFixed(1)}:1
            </span>
          )}

          <button
            type="button" onClick={deshacer} disabled={historial.length === 0}
            title="Deshacer el último cambio"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] text-sm font-medium text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Undo2 size={15} /> <span className="hidden xl:inline">Deshacer</span>
          </button>

          <button
            type="button" onClick={descartar} disabled={!sinGuardar}
            title="Volver a lo que está publicado"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] text-sm font-medium text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <RotateCcw size={15} /> <span className="hidden xl:inline">Descartar</span>
          </button>

          <a
            href={`/${borrador.slug}`} target="_blank" rel="noopener noreferrer"
            title="Abrir el sitio público en otra pestaña"
            className="inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)] text-[color:var(--text-3)] hover:bg-[color:var(--bg-hover)] transition"
          >
            <ExternalLink size={15} />
          </a>

          {/* () => y no onClick={guardar}: guardar() acepta un argumento opcional
              y onClick le pasaría el MouseEvent como si fuera "publica lo mío
              de todos modos". */}
          <button
            type="button" onClick={() => void guardar()} disabled={!sinGuardar || guardando}
            className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-sm)] text-sm font-semibold text-white bg-brand-600 shadow-[var(--shadow-1)] hover:bg-brand-700 active:scale-[0.98] transition disabled:opacity-[.45] disabled:cursor-not-allowed"
          >
            {guardando ? "Publicando…" : "Publicar cambios"}
          </button>
        </div>
      </header>

      {/* ── PISTA ─────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-1.5 text-[11.5px] text-[color:var(--text-3)] border-b border-[color:var(--border-soft)] bg-[color:var(--bg-elev)]">
        Haz clic sobre cualquier texto para cambiarlo. Suelta una foto encima de su hueco para
        sustituirla. El fondo lo define la plantilla: si quieres otro fondo, cambia de plantilla.
      </div>

      {/* ── LIENZO ────────────────────────────────────────
          El iframe conserva SU PROPIO SCROLL y solo se escala por ancho.
          Estirarlo al alto del contenido rompería los hero de 100vh, las
          barras sticky y los botones fixed de las ocho plantillas. */}
      <div ref={lienzoRef} className="flex-1 min-h-0 overflow-hidden bg-[color:var(--bg-elev)]">
        <iframe
          ref={iframeRef}
          key={`${tpl}-${nonce}`}
          src={`/landing-preview/${borrador.slug}?preview=${tpl}&edit=1`}
          title="Tu sitio, editable"
          className="border-0 bg-white origin-top-left block"
          style={{
            width: ANCHO_LIENZO,
            height: `${100 / escala}%`,
            transform: `scale(${escala})`,
          }}
        />
      </div>

      {/* ── CONFLICTO ─────────────────────────────────────
          Dos superficies vivas a la vez (este lienzo y el formulario) es una
          decisión, no un accidente. Cuando la fila se movió por debajo, no se
          pisa: se dice. */}
      {conflicto && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4">
          <div className="max-w-lg w-full bg-card border border-[color:var(--border-soft)] rounded-[var(--radius-lg)] shadow-[var(--shadow-2)] p-5 space-y-3">
            <h2 className="text-[15px] font-semibold text-[color:var(--text-1)]">
              Alguien más publicó {enumerar(conflicto.campos.map(c => NOMBRE_DE_COLUMNA[c] ?? c))}
            </h2>
            <p className="text-[13px] text-[color:var(--text-2)] leading-relaxed">
              Después de que abrieras este editor, se publicó otra versión de eso mismo —tú en otra
              ventana, o alguien más de la clínica— y no la pisamos por tu cuenta. Lo que escribiste
              aquí sigue en pantalla: decide tú cuál se queda.
            </p>
            <ul className="text-[12.5px] text-[color:var(--text-3)] leading-relaxed list-disc pl-5 space-y-0.5">
              <li><b>Publicar lo mío</b>: se queda lo que ves en el lienzo y se sustituye lo otro.</li>
              <li><b>Traer lo de la otra pestaña</b>: gana lo que ya está publicado. Lo que escribiste
                  en {enumerar(conflicto.campos.map(c => NOMBRE_DE_COLUMNA[c] ?? c))} se pierde; lo demás
                  se queda aquí sin publicar.</li>
            </ul>
            <div className="flex flex-wrap gap-2 justify-end pt-1">
              <button
                type="button" onClick={() => setConflicto(null)}
                className="h-9 px-3 rounded-[var(--radius-sm)] text-sm font-medium text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition"
              >
                Seguir aquí sin decidir
              </button>
              <button
                type="button" onClick={traerLoDeLaOtraPestana}
                className="h-9 px-3 rounded-[var(--radius-sm)] text-sm font-medium text-[color:var(--text-1)] border border-[color:var(--border-soft)] hover:bg-[color:var(--bg-hover)] transition"
              >
                Traer lo de la otra pestaña
              </button>
              <button
                type="button" onClick={publicarDeTodosModos}
                className="h-9 px-4 rounded-[var(--radius-sm)] text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition"
              >
                Publicar lo mío
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Aviso({ titulo, cuerpo }: { titulo: string; cuerpo: string }) {
  return (
    <div className="max-w-lg mx-auto mt-10 bg-card border border-[color:var(--border-soft)] rounded-[var(--radius-lg)] shadow-[var(--shadow-1)] p-6 space-y-3">
      <div className="flex items-center gap-2 text-[color:var(--text-3)]"><Monitor size={16} /></div>
      <h1 className="text-[16px] font-semibold text-[color:var(--text-1)]">{titulo}</h1>
      <p className="text-[13.5px] text-[color:var(--text-2)] leading-relaxed">{cuerpo}</p>
      <Link
        href="/dashboard/landing"
        className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[var(--radius)] text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition"
      >
        <ArrowLeft size={15} /> Ir al editor de siempre
      </Link>
    </div>
  );
}
