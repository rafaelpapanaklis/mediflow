"use client";

// Equipo — el selector de rol del formulario de alta y de edición.
//
// Salió de `team-client.tsx` para poder probarlo (la pantalla entera arrastra
// toasts, el router y hojas CSS). Es el MISMO selector con la bandera del
// rediseño apagada o encendida: solo cambian los tres colores que le pasa quien
// lo monta.
//
// Cuándo el rol NO se puede tocar (`bloqueo`, ver `motivoRolFijo`):
//   · «dueno»  — quien se edita es el dueño (SUPER_ADMIN). El servidor no deja
//                asignar SUPER_ADMIN, así que aquí no se ofrece ninguna otra cosa:
//                una sola tarjeta, fija. Antes salían Doctor/Administrador/
//                Recepción SIN ninguno marcado, y quien tocaba «Doctor» (el dueño
//                que también atiende) recibía «No puedes cambiar tu propio rol» y
//                perdía el guardado entero, la cédula incluida (BEVADENT, oct-2026).
//   · «propio» — es uno mismo: se ve su rol, sin botones que valgan.

import type { LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";

export interface OpcionDeRol {
  value: string;
  label: string;
  desc: string;
  icon: LucideIcon;
}

export function SelectorDeRol({
  etiqueta, opciones, valor, onCambiar, bloqueo, ayuda, acento, acentoSuave, bordeSuave, tarjetaDueno,
}: {
  etiqueta: string;
  opciones: readonly OpcionDeRol[];
  valor: string;
  onCambiar: (rol: string) => void;
  bloqueo: "dueno" | "propio" | null;
  /** Por qué no se puede cambiar (solo se muestra con `bloqueo`). */
  ayuda: string;
  acento: string;
  acentoSuave: string;
  bordeSuave: string;
  /** La tarjeta fija del dueño. */
  tarjetaDueno: OpcionDeRol;
}) {
  const tarjeta = (r: OpcionDeRol, activa: boolean, deshabilitada: boolean) => (
    <button
      key={r.value}
      type="button"
      data-rol={r.value}
      disabled={deshabilitada}
      aria-pressed={activa}
      onClick={deshabilitada ? undefined : () => onCambiar(r.value)}
      className="flex flex-col items-center p-3 text-center"
      style={{
        borderRadius: "var(--radius)",
        border: `2px solid ${activa ? acento : bordeSuave}`,
        background: activa ? acentoSuave : "transparent",
        transition: "border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease)",
        ...(deshabilitada ? { cursor: "default", opacity: activa ? 1 : 0.5 } : {}),
      }}>
      <r.icon size={18} strokeWidth={1.75} aria-hidden style={{ color: activa ? acento : "var(--text-3)", marginBottom: 6 }} />
      <span className="text-sm font-bold">{r.label}</span>
      <span className="text-xs text-muted-foreground mt-0.5 leading-tight">{r.desc}</span>
    </button>
  );

  return (
    <div className="space-y-1.5" data-selector-de-rol={bloqueo ?? "libre"}>
      <Label className="text-xs font-semibold">{etiqueta}</Label>
      {bloqueo === "dueno" ? (
        <div className="grid grid-cols-1 gap-2">{tarjeta(tarjetaDueno, true, true)}</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {opciones.map((r) => tarjeta(r, valor === r.value, bloqueo === "propio"))}
        </div>
      )}
      {bloqueo && <p className="text-xs text-muted-foreground" data-rol-fijo-ayuda>{ayuda}</p>}
    </div>
  );
}
