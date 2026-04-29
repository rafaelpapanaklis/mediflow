"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  agendaReducer,
  buildInitialState,
  defaultColumnMode,
  loadStoredColumnMode,
  loadStoredViewMode,
  persistColumnMode,
  persistViewMode,
  type AgendaAction,
} from "@/lib/agenda/store";
import type {
  AgendaAppointmentDTO,
  AgendaColumnMode,
  AgendaDayResponse,
  AgendaFilters,
  AgendaModalKey,
  AgendaStoreState,
  AgendaViewMode,
} from "@/lib/agenda/types";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function fmtISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Calcula el rango (from, to) que cada vista necesita cargar.
 * Day → un solo día. Week → lunes a domingo. Month → grid de 42 celdas
 * (incluye colas de meses vecinos). List → mes calendario completo.
 */
function rangeForView(dayISO: string, viewMode: AgendaViewMode): { from: string; to: string } {
  const [y, m, d] = dayISO.split("-").map((n) => parseInt(n, 10));
  if (viewMode === "day") return { from: dayISO, to: dayISO };
  if (viewMode === "week") {
    const ref = new Date(Date.UTC(y, m - 1, d));
    const dow = (ref.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(y, m - 1, d - dow));
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    return { from: fmtISO(monday), to: fmtISO(sunday) };
  }
  if (viewMode === "month") {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const dow = (first.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(y, m - 1, 1 - dow));
    const end = new Date(start.getTime() + 41 * 86_400_000);
    return { from: fmtISO(start), to: fmtISO(end) };
  }
  // list → mes calendario que contiene dayISO.
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return { from: fmtISO(first), to: fmtISO(last) };
}

interface AgendaContextValue {
  state: AgendaStoreState;
  dispatch: Dispatch<AgendaAction>;
  setDay: (dayISO: string) => void;
  setViewMode: (mode: AgendaViewMode) => void;
  setColumnMode: (mode: AgendaColumnMode) => void;
  setSearchQuery: (q: string) => void;
  selectAppointment: (id: string | null) => void;
  openModal: (key: AgendaModalKey) => void;
  closeModal: () => void;
  toggleWaitlist: (open?: boolean) => void;
  togglePendingPanel: (open?: boolean) => void;
  setFilters: (filters: AgendaFilters) => void;
  clearFilters: () => void;
}

const AgendaContext = createContext<AgendaContextValue | null>(null);

interface ProviderProps {
  initialPayload: AgendaDayResponse;
  initialDayISO: string;
  clinicCategory: string;
  children: ReactNode;
}

