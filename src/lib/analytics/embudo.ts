// Embudo de captación del SITIO PÚBLICO (ws1-t9, punto 3 del encargo de ws7).
//
// UNA sola función, `registrarPaso(paso, datos)`, que todas las pantallas
// llaman al pasar por un paso del embudo. Los nombres de los eventos de GA4 son
// ESTABLES (no se renombran: GA4 y la tarjeta de /admin los cuentan por nombre):
//
//   landing_vista → clic_empezar → registro_vista → registro_enviado →
//   registro_ok → onboarding_completo → checkout_iniciado → pago_ok
//   (+ whatsapp_clic, con su origen)
//
// Qué hace por llamada (todo en el navegador, nunca lanza, nunca navega):
//   1. no hace NADA en rutas privadas (isPrivatePath): ni GA4 ni propio;
//   2. «primera visita»: guarda utm_source/utm_campaign/gclid/fbclid de la
//      PRIMERA llegada con parámetros (localStorage, una vez, no se pisa);
//   3. manda el evento a GA4 (gtag, con send_to) — registro_ok y pago_ok llevan
//      además los parámetros de la primera visita;
//   4. lo cuenta en la analítica propia (tracker, name «paso:<paso>») para que
//      /admin lo lea de la base;
//   5. avisa a los DESTINOS EXTRA registrados (`agregarDestinoPaso`): ahí
//      cuelgan Meta (Lead) y Google Ads («Clic en WhatsApp», secundaria) sin que
//      este archivo conozca meta-pixel*.ts ni gtag.ts.
//
// Pasos que deben salir UNA vez (landing_vista y registro_vista por sesión de
// navegador; registro_ok, onboarding_completo, checkout_iniciado y pago_ok por
// `datos.id`) se marcan en sessionStorage/localStorage.
//
// Sin datos personales: ni correo, ni teléfono, ni nombres. Solo el paso, el
// origen del botón, el plan, el importe y los parámetros de campaña.

import { GA4_MEASUREMENT_ID, isPrivatePath } from "./ga4";
import { limpiarUtm } from "@/lib/ads/utm";
import { custom as contarPropio } from "./tracker-core";

export const PASOS_EMBUDO = [
  "landing_vista",
  "clic_empezar",
  "registro_vista",
  "registro_enviado",
  "registro_ok",
  "onboarding_completo",
  "checkout_iniciado",
  "pago_ok",
] as const;

export type PasoEmbudo = (typeof PASOS_EMBUDO)[number] | "whatsapp_clic";

/** Dónde estaba el botón que se tocó (clic_empezar / whatsapp_clic). */
export type OrigenBoton = "hero" | "precio" | "barra_movil" | "banda";

export interface DatosPaso {
  /** Botón de origen (clic_empezar, whatsapp_clic). */
  origen?: OrigenBoton;
  /** Plan elegido (BASIC | PRO | CLINIC), si el paso lo conoce. */
  plan?: string;
  /** Clave para «una sola vez» (clinicId, id de la sesión de Checkout…). */
  id?: string;
  /** Solo pago_ok: pesos SIN IVA con cupón, el mismo valor de «Pago completado». */
  valueMxn?: number;
  currency?: string;
}

/** Parámetros de campaña de la PRIMERA visita. */
export interface PrimeraVisita {
  utm_source?: string;
  utm_campaign?: string;
  gclid?: string;
  fbclid?: string;
}

export const CLAVE_PRIMERA_VISITA = "dc.primera-visita";
/** Pasos que llevan la primera visita. */
const PASOS_CON_ATRIBUCION = new Set<PasoEmbudo>(["registro_ok", "pago_ok"]);
/** Una vez por sesión de navegador (sin id). */
const UNA_POR_SESION = new Set<PasoEmbudo>(["landing_vista", "registro_vista"]);
/** Una vez por id. */
const UNA_POR_ID = new Set<PasoEmbudo>(["registro_ok", "onboarding_completo", "checkout_iniciado", "pago_ok"]);

export type DestinoPaso = (paso: PasoEmbudo, datos: DatosPaso, atribucion: PrimeraVisita) => void;
const destinosExtra: DestinoPaso[] = [];

/** Engancha un destino extra (Meta, Google Ads). Devuelve la función que lo quita. */
export function agregarDestinoPaso(fn: DestinoPaso): () => void {
  destinosExtra.push(fn);
  return () => {
    const i = destinosExtra.indexOf(fn);
    if (i >= 0) destinosExtra.splice(i, 1);
  };
}

// ── Primera visita ──────────────────────────────────────────────────────────

/** Los 4 parámetros de una query string, limpios y acotados. Puro. */
export function extraerPrimeraVisita(search: string): PrimeraVisita {
  const p = new URLSearchParams(search);
  const out: PrimeraVisita = {};
  for (const k of ["utm_source", "utm_campaign", "gclid", "fbclid"] as const) {
    const v = limpiarUtm(p.get(k));
    if (v) out[k] = v;
  }
  return out;
}

