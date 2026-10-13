// Events API de TikTok — el NÚCLEO PURO (ws1-t5, tanda ws7). Espejo de meta-capi.ts.
//
// Lo que el píxel pierde (bloqueadores, Safari/ITP, SPEI de Stripe, SPEI directo)
// sale también del servidor con el MISMO event_id que el píxel:
//   · CompleteRegistration → `alta.<clinicId>`
//   · Purchase      → id de la sesión de Checkout (cs_…) o `spei.<id>`
// TikTok junta navegador+servidor si coinciden event + event_id.
//
// Datos de coincidencia (user): correo y teléfono SOLO en SHA-256 (correo en
// minúsculas; teléfono en E.164 con «+»), más ip, user_agent, ttclid y ttp en
// claro, que es lo que la API pide. Sin nada más personal.
//
// TOKEN: process.env.TIKTOK_EVENTS_API_TOKEN (Vercel). Va en la cabecera
// `Access-Token` (así lo pide TikTok), nunca en la URL, nunca en un log. Sin
// token la API queda apagada: «sin-token», un aviso en el log, y el píxel sigue.
// TIKTOK_TEST_EVENT_CODE (opcional) manda a «Probar eventos»; vacío en producción.
//
// Sin red ni base: `fetch` y el entorno se inyectan (se prueba con tsx --test).

import { TIKTOK_PIXEL_ID } from "./tiktok-pixel";
import { normalizarCorreo, normalizarTelefono, sha256 } from "./meta-capi";

export const TIKTOK_EVENTS_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
/** Más de esto y se abandona: medir nunca alarga un alta ni un webhook. */
export const TIKTOK_CAPI_TIMEOUT_MS = 4000;

export type NombreEventoTiktok = "CompleteRegistration" | "Purchase";

export interface SenalesTiktok {
  ip?: string | null;
  userAgent?: string | null;
  ttclid?: string | null;
  /** Cookie _ttp del píxel. */
  ttp?: string | null;
}

export interface DatosEventoTiktok extends SenalesTiktok {
  eventName: NombreEventoTiktok;
  eventId: string;
  /** Epoch en SEGUNDOS. */
  eventTime: number;
  eventSourceUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Solo Purchase: pesos SIN IVA con el cupón descontado. */
  value?: number;
  currency?: string;
  /** Plan (content_id). */
  plan?: string | null;
}

export interface EventoTiktok {
  event: NombreEventoTiktok;
  event_time: number;
  event_id: string;
  user: {
    email?: string;
    phone_number?: string;
    ip?: string;
    user_agent?: string;
    ttclid?: string;
    ttp?: string;
  };
  page?: { url: string };
  properties?: { value?: number; currency?: string; content_type: string; content_id?: string };
}

const ID_RE = /^[A-Za-z0-9_.-]{8,512}$/;

function limpio(v: string | null | undefined, max = 512): string | undefined {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : undefined;
}

/** Teléfono E.164 con «+» (el que TikTok pide antes del hash), reusando la normalización de Meta. */
export function telefonoE164(tel: string | null | undefined): string | null {
  const d = normalizarTelefono(tel);
  return d ? `+${d}` : null;
}

export function construirEventoTiktok(d: DatosEventoTiktok): EventoTiktok {
  const em = normalizarCorreo(d.email);
  const ph = telefonoE164(d.phone);
  const ip = limpio(d.ip, 64);
  const ua = limpio(d.userAgent, 1000);
  const ttclid = limpio(d.ttclid);
  const ttp = limpio(d.ttp);

  const user: EventoTiktok["user"] = {};
  if (em) user.email = sha256(em);
  if (ph) user.phone_number = sha256(ph);
  if (ip) user.ip = ip;
  if (ua) user.user_agent = ua;
  if (ttclid && ID_RE.test(ttclid)) user.ttclid = ttclid;
  if (ttp && ID_RE.test(ttp)) user.ttp = ttp;

  const evento: EventoTiktok = {
    event: d.eventName,
    event_time: Math.floor(d.eventTime),
    event_id: d.eventId,
    user,
  };
  const url = limpio(d.eventSourceUrl, 1000);
  if (url) evento.page = { url };
  const plan = /^[A-Za-z0-9_-]{1,32}$/.test(d.plan ?? "") ? (d.plan as string) : undefined;
  evento.properties = { content_type: "product", ...(plan ? { content_id: plan } : {}) };
  if (d.eventName === "Purchase") {
    const value = Number.isFinite(d.value) && (d.value as number) > 0 ? Math.round((d.value as number) * 100) / 100 : 0;
    evento.properties.value = value;
    evento.properties.currency = (d.currency || "MXN").toUpperCase();
  }
  return evento;
}

export type ResultadoTiktok = "enviado" | "sin-token" | "sin-datos" | "error";

export interface EntornoTiktok {
  token?: string | null;
  testEventCode?: string | null;
  pixelId?: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

let avisoSinToken = false;

/**
 * Manda los eventos. Nunca lanza. TikTok contesta 200 con `code` ≠ 0 cuando
 * rechaza el cuerpo, así que se revisa también el `code` de la respuesta.
 */
export async function enviarEventosTiktok(
  eventos: EventoTiktok[],
  entorno: EntornoTiktok,
  fetchImpl: FetchLike,
): Promise<ResultadoTiktok> {
  const token = (entorno.token ?? "").trim();
  try {
    if (!token) {
      if (!avisoSinToken) {
        avisoSinToken = true;
        console.info("[tiktok-capi] TIKTOK_EVENTS_API_TOKEN no está configurada: la Events API queda apagada (el píxel sigue igual)");
      }
      return "sin-token";
    }
    if (!eventos.length) return "sin-datos";

    const cuerpo: Record<string, unknown> = {
      event_source: "web",
      event_source_id: entorno.pixelId ?? TIKTOK_PIXEL_ID,
      data: eventos,
    };
    const prueba = (entorno.testEventCode ?? "").trim();
    if (prueba) cuerpo.test_event_code = prueba;

    const res = await fetchImpl(TIKTOK_EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": token },
      body: JSON.stringify(cuerpo),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIKTOK_CAPI_TIMEOUT_MS) : undefined,
    });
    const texto = (await res.text().catch(() => "")).replaceAll(token, "[token]");
    if (!res.ok) {
      console.warn(`[tiktok-capi] TikTok respondió ${res.status} a ${eventos.map((e) => e.event).join(",")}: ${texto.slice(0, 300)}`);
      return "error";
    }
    try {
      const j = JSON.parse(texto) as { code?: number; message?: string };
      if (typeof j.code === "number" && j.code !== 0) {
        console.warn(`[tiktok-capi] TikTok rechazó ${eventos.map((e) => e.event).join(",")}: code ${j.code} ${String(j.message ?? "").slice(0, 200)}`);
        return "error";
      }
    } catch {
      // cuerpo no JSON con 200: se da por enviado
    }
    return "enviado";
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    console.warn("[tiktok-capi] no se pudo enviar a TikTok:", token ? msg.replaceAll(token, "[token]") : msg);
    return "error";
  }
}

/** Solo para pruebas. */
export function _reiniciarAvisoSinTokenTiktok(): void {
  avisoSinToken = false;
}
