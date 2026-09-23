import type {
  AppointmentStatus,
  AppointmentDTO as HomeAppointmentDTO,
} from "@/lib/home/types";
import type { ScheduleDay } from "./clinic-hours";
import type { BloqueoDTO } from "@/lib/agenda-bloqueos/core";

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

/**
 * Densidad vertical de la grilla Día/Semana:
 *  - "fit": el horario configurado de la clínica cabe completo en el alto
 *    disponible, sin scroll (default — la queja original era "no cabe").
 *  - "medium" / "spacious": alturas fijas por slot para ver más detalle
 *    (spacious = la densidad única que existía antes). Ver slot-metrics.ts.
 */
export type AgendaDensity = "fit" | "medium" | "spacious";

export type AgendaModalKey = "team" | "resources" | "validate" | null;

export interface AgendaAppointmentDTO extends HomeAppointmentDTO {
  resourceId: string | null;
  source: AppointmentSource;
  requiresValidation: boolean;
  overrideReason: string | null;
  checkedInAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelReason?: string | null;
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
  /**
   * Ventana que el eje PINTA de arranque. La SSR de /dashboard/agenda manda
   * aquí `paintedAgendaWindow` (horario real del día + las citas de ese día);
   * los endpoints siguen mandando la ventana EFECTIVA. El cliente la recalcula
   * en cuanto cambia el día, la vista o las citas — ver agenda-provider.
   */
  dayStart: number;
  dayEnd: number;
  /**
   * Horario configurado en Ajustes (ClinicSchedule). Solo `enabled` +
   * `openTime`/`closeTime` por día: el horario de atención de la clínica, que
   * ya es público en su página de reserva. Lo necesita el cliente para
   * recalcular el eje al navegar sin volver al servidor. Opcional: los
   * endpoints que no lo mandan dejan al cliente con la ventana del payload.
   */
  schedules?: ScheduleDay[];
  appointments: AgendaAppointmentDTO[];
  doctors: DoctorColumnDTO[];
  resources: ResourceDTO[];
  pendingValidation: AgendaAppointmentDTO[];
  waitlistCount: number;
  /**
   * LOS BLOQUEOS DEL PERIODO (WS1-T2) — los días y las horas cerrados que
   * solapan el rango que devuelve este payload, en el mismo DTO que
   * `/api/settings/bloqueos`.
   *
   * Es lo único que ws1-t3 consume de esta tarea: con esto pinta la franja
   * sobre la rejilla sin tener que pedir nada aparte. Se manda AQUÍ y no en
   * una llamada suya para que la banda y las citas lleguen en el mismo viaje
   * y del mismo rango — dos peticiones distintas se desincronizan al navegar
   * rápido entre días y la banda se quedaría un día atrás.
   *
   * Opcional: los endpoints que no lo mandan dejan al cliente sin bandas, que
   * es el comportamiento anterior a esta tarea.
   */
  bloqueos?: BloqueoDTO[];
  /**
   * EL HORARIO PROPIO DE LOS DOCTORES (WS1-T2 · horario): `doctorId → sus 7
   * días` (0=Lunes … 6=Domingo, como `schedules`). SOLO vienen los doctores
   * que tienen horario propio; un id ausente = sigue el de la clínica.
   *
   * Es lo que ws1-t3 necesita para pintar, columna a columna, las horas en que
   * ese doctor no atiende (y para avisar antes de soltar una cita ahí). No
   * depende del rango: el horario es semanal. Para decidir si un hueco cae
   * fuera, `doctorNoAtiende` de src/lib/horario-doctor/core.ts (con
   * `horariosDesdeObjeto`); no se compara a mano en un componente.
   *
   * Opcional: sin él, nadie tiene horario propio = la agenda de siempre.
   */
  horariosDoctores?: Record<string, ScheduleDay[]>;
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
  /**
   * WS1-T3 — «YA CONFIRMÉ QUE ESE DÍA ESTÁ BLOQUEADO».
   *
   * 🔴 UN BOOLEANO, NO UN TEXTO, Y A PROPÓSITO. El motivo del bloqueo lo
   * escribe el SERVIDOR leyéndolo de la base, así que mandarlo desde el
   * navegador no aportaría nada y sí dos problemas: pasearía por la red un
   * motivo que puede ser privado («operación de rodilla») y dejaría a mano un
   * campo de texto del cliente al lado de una escritura de auditoría.
   *
   * Y NO es `overrideReason`: aquél exige `canOverrideOverlap(role)` (solo
   * ADMIN y SUPER_ADMIN) porque su valor saca la cita del índice de exclusión
   * que impide dos citas encima. Ver `agenda-bloqueos/core.ts` §7.
   */
  bloqueoConfirmado?: boolean;
  notifyPatient?: boolean;
}

export interface UpdateAppointmentInput {
  doctorId?: string;
  resourceId?: string | null;
  startsAt?: string;
  endsAt?: string;
  reason?: string | null;
  overrideReason?: string | null;
  /** WS1-T3 — ver `CreateAppointmentInput.bloqueoConfirmado`. */
  bloqueoConfirmado?: boolean;
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
  density: AgendaDensity;
  filters: AgendaFilters;
  appointments: AgendaAppointmentDTO[];
  pendingValidation: AgendaAppointmentDTO[];
  doctors: DoctorColumnDTO[];
  resources: ResourceDTO[];
  waitlistCount: number;
  slotMinutes: number;
  /**
   * Ventana que el eje PINTA. En el contexto del provider llega ya recalculada
   * con `paintedAgendaWindow`; el reducer guarda la del payload como suelo.
   */
  dayStart: number;
  dayEnd: number;
  /** Horario de Ajustes — entrada de `paintedAgendaWindow` en el cliente. */
  schedules: ScheduleDay[];
  timezone: string;
  /**
   * LOS BLOQUEOS DEL RANGO CARGADO (WS1-T3).
   *
   * 🔴 SIN ESTE CAMPO, LO DE WS1-T2 ERA CÓDIGO MUERTO. El payload ya traía
   * `bloqueos` (ver `AgendaDayResponse`) y las tres vistas ya sabían pintar la
   * franja, pero el reducer no lo guardaba: `useBloqueosAgenda` leía
   * `state.bloqueos`, no encontraba nada y devolvía la lista vacía SIEMPRE. La
   * agenda se pintaba como si no hubiera bloqueos aunque los hubiera.
   *
   * Vive en el estado y no en un fetch aparte por lo mismo que viaja en el
   * payload: la franja y las citas tienen que venir del MISMO rango, o al
   * navegar rápido entre días la banda se queda un día atrás.
   */
  bloqueos: BloqueoDTO[];
  /**
   * EL HORARIO PROPIO DE LOS DOCTORES (WS1-T2 · horario). Ver
   * `AgendaDayResponse.horariosDoctores`. Vacío = nadie tiene horario propio.
   */
  horariosDoctores: Record<string, ScheduleDay[]>;

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
