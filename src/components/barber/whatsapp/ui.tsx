"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type Dictionary, type TVars } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import { formatBarberShortWhen } from "@/lib/barber/fecha-corta";

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

/**
 * Fecha corta legible. Con `timeZone` (la de la barbería) el texto es el MISMO
 * en el servidor y en el navegador: sin ella, el servidor (UTC en Vercel)
 * y el navegador (hora de México) escribían horas distintas y React tiraba el
 * HTML del servidor (error 418 de hidratación, QA C 15-nov). Sin `timeZone`
 * se comporta como antes.
 */
export function formatWhen(iso: string, locale: string, timeZone?: string | null): string {
  return formatBarberShortWhen(iso, locale, timeZone);
}

/** Teléfono legible (999 260 2093 · 55 1234 5678): el formateador ÚNICO del vertical. */
export function prettyPhone(phone: string): string {
  return formatBarberPhone(phone);
}
