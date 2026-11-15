/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — «Conectar mi WhatsApp» (Embedded Signup): las
   decisiones PURAS, sin red ni base. Se prueban en
   src/lib/barber/__tests__/wa-signup.test.ts.

   Por qué existe (15-nov-2026): Rafael terminó la ventana de Meta en
   producción y el panel dijo «Algo salió mal. Intenta de nuevo.» sin más.
   Tres fallos distintos caían en el mismo texto:
     (a) no llegó el `code`: la ventana se cerró o se canceló;
     (b) llegó el `code` pero NO el waba_id / phone_number_id del evento
         FINISH (el mensaje de Meta no llegó, o llegó tarde);
     (c) el servidor falló sin decir por qué.
   Ahora cada uno tiene su texto, y en (b) el SERVIDOR busca la cuenta y el
   número con el propio token en vez de rendirse.

   Client-safe: lo importan el botón (navegador) y la ruta (servidor).
   ═══════════════════════════════════════════════════════════════════════ */

// ── Lo que pasó en la ventana de Meta (navegador) ───────────────────────

/** Lo que Meta avisa por postMessage durante el Embedded Signup. */
export interface BarberSignupSession {
  wabaId?: string;
  phoneNumberId?: string;
  /** El último evento visto: FINISH…, CANCEL o ERROR. */
  lastEvent?: string;
  /** En CANCEL, el paso en el que se cerró (lo manda Meta, no es sensible). */
  cancelStep?: string;
  /** En ERROR, el código de error de Meta (sin el mensaje). */
  errorCode?: string;
}

/**
 * Lee UN mensaje de Meta y devuelve la sesión actualizada, o null si el
 * mensaje no es del Embedded Signup. Nunca lanza.
 */
export function readBarberSignupMessage(
  prev: BarberSignupSession,
  raw: unknown,
): BarberSignupSession | null {
  let data: any = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || data.type !== "WA_EMBEDDED_SIGNUP") return null;
  const event = typeof data.event === "string" ? data.event : "";
  if (!event) return null;
  const d = data.data && typeof data.data === "object" ? data.data : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  if (event.startsWith("FINISH")) {
    // Coexistence emite FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING; el clásico, FINISH.
    return {
      ...prev,
      lastEvent: event,
      wabaId: str(d.waba_id) ?? prev.wabaId,
      phoneNumberId: str(d.phone_number_id) ?? prev.phoneNumberId,
    };
  }
  if (event === "CANCEL") return { ...prev, lastEvent: event, cancelStep: str(d.current_step) };
  if (event === "ERROR") {
    const ec = d.error_code;
    return { ...prev, lastEvent: event, errorCode: ec == null || ec === "" ? undefined : String(ec).slice(0, 20) };
  }
  return { ...prev, lastEvent: event };
}

/**
 * Al volver de la ventana: ¿qué hacemos?
 *   canceled → no hubo `code` (se cerró antes de terminar, o Meta dio error).
 *   send     → hay `code`: se manda al servidor, AUNQUE falte el número (el
 *              servidor lo busca con el token). `missing` dice qué faltó.
 */
export type BarberSignupStep =
  | { kind: "canceled"; reason: "closed" | "metaError" }
  | { kind: "send"; missing: Array<"wabaId" | "phoneNumberId"> };

export function decideBarberSignupStep(code: unknown, s: BarberSignupSession): BarberSignupStep {
  const hasCode = typeof code === "string" && code.length >= 8;
  if (!hasCode) return { kind: "canceled", reason: s.lastEvent === "ERROR" ? "metaError" : "closed" };
  const missing: Array<"wabaId" | "phoneNumberId"> = [];
  if (!s.wabaId) missing.push("wabaId");
  if (!s.phoneNumberId) missing.push("phoneNumberId");
  return { kind: "send", missing };
}

/** Línea de log SIN datos sensibles (ni código, ni token, ni ids). */
export function barberSignupWarnLine(step: BarberSignupStep, s: BarberSignupSession): string | null {
  const parts: string[] = [];
  if (step.kind === "canceled") {
    parts.push(step.reason === "metaError" ? "Meta devolvió ERROR y no llegó el código" : "no llegó el código (ventana cerrada o cancelada)");
  } else if (step.missing.length > 0) {
    parts.push(`llegó el código pero faltó ${step.missing.join(" y ")} del evento FINISH; lo busca el servidor`);
  } else {
    return null;
  }
  parts.push(`último evento: ${s.lastEvent ?? "ninguno"}`);
  if (s.cancelStep) parts.push(`paso: ${s.cancelStep}`);
  if (s.errorCode) parts.push(`código de error de Meta: ${s.errorCode}`);
  return `[barber/whatsapp] Conectar WhatsApp: ${parts.join(" · ")}`;
}