function almacen(tipo: "localStorage" | "sessionStorage"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window[tipo];
  } catch {
    return null;
  }
}

export function leerPrimeraVisita(): PrimeraVisita {
  try {
    const crudo = almacen("localStorage")?.getItem(CLAVE_PRIMERA_VISITA);
    if (!crudo) return {};
    const o = JSON.parse(crudo) as Record<string, unknown>;
    return extraerPrimeraVisita(
      new URLSearchParams(
        Object.entries(o).filter(([, v]) => typeof v === "string") as [string, string][],
      ).toString(),
    );
  } catch {
    return {};
  }
}

/**
 * Guarda los parámetros de la URL actual SOLO si aún no hay primera visita y la
 * URL trae al menos uno. Nunca pisa. Devuelve lo que quedó guardado.
 */
export function capturarPrimeraVisita(search?: string): PrimeraVisita {
  try {
    const previa = leerPrimeraVisita();
    if (Object.keys(previa).length > 0) return previa;
    const ahora = extraerPrimeraVisita(search ?? (typeof window !== "undefined" ? window.location.search : ""));
    if (Object.keys(ahora).length === 0) return {};
    almacen("localStorage")?.setItem(CLAVE_PRIMERA_VISITA, JSON.stringify(ahora));
    return ahora;
  } catch {
    return {};
  }
}

// ── Parámetros de GA4 ───────────────────────────────────────────────────────

/** Forma exacta del evento de GA4 (sin efectos: se prueba solo). */
export function parametrosGa4(paso: PasoEmbudo, datos: DatosPaso, atribucion: PrimeraVisita): Record<string, unknown> {
  const p: Record<string, unknown> = { send_to: GA4_MEASUREMENT_ID };
  if (datos.origen) p.origen = datos.origen;
  if (datos.plan) p.plan = datos.plan;
  if (paso === "pago_ok") {
    if (typeof datos.valueMxn === "number") p.value = datos.valueMxn;
    p.currency = (datos.currency || "MXN").toUpperCase();
    if (datos.id) p.transaction_id = datos.id;
  }
  if (PASOS_CON_ATRIBUCION.has(paso)) {
    for (const [k, v] of Object.entries(atribucion)) if (v) p[k] = v;
  }
  return p;
}

// ── Una sola vez ────────────────────────────────────────────────────────────

function marca(paso: PasoEmbudo, datos: DatosPaso): { tipo: "localStorage" | "sessionStorage"; clave: string } | null {
  if (UNA_POR_ID.has(paso)) {
    return datos.id ? { tipo: "localStorage", clave: `dc.embudo.${paso}.${datos.id}` } : null;
  }
  if (UNA_POR_SESION.has(paso)) return { tipo: "sessionStorage", clave: `dc.embudo.${paso}` };
  return null;
}

/** true si ya salió (y entonces no se vuelve a mandar); si no, lo marca. */
function yaSalio(paso: PasoEmbudo, datos: DatosPaso): boolean {
  const m = marca(paso, datos);
  if (!m) return false;
  try {
    const a = almacen(m.tipo);
    if (!a) return false;
    if (a.getItem(m.clave)) return true;
    a.setItem(m.clave, "1");
  } catch {
    // sin storage: sale; GA4 deduplica pago_ok por transaction_id
  }
  return false;
}

// ── Registro ────────────────────────────────────────────────────────────────

type GtagFn = (...args: unknown[]) => void;

export type ResultadoPaso = "enviado" | "ya-enviado" | "privada" | "sin-navegador";

/**
 * Registra que alguien pasó por `paso`. Nunca lanza. El resultado dice qué
 * pasó (para pruebas y diagnóstico), no hace falta mirarlo.
 */
export function registrarPaso(paso: PasoEmbudo, datos: DatosPaso = {}): ResultadoPaso {
  try {
    if (typeof window === "undefined") return "sin-navegador";
    if (isPrivatePath(window.location.pathname)) return "privada";

    const atribucion = capturarPrimeraVisita();
    if (yaSalio(paso, datos)) return "ya-enviado";

    const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
    if (typeof gtag === "function") {
      try {
        gtag("event", paso, parametrosGa4(paso, datos, atribucion));
      } catch {
        // medir nunca rompe la pantalla
      }
    }
    try {
      contarPropio(`paso:${paso}`);
    } catch {
      // idem
    }
    for (const d of [...destinosExtra]) {
      try {
        d(paso, datos, atribucion);
      } catch {
        // un destino roto no tumba a los demás
      }
    }
    return "enviado";
  } catch {
    return "sin-navegador";
  }
}
