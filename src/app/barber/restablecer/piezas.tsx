"use client";

import type { ReactNode } from "react";
import { PasswordInput } from "@/components/public/auth/password-input";
import { PasswordStrength } from "@/components/public/auth/password-strength";
import { problemaContrasenaNueva } from "@/lib/barber/contrasena";

/**
 * Piezas que comparten /barber/restablecer (tras el enlace del correo) y
 * /barber/cambiar-contrasena (cambio obligatorio de la temporal): las dos
 * piden la contraseña nueva dos veces, con el medidor y la regla del dental.
 * Textos en español duro, como /barber/entrar.
 */

export const CARAMELO = "#A2612F";

export function textoProblema(nueva: string): string | null {
  const p = problemaContrasenaNueva(nueva);
  if (p === "larga") return "Usa 72 caracteres o menos.";
  if (p === "debil") return "Muy débil: usa al menos 8 caracteres y mezcla mayúsculas, minúsculas y números.";
  return null;
}

/** ¿Se puede mandar? Fuerte, dentro del tope y las dos iguales. */
export function nuevaLista(nueva: string, repetida: string): boolean {
  return problemaContrasenaNueva(nueva) === null && nueva === repetida;
}

export function CamposNueva({
  nueva,
  repetida,
  onNueva,
  onRepetida,
  tocado,
  onTocar,
}: {
  nueva: string;
  repetida: string;
  onNueva: (v: string) => void;
  onRepetida: (v: string) => void;
  tocado: boolean;
  onTocar: () => void;
}) {
  const problema = tocado && nueva ? textoProblema(nueva) : null;
  const noCoinciden = repetida.length > 0 && repetida !== nueva;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <PasswordInput
          label="Contraseña nueva"
          placeholder="Mínimo 8 caracteres"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => onNueva(e.target.value)}
          onBlur={onTocar}
          error={problema ?? undefined}
          required
        />
        <PasswordStrength password={nueva} />
      </div>
      <PasswordInput
        label="Repite la contraseña nueva"
        placeholder="Escríbela otra vez"
        autoComplete="new-password"
        value={repetida}
        onChange={(e) => onRepetida(e.target.value)}
        error={noCoinciden ? "No coinciden." : undefined}
        required
      />
    </>
  );
}

export function Aviso({ tono, children }: { tono: "info" | "error"; children: ReactNode }) {
  const error = tono === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        fontSize: 13,
        lineHeight: 1.45,
        color: error ? "#b91c1c" : "#814A28",
        background: error ? "rgba(220,38,38,0.08)" : "rgba(190,122,60,0.10)",
        border: error ? "1px solid rgba(220,38,38,0.25)" : "1px solid rgba(190,122,60,0.35)",
      }}
    >
      {children}
    </div>
  );
}

export function BotonCaramelo({
  children,
  disabled,
  ocupado,
  type = "submit",
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  ocupado: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || ocupado}
      style={{
        height: 44,
        borderRadius: 10,
        border: "none",
        background: ocupado ? "#CD9459" : disabled ? "#EBD3B4" : CARAMELO,
        color: !ocupado && disabled ? "#814A28" : "#fff",
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: ocupado ? "wait" : disabled ? "not-allowed" : "pointer",
        transition: "background .15s",
      }}
    >
      {children}
    </button>
  );
}

export function Encabezado({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ld-fg)", margin: 0 }}>
        {titulo}
      </h1>
      <p style={{ fontSize: 13.5, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>{texto}</p>
    </div>
  );
}
