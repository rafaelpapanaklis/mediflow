// Cookie de visitante anónimo (dc_vid) — identificador TÉCNICO DE CONTEO.
//
// POR QUÉ EXISTE: el dedupe de clics se apoyaba en la IP, y en México eso
// SUBCUENTA. Los ISP móviles (Telcel, AT&T…) usan CGNAT: miles de teléfonos
// comparten la misma IP pública, y el WiFi de un consultorio hace lo mismo con
// todo el equipo. Como el link se comparte por WhatsApp —casi todo el tráfico
// es móvil—, "dos dentistas con dos teléfonos" contaba como UN clic. Esta
// cookie identifica al NAVEGADOR, no a la red.
//
// QUÉ NO ES: no es perfilado ni tiene nada personal dentro. Es un número
// aleatorio opaco cuyo único uso es "¿este navegador ya contó en los últimos
// 30 minutos?". NO se deriva de la IP ni del user-agent a propósito: derivarla
// de la red sería el mismo bug con otro nombre.
//
// ⚠️ SIEMPRE SERVER-SIDE (Set-Cookie desde un route handler), JAMÁS
// document.cookie: Safari (ITP) borra a los 7 días las cookies escritas por
// JavaScript. Y `httpOnly` para que ni el JS de la página la pueda leer.
//
// No confundir con dc_aff (attribution-cookie.ts): esa atribuye la comisión y
// es de PRIMER TOQUE. Esta solo cuenta visitas y son independientes.

import { randomUUID } from "crypto";
import type { NextResponse } from "next/server";

export const VISITOR_COOKIE = "dc_vid";

/** 1 año. Se renueva sola en cada visita: solo identifica, no atribuye nada. */
export const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

// Formato tolerante a propósito (hoy sembramos randomUUID, 36 chars con
// guiones). Acotado para que un valor absurdo no llegue a la BD ni a un WHERE.
const VID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Identificador nuevo. Aleatorio puro — nada derivado del visitante. */
export function newVisitorId(): string {
  return randomUUID();
}

/** Valor crudo de la cookie → id válido, o null si viene vacía o deforme. */
export function parseVisitorId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return VID_RE.test(v) ? v : null;
}

/**
 * Siembra la cookie en la respuesta. Solo se llama cuando el visitante NO
 * traía una: quien ya la tiene conserva la suya (si se regenerara en cada
 * visita, cada recarga sería un navegador nuevo y volveríamos a sobrecontar).
 *
 * Pick<> para aceptar tanto NextResponse.json como NextResponse.redirect,
 * igual que attribution-cookie.ts.
 */
export function setVisitorCookie(res: Pick<NextResponse, "cookies">, vid: string): boolean {
  if (!parseVisitorId(vid)) return false;
  res.cookies.set({
    name: VISITOR_COOKIE,
    value: vid,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE,
  });
  return true;
}
