"use client";

// Piezas pequeñas del rediseño de Soporte: etiqueta de estado/prioridad/
// categoría, botón, avatar de iniciales y estrellas. Solo pintan; los datos y
// las acciones llegan de `soporte-client.tsx` y `[id]/ticket-client.tsx`.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Star } from "lucide-react";
import type { Tono } from "./formato";
import s from "./soporte.module.css";

const CLASE_TONO: Record<Tono, string> = {
  exito: s.etiquetaExito,
  alerta: s.etiquetaAlerta,
  peligro: s.etiquetaPeligro,
  info: s.etiquetaInfo,
  marca: s.etiquetaMarca,
  neutro: "",
};

export function Etiqueta({ tono = "neutro", punto, children, className }: {
  tono?: Tono;
  punto?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={[s.etiqueta, CLASE_TONO[tono], className ?? ""].filter(Boolean).join(" ")}>
      {punto && <span className={s.etiquetaPunto} aria-hidden />}
      {children}
    </span>
  );
}

type Variante = "principal" | "normal" | "fantasma";

export function Boton({ variante = "normal", chico, icono, children, className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variante?: Variante;
  chico?: boolean;
  icono?: ReactNode;
  className?: string;
}) {
  const cls = [
    s.boton,
    variante === "principal" ? s.botonPrincipal : variante === "fantasma" ? s.botonFantasma : "",
    chico ? s.botonChico : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return (
    <button className={cls} {...rest}>
      {icono}
      {children}
    </button>
  );
}

function inicialesDe(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

export function Avatar({ nombre, clinica }: { nombre: string; clinica?: boolean }) {
  return (
    <span className={[s.avatar, clinica ? s.avatarClinica : ""].filter(Boolean).join(" ")} aria-hidden>
      {inicialesDe(nombre) || "?"}
    </span>
  );
}

export function Estrellas({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  return (
    <div className={s.estrellas} role="radiogroup" aria-label="Calificación (opcional)">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={valor === n}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          onClick={() => onChange(valor === n ? 0 : n)}
          className={[s.estrella, n <= valor ? s.estrellaLlena : ""].filter(Boolean).join(" ")}
        >
          <Star size={22} strokeWidth={1.75} fill={n <= valor ? "currentColor" : "none"} aria-hidden />
        </button>
      ))}
    </div>
  );
}
