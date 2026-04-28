"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  NewPatientContextValue,
  OpenNewPatientParams,
} from "@/lib/new-patient/types";
import { NewPatientDialog } from "./new-patient-dialog";

const NewPatientContext = createContext<NewPatientContextValue | null>(null);

interface DialogState extends OpenNewPatientParams {
  isOpen: boolean;
}

export function NewPatientProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({ isOpen: false });

  const open = useCallback((params?: OpenNewPatientParams) => {
    setState({ isOpen: true, ...params });
  }, []);

  const close = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  const ctx = useMemo<NewPatientContextValue>(
    () => ({ open, close }),
    [open, close],
  );

  return (
    <NewPatientContext.Provider value={ctx}>
      {children}
      <NewPatientDialog
        isOpen={state.isOpen}
        onClose={close}
        initialName={state.initialName}
        initialPhone={state.initialPhone}
        initialEmail={state.initialEmail}
        onCreated={state.onCreated}
      />
    </NewPatientContext.Provider>
  );
}

export function useNewPatientDialog(): NewPatientContextValue {
  const ctx = useContext(NewPatientContext);
  if (!ctx) {
    throw new Error(
      "useNewPatientDialog must be used inside <NewPatientProvider>",
    );
  }
  return ctx;
}
