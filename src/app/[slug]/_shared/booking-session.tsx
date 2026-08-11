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

   La LÓGICA vive en @/lib/patient-portal/booking-auth, compartida con
   las otras dos superficies que reservan (/reservar/[slug] y el popup
   del directorio). Aquí queda solo la piel de las mini-webs: el color
   sale del theme de cada clínica.
   ============================================================ */
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { BOOKING_AUTH_COPY, bookingPhoneExit, patientAuthHref } from "@/lib/patient-portal/booking-auth";
import { alpha, shade } from "./landing-utils";

/* La lógica compartida se re-exporta para que las plantillas y los dos modales
   sigan importándola desde aquí (una sola implementación, tres superficies). */
export {
  patientAuthHref,
  savePendingBooking,
  takePendingBooking,
  splitFullName,
  usePatientSession,
  useBookingReopen,
  pendingSlotOutcome,
  slotTakenNotice,
  requiresPatientAuth,
  currentBookingNext,
  bookingAuthLinks,
  bookingPhoneExit,
  BOOKING_AUTH_COPY,
} from "@/lib/patient-portal/booking-auth";
export type {
  PendingBooking,
  PatientSessionStatus,
  BookingAccount,
  BookingAuthLink,
} from "@/lib/patient-portal/booking-auth";

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
  next,
  phone,
}: {
  slug: string;
  theme: string;
  /** Guarda el hueco elegido antes de que el navegador se vaya al login. */
  onBeforeLeave?: () => void;
  title?: string;
  hint?: string;
  /** Ruta de regreso; por defecto la mini-web de la clínica. */
  next?: string;
  /** Con teléfono, la salida para quien no quiere cuenta. */
  phone?: string | null;
}) {
  const ink = shade(theme, 0.4);
  const target = next ?? `/${slug}`;
  const call = bookingPhoneExit(phone);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={{ background: alpha(theme, 0.08) }}>
        <div className="text-sm font-bold" style={{ color: ink }}>
          {title ?? BOOKING_AUTH_COPY.title}
        </div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: alpha(ink, 0.78) }}>
          {hint ?? BOOKING_AUTH_COPY.hint}
        </p>
      </div>

      <a
        href={patientAuthHref("login", target)}
        onClick={onBeforeLeave}
        className="w-full py-3.5 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all"
        style={{ background: theme, boxShadow: `0 8px 24px ${alpha(theme, 0.4)}` }}
      >
        <LogIn size={16} /> {BOOKING_AUTH_COPY.login}
      </a>

      <a
        href={patientAuthHref("registro", target)}
        onClick={onBeforeLeave}
        className="w-full py-3.5 rounded-2xl font-bold text-sm border-2 flex items-center justify-center gap-2 transition-all"
        style={{ borderColor: theme, color: theme }}
      >
        <UserPlus size={16} /> {BOOKING_AUTH_COPY.registro}
      </a>

      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        {BOOKING_AUTH_COPY.portable}
      </p>

      {call && (
        <p className="text-center">
          <a href={call.href} className="text-xs font-semibold" style={{ color: theme }}>
            {call.label}
          </a>
        </p>
      )}
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
