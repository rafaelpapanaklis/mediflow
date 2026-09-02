"use client";

import { createContext, useContext } from "react";

/** Slot y columna que el cursor señala en la vista Día (ver AgendaHoverGuide). */
export interface HoverSlot {
  slot: number;
  col: number;
}

/* En su propio módulo —y no dentro de AgendaHoverGuide— para que la regla
   de horas pueda leerlo sin que los dos archivos se importen en círculo. */
export const HoverSlotContext = createContext<HoverSlot | null>(null);

export function useAgendaHoverSlot(): HoverSlot | null {
  return useContext(HoverSlotContext);
}
