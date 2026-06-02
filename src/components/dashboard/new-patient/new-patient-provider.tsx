"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  NewPatientContextValue,
  OpenNewPatientParams,
} from "@/lib/new-patient/types";
import { NewPatientModal } from "@/components/dashboard/new-patient-modal";

/**
 * Single source of truth para el modal "Nuevo paciente".
 *
 * El provider envuelve el dashboard y expone open/close vía hook
 * useNewPatientDialog. Renderiza el `NewPatientModal` completo (con
 * sección Identificación oficial NOM-024, alergias, notas, etc.) — el
 * modal "minimalista" anterior fue eliminado para evitar UI duplicada.
 */
const NewPatientContext = createContext<NewPatientContextValue | null>(null);

interface DialogState extends OpenNewPatientParams {
  isOpen: boolean;
}

export function NewPatientProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({ isOpen: false });
  const router = useRouter();

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

  // El consumer del provider espera onCreated con shape { id, name }
  // (legacy de NewPatientDialog). NewPatientModal devuelve el patient
  // completo desde la API. Mapeamos para mantener compat.
  const handleCreated = useCallback((patient: { id: string; firstName: string; lastName: string | null }) => {
    if (state.onCreated) {
      const fullName = [patient.firstName, patient.lastName].filter(Boolean).join(" ").trim();
      state.onCreated({ id: patient.id, name: fullName });
    }
    // Red de seguridad: refresca SIEMPRE las vistas server-rendered (listas,
    // contadores, context bar) tras crear un paciente, aunque el opener no
    // pase onCreated. Síntoma #1: registrar paciente sin recargar.
    router.refresh();
  }, [state, router]);

  return (
    <NewPatientContext.Provider value={ctx}>
      {children}
      <NewPatientModal
        open={state.isOpen}
        onClose={close}
        onCreated={handleCreated}
        initialName={state.initialName}
        initialPhone={state.initialPhone}
        initialEmail={state.initialEmail}
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
