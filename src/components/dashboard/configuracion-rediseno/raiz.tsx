import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./configuracion.module.css";

/**
 * La raíz del rediseño de Configuración: monta los tokens y las dos
 * familias tipográficas del menú de dos niveles (`CLASES_MENU`) y, DENTRO,
 * la caja de la pantalla.
 *
 * Dos nodos y no uno, a propósito: `.tokens` del menú apaga `tabular-nums`
 * para sus propias cifras con un selector que le gana a cualquier clase
 * (`:root body .tokens`). Si `.raiz` fuera el mismo nodo, perdería; siendo
 * hijo, vuelve a encender `tabular-nums` y todo lo de dentro —cantidades,
 * horas, contadores— lo hereda en Instrument Sans.
 *
 * Solo se monta con el interruptor `menu-dos-niveles` encendido para la
 * clínica; con él apagado la pantalla ni importa esta carpeta.
 */
export function RaizConfiguracion({
  children,
  estrecha = false,
}: {
  children: ReactNode;
  /** Pantallas de un solo formulario (firma, sucursales): caja más angosta. */
  estrecha?: boolean;
}) {
  return (
    <div className={CLASES_MENU}>
      <div className={[s.raiz, estrecha ? s.raizEstrecha : ""].filter(Boolean).join(" ")}>
        {children}
      </div>
    </div>
  );
}
