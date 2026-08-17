"use client";
/* ============================================================
   VISTA PREVIA EN VIVO de la mini-web.

   /dashboard/landing tiene la mini-web metida en un <iframe>. Antes
   ese iframe SOLO se recargaba al guardar: la clínica escribía a
   ciegas. Ahora el editor manda los cambios por postMessage y la
   plantilla se vuelve a pintar SIN recargar — no se pierde el scroll
   ni parpadea, y no hay una petición por tecla.

   Quién es quién:
     · el editor  → manda { kind:"patch" } con lo que lleva escrito.
     · esta pieza → vive DENTRO del iframe, avisa { kind:"ready" }
       cuando ya puede recibir y aplica el parche encima de la
       clínica que vino del servidor.
     · las plantillas → llaman useLiveClinic(clinic) y ya.

   ⚠️ SEGURIDAD — la lista de campos es una allowlist CERRADA.
   Ver el commit 0424d5ab: la mini-web llegó a serializar la fila
   entera de Clinic (waAccessToken, facturApiLiveKey…) dentro del HTML
   público. Aquí viaja exclusivamente lo que el formulario de
   /dashboard/landing sabe editar; cualquier otra clave se tira. La
   lista se deriva de CAMPOS_VIVOS, que es también el validador: un
   valor con la forma equivocada NO se aplica.

   Fuera del iframe (la página pública /[slug]) no hay proveedor:
   useLiveClinic devuelve la clínica tal cual y no se escucha nada.
   ============================================================ */
import {
  Component, createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import type { LandingClinic } from "./types";

/* ── Validadores por forma. Se rechaza el campo, no el mensaje entero:
      un valor roto deja la vista previa en lo último bueno. ───────── */
const esTexto  = (v: unknown) => v === null || typeof v === "string";
const esNumero = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const esLista  = (v: unknown) => Array.isArray(v);
const esUrls   = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");
const esMapa   = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Los campos que /dashboard/landing edita, y solo esos.
 *
 * Si mañana el editor aprende a cambiar otra cosa, se agrega AQUÍ (y en
 * ALLOWED de /api/clinic-landing). Nada que no esté en este mapa viaja
 * al iframe ni se aplica dentro de él.
 */
const CAMPOS_VIVOS = {
  description:            esTexto,
  landingThemeColor:      esTexto,
  landingTagline:         esTexto,
  landingYearsExperience: esNumero,
  landingPatients:        esTexto,
  landingUrgentText:      esTexto,
  landingMsiPlazos:       esLista,
  landingCoverUrl:        esTexto,
  landingGallery:         esUrls,
  landingMapEmbed:        esTexto,
  landingServices:        esLista,
  landingTestimonials:    esLista,
  landingFaqs:            esLista,
  landingWhatsapp:        esTexto,
  landingInstagram:       esTexto,
  landingFacebook:        esTexto,
  landingTiktok:          esTexto,
  landingSections:        esLista,
  landingPhotos:          esMapa,
} satisfies Record<string, (v: unknown) => boolean>;

export type LivePreviewField = keyof typeof CAMPOS_VIVOS;
export type LivePreviewPatch = Partial<Record<LivePreviewField, unknown>>;

/** Los nombres, para que el editor arme el parche sin repetir la lista. */
export const LIVE_PREVIEW_FIELDS = Object.keys(CAMPOS_VIVOS) as LivePreviewField[];

/** Marca de los mensajes: el mismo origen también trae ruido de extensiones. */
export const LIVE_PREVIEW_MSG = "dc-landing-live";

export interface LivePreviewMessage {
  source: typeof LIVE_PREVIEW_MSG;
  kind: "patch" | "ready";
  slug: string;
  patch?: LivePreviewPatch;
}

/**
 * Deja pasar solo los campos conocidos y con la forma correcta.
 * Devuelve null si no quedó nada aplicable (así un mensaje vacío o
 * corrupto no borra lo que la clínica ya está viendo).
 */
export function pickLiveFields(raw: unknown): LivePreviewPatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entrada = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const campo of LIVE_PREVIEW_FIELDS) {
    if (!(campo in entrada)) continue;
    const valor = entrada[campo];
    if (valor === undefined) continue;
    if (!CAMPOS_VIVOS[campo](valor)) continue; // forma equivocada: se ignora ese campo
    out[campo] = valor;
  }
  return Object.keys(out).length > 0 ? (out as LivePreviewPatch) : null;
}

