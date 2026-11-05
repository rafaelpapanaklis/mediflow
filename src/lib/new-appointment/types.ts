import type { AppointmentStatus } from "@/lib/agenda/types";

export interface NewAppointmentInitialSlot {
  startsAt?: string;
  /**
   * El doctor de la columna/carril en que se hizo clic. `null` = la columna «Sin doctor»
   * (ws1-t11): abre en «Sin doctor». Ausente = sin preferencia.
   */
  doctorId?: string | null;
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
  /**
   * ws1-t1 (F7) — más candidatos a doctor, en orden, después de `initialDoctorId` («Reagendar próxima»: el de
   * su última cita y luego el tratante). Se queda el primero que pueda recibir citas.
   */
  initialDoctorIds?: string[];
  /** ws1-t1 (F7) — consultorio con el que abre (sin `initialSlot`). Solo si existe en la clínica. */
  initialResourceId?: string;
  /** Día «AAAA-MM-DD» con el que abre (sin `initialSlot`). Por defecto, el de la agenda que se ve, o hoy. */
  initialDateISO?: string;
  initialReason?: string;
  /**
   * ws1-t1 (plan fase 2 · P8) — minutos con los que abre (la duración del tarifario de lo que se
   * agenda). Cuenta como «elegida a mano»: ni la de ortodoncia ni la de pediatría la pisan.
   */
  initialDurationMin?: number;
  /**
   * ws1-t1 (plan fase 2 · P8) — «Agendar lo pendiente»: las filas del plan que el POST liga a la
   * cita (`planItemIds`). `resumen` es lo que la ventana enseña («Resina 16 · Endodoncia 26»).
   */
  delPlan?: { planId: string; filaIds: string[]; resumen: string };
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
