"use client";

import { useEffect, useState } from "react";

/**
 * Un reloj que solo cambia cuando cambia el minuto.
 *
 * Lo comparten la cuadrícula (la línea de «ahora») y el panel de la cita (los
 * minutos de espera, los de consulta y la gracia de 15 minutos del «no
 * asistió»). Si el panel usara `new Date()` dentro de un `useMemo`, la hora se
 * le congelaría al abrirlo: un paciente llevaría «espera 24 min» diez minutos
 * después, y el botón «No asistió» no aparecería al cumplirse la gracia hasta
 * cerrar y volver a abrir.
 *
 * Salta en el cambio de minuto exacto y luego cada 60 s; re-renderizar por
 * segundo sería tirar trabajo a la basura para mover un número que solo cambia
 * una vez por minuto.
 *
 * ⚠️ Devuelve un instante. La hora de PARED sale siempre de convertirlo con la
 * zona de la clínica (`minutosEnTz`, `formatTimeInTz`), nunca con `getHours()`.
 */
export function useMinuto(): Date {
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const alSiguienteMinuto = 60_000 - (Date.now() % 60_000);
    let intervalo: ReturnType<typeof setInterval> | undefined;
    const arranque = setTimeout(() => {
      setAhora(new Date());
      intervalo = setInterval(() => setAhora(new Date()), 60_000);
    }, alSiguienteMinuto);
    return () => {
      clearTimeout(arranque);
      if (intervalo) clearInterval(intervalo);
    };
  }, []);

  return ahora;
}
