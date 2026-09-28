"use client";

// Ortodoncia — Ola 0 (ws1-t1): ranura de la lista de mensualidades por
// cobrar, para Caja y para Hoy (recepción).
//
// ⚠️ Esta Ola NO la monta en `caja-client.tsx` ni en la ruta de Hoy
// (`api/dashboard/home/receptionist/route.ts`): ambos son, por decisión de
// arquitectura, SOLO de la parte «Recepción» («Archivos calientes» en
// REPORTE-ws1-t8.md) — ni siquiera la Ola 0 los toca, para no pisar el
// trabajo que esa parte hace en la Ola 1. El componente existe ya para que
// Recepción lo importe y lo monte, autosuficiente como
// `AvisoAnticiposPorRevisar` (self-fetch a su propio endpoint, se calla sola
// si no hay nada que cobrar).
//
// Devuelve `null` hasta entonces — ver «MAPA DE PARTES» en REPORTE-ws1-t1.md.
export function ListaMensualidades() {
  return null;
}
