"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type Dictionary, type TVars } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";

// ═══════════════════════════════════════════════════════════════════════
// i18n de /barber/whatsapp.
//
// El servidor manda el diccionario COMPLETO del vertical y aquí se arma el
// mismo makeT que usa el server: así las llaves son idénticas en los dos
// lados y no hay dos verdades.
//
// Provider propio (y no el de team/admin-ui) porque aquel prefija
// `barber.admin.` y estas pantallas viven bajo `barber.whatsapp.`. El resto
// de las piezas visuales (Btn, Modal, Chip…) SÍ se reutilizan de allí: no
// dependen del contexto y así el vertical tiene un solo lenguaje visual.
// ═══════════════════════════════════════════════════════════════════════

const WaDictContext = createContext<Dictionary | null>(null);

export function WaI18n({ dict, children }: { dict: Dictionary; children: ReactNode }) {
  return <WaDictContext.Provider value={dict}>{children}</WaDictContext.Provider>;
}

export type WaT = (key: string, vars?: TVars) => string;

/** t() con el prefijo barber.whatsapp ya puesto: t("inbox.title"). */
export function useWaT(): WaT {
  const dict = useContext(WaDictContext);
  return useMemo(() => {
    return makeBarberT(dict ?? {}, "barber.whatsapp");
  }, [dict]);
}

/** Fecha corta legible en la zona del navegador. */
export function formatWhen(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

/** Teléfono a 10 dígitos con formato legible: 55 1234 5678. */
export function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length !== 10) return phone;
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}
