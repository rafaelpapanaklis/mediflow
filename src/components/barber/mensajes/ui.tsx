"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type Dictionary, type TVars } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";

// i18n de /barber/mensajes. Mismo patrón que whatsapp/ui.tsx: el servidor
// manda el diccionario COMPLETO del vertical y aquí se antepone el prefijo
// (i18n-alcance.test lo vigila).

const MsjDictContext = createContext<Dictionary | null>(null);

export function MsjI18n({ dict, children }: { dict: Dictionary; children: ReactNode }) {
  return <MsjDictContext.Provider value={dict}>{children}</MsjDictContext.Provider>;
}

export type MsjT = (key: string, vars?: TVars) => string;

/** t() con el prefijo barber.mensajes ya puesto: t("chat.back"). */
export function useMsjT(): MsjT {
  const dict = useContext(MsjDictContext);
  return useMemo(() => makeBarberT(dict ?? {}, "barber.mensajes"), [dict]);
}
