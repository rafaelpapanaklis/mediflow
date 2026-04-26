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
  persistColumnMode,
  type AgendaAction,
} from "@/lib/agenda/store";
import type {
  AgendaColumnMode,
  AgendaDayResponse,
  AgendaStoreState,
} from "@/lib/agenda/types";

interface AgendaContextValue {
  state: AgendaStoreState;
  dispatch: Dispatch<AgendaAction>;
  setDay: (dayISO: string) => void;
  setColumnMode: (mode: AgendaColumnMode) => void;
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
      const stored = loadStoredColumnMode();
      const mode = stored ?? defaultColumnMode(
        clinicCategory,
        initialPayload.doctors,
        initialPayload.resources,
      );
      return { ...base, columnMode: mode };
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

  const setColumnMode = useCallback((mode: AgendaColumnMode) => {
    persistColumnMode(mode);
    dispatch({ type: "SET_COLUMN_MODE", mode });
  }, []);

  const ctx = useMemo<AgendaContextValue>(
    () => ({ state, dispatch, setDay, setColumnMode }),
    [state, setDay, setColumnMode],
  );

  return <AgendaContext.Provider value={ctx}>{children}</AgendaContext.Provider>;
}

export function useAgenda(): AgendaContextValue {
  const ctx = useContext(AgendaContext);
  if (!ctx) throw new Error("useAgenda must be used inside <AgendaProvider>");
  return ctx;
}
