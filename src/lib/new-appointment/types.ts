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
  /**
   * La ropa que el layout eligió para el panel con el interruptor por
   * clínica `menu-dos-niveles` ("nueva") o sin él ("clasica"). Es la única
   * señal del interruptor que llega al cliente sin añadir un proveedor al
   * layout; la lee «Agendar siguiente» al cerrar consulta para abrir la
   * Nueva cita nueva en vez de mandar a la agenda de siempre.
   */
  apariencia: "clasica" | "nueva";
}

export interface PatientSearchHit {
  id: string;
  name: string;
  phone: string | null;
  recentStatus?: AppointmentStatus;
}
