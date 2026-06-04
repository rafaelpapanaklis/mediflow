// src/i18n/i18n-provider.tsx
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeT, type Dictionary, type TFunction } from "./t";

interface I18nContextValue {
  locale: string;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Provee `t` (y el locale activo) a todo el árbol cliente del panel. Se monta en
 * el layout servidor del dashboard, que resuelve el locale desde la clínica de la
 * sesión (clinic.locale ?? "es") y le pasa el diccionario YA resuelto a ese
 * locale — solo se serializa el idioma activo, no ambos. `t` se memoiza por dict.
 */
export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: string;
  dict: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: makeT(dict) }),
    [locale, dict],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Hook cliente: const t = useT(); t("namespace.clave") | t("clave", { var }).
export function useT(): TFunction {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT debe usarse dentro de <I18nProvider>");
  return ctx.t;
}

export function useLocale(): string {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useLocale debe usarse dentro de <I18nProvider>");
  return ctx.locale;
}
