"use client";
/* ============================================================
   Puente de la landing hacia la lógica de sesión del paciente.

   La lógica (un solo GET /api/paciente/me, los dos caminos para
   identificarse, el hueco guardado mientras va y vuelve del login)
   vive en @/lib/patient-portal/booking-auth y la comparten las tres
   superficies que reservan.

   La UI que antes vivía aquí —BookingAuthChoices, BookingSessionBadge,
   BookingSessionLoading— se fue a _shared/booking-flow.tsx, que es el
   único flujo de reserva. Este archivo queda como el re-export que
   las plantillas ya importaban.
   ============================================================ */

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
