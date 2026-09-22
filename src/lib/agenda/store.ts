import type {
  AgendaAppointmentDTO,
  AgendaColumnMode,
  AgendaDayResponse,
  AgendaDensity,
  AgendaFilters,
  AgendaModalKey,
  AgendaStoreState,
  AgendaViewMode,
  AppointmentStatus,
  DoctorColumnDTO,
  ResourceDTO,
} from "./types";
import type { BloqueoDTO } from "@/lib/agenda-bloqueos/core";
import type { ScheduleDay } from "./clinic-hours";

export type AgendaAction =
  | { type: "LOAD_DAY"; payload: AgendaDayResponse; dayISO: string }
  | { type: "SET_DAY"; dayISO: string }
  | { type: "SET_VIEW_MODE"; viewMode: AgendaViewMode }
  | { type: "SET_COLUMN_MODE"; mode: AgendaColumnMode }
  | { type: "SET_DENSITY"; density: AgendaDensity }
  | { type: "SET_FILTERS"; filters: AgendaFilters }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_SELECTED"; id: string | null }
  | { type: "SET_MODAL"; key: AgendaModalKey }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "TOGGLE_WAITLIST"; open: boolean }
  | { type: "TOGGLE_PENDING"; open: boolean }
  | { type: "SELECT_IDS"; ids: string[] }
  | { type: "OPTIMISTIC_RESCHEDULE"; id: string; doctorId: string; resourceId: string | null; startsAt: string; endsAt: string }
  | { type: "ROLLBACK_RESCHEDULE"; original: AgendaAppointmentDTO }
  | { type: "OPTIMISTIC_STATUS"; id: string; status: AppointmentStatus }
  | { type: "ROLLBACK_STATUS"; original: AgendaAppointmentDTO }
  | { type: "REPLACE_APPOINTMENT"; appointment: AgendaAppointmentDTO }
  | { type: "REMOVE_APPOINTMENT"; id: string }
  | { type: "SET_APPOINTMENTS"; appointments: AgendaAppointmentDTO[] }
  /**
   * WS1-T3 — los bloqueos del rango que acaba de llegar. Va SEPARADA de
   * `SET_APPOINTMENTS` porque el loader la despacha desde el mismo lote pero
   * las mutaciones optimistas de citas (mover, cambiar estado) no tocan los
   * bloqueos: mezclarlas obligaría a reenviar la lista entera en cada
   * arrastre.
   */
  | { type: "SET_BLOQUEOS"; bloqueos: BloqueoDTO[] }
  /**
   * WS1-T2 · horario — el horario propio de los doctores. Aparte, por lo mismo
   * que los bloqueos; y casi nunca cambia (es semanal): basta con el payload
   * inicial o con volver a despacharlo tras guardar un horario.
   */
  | { type: "SET_HORARIOS_DOCTORES"; horariosDoctores: Record<string, ScheduleDay[]> }
  | { type: "UPSERT_RESOURCE"; resource: ResourceDTO }
  | { type: "REMOVE_RESOURCE"; id: string }
  | { type: "REORDER_RESOURCES"; orderedIds: string[] }
  | { type: "SET_RESOURCES"; resources: ResourceDTO[] }
  | { type: "UPSERT_DOCTOR"; doctor: DoctorColumnDTO }
  | { type: "REMOVE_DOCTOR"; id: string };

export function buildInitialState(payload: AgendaDayResponse, dayISO: string): AgendaStoreState {
  return {
    dayISO,
    viewMode: "day",
    columnMode: "doctor",
    density: "fit",
    filters: { doctorIds: [], resourceIds: [], statuses: [] },
    appointments: payload.appointments,
    pendingValidation: payload.pendingValidation,
    doctors: payload.doctors,
    resources: payload.resources,
    waitlistCount: payload.waitlistCount,
    slotMinutes: payload.slotMinutes,
    dayStart: payload.dayStart,
    dayEnd: payload.dayEnd,
    schedules: payload.schedules ?? [],
    timezone: payload.timezone,
    bloqueos: payload.bloqueos ?? [],
    horariosDoctores: payload.horariosDoctores ?? {},
    drag: {
      draggingId: null,
      ghostStartsAt: null,
      ghostColumn: null,
      hasConflict: false,
    },
    waitlistOpen: false,
    pendingSectionOpen: false,
    selectedIds: [],
    selectedAppointmentId: null,
    searchQuery: "",
    modalOpen: null,
    isLoading: false,
    error: null,
  };
}

