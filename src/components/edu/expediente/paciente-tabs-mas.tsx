"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { EduPacienteTab } from "@/components/edu/expediente/paciente-tabs";

/**
 * El desplegable «Más ▾» de la tira de pestañas.
 *
 * Vive en su propio archivo porque `paciente-tabs.tsx` ya tiene bastante
 * con medir: aquí solo está el botón, el menú y las tres formas de
 * cerrarlo (clic fuera, Escape, y navegar a un item).
 *
 * ⛔ NO IMPORTA NADA DE `src/components/dashboard/`. El patrón —medir la
 * fila real, colapsar el sobrante, y rotular el botón con la pestaña
 * activa cuando cae dentro— es el del dental, pero el código es propio y
 * las clases son `edu-*`: importar de allá saca al `edu-guard` con exit 1,
 * y sus estilos usan tokens del dental (`--brand-grad`, `--text-1`) que
 * aquí no existen.
 */
export function EduPacienteTabsMas({
  items,
  activoHref,
}: {
  /** Las pestañas que NO cupieron, en su orden original. */
  items: EduPacienteTab[];
  /** El href de la pestaña activa, o "" si ninguna lo está. */
  activoHref: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);

  // La activa dentro del sobrante: decide el rótulo y el encendido del
  // botón. Sin esto, estando en «Recetas» la barra no enseñaría nada
  // encendido y el usuario no sabría en qué pestaña está.
  const activaDentro = items.find((t) => t.href === activoHref) ?? null;

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  if (items.length === 0) return null;

  return (
    <div className="edu-tabs__mas" ref={caja}>
      <button
        type="button"
        className={`edu-tab edu-tab--mas ${activaDentro ? "edu-tab--masactivo" : ""}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        {activaDentro ? `Más · ${activaDentro.label}` : "Más"}
        <ChevronDown size={14} aria-hidden />
      </button>

      {abierto && (
        <div className="edu-tabs__menu" role="menu">
          {items.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              role="menuitem"
              className={`edu-tabs__menuitem ${
                t.href === activoHref ? "edu-tabs__menuitem--on" : ""
              }`}
              aria-current={t.href === activoHref ? "page" : undefined}
              onClick={() => setAbierto(false)}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
