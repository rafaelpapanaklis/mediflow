"use client";
/* ============================================================
   Puerta de identificación de la reserva pública — LÓGICA y COPY.
   La comparten las TRES superficies que postean a /api/public/book
   (que sin sesión responde 401 { error, requiresAuth: true }):
     · las mini-webs de /[slug]      → _shared/booking-session.tsx
     · /reservar/[slug]              → booking-client.tsx
     · el popup del directorio       → components/directory/BookingSchedule.tsx
   Aquí NO hay presentación: cada superficie tiene su propio estilo y
   pinta estos datos como le corresponde. Lo que se comparte es el
   comportamiento — un solo GET de sesión, los dos caminos para
   identificarse, el hueco guardado mientras va y vuelve del login.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";

/* ---------- la cuenta del portal ---------- */

/** Subconjunto de GET /api/paciente/me que la reserva necesita. */
export interface BookingAccount {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

const PATIENT_ME_API = "/api/paciente/me";

/** 200 → cuenta · 401 / red caída → null (tratar como "sin sesión"). */
export async function fetchBookingAccount(): Promise<BookingAccount | null> {
  try {
    const res = await fetch(PATIENT_ME_API, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.id === "string" ? (data as BookingAccount) : null;
  } catch {
    return null;
  }
}

export type PatientSessionStatus = "loading" | "authenticated" | "anonymous";

/**
 * GET /api/paciente/me UNA sola vez, cuando el flujo de reserva se abre
 * (`active`). Nunca durante la carga de la página: las tres superficies son
 * públicas y estáticas.
 */
export function usePatientSession(active: boolean) {
  const [status, setStatus] = useState<PatientSessionStatus>("loading");
  const [me, setMe] = useState<BookingAccount | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    // Sin cancelación a propósito: si cierra el modal antes de que responda,
    // el estado ya queda resuelto para la próxima vez que lo abra.
    fetchBookingAccount().then((account) => {
      setMe(account);
      setStatus(account ? "authenticated" : "anonymous");
    });
  }, [active]);

  /** El POST respondió 401 requiresAuth: la sesión venció a media reserva. */
  const markSignedOut = useCallback(() => {
    setMe(null);
    setStatus("anonymous");
  }, []);

  return { status, me, markSignedOut };
}

/** Un 401 del POST /api/public/book = hay que identificarse, no es un error. */
export function requiresPatientAuth(status: number, body?: { requiresAuth?: boolean } | null) {
  return status === 401 && (body?.requiresAuth ?? true);
}

/* ---------- el hueco elegido antes de identificarse ---------- */

/** Lo que el visitante YA eligió cuando le pedimos cuenta. */
export interface PendingBooking {
  doctorId: string;
  date: string; // YYYY-MM-DD
  slot: string; // HH:mm
  service: string;
}

/** Una clave por clínica: dos reservas abiertas no se pisan el hueco. */
const pendingKey = (slug: string) => `dc:pending-booking:${slug}`;

export function savePendingBooking(slug: string, sel: PendingBooking) {
  if (!slug || !sel || !sel.doctorId || !sel.date || !sel.slot) return;
  try {
    window.sessionStorage.setItem(pendingKey(slug), JSON.stringify(sel));
  } catch {
    /* modo privado / storage lleno: se pierde el hueco, no la reserva */
  }
}

/** Lee y BORRA: un hueco guardado se reabre una sola vez. */
export function takePendingBooking(slug: string): PendingBooking | null {
  try {
    const raw = window.sessionStorage.getItem(pendingKey(slug));
    if (!raw) return null;
    window.sessionStorage.removeItem(pendingKey(slug));
    const p = JSON.parse(raw);
    // Formato estricto: una fecha rota volvería el calendario un Invalid Date.
    if (!p || typeof p.doctorId !== "string" || !p.doctorId) return null;
    if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return null;
    if (typeof p.slot !== "string" || !/^\d{2}:\d{2}$/.test(p.slot)) return null;
    return {
      doctorId: p.doctorId,
      date: p.date,
      slot: p.slot,
      service: typeof p.service === "string" ? p.service : "",
    };
  } catch {
    return null;
  }
}

