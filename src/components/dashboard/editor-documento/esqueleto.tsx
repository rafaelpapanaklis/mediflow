"use client";

// Lo que se ve mientras llega el editor (next/dynamic): la silueta de la hoja.
// En su propio archivo para que `index.tsx` no arrastre Tiptap al paquete de la página.

import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./editor-documento.module.css";

export function EsqueletoEditor({ children }: { children?: ReactNode }) {
  return (
    <div className={[CLASES_MENU, s.raiz].join(" ")} aria-busy="true">
      <div className={s.barra} aria-hidden />
      <div className={s.pila}>
        <div className={[s.hoja, s.hojaEsqueleto].join(" ")}>{children}</div>
      </div>
    </div>
  );
}
