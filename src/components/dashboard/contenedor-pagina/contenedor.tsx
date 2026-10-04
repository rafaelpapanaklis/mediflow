import type { ReactNode } from "react";
import s from "./contenedor.module.css";

/** C-127 (ws1-t8): el margen de página de referencia del panel. */
export function ContenedorPagina({ children }: { children: ReactNode }) {
  return <div className={s.pagina}>{children}</div>;
}
