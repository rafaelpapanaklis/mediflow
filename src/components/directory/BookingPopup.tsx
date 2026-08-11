"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UserRound, X } from "lucide-react";
import {
  type BookingSelection,
  type DirectoryClinic,
} from "@/lib/directory/types";
import {
  BookingFlow,
  normalizeServices,
  type BookingFlowSelection,
} from "@/app/[slug]/_shared/booking-flow";
import type { PendingBooking } from "@/lib/patient-portal/booking-auth";

// ─────────────────────────────────────────────────────────────────────────────
// POPUP DE RESERVA del directorio — SOLO la cáscara.
//
// El flujo (doctor → fecha → hora → procedimiento → identificarse, con
// "cualquier disponible" y las dos vías de identificación) es el MISMO que
// usan las ocho mini-webs y /reservar: src/app/[slug]/_shared/booking-flow.tsx.
// Antes estaba copiado aquí y en BookingSchedule.tsx, que ya no existe.
//
// Bottom-sheet en móvil, centrado en sm+. Acento = clinic.themeColor ??
// violeta DaleControl. Cada cambio de selección se avisa al controller vía
// onSelectionChange (él la persiste en URL + sessionStorage).
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingPopupProps {
  clinic: DirectoryClinic;
  initialSelection?: Partial<BookingSelection>;
  /** Cada cambio de selección — el controller la persiste en URL + storage */
  onSelectionChange: (sel: BookingSelection) => void;
  onClose: () => void;
}

export function BookingPopup({ clinic, initialSelection, onSelectionChange, onClose }: BookingPopupProps) {
  const theme = clinic.themeColor || "#7c3aed";
  const [titulo, setTitulo] = useState("Reservar cita");
  const [terminado, setTerminado] = useState(false);

  // Bloquea el scroll del body mientras el popup está montado.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Tecla Escape cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Selección que llega por URL/storage (regreso del registro o link
   * compartido). Si está completa se repone como "hueco guardado" y el flujo
   * salta directo a confirmar; el doctor que ya no exista se descarta.
   */
  const { restore, preDoctor, preService } = useMemo(() => {
    const doctorId = initialSelection?.doctorId ?? null;
    const vive = !doctorId || doctorId === "any" || clinic.doctors.some(d => d.id === doctorId);
    const doctor = vive ? doctorId : null;
    const completo: PendingBooking | null =
      doctor && initialSelection?.date && initialSelection?.slot
        ? { doctorId: doctor, date: initialSelection.date, slot: initialSelection.slot, service: initialSelection.service ?? "" }
        : null;
    return { restore: completo, preDoctor: doctor, preService: initialSelection?.service ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic.doctors]);

  const alCambiar = useCallback((sel: BookingFlowSelection) => {
    onSelectionChange({
      clinicSlug: clinic.slug,
      service: sel.service,
      doctorId: sel.doctorId,
      date: sel.date,
      slot: sel.slot,
    });
  }, [clinic.slug, onSelectionChange]);

  const alCambiarPaso = useCallback((info: { title: string; done: boolean }) => {
    setTitulo(info.title);
    setTerminado(info.done);
  }, []);

  const servicios = useMemo(() => normalizeServices(clinic.featuredServices), [clinic.featuredServices]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reservar cita en ${clinic.name}`}
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-[460px] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto"
        // dvh sigue al viewport visible en móvil (iOS Safari con toolbar
        // expandida recorta el header con 92vh); si no hay soporte, la
        // declaración inválida se ignora y aplica el max-h-[92vh] de la clase.
        style={{ maxHeight: "92dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky: logo + título del paso + X */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-4 border-b border-gray-50 rounded-t-[2rem]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {clinic.logoUrl ? (
                <img src={clinic.logoUrl} alt="" loading="lazy" className="w-6 h-6 rounded-lg object-cover shrink-0" />
              ) : (
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ background: theme }}
                >
                  {clinic.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="font-bold text-lg leading-tight truncate" style={{ color: "var(--ink)" }}>
                  {titulo}
                </div>
                <div className="text-xs truncate" style={{ color: "var(--muted)" }}>{clinic.name}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {clinic.doctors.length === 0 ? (
            <div className="text-center py-8">
              <div
                className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: "var(--v50)", color: "var(--b2)" }}
              >
                <UserRound size={24} />
              </div>
              <p className="font-bold mb-1" style={{ color: "var(--ink)" }}>
                Esta clínica aún no tiene agenda en línea
              </p>
              <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                Intenta más tarde o contacta directamente a la clínica.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3.5 rounded-2xl font-bold text-white transition-all"
                style={{ background: theme }}
              >
                Cerrar
              </button>
            </div>
          ) : (
            <>
              <BookingFlow
                clinic={{
                  name: clinic.name,
                  slug: clinic.slug,
                  phone: clinic.phone,
                  whatsapp: null,
                  address: clinic.address,
                  doctors: clinic.doctors,
                  schedules: clinic.schedules,
                  services: servicios,
                }}
                theme={theme}
                surface="light"
                preselectedDoctorId={preDoctor}
                preselectedService={preService}
                restore={restore}
                onClose={onClose}
                onSelectionChange={alCambiar}
                onStepChange={alCambiarPaso}
              />

              {terminado && clinic.landingActive && (
                <Link
                  href={`/${clinic.slug}`}
                  className="block w-full py-3 mt-2 rounded-2xl font-semibold text-sm text-center border hover:bg-[color:var(--tint2)] transition-colors"
                  style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                >
                  Ver clínica
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
