"use client";

import { useMemo } from "react";
import { type Dictionary, type TFunction } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";

/**
 * t() de cliente para el dinero barber. El server manda el sub-diccionario
 * `barber.caja` (getBarberDict(locale).barber.caja) y aquí se vuelve una
 * función pura: t("ticket.title"). Mismo motor makeT que el server, así
 * nunca divergen. No hay provider de i18n en /barber a propósito (ver
 * dictionaries/barber/index.ts).
 */
export function useBarberT(dict: Dictionary): TFunction {
  return useMemo(() => makeBarberT(dict), [dict]);
}
