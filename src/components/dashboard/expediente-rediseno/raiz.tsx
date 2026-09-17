import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./expediente.module.css";

/**
 * La raíz de los apartados del expediente vestidos en la segunda ola (Plan
 * de tratamiento, Citas, Facturación y el marco del Odontograma).
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú con su versión oscura y la tipografía. La
 * raíz del expediente (`pacientes-rediseno/raiz.tsx`) solo declara `--pr-*`,
 * así que sin este nodo las reglas de `expediente.module.css` no tendrían de
 * dónde leer el color. Los `--pr-*` semánticos (éxito, alerta, peligro) se
 * heredan de esa raíz de arriba.
 */
export function RaizExpediente({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[CLASES_MENU, s.raiz, className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}
