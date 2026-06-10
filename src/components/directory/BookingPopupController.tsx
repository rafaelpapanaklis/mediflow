"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  DIRECTORY_API,
  type BookingSelection,
  type DirectoryClinic,
  type DirectoryClinicsResponse,
} from "@/lib/directory/types";
import {
  onBookingOpenRequest,
  readSelectionFromUrl,
  readPersistedSelection,
  syncSelectionToUrl,
  persistSelection,
  clearPersistedSelection,
} from "@/lib/directory/booking-state";
import { BookingPopup } from "./BookingPopup";

// ─────────────────────────────────────────────────────────────────────────────
// Controller del popup de reserva: decide CUÁNDO abrir y con QUÉ selección
// inicial. Montado una vez por DirectoryExplorer. Tres vías de apertura:
//   A) Evento del bus (click en "Reservar cita" de una card) → selección
//      limpia { clinicSlug } sincronizada a URL + sessionStorage antes de abrir.
//   B) URL con ?reservar=<slug>&servicio=&doctor=&fecha=&hora= (regreso del
//      registro vía ?next= o link compartido) → se resuelve la clínica contra
//      GET /api/directory/clinics?slug= y se reabre con esa selección.
//   C) Respaldo sessionStorage: si la URL perdió el query, se restaura la
//      selección guardada SOLO si savedPath coincide con el pathname actual.
// Sin useSearchParams/useRouter (romperían el SSG): los helpers de
// booking-state leen/escriben window.location dentro de useEffect.
// ─────────────────────────────────────────────────────────────────────────────

export function BookingPopupController() {
  const [open, setOpen] = useState<{ clinic: DirectoryClinic; initial: Partial<BookingSelection> } | null>(null);
  const [resolving, setResolving] = useState(false);
  /** true en cuanto el bus abre el popup — la restauración (B)/(C) no debe pisarlo. */
  const openedByEventRef = useRef(false);

  const handleSelectionChange = useCallback((sel: BookingSelection) => {
    syncSelectionToUrl(sel);
    persistSelection(sel);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(null);
    syncSelectionToUrl(null);
    clearPersistedSelection();
  }, []);

  useEffect(() => {
    // 1) Vía A — suscripción al bus ANTES de restaurar, para no perder clicks.
    const unsubscribe = onBookingOpenRequest((clinic) => {
      const sel: BookingSelection = {
        clinicSlug: clinic.slug,
        service: null,
        doctorId: null,
        date: null,
        slot: null,
      };
      openedByEventRef.current = true;
      syncSelectionToUrl(sel);
      persistSelection(sel);
      setOpen({ clinic, initial: sel });
    });

    // 2) Vías B/C — restaurar selección desde la URL o, en su defecto, desde
    //    sessionStorage (solo si se guardó en este mismo pathname).
    let cancelled = false;
    const fromUrl = readSelectionFromUrl();
    const stored = readPersistedSelection();
    const sel =
      fromUrl ??
      (stored && stored.savedPath === window.location.pathname ? stored : null);

    if (sel?.clinicSlug && !openedByEventRef.current) {
      const slug = sel.clinicSlug;
      setResolving(true);
      (async () => {
        try {
          const res = await fetch(`${DIRECTORY_API}?slug=${encodeURIComponent(slug)}`);
          // 5xx/red caída → throw: NO limpiar la selección (es transitorio).
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: DirectoryClinicsResponse = await res.json();
          const clinic = data?.items?.[0];
          if (cancelled || openedByEventRef.current) return;
          if (clinic) {
            const initial: BookingSelection = {
              clinicSlug: clinic.slug,
              service: sel.service ?? null,
              doctorId: sel.doctorId ?? null,
              date: sel.date ?? null,
              slot: sel.slot ?? null,
            };
            // Vía C: la URL no traía la selección — dejarla compartible.
            if (!fromUrl) syncSelectionToUrl(initial);
            setOpen((prev) => prev ?? { clinic, initial });
          } else {
            // 200 sin items → clínica inexistente o despublicada: limpiar y no abrir.
            syncSelectionToUrl(null);
            clearPersistedSelection();
          }
        } catch {
          // Error transitorio: conservar selección (URL + storage) para que un
          // refresh reintente — no perder la reserva de quien vuelve del registro.
        } finally {
          if (!cancelled) setResolving(false);
        }
      })();
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Montaje único: la restauración y el bus solo se configuran una vez.
  }, []);

  if (resolving) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm"
        role="status"
        aria-label="Recuperando tu reserva"
      >
        <Loader2 className="h-8 w-8 animate-spin text-white" aria-hidden="true" />
      </div>
    );
  }

  if (!open) return null;

  return (
    <BookingPopup
      key={open.clinic.slug}
      clinic={open.clinic}
      initialSelection={open.initial}
      onSelectionChange={handleSelectionChange}
      onClose={handleClose}
    />
  );
}
