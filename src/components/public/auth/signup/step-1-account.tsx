"use client";

import Link from "next/link";
import { useState } from "react";
import { FormField } from "../form-field";
import { PasswordInput } from "../password-input";
import { PasswordStrength, scorePassword } from "../password-strength";

interface Step1Values {
  nombre: string;
  email: string;
  password: string;
}

interface Step1AccountProps {
  values: Step1Values;
  onChange: (values: Partial<Step1Values>) => void;
  onContinue: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Step1Account({ values, onChange, onContinue }: Step1AccountProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const nameValid = values.nombre.trim().length >= 2;
  const emailValid = EMAIL_RE.test(values.email);
  const pwScore = scorePassword(values.password);
  const pwValid = pwScore >= 2;

  const errors = {
    nombre:
      touched.nombre && !nameValid ? "Ingresa tu nombre completo" : undefined,
    email: touched.email && !emailValid ? "Email inválido" : undefined,
    password:
      touched.password && !pwValid
        ? "La contraseña es muy débil"
        : undefined,
  };

  const canContinue = nameValid && emailValid && pwValid;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (canContinue) onContinue();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <FormField
        label="Nombre completo"
        placeholder="Dra. Mariana Morales"
        autoComplete="name"
        value={values.nombre}
        onChange={e => onChange({ nombre: e.target.value })}
        onBlur={() => setTouched(t => ({ ...t, nombre: true }))}
        error={errors.nombre}
        required
      />

      <FormField
        label="Email profesional"
        type="email"
        placeholder="mariana@clinicavida.mx"
        autoComplete="email"
        hint="Usaremos este correo para verificarte y enviarte notificaciones."
        value={values.email}
        onChange={e => onChange({ email: e.target.value })}
        onBlur={() => setTouched(t => ({ ...t, email: true }))}
        error={errors.email}
        required
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <PasswordInput
          label="Contraseña"
          placeholder="Mínimo 8 caracteres"
          autoComplete="new-password"
          value={values.password}
          onChange={e => onChange({ password: e.target.value })}
          onBlur={() => setTouched(t => ({ ...t, password: true }))}
          error={errors.password}
          required
        />
        <PasswordStrength password={values.password} />
      </div>

      <button
        type="submit"
        disabled={!canContinue}
        style={{
          width: "100%",
          height: 44,
          borderRadius: 10,
          background: !canContinue
            ? "rgba(124,58,237,0.4)"
            : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          border: "none",
          cursor: !canContinue ? "not-allowed" : "pointer",
          boxShadow: !canContinue
            ? "none"
            : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
          fontFamily: "inherit",
          transition: "all .15s",
          marginTop: 4,
        }}
      >
        Continuar →
      </button>

      <div
        style={{
          fontSize: 12.5,
          color: "var(--ld-fg-muted)",
          textAlign: "center",
          paddingTop: 10,
          borderTop: "1px solid var(--ld-border)",
        }}
      >
        ¿Ya tienes cuenta?{" "}
        <Link
          href="/login"
          style={{
            color: "var(--ld-brand-light)",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Inicia sesión →
        </Link>
      </div>
    </form>
  );
}
