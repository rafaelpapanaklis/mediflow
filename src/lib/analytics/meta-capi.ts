// API de Conversiones de Meta (CAPI) — el NÚCLEO PURO (WS1-T4).
//
// El píxel del navegador (fbq) se pierde con bloqueadores de anuncios, con
// Safari/ITP y en todos los pagos que no pasan por una página nuestra (SPEI de
// Stripe, SPEI directo confirmado en /admin). Por eso los dos eventos que Meta
// necesita para optimizar —CompleteRegistration y Purchase— salen TAMBIÉN del
// servidor, con el MISMO event_id que el píxel: Meta junta los dos (navegador y
// servidor) en uno solo si coinciden event_name + event_id (deduplicación).
//
//   · CompleteRegistration → event_id = `alta.<clinicId>` (ver eventIdRegistro).
//   · Purchase              → event_id = id de la sesión de Checkout (cs_…), o
//                             `spei.<id de la solicitud>` en el SPEI directo.
//
// Datos de coincidencia (user_data): correo y teléfono SOLO en SHA-256 (Meta
// lo exige así y nosotros no mandamos nada en claro), y en claro lo que el
// propio navegador ya le entrega al píxel: IP, user agent, fbp y fbc.
//
// TOKEN: process.env.META_CAPI_TOKEN (variable de entorno de Vercel). Nunca en
// el código, nunca en la URL (va en el CUERPO del POST, así un log de la URL o
// de un error jamás lo trae) y nunca en un log. Sin token, la API se apaga y
// no pasa nada más: devuelve "sin-token" y avisa UNA vez en el log.
// META_CAPI_TEST_EVENT_CODE (opcional) manda los eventos a «Probar eventos» del
// Administrador de eventos; en producción normal se deja vacía.
//
// Aquí no hay red ni base: `fetch` y el entorno se inyectan, así se prueba con
// `tsx --test` con un Meta falso. El cableado está en meta-capi.server.ts.

import { createHash } from "node:crypto";
import { META_PIXEL_ID } from "./meta-pixel";

/** Versión de la Graph API. Meta mantiene cada versión ~2 años; cambiarla es solo esta línea. */
export const META_GRAPH_VERSION = "v24.0";
/** Más de esto y se abandona: medir nunca puede alargar un alta ni un webhook. */
export const META_CAPI_TIMEOUT_MS = 4000;

export type NombreEventoMeta = "CompleteRegistration" | "Purchase";

export interface SenalesNavegador {
  /** IP de quien hizo la acción (x-forwarded-for), en claro: Meta la pide así. */
  ip?: string | null;
  userAgent?: string | null;
  /** Cookie _fbp del píxel. */
  fbp?: string | null;
  /** «fb.1.<ms>.<fbclid>» (cookie dc_meta / _fbc o lo guardado en el alta). */
  fbc?: string | null;
}

export interface DatosEventoMeta extends SenalesNavegador {
  eventName: NombreEventoMeta;
  eventId: string;
  /** Epoch en SEGUNDOS. */
  eventTime: number;
  /** Página donde ocurrió (solo para los eventos de sitio web). */
  eventSourceUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Solo Purchase: pesos SIN IVA con el cupón descontado. */
  value?: number;
  currency?: string;
}

