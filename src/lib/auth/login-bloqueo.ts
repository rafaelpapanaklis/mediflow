import type { NextRequest } from "next/server";
import {
  failbanGuard,
  getClientIp,
  isRemembered,
  lockRemainingSec,
  recordAuthFailure,
  recordAuthSuccess,
  recordDistinctFailure,
  rememberKey,
} from "@/lib/failban";
import {
  SCOPE_LOGIN_CLINICA,
  mensajeBloqueoCuenta,
  mensajeBloqueoRed,
} from "@/lib/auth/login-servidor";

/**
 * Bloqueo del login de clínica (revisión en panel.108, 1-oct-2026, F3).
 *
 * Antes contaba IP y cuenta con la misma regla (5 fallos): en una clínica todos
 * salen por la misma IP, así que la recepcionista que se equivocaba cinco veces
 * dejaba fuera al doctor. Ahora:
 *
 *  · CUENTA (correo): el bloqueo fuerte de siempre — 5 fallos en 15 min →
 *    1 min, con backoff hasta 30 min. Aplica igual a correos que no existen.
 *  · IP: solo un tope alto contra ataques masivos — 10 correos DISTINTOS
 *    fallidos en 15 min → la IP queda frenada 15 min. Equivocarse muchas veces
 *    con el mismo correo no suma aquí (eso ya lo frena la cuenta).
 *  · Aun con la IP frenada, una cuenta que ya entró bien desde esa IP en los
 *    últimos 30 días (y que no esté bloqueada ella) sigue pudiendo entrar: el
 *    doctor de la clínica no paga el ataque que venga de su red.
 *  · Un acierto limpia el contador de SU cuenta, nunca el de la IP (si no, un
 *    atacante con una cuenta válida intercalaría aciertos para resetearlo).
 */
export const POLITICA_IP = { threshold: 10, windowSec: 15 * 60, lockSec: 15 * 60 };
const RECUERDO_IP_CUENTA_SEC = 30 * 24 * 60 * 60;

const objetivoCuenta = (email: string) => ({ scope: SCOPE_LOGIN_CLINICA, account: email, porIp: false });
const sujetoIp = (req: NextRequest) => `${SCOPE_LOGIN_CLINICA}:ip-cuentas:${getClientIp(req)}`;
const marcaConocida = (req: NextRequest, email: string) => `${SCOPE_LOGIN_CLINICA}:conocida:${getClientIp(req)}:${email}`;

export type Bloqueo = { retrySec: number; mensaje: string } | null;

/** ¿Puede intentarse este login? null = sí. Llamar ANTES de preguntar a Supabase. */
export async function revisarBloqueoLogin(req: NextRequest, email: string): Promise<Bloqueo> {
  const cuenta = await failbanGuard(req, objetivoCuenta(email));
  if (cuenta) {
    const retrySec = Number(cuenta.headers.get("Retry-After")) || 60;
    return { retrySec, mensaje: mensajeBloqueoCuenta(retrySec) };
  }
  const ip = await lockRemainingSec(sujetoIp(req));
  if (ip > 0 && !(await isRemembered(marcaConocida(req, email)))) {
    const retrySec = Math.max(1, Math.ceil(ip));
    return { retrySec, mensaje: mensajeBloqueoRed(retrySec) };
  }
  return null;
}

/** Fallo de credenciales: suma a la cuenta y anota el correo en el conjunto de la IP. */
export async function registrarFalloLogin(req: NextRequest, email: string): Promise<void> {
  await recordAuthFailure(req, objetivoCuenta(email));
  await recordDistinctFailure(sujetoIp(req), email, POLITICA_IP);
}

/** Acierto: limpia la cuenta y recuerda que entró bien desde esta IP. */
export async function registrarAciertoLogin(req: NextRequest, email: string): Promise<void> {
  await recordAuthSuccess(req, objetivoCuenta(email));
  await rememberKey(marcaConocida(req, email), RECUERDO_IP_CUENTA_SEC);
}
