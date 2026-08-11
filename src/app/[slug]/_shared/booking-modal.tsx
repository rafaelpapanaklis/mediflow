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
import type { LandingClinic } from "./types";
import type { PendingBooking } from "./booking-session";

/** LandingClinic → el contrato que entiende el flujo. */
export function toBookingClinic(clinic: LandingClinic): BookingFlowClinic {
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
    services: normalizeServices(clinic.landingServices),
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
  return (
    <BookingFlowModal
      open={open}
      onClose={onClose}
      clinic={toBookingClinic(clinic)}
      theme={theme}
      surface="light"
      preselectedDoctorId={preselectedDoctorId}
      preselectedService={preselectedService}
      restore={restore}
      nextPath={`/${clinic.slug}`}
    />
  );
}