export interface EventoCapi {
  event_name: NombreEventoMeta;
  event_time: number;
  event_id: string;
  action_source: "website" | "system_generated";
  event_source_url?: string;
  user_data: {
    em?: string[];
    ph?: string[];
    client_ip_address?: string;
    client_user_agent?: string;
    fbp?: string;
    fbc?: string;
  };
  custom_data?: { value: number; currency: string };
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Correo como lo pide Meta antes del hash: sin espacios y en minúsculas. null si no parece correo. */
export function normalizarCorreo(correo: string | null | undefined): string | null {
  const c = (correo ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : null;
}

/**
 * Teléfono como lo pide Meta antes del hash: solo dígitos y CON lada de país,
 * sin «+» ni ceros iniciales. Los de México se guardan como 10 dígitos (alta)
 * o 52 + 10 (clinics.phone); el viejo 521 + 10 de celular se lleva a 52 + 10.
 */
export function normalizarTelefono(tel: string | null | undefined): string | null {
  let d = (tel ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) d = `52${d}`;
  else if (d.length === 13 && d.startsWith("521")) d = `52${d.slice(3)}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

const FBC_RE = /^fb\.\d{1,2}\.\d{10,13}\.[A-Za-z0-9_.-]{10,512}$/;
const FBP_RE = /^fb\.\d{1,2}\.\d{10,13}\.\d{5,20}$/;

function limpio(v: string | null | undefined, max = 512): string | undefined {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : undefined;
}

/** id de evento del alta: el MISMO en el píxel (lo devuelve /api/auth/register) y en el servidor. */
export function eventIdRegistro(clinicId: string): string {
  return `alta.${clinicId}`;
}

/** id de evento del SPEI directo (no hay sesión de Checkout ni píxel con quien deduplicar). */
export function eventIdSpeiDirecto(solicitudId: string): string {
  return `spei.${solicitudId}`;
}

/**
 * Arma el evento tal como lo recibe la CAPI. Sin user agent no puede ir como
 * evento de «sitio web» (Meta lo rechaza): sale como system_generated, que es
 * lo honesto para un pago confirmado sin navegador de por medio.
 */
export function construirEventoCapi(d: DatosEventoMeta): EventoCapi {
  const em = normalizarCorreo(d.email);
  const ph = normalizarTelefono(d.phone);
  const ua = limpio(d.userAgent, 1000);
  const ip = limpio(d.ip, 64);
  const fbp = limpio(d.fbp);
  const fbc = limpio(d.fbc);

  const user_data: EventoCapi["user_data"] = {};
  if (em) user_data.em = [sha256(em)];
  if (ph) user_data.ph = [sha256(ph)];
  if (ip) user_data.client_ip_address = ip;
  if (ua) user_data.client_user_agent = ua;
  if (fbp && FBP_RE.test(fbp)) user_data.fbp = fbp;
  if (fbc && FBC_RE.test(fbc)) user_data.fbc = fbc;

  const web = !!ua;
  const evento: EventoCapi = {
    event_name: d.eventName,
    event_time: Math.floor(d.eventTime),
    event_id: d.eventId,
    action_source: web ? "website" : "system_generated",
    user_data,
  };
  const url = limpio(d.eventSourceUrl, 1000);
  if (web && url) evento.event_source_url = url;
  if (d.eventName === "Purchase") {
    const value = Number.isFinite(d.value) && (d.value as number) > 0 ? Math.round((d.value as number) * 100) / 100 : 0;
    evento.custom_data = { value, currency: (d.currency || "MXN").toUpperCase() };
  }
  return evento;
}

export type ResultadoCapi = "enviado" | "sin-token" | "sin-datos" | "error";

export interface EntornoCapi {
  token?: string | null;
  testEventCode?: string | null;
  pixelId?: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

let avisoSinToken = false;

/**
 * Manda los eventos a la CAPI. Nunca lanza. El token viaja en el cuerpo y
 * jamás se escribe en el log; si Meta contesta error, el log lleva el status y
 * el mensaje de Meta (que no incluye el token).
 */
export async function enviarEventosCapi(
  eventos: EventoCapi[],
  entorno: EntornoCapi,
  fetchImpl: FetchLike,
): Promise<ResultadoCapi> {
  try {
    const token = (entorno.token ?? "").trim();
    if (!token) {
      if (!avisoSinToken) {
        avisoSinToken = true;
        console.info("[meta-capi] META_CAPI_TOKEN no está configurada: la API de Conversiones queda apagada (el píxel sigue igual)");
      }
      return "sin-token";
    }
    if (!eventos.length) return "sin-datos";

    const cuerpo: Record<string, unknown> = { data: eventos, access_token: token };
    const prueba = (entorno.testEventCode ?? "").trim();
    if (prueba) cuerpo.test_event_code = prueba;

    const pixel = entorno.pixelId ?? META_PIXEL_ID;
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixel}/events`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(META_CAPI_TIMEOUT_MS) : undefined,
    });
    if (!res.ok) {
      const detalle = (await res.text().catch(() => "")).replaceAll(token, "[token]").slice(0, 300);
      console.warn(`[meta-capi] Meta respondió ${res.status} a ${eventos.map((e) => e.event_name).join(",")}: ${detalle}`);
      return "error";
    }
    return "enviado";
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    const token = (entorno.token ?? "").trim();
    console.warn("[meta-capi] no se pudo enviar a Meta:", token ? msg.replaceAll(token, "[token]") : msg);
    return "error";
  }
}

/** Solo para pruebas: vuelve a permitir el aviso de «sin token». */
export function _reiniciarAvisoSinToken(): void {
  avisoSinToken = false;
}
