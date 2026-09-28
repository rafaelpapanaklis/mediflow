"use client";
// ws1-t1 ronda 2 (Ortodoncia conectada a la reserva web) — hook compartido
// por booking-modal.tsx (las 8 plantillas + directorio) y
// reservar/[slug]/booking-client.tsx: UN solo GET a
// /api/public/orthodontics/mi-control cuando la reserva se activa, mismo
// patrón "one-shot" que usePatientSession (booking-auth.ts) — no se repite
// mientras el componente siga montado, y nunca se llama si esta clínica ni
// siquiera tiene el módulo activo (`active` en false).
//
// SIEMPRE responde 200 con `casoActivo: null` cuando no aplica (sin sesión,
// sin caso, error de red): un visitante anónimo nunca debe notar que este
// fetch existe.

import { useEffect, useRef, useState } from "react";

export interface MiCasoActivoOrto {
  label: string;
  durationMin: number;
  treatingDoctorId: string | null;
}

export function useMiControlOrto(slug: string, active: boolean): MiCasoActivoOrto | null {
  const [casoActivo, setCasoActivo] = useState<MiCasoActivoOrto | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    fetch(`/api/public/orthodontics/mi-control?slug=${encodeURIComponent(slug)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCasoActivo(data?.casoActivo ?? null))
      .catch(() => setCasoActivo(null));
  }, [active, slug]);

  return casoActivo;
}