/**
 * La llave del texto que ve la barbería (bajo barber.whatsapp.signup.*).
 * Los códigos que manda el servidor se traducen aquí; un error del servidor
 * sin código usa su `error` si trae uno, y si no, el texto de «servidor».
 */
export type BarberSignupTextKey =
  | "canceled"
  | "metaError"
  | "noNumber"
  | "manyNumbers"
  | "server"
  | "network";

export const BARBER_SIGNUP_SERVER_CODES: Record<string, BarberSignupTextKey> = {
  NUMBER_NOT_FOUND: "noNumber",
  NUMBER_AMBIGUOUS: "manyNumbers",
};

export function barberSignupFailureText(args: {
  step?: BarberSignupStep;
  /** Respuesta del servidor (si la hubo). */
  status?: number;
  body?: { error?: unknown; code?: unknown } | null;
  /** fetch lanzó (sin red). */
  network?: boolean;
}): { key: BarberSignupTextKey } | { message: string } {
  if (args.step?.kind === "canceled") return { key: args.step.reason === "metaError" ? "metaError" : "canceled" };
  if (args.network) return { key: "network" };
  const code = typeof args.body?.code === "string" ? args.body.code : "";
  if (code && BARBER_SIGNUP_SERVER_CODES[code]) return { key: BARBER_SIGNUP_SERVER_CODES[code] };
  const msg = typeof args.body?.error === "string" ? args.body.error.trim() : "";
  if (msg) return { message: msg };
  return { key: "server" };
}

// ── Encontrar la cuenta y el número con el token (servidor) ─────────────

/**
 * Las cuentas de WhatsApp Business (WABA) que la persona compartió con la
 * app, según `GET /debug_token` → `data.granular_scopes[].target_ids` de los
 * permisos de WhatsApp. Es lo que Meta documenta para el Embedded Signup
 * cuando no se tiene el evento FINISH.
 */
export function wabaIdsFromDebugToken(json: unknown): string[] {
  const scopes = (json as any)?.data?.granular_scopes;
  if (!Array.isArray(scopes)) return [];
  const out: string[] = [];
  for (const s of scopes) {
    if (s?.scope !== "whatsapp_business_management" && s?.scope !== "whatsapp_business_messaging") continue;
    for (const id of Array.isArray(s?.target_ids) ? s.target_ids : []) {
      const v = String(id ?? "").trim();
      if (/^\d{5,25}$/.test(v) && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

export interface WabaListing {
  wabaId: string;
  /** Los números que `GET /{waba}/phone_numbers` lista CON ESE TOKEN. */
  phoneNumberIds: string[];
}

export type SignupPick =
  | { ok: true; wabaId: string; phoneNumberId: string; discovered: boolean }
  | { ok: false; code: "NUMBER_NOT_FOUND" | "NUMBER_AMBIGUOUS" };

/**
 * Elige la cuenta y el número. Nunca adivina: con varios candidatos y nada
 * que los distinga, pide volver a intentarlo eligiendo el número.
 *
 * Todo par (cuenta, número) sale de lo que Meta lista con el token que se
 * acaba de obtener: si está en la lista, es de quien autorizó (la misma
 * prueba de propiedad que barberWabaOwnsPhone).
 */
export function pickBarberSignupNumber(args: {
  clientWabaId?: string | null;
  clientPhoneNumberId?: string | null;
  listings: WabaListing[];
}): SignupPick {
  const wabaHint = args.clientWabaId || null;
  const phoneHint = args.clientPhoneNumberId || null;
  const pairs: Array<{ wabaId: string; phoneNumberId: string }> = [];
  for (const l of args.listings) {
    for (const p of l.phoneNumberIds) {
      if (!pairs.some((x) => x.phoneNumberId === p)) pairs.push({ wabaId: l.wabaId, phoneNumberId: p });
    }
  }
  let candidates = pairs;
  if (phoneHint) candidates = candidates.filter((x) => x.phoneNumberId === phoneHint);
  else if (wabaHint) candidates = candidates.filter((x) => x.wabaId === wabaHint);
  if (candidates.length === 0) return { ok: false, code: "NUMBER_NOT_FOUND" };
  if (candidates.length > 1) return { ok: false, code: "NUMBER_AMBIGUOUS" };
  return { ok: true, ...candidates[0], discovered: true };
}
