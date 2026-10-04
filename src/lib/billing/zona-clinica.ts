// «Hoy» de la CLÍNICA para las fechas por defecto de cobros y facturas (auditoría de
// uso C-33, 4-oct-2026). Hasta aquí salían de la zona del NAVEGADOR: con la
// computadora en hora del este, una factura de las 23:03 (CDMX, sábado 3) nacía «4 oct».
// La zona se pide una vez a /api/clinic/zona y se recuerda; mientras no llega (o si
// falla) se usa la del navegador, como antes.

import { useEffect, useState } from "react";
import { hoyEnZona } from "@/lib/fechas/hoy-en-zona";
import { todayLocalISO } from "./paid-at";

let zonaCache: string | null | undefined;
let pendiente: Promise<string | null> | null = null;

function leerZona(): Promise<string | null> {
  if (zonaCache !== undefined) return Promise.resolve(zonaCache);
  if (!pendiente) {
    pendiente = fetch("/api/clinic/zona")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: string } | null) => (zonaCache = typeof d?.timezone === "string" && d.timezone ? d.timezone : null))
      .catch(() => null)
      .finally(() => { pendiente = null; });
  }
  return pendiente;
}

/** El día ("YYYY-MM-DD") en la zona de la clínica; sin zona válida, el del navegador. Puro. */
export function hoyDeLaClinica(zona: string | null | undefined, now: Date = new Date()): string {
  if (!zona) return todayLocalISO(now);
  try {
    return hoyEnZona(now, zona);
  } catch {
    return todayLocalISO(now);
  }
}

/** Hook: el «hoy» de la clínica (se re-pinta cuando llega la zona). */
export function useHoyDeLaClinica(): string {
  const [zona, setZona] = useState<string | null>(zonaCache ?? null);
  useEffect(() => {
    let vivo = true;
    void leerZona().then((z) => { if (vivo) setZona(z); });
    return () => { vivo = false; };
  }, []);
  return hoyDeLaClinica(zona);
}