/**
 * Al montar la superficie: si el visitante dejó un hueco guardado antes de irse
 * a identificarse, reabre la reserva con esa selección. `?reservar=1` (el gate
 * viejo de classic) sigue reconociéndose para no romper los enlaces en vuelo.
 */
export function useBookingReopen(slug: string, onReopen: (pending: PendingBooking | null) => void) {
  const cb = useRef(onReopen);
  useEffect(() => {
    cb.current = onReopen;
  });
  useEffect(() => {
    const pending = takePendingBooking(slug);
    const params = new URLSearchParams(window.location.search);
    const legacy = params.get("reservar") === "1";
    if (legacy) {
      params.delete("reservar");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    }
    if (pending || legacy) cb.current(pending);
  }, [slug]);
}

/** ¿Qué hacer con el hueco guardado cuando llega la disponibilidad del día? */
export type PendingSlotOutcome = "ignore" | "apply" | "taken";

export function pendingSlotOutcome(
  pending: PendingBooking | null,
  doctorId: string,
  date: string,
  slots: string[],
): PendingSlotOutcome {
  if (!pending || pending.doctorId !== doctorId || pending.date !== date) return "ignore";
  return slots.includes(pending.slot) ? "apply" : "taken";
}

/** Se lo ganaron mientras se identificaba: aviso claro, de vuelta al calendario. */
export function slotTakenNotice(slot: string) {
  return `El horario de las ${slot} ya fue reservado. Elige otro, por favor.`;
}

/* ---------- los dos caminos para identificarse ---------- */

const PATIENT_AUTH_PATHS = { login: "/paciente/login", registro: "/paciente/registro" } as const;

/** Solo rutas internas (mismo criterio que login-form / registro-form). */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/** /paciente/login|registro con ?next= de vuelta a ESTA reserva. */
export function patientAuthHref(kind: "login" | "registro", next: string) {
  const target = safeNextPath(next);
  return `${PATIENT_AUTH_PATHS[kind]}${target ? `?next=${encodeURIComponent(target)}` : ""}`;
}

/** La ruta actual con su querystring: el ?next= que devuelve a esta reserva. */
export function currentBookingNext(fallback = "/"): string {
  if (typeof window === "undefined") return fallback;
  return window.location.pathname + window.location.search;
}

/**
 * El copy de la puerta. Ningún botón dice "DaleControl": el paciente conoce a
 * su clínica, no a la plataforma; la plataforma solo se menciona al pie, como
 * lo que gana quien crea la cuenta.
 */
export const BOOKING_AUTH_COPY = {
  title: "Solo falta identificarte",
  hint: "Guardamos el horario que elegiste. Entra o crea tu cuenta y confirmamos tu cita.",
  login: "Ya soy paciente · Iniciar sesión",
  registro: "Es mi primera vez · Crear cuenta",
  portable: "Tu cuenta te sirve en cualquier clínica con DaleControl.",
  /** La sesión se venció a media reserva (401 del POST). */
  expiredTitle: "Tu sesión se cerró",
  expiredHint: "Entra otra vez y confirmamos el horario que ya elegiste.",
} as const;

export interface BookingAuthLink {
  kind: "login" | "registro";
  href: string;
  label: string;
}

/** Los dos caminos, en orden: primero quien ya es paciente. */
export function bookingAuthLinks(next: string): BookingAuthLink[] {
  return [
    { kind: "login", href: patientAuthHref("login", next), label: BOOKING_AUTH_COPY.login },
    { kind: "registro", href: patientAuthHref("registro", next), label: BOOKING_AUTH_COPY.registro },
  ];
}

/** La salida de siempre para quien no quiere cuenta: llamar a la clínica. */
export function bookingPhoneExit(phone: string | null | undefined) {
  const label = (phone ?? "").trim();
  if (!label) return null;
  return { href: `tel:${label.replace(/[^\d+]/g, "")}`, label: `o llámanos al ${label}` };
}

/* ---------- datos de la cuenta en el formulario ---------- */

/** Primer token → firstName; el resto → lastName (un solo token → lastName ""). */
export function splitFullName(name: string) {
  const tokens = (name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: tokens[0] ?? "", lastName: tokens.slice(1).join(" ") };
}