export function agendaReducer(
  state: AgendaStoreState,
  action: AgendaAction,
): AgendaStoreState {
  switch (action.type) {
    case "LOAD_DAY":
      return {
        ...state,
        dayISO: action.dayISO,
        appointments: action.payload.appointments,
        pendingValidation: action.payload.pendingValidation,
        doctors: action.payload.doctors,
        resources: action.payload.resources,
        waitlistCount: action.payload.waitlistCount,
        slotMinutes: action.payload.slotMinutes,
        dayStart: action.payload.dayStart,
        dayEnd: action.payload.dayEnd,
        schedules: action.payload.schedules ?? state.schedules,
        timezone: action.payload.timezone,
        // Un payload SIN el campo conserva los que había: las rutas que no lo
        // mandan (ninguna hoy) no pueden borrar la franja de la pantalla.
        bloqueos: action.payload.bloqueos ?? state.bloqueos,
        // WS1-T2 · horario — mismo criterio: sin el campo, se conserva.
        horariosDoctores: action.payload.horariosDoctores ?? state.horariosDoctores,
        isLoading: false,
        error: null,
      };
    case "SET_DAY":
      return { ...state, dayISO: action.dayISO };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.viewMode };
    case "SET_COLUMN_MODE":
      return { ...state, columnMode: action.mode };
    case "SET_DENSITY":
      return { ...state, density: action.density };
    case "SET_FILTERS":
      return { ...state, filters: action.filters };
    case "SET_BLOQUEOS":
      return { ...state, bloqueos: action.bloqueos };
    case "SET_HORARIOS_DOCTORES":
      return { ...state, horariosDoctores: action.horariosDoctores };
    case "SET_APPOINTMENTS":
      return { ...state, appointments: action.appointments, isLoading: false, error: null };
    case "SET_SEARCH":
      return { ...state, searchQuery: action.query };
    case "SET_SELECTED":
      return { ...state, selectedAppointmentId: action.id };
    case "SET_MODAL":
      return { ...state, modalOpen: action.key };
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "TOGGLE_WAITLIST":
      return { ...state, waitlistOpen: action.open };
    case "TOGGLE_PENDING":
      return { ...state, pendingSectionOpen: action.open };
    case "SELECT_IDS":
      return { ...state, selectedIds: action.ids };
    case "OPTIMISTIC_RESCHEDULE": {
      const next = state.appointments.map((a) =>
        a.id === action.id
          ? {
              ...a,
              doctor: a.doctor
                ? { ...a.doctor, id: action.doctorId }
                : a.doctor,
              resourceId: action.resourceId,
              startsAt: action.startsAt,
              endsAt: action.endsAt,
            }
          : a,
      );
      return { ...state, appointments: next };
    }
    case "ROLLBACK_RESCHEDULE": {
      const next = state.appointments.map((a) =>
        a.id === action.original.id ? action.original : a,
      );
      return { ...state, appointments: next };
    }
    case "OPTIMISTIC_STATUS": {
      const next = state.appointments.map((a) =>
        a.id === action.id ? { ...a, status: action.status } : a,
      );
      return { ...state, appointments: next };
    }
    case "ROLLBACK_STATUS": {
      const next = state.appointments.map((a) =>
        a.id === action.original.id ? action.original : a,
      );
      return { ...state, appointments: next };
    }
    case "REPLACE_APPOINTMENT": {
      const exists = state.appointments.some((a) => a.id === action.appointment.id);
      const next = exists
        ? state.appointments.map((a) =>
            a.id === action.appointment.id ? action.appointment : a,
          )
        : [...state.appointments, action.appointment];
      return { ...state, appointments: next };
    }
    case "REMOVE_APPOINTMENT":
      return {
        ...state,
        appointments: state.appointments.filter((a) => a.id !== action.id),
      };
    case "UPSERT_RESOURCE": {
      const exists = state.resources.some((r) => r.id === action.resource.id);
      const next = exists
        ? state.resources.map((r) => (r.id === action.resource.id ? action.resource : r))
        : [...state.resources, action.resource];
      return { ...state, resources: next.sort((a, b) => a.orderIndex - b.orderIndex) };
    }
    case "REMOVE_RESOURCE":
      return { ...state, resources: state.resources.filter((r) => r.id !== action.id) };
    case "REORDER_RESOURCES": {
      const map = new Map(state.resources.map((r) => [r.id, r] as const));
      const next: ResourceDTO[] = [];
      action.orderedIds.forEach((id, idx) => {
        const r = map.get(id);
        if (r) next.push({ ...r, orderIndex: idx });
      });
      return { ...state, resources: next };
    }
    case "SET_RESOURCES":
      return { ...state, resources: action.resources };
    case "UPSERT_DOCTOR": {
      const exists = state.doctors.some((d) => d.id === action.doctor.id);
      const next = exists
        ? state.doctors.map((d) => (d.id === action.doctor.id ? action.doctor : d))
        : [...state.doctors, action.doctor];
      return { ...state, doctors: next };
    }
    case "REMOVE_DOCTOR":
      return { ...state, doctors: state.doctors.filter((d) => d.id !== action.id) };
    default:
      return state;
  }
}

const COLUMN_MODE_KEY = "agenda-column-mode";
const VIEW_MODE_KEY = "agenda-view-mode";
const DENSITY_KEY = "agenda-density";

export function loadStoredColumnMode(): AgendaColumnMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(COLUMN_MODE_KEY);
    if (v === "doctor" || v === "resource" || v === "unified") return v;
  } catch {
    /* noop */
  }
  return null;
}

export function persistColumnMode(mode: AgendaColumnMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLUMN_MODE_KEY, mode);
  } catch {
    /* noop */
  }
}

export function loadStoredViewMode(): AgendaViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(VIEW_MODE_KEY);
    if (v === "day" || v === "week" || v === "month" || v === "list") return v;
  } catch {
    /* noop */
  }
  return null;
}

export function persistViewMode(mode: AgendaViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* noop */
  }
}

export function loadStoredDensity(): AgendaDensity | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(DENSITY_KEY);
    if (v === "fit" || v === "medium" || v === "spacious") return v;
  } catch {
    /* noop */
  }
  return null;
}

export function persistDensity(density: AgendaDensity): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* noop */
  }
}

export function defaultColumnMode(
  category: string,
  doctors: DoctorColumnDTO[],
  resources: ResourceDTO[],
): AgendaColumnMode {
  if (doctors.length <= 1 && resources.length === 0) return "unified";
  const NON_MEDICAL = [
    "SPA", "MASSAGE", "BEAUTY_CENTER", "NAIL_SALON",
    "HAIR_SALON", "BROW_LASH", "LASER_HAIR_REMOVAL",
  ];
  if (NON_MEDICAL.includes(category) && resources.length > 0) return "resource";
  return "doctor";
}
