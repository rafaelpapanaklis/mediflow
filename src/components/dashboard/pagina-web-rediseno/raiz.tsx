import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./pagina-web.module.css";

/**
 * La raíz del rediseño del EDITOR de página web (el panel de Configuración y
 * el lienzo de clic-para-editar), vestida con el mismo lenguaje visual que el
 * menú de dos niveles, Pacientes, la Agenda y «Hoy».
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y las dos familias
 * tipográficas (Instrument Sans y los íconos). Las clases de
 * `pagina-web.module.css` leen esos tokens por herencia.
 *
 * ⛔ No es el sitio público de la clínica. El lienzo de clic-para-editar sigue
 * mostrando la página pública DENTRO de un <iframe> que apunta a
 * /landing-preview: eso lo pinta la plantilla de la clínica y no cambia ni un
 * píxel por este rediseño. Lo que se viste aquí es el CHROME del editor
 * (la barra, los formularios, las tarjetas) — nunca lo que hay dentro del
 * iframe.
 *
 * Solo la monta `LandingConfigClient` / `EditorVisual` cuando el interruptor
 * por clínica `menu-dos-niveles` (`clinic_feature_flags`) está encendido.
 * Apagado, las dos pantallas devuelven exactamente el mismo árbol de hoy —
 * ver el `if (!rediseno) return (...)` al final de cada componente — y no
 * llegan a montar esto.
 */
export function RaizPaginaWeb({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[CLASES_MENU, s.raiz, className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

/** Las clases de la raíz, para un nodo que ya existe (el lienzo, el modal de conflicto). */
export const CLASES_PAGINA_WEB = [CLASES_MENU, s.raiz].join(" ");
