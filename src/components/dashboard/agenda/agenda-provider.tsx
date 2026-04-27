"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
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
  AgendaColumnMode,
  AgendaDayResponse,
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

  const ctx = useMemo<AgendaContextValue>(
    () => ({
      state, dispatch,
      setDay, setViewMode, setColumnMode,
      setSearchQuery, selectAppointment,
      openModal, closeModal, toggleWaitlist,
    }),
    [state, setDay, setViewMode, setColumnMode, setSearchQuery, selectAppointment, openModal, closeModal, toggleWaitlist],
  );

  return <AgendaContext.Provider value={ctx}>{children}</AgendaContext.Provider>;
}

export function useAgenda(): AgendaContextValue {
  const ctx = useContext(AgendaContext);
  if (!ctx) throw new Error("useAgenda must be used inside <AgendaProvider>");
  return ctx;
}
