"use client";
// Mapa 14 — el alta del caso lee el importe del presupuesto que la trajo.
//
// Quien acepta un presupuesto de ortodoncia llega a la ficha con
// `?tab=ortodoncia&abrirCaso=1&presupuesto=<id>`. `useAbrirAltaAlLlegar`
// abre el alta y quita solo `abrirCaso`; `presupuesto` se queda en la
// dirección, y este gancho lo lee al abrir el alta y pide al servidor el
// importe de ortodoncia de ese presupuesto (misma clínica, mismo paciente,
// aceptado). Sin parámetro, o si el servidor dice que no aplica: `null`.
//
// Se lee de `window.location` (como `useAbrirAltaAlLlegar`) y no con
// `useSearchParams`, para no exigir un <Suspense> a quien monte el alta.
import { useEffect, useState } from "react";
import { PARAMETRO_PRESUPUESTO } from "@/lib/quotes/ortodoncia";
import { getPresupuestoParaAlta } from "@/app/actions/orthodontics/getPresupuestoParaAlta";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { ImporteDelPresupuesto } from "@/lib/orthodontics/importe-desde-presupuesto";

export function usePresupuestoDelAlta(patientId: string): ImporteDelPresupuesto | null {
  const [presupuesto, setPresupuesto] = useState<ImporteDelPresupuesto | null>(null);
  useEffect(() => {
    const quoteId = new URLSearchParams(window.location.search).get(PARAMETRO_PRESUPUESTO);
    if (!quoteId || !patientId) {
      setPresupuesto(null);
      return;
    }
    let vigente = true;
    getPresupuestoParaAlta({ patientId, quoteId })
      .then((res) => {
        if (vigente) setPresupuesto(isFailure(res) ? null : res.data);
      })
      .catch(() => {
        if (vigente) setPresupuesto(null);
      });
    return () => {
      vigente = false;
    };
  }, [patientId]);
  return presupuesto;
}
