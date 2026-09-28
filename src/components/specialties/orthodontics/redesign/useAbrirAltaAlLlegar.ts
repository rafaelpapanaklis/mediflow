"use client";
// Quien llega a la pestaña Ortodoncia desde «Abrir caso» del módulo (Pacientes
// en tratamiento → elegir paciente) trae `?abrirCaso=1`: el asistente de alta
// se abre solo. El aviso no da ningún permiso (ver `debeAbrirElAlta`), y se
// quita de la dirección para que recargar o volver atrás no lo abra otra vez.
//
// Lo usan las dos caras de la pestaña: la completa
// (`OrthodonticsRedesignClient`) y la limpia (`OrtodonciaSinCaso`).
import { useEffect } from "react";
import { PARAMETRO_ABRIR_CASO, debeAbrirElAlta } from "@/lib/orthodontics/abrir-caso";

export function useAbrirAltaAlLlegar(opts: { tieneCaso: boolean; puedeCrear: boolean; abrir: () => void }) {
  const { tieneCaso, puedeCrear, abrir } = opts;
  useEffect(() => {
    const direccion = new URLSearchParams(window.location.search);
    const parametro = direccion.get(PARAMETRO_ABRIR_CASO);
    if (parametro === null) return;
    if (debeAbrirElAlta({ parametro, tieneCaso, puedeCrear })) abrir();
    direccion.delete(PARAMETRO_ABRIR_CASO);
    const resto = direccion.toString();
    // Con `null`, no con `window.history.state`: así Next se entera del cambio
    // y no vuelve a poner el aviso en la dirección en su siguiente refresco.
    window.history.replaceState(null, "", `${window.location.pathname}${resto ? `?${resto}` : ""}${window.location.hash}`);
    // `abrir` cambia en cada pintado; lo que decide es el caso y el permiso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tieneCaso, puedeCrear]);
}