export function AgendaProvider({
  initialPayload,
  initialDayISO,
  clinicCategory,
  children,
}: ProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [state, dispatch] = useReducer(
    agendaReducer,
    null,
    () => {
      const base = buildInitialState(initialPayload, initialDayISO);
      const storedColumn = loadStoredColumnMode();
      const columnMode = storedColumn ?? defaultColumnMode(
        clinicCategory,
        initialPayload.doctors,
        initialPayload.resources,
      );
      const storedView = loadStoredViewMode();
      return { ...base, columnMode, viewMode: storedView ?? "day" };
    },
  );

  useEffect(() => {
    dispatch({ type: "LOAD_DAY", payload: initialPayload, dayISO: initialDayISO });
  }, [initialPayload, initialDayISO]);

  // ── Unified data loader ─────────────────────────────────────────────
  // Recarga citas según viewMode + dayISO + filtros. La página inicial
  // hace SSR de un solo día (rápido para LCP), pero al montar / cambiar
  // de vista / cambiar filtros, refrescamos con el rango correcto via
  // /api/agenda/range. Multi-tenant: el endpoint usa loadClinicSession
  // y filtra por clinicId desde la sesión.
  const filterDoctorIdsKey = state.filters.doctorIds.join(",");
  const filterResourceIdsKey = state.filters.resourceIds.join(",");
  const filterStatusesKey = state.filters.statuses.join(",");
  const initialFetchSkipped = useRef(false);
  useEffect(() => {
    // Skip primer mount cuando los datos del SSR ya cubren la vista actual
    // (caso común: viewMode='day' + dayISO===initialDayISO). Evita un
    // round-trip duplicado /api/agenda/range justo después de la SSR.
    if (
      !initialFetchSkipped.current &&
      state.viewMode === "day" &&
      state.dayISO === initialDayISO &&
      state.filters.doctorIds.length === 0 &&
      state.filters.resourceIds.length === 0 &&
      state.filters.statuses.length === 0
    ) {
      initialFetchSkipped.current = true;
      return;
    }
    initialFetchSkipped.current = true;

    const ctrl = new AbortController();
    const range = rangeForView(state.dayISO, state.viewMode);
    const params = new URLSearchParams();
    params.set("from", range.from);
    params.set("to", range.to);
    if (filterDoctorIdsKey) params.set("doctorIds", filterDoctorIdsKey);
    if (filterResourceIdsKey) params.set("resourceIds", filterResourceIdsKey);
    if (filterStatusesKey) params.set("statuses", filterStatusesKey);

    dispatch({ type: "SET_LOADING", isLoading: true });
    fetch(`/api/agenda/range?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("range_failed");
        return r.json();
      })
      .then((data: { appointments: AgendaAppointmentDTO[] }) => {
        if (ctrl.signal.aborted) return;
        dispatch({ type: "SET_APPOINTMENTS", appointments: data.appointments ?? [] });
      })
      .catch((e: { name?: string }) => {
        if (e?.name === "AbortError") return;
        dispatch({ type: "SET_LOADING", isLoading: false });
      });
    return () => ctrl.abort();
  }, [state.dayISO, state.viewMode, filterDoctorIdsKey, filterResourceIdsKey, filterStatusesKey]);

  const setDay = useCallback(
    (dayISO: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("date", dayISO);
      params.delete("highlight");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const setViewMode = useCallback((mode: AgendaViewMode) => {
    persistViewMode(mode);
    dispatch({ type: "SET_VIEW_MODE", viewMode: mode });
  }, []);

  const setColumnMode = useCallback((mode: AgendaColumnMode) => {
    persistColumnMode(mode);
    dispatch({ type: "SET_COLUMN_MODE", mode });
  }, []);

  const setSearchQuery = useCallback((q: string) => {
    dispatch({ type: "SET_SEARCH", query: q });
  }, []);

  const selectAppointment = useCallback((id: string | null) => {
    dispatch({ type: "SET_SELECTED", id });
  }, []);

  const openModal = useCallback((key: AgendaModalKey) => {
    dispatch({ type: "SET_MODAL", key });
  }, []);

  const closeModal = useCallback(() => {
    dispatch({ type: "SET_MODAL", key: null });
  }, []);

  const toggleWaitlist = useCallback((open?: boolean) => {
    dispatch({
      type: "TOGGLE_WAITLIST",
      open: open ?? !state.waitlistOpen,
    });
  }, [state.waitlistOpen]);

  const togglePendingPanel = useCallback((open?: boolean) => {
    dispatch({
      type: "TOGGLE_PENDING",
      open: open ?? !state.pendingSectionOpen,
    });
  }, [state.pendingSectionOpen]);

  const setFilters = useCallback((filters: AgendaFilters) => {
    dispatch({ type: "SET_FILTERS", filters });
  }, []);

  const clearFilters = useCallback(() => {
    dispatch({ type: "SET_FILTERS", filters: { doctorIds: [], resourceIds: [], statuses: [] } });
  }, []);

  const ctx = useMemo<AgendaContextValue>(
    () => ({
      state, dispatch,
      setDay, setViewMode, setColumnMode,
      setSearchQuery, selectAppointment,
      openModal, closeModal, toggleWaitlist, togglePendingPanel,
      setFilters, clearFilters,
    }),
    [state, setDay, setViewMode, setColumnMode, setSearchQuery, selectAppointment, openModal, closeModal, toggleWaitlist, togglePendingPanel, setFilters, clearFilters],
  );

  return <AgendaContext.Provider value={ctx}>{children}</AgendaContext.Provider>;
}

export function useAgenda(): AgendaContextValue {
  const ctx = useContext(AgendaContext);
  if (!ctx) throw new Error("useAgenda must be used inside <AgendaProvider>");
  return ctx;
}
