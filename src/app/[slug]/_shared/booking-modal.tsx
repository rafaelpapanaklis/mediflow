"use client";
/* ============================================================
   Adaptador de la landing hacia EL flujo de reserva.

   Aquí ya no vive ningún flujo: la reserva completa (doctor →
   fecha → hora → procedimiento → identificarse, con las dos vías
   y "cualquier disponible") está en _shared/booking-flow.tsx y la
   comparten las ocho plantillas, /reservar y el directorio.

   Lo único que queda en este archivo es la traducción de
   `LandingClinic` (lo que la mini-web ya tiene cargado) al
   contrato del flujo. Se conserva el nombre <BookingModal> para
   que las plantillas no tengan que cambiar su import.
   ============================================================ */
import { BookingFlowModal, normalizeServices, type BookingFlowClinic } from "./booking-flow";
import { conControlDeOrtodoncia, conValoracionDeOrtodoncia } from "@/lib/orthodontics/landing-servicio-valoracion";
import { useMiControlOrto } from "@/lib/orthodontics/use-mi-control-orto";
import type { LandingClinic } from "./types";
import type { PendingBooking } from "./booking-session";

/**
 * LandingClinic → el contrato que entiende el flujo. `casoActivo` (ws1-t1
 * ronda 2) es del paciente YA identificado con sesión de portal — `null`
 * para cualquier visitante anónimo, o un paciente sin caso en esta clínica.
 */
export function toBookingClinic(
  clinic: LandingClinic,
  casoActivo?: { label: string; durationMin: number } | null,
): BookingFlowClinic {
  const conValoracion = conValoracionDeOrtodoncia(normalizeServices(clinic.landingServices), clinic.orthoValoracion);
  return {
    name: clinic.name,
    slug: clinic.slug,
    phone: clinic.phone,
    whatsapp: clinic.landingWhatsapp,
    address: clinic.address,
    doctors: clinic.users.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      specialty: u.specialty,
      color: u.color,
      avatarUrl: u.avatarUrl,
      services: u.services,
    })),
    schedules: clinic.schedules,
    services: conControlDeOrtodoncia(conValoracion, casoActivo),
  };
}

export interface BookingModalProps {
  clinic: LandingClinic;
  theme: string;
  open: boolean;
  onClose: () => void;
  preselectedDoctorId?: string;
  preselectedService?: string;
  /** Hueco que el visitante eligió antes de irse a identificarse. */
  restore?: PendingBooking | null;
}

export function BookingModal({ clinic, theme, open, onClose, preselectedDoctorId, preselectedService, restore }: BookingModalProps) {
  // ws1-t1 ronda 2 — si hay sesión de portal Y un caso activo en ESTA
  // clínica, se ofrece "Control de ortodoncia" con su doctor tratante, sin
  // pisar una preselección que ya venga del botón que abrió el modal
  // (preselectedDoctorId/preselectedService, p.ej. desde la tarjeta de un
  // doctor específico).
  const casoActivo = useMiControlOrto(clinic.slug, open && !!clinic.orthoValoracion);
  return (
    <BookingFlowModal
      open={open}
      onClose={onClose}
      clinic={toBookingClinic(clinic, casoActivo)}
      theme={theme}
      surface="light"
      preselectedDoctorId={preselectedDoctorId ?? casoActivo?.treatingDoctorId ?? undefined}
      preselectedService={preselectedService ?? casoActivo?.label}
      restore={restore}
      nextPath={`/${clinic.slug}`}
    />
  );
}
