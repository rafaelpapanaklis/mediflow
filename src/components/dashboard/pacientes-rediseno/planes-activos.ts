// «Tratamiento activo» del Resumen con más de un plan activo (auditoría de uso, C-75).
//
// La tarjeta enseñaba UN plan ($1,350) mientras «Estado de cuenta» decía «Plan activo $2,550» (la suma de los
// dos planes activos). Ahora la tarjeta dice cuántos planes activos más hay y el total de todos, la misma cifra
// que el estado de cuenta. PURO (los textos, con `useLocale`, aparte).

import { useLocale } from "@/i18n/i18n-provider";

export interface ResumenDePlanesActivos {
  /** Planes activos además del que se enseña. */
  otros: number;
  /** Suma del costo de TODOS los activos (la del estado de cuenta). */
  totalCosto: number;
}

export function resumenDePlanesActivos(tratamientos: ReadonlyArray<{ status?: unknown; totalCost?: unknown }>): ResumenDePlanesActivos {
  const activos = tratamientos.filter((p) => p.status === "ACTIVE");
  const totalC = activos.reduce((acc, p) => acc + (typeof p.totalCost === "number" && Number.isFinite(p.totalCost) ? Math.round(p.totalCost * 100) : 0), 0);
  return { otros: Math.max(0, activos.length - 1), totalCosto: totalC / 100 };
}

const es = {
  masPlanes: (n: number) => (n === 1 ? "y 1 plan activo más" : `y ${n} planes activos más`),
  totalActivos: "Total de planes activos",
};
const en: typeof es = {
  masPlanes: (n: number) => (n === 1 ? "and 1 more active plan" : `and ${n} more active plans`),
  totalActivos: "All active plans",
};

export function useTextosPlanesActivos(): typeof es {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return locale === "en" ? en : es;
}
