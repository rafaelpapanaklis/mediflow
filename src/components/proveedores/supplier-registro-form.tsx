"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  SUPPLIER_CATEGORY_OPTIONS,
  SUPPLIER_PAYMENT_METHOD_OPTIONS,
} from "@/lib/suppliers/types";
import { Logo } from "@/components/public/landing/primitives/logo";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";

/** Chip-toggle reutilizable para multi-select (categorías / métodos de pago). */
function Chip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      style={{
        padding: "7px 12px",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "all .15s",
        border: selected
          ? "1px solid var(--ld-brand)"
          : "1px solid var(--ld-border)",
        background: selected
          ? "rgba(124,58,237,0.18)"
          : "rgba(255,255,255,0.03)",
        color: selected ? "var(--ld-brand-light)" : "var(--ld-fg-muted)",
      }}
    >
      {label}
    </button>
  );
}

export function SupplierRegistroForm() {
  const [businessName, setBusinessName] = useState("");
  const [rfc, setRfc] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    // Validación básica en cliente.
    if (!businessName.trim()) return setError("El nombre del negocio es requerido.");
    if (!firstName.trim()) return setError("El nombre es requerido.");
    if (!lastName.trim()) return setError("El apellido es requerido.");
    if (!email.trim()) return setError("El correo electrónico es requerido.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");

    setLoading(true);
    try {
      const res = await fetch("/api/proveedores/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          rfc: rfc.trim() || undefined,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          categories,
          paymentMethods,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "No se pudo completar el registro. Intenta de nuevo.");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/proveedores/login";
      }, 1500);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo completar el registro. Intenta de nuevo.");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <Logo size={22} color="var(--ld-brand-light)" />
        </div>
        <div
          role="status"
          style={{
            padding: "20px 22px",
            borderRadius: 14,
            background: "rgba(52,211,153,0.08)",
            border: "1px solid rgba(52,211,153,0.25)",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-sans, system-ui, sans-serif)",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--ld-fg)",
              margin: 0,
              marginBottom: 8,
            }}
          >
            Registro recibido
          </h1>
          <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
            Tu cuenta está en revisión; te avisaremos al aprobarla.
          </p>
        </div>
        <Link
          href="/proveedores/login"
          style={{
            width: "100%",
            height: 44,
            borderRadius: 10,
            background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
        >
          Ir a iniciar sesión →
        </Link>
      </div>
    );
  }

  const inputDisabled = loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Logo arriba del form */}
      <div>
        <Logo size={22} color="var(--ld-brand-light)" />
      </div>

      {/* Título */}
      <div>
        <h1
          style={{
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "var(--ld-fg)",
            margin: 0,
            marginBottom: 6,
          }}
        >
          Regístrate como proveedor
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0 }}>
          Crea tu cuenta para vender a clínicas en MediFlow
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "#fca5a5",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <FormField
          label="Nombre del negocio"
          type="text"
          autoComplete="organization"
          placeholder="Distribuidora Dental del Centro"
          value={businessName}
          onChange={e => setBusinessName(e.target.value)}
          disabled={inputDisabled}
          required
        />

        <FormField
          label="RFC (opcional)"
          type="text"
          maxLength={13}
          placeholder="XAXX010101000"
          value={rfc}
          onChange={e => setRfc(e.target.value.toUpperCase())}
          disabled={inputDisabled}
        />

        {/* Nombre + Apellido en fila */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField
            label="Nombre"
            type="text"
            autoComplete="given-name"
            placeholder="Ana"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            disabled={inputDisabled}
            required
          />
          <FormField
            label="Apellido"
            type="text"
            autoComplete="family-name"
            placeholder="García"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            disabled={inputDisabled}
            required
          />
        </div>

        <FormField
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="contacto@miproveedor.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={inputDisabled}
          required
        />

        <PasswordInput
          label="Contraseña"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={inputDisabled}
          required
        />

        <FormField
          label="Teléfono (opcional)"
          type="tel"
          autoComplete="tel"
          placeholder="55 1234 5678"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          disabled={inputDisabled}
        />

        {/* Ciudad + Estado en fila */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField
            label="Ciudad (opcional)"
            type="text"
            autoComplete="address-level2"
            placeholder="CDMX"
            value={city}
            onChange={e => setCity(e.target.value)}
            disabled={inputDisabled}
          />
          <FormField
            label="Estado (opcional)"
            type="text"
            autoComplete="address-level1"
            placeholder="Ciudad de México"
            value={state}
            onChange={e => setState(e.target.value)}
            disabled={inputDisabled}
          />
        </div>

        {/* Categorías (multi-select chips) */}
        <FormField label="Categorías que ofreces">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SUPPLIER_CATEGORY_OPTIONS.map(opt => (
              <Chip
                key={opt}
                label={opt}
                selected={categories.includes(opt)}
                onToggle={() => toggle(categories, setCategories, opt)}
              />
            ))}
          </div>
        </FormField>

        {/* Métodos de pago (multi-select chips) */}
        <FormField label="Métodos de pago aceptados">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SUPPLIER_PAYMENT_METHOD_OPTIONS.map(opt => (
              <Chip
                key={opt}
                label={opt}
                selected={paymentMethods.includes(opt)}
                onToggle={() => toggle(paymentMethods, setPaymentMethods, opt)}
              />
            ))}
          </div>
        </FormField>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            height: 44,
            borderRadius: 10,
            background: loading
              ? "rgba(124,58,237,0.4)"
              : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: loading
              ? "none"
              : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
            fontFamily: "inherit",
            transition: "all .15s",
          }}
        >
          {loading ? "Enviando registro…" : "Crear cuenta →"}
        </button>
      </form>

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: 13, color: "var(--ld-fg-muted)" }}>
        ¿Ya tienes cuenta?{" "}
        <Link
          href="/proveedores/login"
          style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
        >
          Inicia sesión →
        </Link>
      </div>
    </div>
  );
}
