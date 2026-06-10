"use client";

import { CalendarCheck } from "lucide-react";
import type { DirectoryClinic } from "@/lib/directory/types";
import { openBookingPopup } from "@/lib/directory/booking-state";

// ─────────────────────────────────────────────────────────────────────────────
// Botón "Reservar cita" del perfil público. Dispara el MISMO popup del
// directorio (openBookingPopup → bus de eventos → <BookingPopupController/>,
// montado una vez en la página). Puede haber varios botones; el controller es
// único. El acento usa clinic.themeColor.
// ─────────────────────────────────────────────────────────────────────────────

export function ReserveButton({
  clinic,
  label = "Reservar cita",
  full = false,
}: {
  clinic: DirectoryClinic;
  label?: string;
  full?: boolean;
}) {
  const theme = clinic.themeColor || "#7c3aed";
  return (
    <button
      type="button"
      onClick={() => openBookingPopup(clinic)}
      aria-label={`Reservar cita en ${clinic.name}`}
      className="inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white transition hover:brightness-105 active:brightness-95"
      style={{
        background: `linear-gradient(180deg, ${theme}, ${theme})`,
        boxShadow: `0 8px 24px ${theme}40`,
        width: full ? "100%" : undefined,
      }}
    >
      <CalendarCheck size={18} aria-hidden="true" />
      {label}
    </button>
  );
}
