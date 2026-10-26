// ws1-t4 · «Clave de la sede» — las reglas, sin base ni cookies.
//
// Lo que pidió Rafael (25-oct-2026): un dueño con varias sedes quiere que UNA
// la maneje otra cuenta (un ADMINISTRADOR de esa sede) sin que la cuenta
// principal —SUPER_ADMIN en todas— pueda verla. El pago sigue ligado: si la
// principal no paga se cancelan todas, y eso no se toca aquí.
//
// Con la clave activa NADIE entra a la sede sin teclearla, tampoco el
// SUPER_ADMIN. Con la clave correcta no se vuelve a pedir en 72 h EN ESE
// NAVEGADOR, para ESA persona y ESA sede: la prueba es una cookie httpOnly
// firmada que lleva la VERSIÓN de la clave. Cambiar, desactivar o restablecer
// la clave sube la versión y todas las cookies anteriores dejan de valer.
//
// Este archivo es PURO (solo node:crypto): lo prueban los tests sin request y
// lo comparten el gate de getAuthContext/getCurrentUser, el layout, las rutas
// /api/sede-clave y las vistas que juntan varias sedes. Nunca lo importes desde
// el middleware (Edge): node:crypto no existe ahí.
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { activeClinicSecret } from "@/lib/active-clinic-core";
import { hasPermission } from "@/lib/auth/permissions";
import { CLAVE_MAX, CLAVE_MIN, RUTA_SEDE_CON_CLAVE } from "./constantes";

export { CLAVE_MAX, CLAVE_MIN, RUTA_SEDE_CON_CLAVE, CODIGO_SEDE_CON_CLAVE, STATUS_SEDE_CON_CLAVE } from "./constantes";

/** Cuánto vale un desbloqueo en un navegador. */
export const VIGENCIA_DESBLOQUEO_MS = 72 * 60 * 60 * 1000;
/** 5 claves mal en 15 min para la misma persona+sede → 15 min sin poder intentar. */
export const MAX_FALLOS = 5;
export const VENTANA_FALLOS_MS = 15 * 60 * 1000;
export const BLOQUEO_MS = 15 * 60 * 1000;

/** El permiso que deja a un ADMIN crear y cambiar la clave (src/lib/auth/permissions.ts). */
export const PERMISO_SEDE_CLAVE = "sede.clave" as const;

// ── Quién la gestiona ───────────────────────────────────────────────────

/**
 * ¿Puede esta ficha (la de la sede activa) activar, cambiar o desactivar la
 * clave? El SUPER_ADMIN siempre; un ADMIN solo con el permiso «sede.clave»
 * (que por defecto no tiene: se lo da el dueño en Equipo → Permisos). Ningún
 * otro rol, aunque alguien le meta la llave en su override.
 */
export function puedeGestionarClave(
  user: { role?: string | null; permissionsOverride?: string[] | null } | null | undefined,
): boolean {
  if (!user || typeof user !== "object") return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role !== "ADMIN") return false;
  return hasPermission({ role: "ADMIN", permissionsOverride: user.permissionsOverride ?? [] }, PERMISO_SEDE_CLAVE);
}

// ── La clave nueva ──────────────────────────────────────────────────────

export type ErrorClaveNueva = "vacia" | "corta" | "larga" | "distintas";

export type ValidacionClave =
  | { ok: true; error?: undefined }
  | { ok: false; error: ErrorClaveNueva };

/** La clave nueva y su confirmación: las dos iguales, de 6 a 72 caracteres. */
export function validarClaveNueva(clave: unknown, confirmacion: unknown): ValidacionClave {
  if (typeof clave !== "string" || clave.length === 0) return { ok: false, error: "vacia" };
  if (clave.length < CLAVE_MIN) return { ok: false, error: "corta" };
  if (Buffer.byteLength(clave, "utf8") > CLAVE_MAX) return { ok: false, error: "larga" };
  if (typeof confirmacion !== "string" || confirmacion !== clave) return { ok: false, error: "distintas" };
  return { ok: true };
}

export const MENSAJE_CLAVE_NUEVA: Record<ErrorClaveNueva, string> = {
  vacia: "Escribe la clave de la sede.",
  corta: `La clave debe tener al menos ${CLAVE_MIN} caracteres.`,
  larga: `La clave no puede pasar de ${CLAVE_MAX} caracteres.`,
  distintas: "Las dos claves no coinciden.",
};

// ── La cookie del desbloqueo ────────────────────────────────────────────

/** Secreto DERIVADO del de la cookie de clínica: no se confunde con df_2fa ni con «Ver como clínica». */
export function secretoDesbloqueo(base: string = activeClinicSecret()): string {
  return `${base}:sede-clave`;
}

/**
 * Nombre de la cookie de UNA persona en UNA sede. Va por persona y sede para
 * que en la computadora compartida de recepción el desbloqueo de una persona
 * no pise el de otra. Hash corto: ni el id de la sede ni el de la persona
 * quedan a la vista en el nombre.
 */
export function nombreCookieDesbloqueo(supabaseId: string, clinicId: string): string {
  const h = createHash("sha256").update(JSON.stringify([supabaseId, clinicId])).digest("hex").slice(0, 16);
  return `df_sede_${h}`;
}

export interface DatosDesbloqueo {
  supabaseId: string;
  clinicId: string;
  version: number;
  /** Instante (ms) en que se tecleó la clave. */
  emitidoMs: number;
}

function firmar(valor: string, secreto: string): string {
  return createHmac("sha256", secreto).update(valor).digest("hex").slice(0, 32);
}

