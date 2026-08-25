"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeT, type Dictionary, type TVars } from "@/i18n/t";

// ═══════════════════════════════════════════════════════════════════════
// i18n y formato de /barber/campanas.
//
// Provider propio (no el de team/admin-ui, que prefija `barber.admin.`)
// porque estas llaves viven bajo `barber.campanas.`. Las piezas visuales
// (Btn, Modal, Chip…) SÍ se reutilizan de allí: no dependen del contexto y
// así el vertical tiene un solo lenguaje visual.
// ═══════════════════════════════════════════════════════════════════════

const CampDictContext = createContext<Dictionary | null>(null);

export function CampI18n({ dict, children }: { dict: Dictionary; children: ReactNode }) {
  return <CampDictContext.Provider value={dict}>{children}</CampDictContext.Provider>;
}

export type CampT = (key: string, vars?: TVars) => string;

/** t() con el prefijo barber.campanas ya puesto: t("list.empty"). */
export function useCampT(): CampT {
  const dict = useContext(CampDictContext);
  return useMemo(() => {
    const base = makeT(dict ?? {});
    return (key: string, vars?: TVars) => base(`barber.campanas.${key}`, vars);
  }, [dict]);
}

/**
 * Costo en USD. CUATRO decimales a propósito: a $0.0324 por mensaje,
 * redondear a centavos enseñaría "$0.00" para una tanda chica y la barbería
 * creería que mandar marketing es gratis.
 */
export function formatUsd(amount: number): string {
  const decimals = amount > 0 && amount < 0.1 ? 4 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(decimals)}`;
  }
}

/** Pesos mexicanos, sin centavos: es lo que gastó un cliente, no un ticket. */
export function formatMxn(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

/** Fecha corta (sin hora): las campañas se miden en días, no en minutos. */
export function formatDay(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Teléfono a 10 dígitos con formato legible: 55 1234 5678. */
export function prettyPhone(phone: string): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length !== 10) return phone;
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}
