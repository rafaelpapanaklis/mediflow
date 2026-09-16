import { instrumentSans, materialSymbols } from "@/fonts/menu";
import s from "./menu-dos-niveles.module.css";

/**
 * Clases que tiene que llevar TODO lo que pinta el menú, portales incluidos
 * (tooltips, desplegables, el diálogo de «Personalizar»): los tokens de color y
 * las dos familias tipográficas. Vive en su propio archivo para que quien la
 * necesite no tenga que importar el menú entero.
 */
export const CLASES_MENU = [s.tokens, instrumentSans.variable, materialSymbols.variable].join(" ");
