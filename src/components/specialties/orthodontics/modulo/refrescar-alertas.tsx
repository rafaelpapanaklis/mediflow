"use client";
// Módulo de Ortodoncia — cómo se repinta Alertas después de posponer o deshacer (ws1-t12, revisión final, punto 10).
//
// `VistaAlertas` guarda las alertas en su estado y da a sus botones esta función: pide los datos de nuevo al servidor
// (`cargarAlertasDeOrtodoncia`) y la vista se repinta SIN recargar; no depende de que `router.refresh()` traiga la
// página. Fuera de `VistaAlertas` (o si la lectura falla) se cae a `router.refresh()`, como antes.
import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";

export const RefrescarAlertasContext = createContext<(() => Promise<void>) | null>(null);

export function useRefrescarAlertas(): () => Promise<void> {
  const desdeLaVista = useContext(RefrescarAlertasContext);
  const router = useRouter();
  return desdeLaVista ?? (async () => router.refresh());
}
