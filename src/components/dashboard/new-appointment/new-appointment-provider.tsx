"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  NewAppointmentContextValue,
  OpenNewAppointmentParams,
} from "@/lib/new-appointment/types";
import { NewAppointmentDialog } from "./new-appointment-dialog";

const NewAppointmentContext =
  createContext<NewAppointmentContextValue | null>(null);

export function NewAppointmentProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [params, setParams] = useState<OpenNewAppointmentParams | null>(null);

  const open = useCallback((p?: OpenNewAppointmentParams) => {
    setParams(p ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const ctx = useMemo<NewAppointmentContextValue>(
    () => ({ open, close }),
    [open, close],
  );

  return (
    <NewAppointmentContext.Provider value={ctx}>
      {children}
      <NewAppointmentDialog
        isOpen={isOpen}
        onClose={close}
        params={params}
      />
    </NewAppointmentContext.Provider>
  );
}

export function useNewAppointmentDialog(): NewAppointmentContextValue {
  const ctx = useContext(NewAppointmentContext);
  if (!ctx) {
    throw new Error(
      "useNewAppointmentDialog must be used inside <NewAppointmentProvider>",
    );
  }
  return ctx;
}
