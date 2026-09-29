"use client";
// Quien llega a la pestaña Ortodoncia desde «Completar diagnóstico / plan» de Tablero o Alertas (ws1-t12) trae
// `?completar=diagnostico|plan`: la ventana del caso se abre sola en ese paso. El aviso no da ningún permiso (solo
// se atiende si quien mira puede editar) y se quita de la dirección para que recargar o volver atrás no lo abra
// otra vez.
import { useEffect } from "react";
import { PARAMETRO_COMPLETAR, pasoPedido } from "@/lib/orthodontics/casos-incompletos-ruta";
import type { PasoDelCaso } from "@/lib/orthodontics/plan-detalle";

export function useCompletarAlLlegar(opts: { puedeEditar: boolean; abrir: (paso: PasoDelCaso) => void }) {
  const { puedeEditar, abrir } = opts;
  useEffect(() => {
    const direccion = new URLSearchParams(window.location.search);
    const paso = pasoPedido(direccion.get(PARAMETRO_COMPLETAR));
    if (direccion.get(PARAMETRO_COMPLETAR) === null) return;
    if (paso && puedeEditar) abrir(paso);
    direccion.delete(PARAMETRO_COMPLETAR);
    const resto = direccion.toString();
    // Con `null`, no con `window.history.state`: así Next se entera del cambio y no vuelve a poner el aviso.
    window.history.replaceState(null, "", `${window.location.pathname}${resto ? `?${resto}` : ""}${window.location.hash}`);
    // `abrir` cambia en cada pintado; lo que decide es el permiso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puedeEditar]);
}
