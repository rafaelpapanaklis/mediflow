"use client";
/* ============================================================
   Sesión del paciente DENTRO de la reserva pública de la landing.
   Lo comparten el modal de futurista/healthtech/calido
   (_shared/booking-modal.tsx) y el modal inline de classic
   (landing-client.tsx):
     · un solo GET /api/paciente/me al abrir el modal,
     · los dos caminos para identificarse (entrar / crear cuenta),
     · el hueco ya elegido, guardado mientras va y vuelve del login.
   El POST /api/public/book exige sesión: sin esto el visitante que
   ya eligió doctor, día y hora se topaba con un 401 sin salida.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import type { PacienteMe } from "@/lib/patient-portal/types";
import { alpha, shade } from "./landing-utils";

/* ---------- el hueco elegido antes de identificarse ---------- */

/** Lo que el visitante YA eligió cuando le pedimos cuenta. */
export interface PendingBooking {
  doctorId: string;
  date: string; // YYYY-MM-DD
  slot: string; // HH:mm
  service: string;
}

/** Una clave por clínica: dos mini-webs abiertas no se pisan el hueco. */
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

/** /paciente/login|registro con ?next= de vuelta a ESTA landing. */
export function patientAuthHref(kind: "login" | "registro", slug: string) {
  return `/paciente/${kind}?next=${encodeURIComponent(`/${slug}`)}`;
}

/** Primer token → firstName; el resto → lastName (un solo token → lastName ""). */
export function splitFullName(name: string) {
  const tokens = (name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: tokens[0] ?? "", lastName: tokens.slice(1).join(" ") };
}

/* ---------- sesión ---------- */

export type PatientSessionStatus = "loading" | "authenticated" | "anonymous";

/**
 * GET /api/paciente/me UNA sola vez, cuando el modal se abre (`active`).
 * Nunca durante la carga de la landing: la mini-web es pública y estática.
 */
export function usePatientSession(active: boolean) {
  const [status, setStatus] = useState<PatientSessionStatus>("loading");
  const [me, setMe] = useState<PacienteMe | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    // Sin cancelación a propósito: si cierra el modal antes de que responda,
    // el estado ya queda resuelto para la próxima vez que lo abra.
    fetch("/api/paciente/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: any) => {
        if (data && typeof data.id === "string") {
          setMe(data as PacienteMe);
          setStatus("authenticated");
        } else {
          setMe(null);
          setStatus("anonymous");
        }
      });
  }, [active]);

  /** El POST respondió 401 requiresAuth: la sesión venció a media reserva. */
  const markSignedOut = useCallback(() => {
    setMe(null);
    setStatus("anonymous");
  }, []);

  return { status, me, markSignedOut };
}

/**
 * Al montar la landing: si el visitante dejó un hueco guardado antes de irse
 * a identificarse, reabre el modal con esa selección. `?reservar=1` (el gate
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

/* ---------- UI compartida (neutra: el color sale del theme) ---------- */

/** Mientras se resuelve /api/paciente/me (milisegundos, no parpadea el paso). */
export function BookingSessionLoading({ theme }: { theme: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
      <Loader2 size={14} className="animate-spin" style={{ color: theme }} />
      Un momento…
    </div>
  );
}

/**
 * Los DOS caminos, antes de que llene nada. Ninguno de los dos botones dice
 * "DaleControl": el paciente conoce a su dentista, no a la plataforma.
 */
export function BookingAuthChoices({
  slug,
  theme,
  onBeforeLeave,
  title,
  hint,
}: {
  slug: string;
  theme: string;
  /** Guarda el hueco elegido antes de que el navegador se vaya al login. */
  onBeforeLeave?: () => void;
  title?: string;
  hint?: string;
}) {
  const ink = shade(theme, 0.4);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={{ background: alpha(theme, 0.08) }}>
        <div className="text-sm font-bold" style={{ color: ink }}>
          {title ?? "Solo falta identificarte"}
        </div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: alpha(ink, 0.78) }}>
          {hint ?? "Guardamos el horario que elegiste. Entra o crea tu cuenta y confirmamos tu cita."}
        </p>
      </div>

      <a
        href={patientAuthHref("login", slug)}
        onClick={onBeforeLeave}
        className="w-full py-3.5 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all"
        style={{ background: theme, boxShadow: `0 8px 24px ${alpha(theme, 0.4)}` }}
      >
        <LogIn size={16} /> Ya soy paciente · Iniciar sesión
      </a>

      <a
        href={patientAuthHref("registro", slug)}
        onClick={onBeforeLeave}
        className="w-full py-3.5 rounded-2xl font-bold text-sm border-2 flex items-center justify-center gap-2 transition-all"
        style={{ borderColor: theme, color: theme }}
      >
        <UserPlus size={16} /> Es mi primera vez · Crear cuenta
      </a>

      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        Tu cuenta te sirve en cualquier clínica con DaleControl.
      </p>
    </div>
  );
}

/** "Reservas como {name}" arriba del paso de datos, con salida a otros datos. */
export function BookingSessionBadge({
  name,
  theme,
  usingAccount,
  onUseOther,
  onUseAccount,
}: {
  name: string;
  theme: string;
  usingAccount: boolean;
  onUseOther: () => void;
  onUseAccount: () => void;
}) {
  const ink = shade(theme, 0.4);
  return (
    <div className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3" style={{ background: alpha(theme, 0.08) }}>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: alpha(ink, 0.6) }}>
          {usingAccount ? "Reservas como" : "Reservas para otra persona"}
        </div>
        <div className="text-sm font-bold truncate" style={{ color: ink }}>
          {usingAccount ? name : "Con datos distintos a los de tu cuenta"}
        </div>
      </div>
      <button
        type="button"
        onClick={usingAccount ? onUseOther : onUseAccount}
        className="text-[11px] font-bold underline shrink-0 whitespace-nowrap"
        style={{ color: theme }}
      >
        {usingAccount ? "Usar otros datos" : "Usar mis datos"}
      </button>
    </div>
  );
}
