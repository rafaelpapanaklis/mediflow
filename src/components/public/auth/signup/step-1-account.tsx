"use client";

import Link from "next/link";
import { useState } from "react";
import { FormField } from "../form-field";
import { PasswordInput } from "../password-input";
import { PasswordStrength, scorePassword } from "../password-strength";
import { mxTenDigits } from "@/lib/phone-mx";
import { botonPrimario } from "./estilos";

// El campo se pide como teléfono de contacto (no como WhatsApp), así que el
// error también: MX_PHONE_ERROR habla de WhatsApp y lo usan otras superficies.
const PHONE_ERROR = "Escribe tu teléfono a 10 dígitos";

interface Step1Values {
  nombre: string;
  email: string;
  phone: string;
  password: string;
}

interface Step1AccountProps {
  values: Step1Values;
  onChange: (values: Partial<Step1Values>) => void;
  onContinue: () => void;
  /** Supabase rechazó esta contraseña al crear la cuenta (p. ej. por filtrada). */
  passwordServerError?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Step1Account({ values, onChange, onContinue, passwordServerError }: Step1AccountProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [emailServerError, setEmailServerError] = useState<string | undefined>();

  const nameValid = values.nombre.trim().length >= 2;
  const emailValid = EMAIL_RE.test(values.email);
  const phoneValid = mxTenDigits(values.phone) !== null;
  const pwScore = scorePassword(values.password);
  const pwValid = pwScore >= 2;

  const errors = {
    nombre:
      touched.nombre && !nameValid ? "Ingresa tu nombre completo" : undefined,
    email:
      (touched.email && !emailValid ? "Email inválido" : undefined) ??
      emailServerError,
    phone: touched.phone && !phoneValid ? PHONE_ERROR : undefined,
    password:
      (touched.password && !pwValid ? "La contraseña es muy débil" : undefined) ??
      passwordServerError,
  };

  // Con el rechazo de Supabase a la vista no se avanza: esa misma contraseña
  // volvería a fallar en el paso 3. Se borra al teclear otra.
  const canContinue = nameValid && emailValid && phoneValid && pwValid && !passwordServerError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canContinue || checking) return;

    setEmailServerError(undefined);
    setChecking(true);
    try {
      const res = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.exists === true) {
          setEmailServerError("Este correo ya está registrado. Inicia sesión");
          return;
        }
      }
      onContinue();
    } catch {
      onContinue();
    } finally {
      setChecking(false);
    }
  }

  const buttonDisabled = !canContinue || checking;

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
        onChange={e => {
          onChange({ email: e.target.value });
          if (emailServerError) setEmailServerError(undefined);
        }}
        onBlur={() => setTouched(t => ({ ...t, email: true }))}
        error={errors.email}
        required
      />

      <FormField
        label="Número de teléfono"
        type="tel"
        inputMode="numeric"
        placeholder="55 1234 5678"
        autoComplete="tel"
        hint="Te escribimos por aquí para ayudarte a configurar tu clínica."
        value={values.phone}
        onChange={e => onChange({ phone: e.target.value })}
        onBlur={() => setTouched(t => ({ ...t, phone: true }))}
        error={errors.phone}
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
        disabled={buttonDisabled}
        className="dca-btn-primary"
        style={botonPrimario(buttonDisabled, { width: "100%", marginTop: 4 })}
      >
        {checking ? "Verificando…" : "Continuar"}
        {!checking && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        )}
      </button>

      <div
        style={{
          fontSize: 13.5,
          color: "#475569",
          textAlign: "center",
          paddingTop: 14,
          borderTop: "1px solid #e8edf4",
        }}
      >
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="dca-link">
          Inicia sesión
        </Link>
      </div>
    </form>
  );
}
