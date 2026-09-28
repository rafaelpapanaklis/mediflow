// Atom: fila etiqueta / valor, como las de «Información del paciente» en la
// ficha. El valor se alinea a la derecha y, si es largo, parte por palabras.

import type { ReactNode } from "react";
import orto from "../orto.module.css";

export interface KVProps {
  k: ReactNode;
  v: ReactNode;
  className?: string;
  /** Clases extra para el valor (p. ej. un tono). */
  vClass?: string;
}

export function KV({ k, v, className = "", vClass = "" }: KVProps) {
  return (
    <div className={[orto.fila, className].filter(Boolean).join(" ")}>
      <span className={orto.filaEtiqueta}>{k}</span>
      <span className={[orto.filaValor, vClass].filter(Boolean).join(" ")}>{v}</span>
    </div>
  );
}
