import type { AppointmentStatus } from "@/lib/agenda/types";

export interface NewAppointmentInitialSlot {
  startsAt?: string;
  doctorId?: string;
  resourceId?: string | null;
}

export interface NewAppointmentInitialPatient {
  id: string;
  name: string;
}

export interface OpenNewAppointmentParams {
  initialSlot?: NewAppointmentInitialSlot;
  initialPatient?: NewAppointmentInitialPatient;
  initialDoctorId?: string;
  initialReason?: string;
  openAgendaAfter?: boolean;
  redirectAfter?: string;
  onCreated?: (appt: { id: string; startsAt: string }) => void;
}

export interface NewAppointmentContextValue {
  open: (params?: OpenNewAppointmentParams) => void;
  close: () => void;
}

export interface PatientSearchHit {
  id: string;
  name: string;
  phone: string | null;
  recentStatus?: AppointmentStatus;
}
