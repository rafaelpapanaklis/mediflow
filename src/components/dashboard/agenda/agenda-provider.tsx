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
import { viewRangeISO } from "@/lib/agenda/date-ranges";
import { todayInTz } from "@/lib/agenda/time-utils";
import type {
  AgendaAppointmentDTO,
  AgendaColumnMode,
  AgendaDayResponse,
  AgendaFilters,
  AgendaModalKey,
  AgendaStoreState,
  AgendaViewMode,
} from "@/lib/agenda/types";

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
  /**
   * Hover-prefetch para tabs de vista. Llama esto al onMouseEnter de
   * Día/Semana/Mes/Lista para warmar el cache antes del click.
   */
  prefetchView: (mode: AgendaViewMode) => void;
}

interface CacheEntry {
  data: AgendaAppointmentDTO[];
  ts: number;
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
  //
  // SWR-lite cache: cada (range, filtros) se cachea por 30s. Cuando el
  // usuario vuelve a una vista/día ya visto, render inmediato del
  // cache + revalidate en background. Hover-prefetch en los tabs de
  // vista warma el cache ANTES del click → transición instantánea.
  const filterDoctorIdsKey = state.filters.doctorIds.join(",");
  const filterResourceIdsKey = state.filters.resourceIds.join(",");
  const filterStatusesKey = state.filters.statuses.join(",");
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const initialFetchSkipped = useRef(false);

  const fetchRangeData = useCallback(async (
    viewMode: AgendaViewMode,
    dayISO: string,
    filters: AgendaFilters,
    options: { signal?: AbortSignal; backgroundOnly?: boolean } = {},
  ): Promise<void> => {
    // Único helper de rangos — comparte semántica con SSR y
    // /api/agenda/range. Si dos componentes calculan el rango distinto,
    // los contadores y el render se desincronizan.
    //
    // Bug E: vista Lista siempre arranca en HOY (no en `state.dayISO`),
    // sin importar a qué día navegó el usuario en Día/Semana. Sin esto,
    // si Rafael navegaba al 14/abr en vista Día y cambiaba a vista
    // Lista, veía citas del 14/abr en adelante (citas pasadas).
    const baseDayISO = viewMode === "list" ? todayInTz(state.timezone) : dayISO;
    const range = viewRangeISO(viewMode, baseDayISO, state.timezone);
    const dKey = filters.doctorIds.join(",");
    const rKey = filters.resourceIds.join(",");
    const sKey = filters.statuses.join(",");
    const key = `${range.from}|${range.to}|${dKey}|${rKey}|${sKey}`;

    // Cache hit: render inmediato (stale-while-revalidate). Si el cache
    // es fresco (< 30s) skip la revalidación; si no, sigue con el fetch
    // para refrescar.
    const cached = cacheRef.current.get(key);
    if (cached && !options.backgroundOnly) {
      dispatch({ type: "SET_APPOINTMENTS", appointments: cached.data });
      if (Date.now() - cached.ts < 30_000) return;
    }

    const params = new URLSearchParams();
    params.set("from", range.from);
    params.set("to", range.to);
    if (dKey) params.set("doctorIds", dKey);
    if (rKey) params.set("resourceIds", rKey);
    if (sKey) params.set("statuses", sKey);

    try {
      const res = await fetch(`/api/agenda/range?${params}`, { signal: options.signal });
      if (!res.ok) throw new Error("range_failed");
      const data = (await res.json()) as { appointments: AgendaAppointmentDTO[] };
      if (options.signal?.aborted) return;
      const appts = data.appointments ?? [];
      cacheRef.current.set(key, { data: appts, ts: Date.now() });
      if (!options.backgroundOnly) {
        dispatch({ type: "SET_APPOINTMENTS", appointments: appts });
      }
    } catch (e) {
      const err = e as { name?: string };
      if (err?.name === "AbortError") return;
      // Background fetch silent; foreground deja state.appointments con
      // lo que sea (stale o vacío) — no blank.
    }
  }, [state.timezone]);

  useEffect(() => {
    // Skip primer mount cuando los datos del SSR ya cubren la vista actual
    // (caso común: viewMode='day' + dayISO===initialDayISO). Evita un
    // round-trip duplicado /api/agenda/range justo después de la SSR. Aún
    // así, sembramos el cache con los datos del SSR para que volver a
    // este mismo día sea instant.
    if (
      !initialFetchSkipped.current &&
      state.viewMode === "day" &&
      state.dayISO === initialDayISO &&
      state.filters.doctorIds.length === 0 &&
      state.filters.resourceIds.length === 0 &&
      state.filters.statuses.length === 0
    ) {
      initialFetchSkipped.current = true;
      const range = viewRangeISO("day", initialDayISO, state.timezone);
      const key = `${range.from}|${range.to}|||`;
      cacheRef.current.set(key, { data: initialPayload.appointments, ts: Date.now() });
      return;
    }
    initialFetchSkipped.current = true;

    const ctrl = new AbortController();
    void fetchRangeData(state.viewMode, state.dayISO, state.filters, { signal: ctrl.signal });
    return () => ctrl.abort();
  }, [state.dayISO, state.viewMode, filterDoctorIdsKey, filterResourceIdsKey, filterStatusesKey, state.filters, fetchRangeData, initialDayISO, initialPayload.appointments]);

  // Idle-prefetch: cuando el usuario está en vista Día, después de 500ms
  // de inactividad warmamos el cache de la Semana correspondiente. Si
  // luego clickea "Semana", la transición es instantánea.
  useEffect(() => {
    if (state.viewMode !== "day") return;
    const t = setTimeout(() => {
      void fetchRangeData("week", state.dayISO, state.filters, { backgroundOnly: true });
    }, 500);
    return () => clearTimeout(t);
  }, [state.viewMode, state.dayISO, filterDoctorIdsKey, filterResourceIdsKey, filterStatusesKey, state.filters, fetchRangeData]);

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

  const prefetchView = useCallback((mode: AgendaViewMode) => {
    void fetchRangeData(mode, state.dayISO, state.filters, { backgroundOnly: true });
  }, [fetchRangeData, state.dayISO, state.filters]);

  const ctx = useMemo<AgendaContextValue>(
    () => ({
      state, dispatch,
      setDay, setViewMode, setColumnMode,
      setSearchQuery, selectAppointment,
      openModal, closeModal, toggleWaitlist, togglePendingPanel,
      setFilters, clearFilters, prefetchView,
    }),
    [state, setDay, setViewMode, setColumnMode, setSearchQuery, selectAppointment, openModal, closeModal, toggleWaitlist, togglePendingPanel, setFilters, clearFilters, prefetchView],
  );

  return <AgendaContext.Provider value={ctx}>{children}</AgendaContext.Provider>;
}

export function useAgenda(): AgendaContextValue {
  const ctx = useContext(AgendaContext);
  if (!ctx) throw new Error("useAgenda must be used inside <AgendaProvider>");
  return ctx;
}