/** Lee un mensaje del canal, ya validado el origen y el slug. null = no es nuestro. */
export function parseLiveMessage(ev: MessageEvent, slug: string): LivePreviewMessage | null {
  if (typeof window === "undefined") return null;
  if (ev.origin !== window.location.origin) return null;
  const d = ev.data as Partial<LivePreviewMessage> | null;
  if (!d || typeof d !== "object") return null;
  if (d.source !== LIVE_PREVIEW_MSG) return null;
  if (d.kind !== "patch" && d.kind !== "ready") return null;
  // Multi-tenant: la vista previa es la de ESTA clínica y de ninguna otra.
  if (d.slug !== slug) return null;
  return d as LivePreviewMessage;
}

/** Manda el parche al iframe. Si todavía no cargó, postMessage no hace nada. */
export function postLivePreview(win: Window | null | undefined, slug: string, patch: LivePreviewPatch) {
  if (!win || typeof window === "undefined") return;
  const limpio = pickLiveFields(patch);
  if (!limpio) return;
  try {
    win.postMessage(
      { source: LIVE_PREVIEW_MSG, kind: "patch", slug, patch: limpio } satisfies LivePreviewMessage,
      window.location.origin,
    );
  } catch {
    /* El iframe se fue a otro origen o ya no existe: la vista previa
       se queda en lo publicado, que es exactamente el respaldo. */
  }
}

/* ============================================================
   Contexto + hook
   ============================================================ */
const LiveClinicCtx = createContext<LivePreviewPatch | null>(null);

/**
 * La clínica que debe pintar la plantilla.
 *
 * Sin proveedor (la página pública) devuelve la misma referencia que
 * llegó del servidor: cero coste y cero cambio de comportamiento.
 */
export function useLiveClinic<T extends LandingClinic>(clinic: T): T {
  const patch = useContext(LiveClinicCtx);
  return useMemo(() => (patch ? ({ ...clinic, ...patch } as T) : clinic), [clinic, patch]);
}

/* ============================================================
   Red de seguridad: si la plantilla revienta con un parche, se
   vuelve a lo publicado en vez de dejar el iframe en blanco.
   ============================================================ */
class LiveBoundary extends Component<
  { onFail: () => void; resetKey: number; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  componentDidUpdate(prev: { resetKey: number }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * Puente editor ⇄ iframe. Solo se monta en /landing-preview/[slug];
 * la página pública nunca escucha mensajes de nadie.
 */
export function LivePreviewBridge({ slug, children }: { slug: string; children: ReactNode }) {
  const [patch, setPatch] = useState<LivePreviewPatch | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = parseLiveMessage(ev, slug);
      if (!msg || msg.kind !== "patch") return;
      const limpio = pickLiveFields(msg.patch);
      if (limpio) setPatch(limpio);
    }
    window.addEventListener("message", onMessage);
    /* El editor no tiene forma de saber cuándo terminó de cargar el iframe:
       se lo decimos nosotros y él contesta con el estado actual. Sin padre
       (la vista previa abierta en su propia pestaña) el mensaje se lo manda
       a sí mismo y el listener lo descarta por kind. */
    try {
      window.parent?.postMessage(
        { source: LIVE_PREVIEW_MSG, kind: "ready", slug } satisfies LivePreviewMessage,
        window.location.origin,
      );
    } catch { /* padre de otro origen: se queda con lo publicado */ }
    return () => window.removeEventListener("message", onMessage);
  }, [slug]);

  /* Si la plantilla revienta con un parche se vuelve a lo PUBLICADO, que es
     justo lo que pinta la página pública y por tanto no puede fallar: el
     bucle termina siempre. El siguiente parche se intenta igual, así que
     borrar el carácter que rompió la cosa recupera la vista previa sola. */
  function alFallar() {
    // Ya estábamos en lo publicado: no hay a dónde volver y reintentar sería
    // un bucle infinito. Se deja como está (eso ya sería un fallo de la
    // plantilla, y rompería igual la página pública).
    if (patch === null) return;
    setPatch(null);
    setResetKey(k => k + 1);
  }

  return (
    <LiveClinicCtx.Provider value={patch}>
      <LiveBoundary onFail={alFallar} resetKey={resetKey}>{children}</LiveBoundary>
    </LiveClinicCtx.Provider>
  );
}
