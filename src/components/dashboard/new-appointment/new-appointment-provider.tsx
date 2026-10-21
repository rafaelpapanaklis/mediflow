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
import type { AparienciaNuevaCita } from "./apariencia";

const NewAppointmentContext =
  createContext<NewAppointmentContextValue | null>(null);

export function NewAppointmentProvider({
  children,
  apariencia = "clasica",
}: {
  children: ReactNode;
  /**
   * La ropa de la ventana. La pone el layout con el interruptor
   * `menu-dos-niveles`; sin él es la de siempre. No cambia ninguna regla.
   */
  apariencia?: AparienciaNuevaCita;
}) {
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
    () => ({ open, close, apariencia }),
    [open, close, apariencia],
  );

  return (
    <NewAppointmentContext.Provider value={ctx}>
      {children}
      <NewAppointmentDialog
        isOpen={isOpen}
        onClose={close}
        params={params}
        apariencia={apariencia}
      />
    </NewAppointmentContext.Provider>
  );
}

/**
 * ws1-t1 (plan fase 2 · P8) — todo «Nueva cita» que se abra DENTRO de esto lleva además `extra`
 * («Agendar lo pendiente» en la agenda: el clic en un hueco abre la cita con el paciente, el
 * motivo, la duración y las filas del plan). Lo que pasa quien abre (el hueco, el doctor de la
 * columna) manda sobre `extra`; los `onCreated` se llaman los dos. Con `extra = null`, nada cambia.
 */
export function ConParamsDeNuevaCita({
  extra,
  children,
}: {
  extra: OpenNewAppointmentParams | null;
  children: ReactNode;
}) {
  const padre = useContext(NewAppointmentContext);
  const ctx = useMemo<NewAppointmentContextValue | null>(() => {
    if (!padre || !extra) return padre;
    return {
      ...padre,
      open: (p?: OpenNewAppointmentParams) => {
        const propios = p ?? {};
        padre.open({
          ...extra,
          ...propios,
          // El hueco elegido trae su doctor: ese manda; si no trae, el del plan.
          initialDoctorId: propios.initialSlot?.doctorId ?? propios.initialDoctorId ?? extra.initialDoctorId,
          onCreated: (appt) => {
            propios.onCreated?.(appt);
            extra.onCreated?.(appt);
          },
        });
      },
    };
  }, [padre, extra]);
  if (!ctx) return <>{children}</>;
  return <NewAppointmentContext.Provider value={ctx}>{children}</NewAppointmentContext.Provider>;
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
