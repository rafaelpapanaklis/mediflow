import type {
  AppointmentStatus,
  AppointmentDTO as HomeAppointmentDTO,
} from "@/lib/home/types";

export type { AppointmentStatus } from "@/lib/home/types";

export type AppointmentSource =
  | "STAFF"
  | "PATIENT_PORTAL"
  | "WEBSITE"
  | "WHATSAPP";

/**
 * Tipos de recurso. Los tres primeros (CHAIR/ROOM/EQUIPMENT) son legacy:
 * existen en el enum de Postgres por compat pero ya no se usan en la app
 * (el backfill 20260513120100 los reescribe a los nuevos). El código
 * nuevo debe usar los 6 valores explícitos.
 */
export type ResourceKind =
  | "CHAIR"
  | "ROOM"
  | "EQUIPMENT"
  | "CONSULTORIO_DENTAL"
  | "CONSULTORIO_GENERAL"
  | "SILLA_DENTAL"
  | "SALA_DE_ESPERA"
  | "RADIOGRAFIA"
  | "LABORATORIO";

/** Valores ofrecidos al usuario en formularios de creación/edición. */
export const ACTIVE_RESOURCE_KINDS: readonly ResourceKind[] = [
  "CONSULTORIO_DENTAL",
  "CONSULTORIO_GENERAL",
  "SILLA_DENTAL",
  "SALA_DE_ESPERA",
  "RADIOGRAFIA",
  "LABORATORIO",
];

/** Labels en español para todos los kinds (incluye legacy para tolerar BD migrada a medias). */
export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  CHAIR: "Sillón",
  ROOM: "Sala",
  EQUIPMENT: "Equipo",
  CONSULTORIO_DENTAL: "Consultorio Dental",
  CONSULTORIO_GENERAL: "Consultorio General",
  SILLA_DENTAL: "Silla Dental",
  SALA_DE_ESPERA: "Sala de Espera",
  RADIOGRAFIA: "Radiografía",
  LABORATORIO: "Laboratorio",
};

/**
 * Kinds que representan lugares físicos donde se atiende al paciente.
 * Usado por la agenda (columna "Por sillón"), el editor de layout y la
 * vista live para no mezclar lugares de tratamiento con salas de espera,
 * radiografía o laboratorio.
 */
export const TREATMENT_KINDS: readonly ResourceKind[] = ["SILLA_DENTAL", "CONSULTORIO_DENTAL"];

export type WaitlistPriority = "LOW" | "NORMAL" | "HIGH";

export type AgendaColumnMode = "doctor" | "resource" | "unified";

export type AgendaViewMode = "day" | "week" | "month" | "list";

export type AgendaModalKey = "team" | "resources" | "validate" | null;

export interface AgendaAppointmentDTO extends HomeAppointmentDTO {
  resourceId: string | null;
  source: AppointmentSource;
  requiresValidation: boolean;
  overrideReason: string | null;
  checkedInAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ResourceDTO {
  id: string;
  name: string;
  kind: ResourceKind;
  color: string | null;
  orderIndex: number;
  isActive?: boolean;
}

/** Una ventana horaria dentro de un día. */
export interface ResourceScheduleWindow {
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
}

/**
 * Horario semanal por Resource. 7 días (0=Mon..6=Sun, Monday-based).
 * Array vacío en un día = cerrado ese día.
 */
export interface WeekScheduleDTO {
  days: {
    0: ResourceScheduleWindow[];
    1: ResourceScheduleWindow[];
    2: ResourceScheduleWindow[];
    3: ResourceScheduleWindow[];
    4: ResourceScheduleWindow[];
    5: ResourceScheduleWindow[];
    6: ResourceScheduleWindow[];
  };
}

/** Respuesta del GET /api/agenda/resources/[id]/schedule. */
export interface ResourceScheduleResponse {
  resourceId: string;
  alwaysOpen: boolean;
  schedule: WeekScheduleDTO | null;
}

export interface DoctorColumnDTO {
  id: string;
  displayName: string;
  shortName: string;
  avatarSeed?: string;
  avatarUrl?: string | null;
  color: string | null;
  activeInAgenda: boolean;
}

export interface WaitlistEntryDTO {
  id: string;
  patient: { id: string; name: string };
  reason: string | null;
  priority: WaitlistPriority;
  preferredDoctor: { id: string; shortName: string } | null;
  preferredWindow: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AgendaDayResponse {
  range: { from: string; to: string };
  timezone: string;
  slotMinutes: number;
  dayStart: number;
  dayEnd: number;
  appointments: AgendaAppointmentDTO[];
  doctors: DoctorColumnDTO[];
  resources: ResourceDTO[];
  pendingValidation: AgendaAppointmentDTO[];
  waitlistCount: number;
}

export interface CreateAppointmentInput {
  patientId: string;
  doctorId: string;
  resourceId?: string | null;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
  isTeleconsult?: boolean;
  isWalkIn?: boolean;
  overrideReason?: string | null;
  notifyPatient?: boolean;
}

export interface UpdateAppointmentInput {
  doctorId?: string;
  resourceId?: string | null;
  startsAt?: string;
  endsAt?: string;
  reason?: string | null;
  overrideReason?: string | null;
  notifyPatient?: boolean;
}

export interface AppointmentConflictError {
  error: "appointment_overlap";
  conflictingAppointment: {
    id: string;
    patientName: string;
    startsAt: string;
    endsAt: string;
    doctorId: string;
    resourceId: string | null;
    status: AppointmentStatus;
  };
}

export interface BatchValidateInput {
  action: "confirm" | "reject";
  appointmentIds: string[];
  rejectReason?: string;
  notifyPatients: boolean;
}

export interface BatchValidateResult {
  processed: number;
  failed: Array<{ id: string; error: string }>;
}

export interface StatusChangeInput {
  status: AppointmentStatus;
  reason?: string;
}

export interface CreateWaitlistInput {
  patientId: string;
  reason?: string;
  priority?: WaitlistPriority;
  preferredDoctorId?: string;
  preferredWindow?: string;
  notes?: string;
}

export interface AgendaFilters {
  doctorIds: string[];
  resourceIds: string[];
  statuses: AppointmentStatus[];
}

export interface AgendaDragState {
  draggingId: string | null;
  ghostStartsAt: string | null;
  ghostColumn: { type: "doctor" | "resource"; id: string } | null;
  hasConflict: boolean;
}

export interface AgendaStoreState {
  dayISO: string;
  viewMode: AgendaViewMode;
  columnMode: AgendaColumnMode;
  filters: AgendaFilters;
  appointments: AgendaAppointmentDTO[];
  pendingValidation: AgendaAppointmentDTO[];
  doctors: DoctorColumnDTO[];
  resources: ResourceDTO[];
  waitlistCount: number;
  slotMinutes: number;
  dayStart: number;
  dayEnd: number;
  timezone: string;

  drag: AgendaDragState;
  waitlistOpen: boolean;
  pendingSectionOpen: boolean;
  selectedIds: string[];
  selectedAppointmentId: string | null;
  searchQuery: string;
  modalOpen: AgendaModalKey;

  isLoading: boolean;
  error: string | null;
}