/** `<base64url(json)>.<hmac>`. JSON porque los ids importados pueden traer cualquier carácter. */
export function empacarDesbloqueo(d: DatosDesbloqueo, secreto: string = secretoDesbloqueo()): string {
  const valor = Buffer.from(JSON.stringify([d.supabaseId, d.clinicId, d.version, d.emitidoMs]), "utf8").toString("base64url");
  return `${valor}.${firmar(valor, secreto)}`;
}

export function desempacarDesbloqueo(raw: string | null | undefined, secreto: string = secretoDesbloqueo()): DatosDesbloqueo | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  const i = raw.lastIndexOf(".");
  if (i < 1) return null;
  const valor = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(firmar(valor, secreto));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const arr = JSON.parse(Buffer.from(valor, "base64url").toString("utf8"));
    if (!Array.isArray(arr) || arr.length !== 4) return null;
    const [supabaseId, clinicId, version, emitidoMs] = arr;
    if (typeof supabaseId !== "string" || !supabaseId) return null;
    if (typeof clinicId !== "string" || !clinicId) return null;
    if (!Number.isInteger(version) || !Number.isFinite(emitidoMs)) return null;
    return { supabaseId, clinicId, version, emitidoMs };
  } catch {
    return null;
  }
}

/**
 * ¿Esta cookie prueba que ESTA persona tecleó la clave VIGENTE de ESTA sede
 * hace menos de 72 h? Las cuatro cosas, todas: firma, persona+sede, versión
 * (si la clave cambió, se desactivó o se restableció, ya no vale) y vigencia.
 */
export function desbloqueoVigente(
  raw: string | null | undefined,
  esperado: { supabaseId: string; clinicId: string; version: number },
  ahoraMs: number = Date.now(),
  secreto: string = secretoDesbloqueo(),
): boolean {
  const d = desempacarDesbloqueo(raw, secreto);
  if (!d) return false;
  if (d.supabaseId !== esperado.supabaseId || d.clinicId !== esperado.clinicId) return false;
  if (d.version !== esperado.version) return false;
  const edad = ahoraMs - d.emitidoMs;
  return edad >= 0 && edad <= VIGENCIA_DESBLOQUEO_MS;
}

// ── La decisión del gate ────────────────────────────────────────────────

export interface EstadoClave {
  /** Hay clave puesta en la sede. */
  activa: boolean;
  /** Sube con cada activar/cambiar/desactivar/restablecer. */
  version: number;
}

/**
 * LA decisión para una sesión de clínica:
 *   · sin clave en la sede                    → libre
 *   · «Ver como clínica» desde /admin          → libre (queda en su bitácora)
 *   · con clave y desbloqueo vigente           → libre
 *   · con clave y sin desbloqueo               → bloqueada
 */
export function sedeBloqueada(input: {
  estado: EstadoClave | null;
  verComoAdmin: boolean;
  cookie: string | null | undefined;
  supabaseId: string;
  clinicId: string;
  ahoraMs?: number;
  secreto?: string;
}): boolean {
  if (!input.estado || !input.estado.activa) return false;
  if (input.verComoAdmin) return false;
  return !desbloqueoVigente(
    input.cookie,
    { supabaseId: input.supabaseId, clinicId: input.clinicId, version: input.estado.version },
    input.ahoraMs ?? Date.now(),
    input.secreto ?? secretoDesbloqueo(),
  );
}

// ── Intentos ────────────────────────────────────────────────────────────

export interface Intento {
  ok: boolean;
  /** ms */
  en: number;
}

export interface EstadoIntentos {
  /** Hasta cuándo (ms) no se puede intentar; null si se puede. */
  bloqueadoHasta: number | null;
  /** Cuántos fallos más se aguantan antes del bloqueo. */
  restantes: number;
}

/**
 * Cuenta los intentos de UNA persona en UNA sede (y una versión de la clave).
 * Solo cuentan los fallos posteriores al último acierto. Cinco fallos dentro de
 * 15 min bloquean 15 min desde el quinto; mientras dura el bloqueo no se
 * registra nada (la ruta corta antes de comprobar), y al acabar se empieza de
 * cero.
 */
export function estadoDeIntentos(intentos: readonly Intento[], ahoraMs: number = Date.now()): EstadoIntentos {
  const orden = intentos
    .filter((x) => x && Number.isFinite(x.en))
    .slice()
    .sort((a, b) => a.en - b.en);
  let ultimoOk = -Infinity;
  for (const x of orden) if (x.ok) ultimoOk = x.en;

  let hasta: number | null = null;
  let ventana: number[] = [];
  for (const x of orden) {
    if (x.ok || x.en <= ultimoOk) continue;
    if (hasta !== null && x.en < hasta) continue;
    ventana = ventana.filter((t) => x.en - t <= VENTANA_FALLOS_MS);
    ventana.push(x.en);
    if (ventana.length >= MAX_FALLOS) {
      hasta = x.en + BLOQUEO_MS;
      ventana = [];
    }
  }
  if (hasta !== null && hasta > ahoraMs) return { bloqueadoHasta: hasta, restantes: 0 };
  const vivos = ventana.filter((t) => ahoraMs - t <= VENTANA_FALLOS_MS).length;
  return { bloqueadoHasta: null, restantes: Math.max(0, MAX_FALLOS - vivos) };
}

/** «Espera N minutos»: redondeado hacia arriba, mínimo 1. */
export function minutosHasta(hastaMs: number, ahoraMs: number = Date.now()): number {
  return Math.max(1, Math.ceil((hastaMs - ahoraMs) / 60_000));
}

/** ¿El valor del destino tras desbloquear es una pantalla del panel? (evita redirecciones abiertas) */
export function destinoSeguro(next: unknown): string {
  if (typeof next !== "string") return "/dashboard";
  if (!next.startsWith("/dashboard") || next.startsWith("//") || next.startsWith(RUTA_SEDE_CON_CLAVE)) return "/dashboard";
  return next;
}
