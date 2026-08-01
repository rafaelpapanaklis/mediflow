"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Logo } from "@/components/public/landing/primitives/logo";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";

const PAYOUT_METHODS: { value: string; label: string; placeholder: string }[] = [
  { value: "", label: "Lo defino después", placeholder: "" },
  { value: "SPEI", label: "Transferencia SPEI", placeholder: "CLABE de 18 dígitos" },
  { value: "PAYPAL", label: "PayPal", placeholder: "Correo de tu cuenta PayPal" },
  { value: "OTHER", label: "Otro", placeholder: "Describe cómo quieres recibir tus pagos" },
];

/**
 * Formato local a propósito: el `fmtMxn` de `@/lib/affiliates/public-offer`
 * arrastra Prisma y este componente es "use client".
 */
const fmtMxn = (n: number) => "$" + Math.round(n).toLocaleString("es-MX");

const offerLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--ld-fg)",
};

const offerAmountStyle: React.CSSProperties = {
  color: "var(--ld-brand-light)",
  fontWeight: 600,
};

const selectStyle: React.CSSProperties = {
  height: 42,
  padding: "0 14px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--ld-border)",
  color: "var(--ld-fg)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

export function AffiliateRegistroForm({
  topRecurringMxn = 0,
  topOneTimeMxn = 0,
}: {
  topRecurringMxn?: number;
  topOneTimeMxn?: number;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("");
  const [payoutDetails, setPayoutDetails] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const currentMethod = PAYOUT_METHODS.find(m => m.value === payoutMethod) ?? PAYOUT_METHODS[0];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (!name.trim()) return setError("Tu nombre o el de tu empresa es requerido.");
    if (!email.trim()) return setError("El correo electrónico es requerido.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (!acceptedTerms) return setError("Debes aceptar los términos del programa para continuar.");

    setLoading(true);
    try {
      const res = await fetch("/api/afiliados/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          payoutMethod: payoutMethod || undefined,
          payoutDetails: payoutDetails.trim() || undefined,
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
        window.location.href = "/afiliados/login";
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
            Tu cuenta de afiliado está en revisión; te avisaremos al aprobarla.
          </p>
        </div>
        <Link
          href="/afiliados/login"
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

  // Los campos sólo se bloquean mientras se envía; el botón además exige el check.
  const inputDisabled = loading;
  const isDisabled = loading || !acceptedTerms;
  const hasOffer = topRecurringMxn > 0 || topOneTimeMxn > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Logo size={22} color="var(--ld-brand-light)" />
      </div>

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
          Conviértete en afiliado
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0 }}>
          Recomienda DaleControl y gana comisión recurrente por cada clínica que se suscriba
        </p>
        <Link
          href="/afiliados"
          style={{
            display: "inline-block",
            marginTop: 10,
            color: "var(--ld-fg-muted)",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          ← Conoce el programa
        </Link>
      </div>

      <div
        style={{
          padding: "14px 16px",
          borderRadius: 12,
          border: "1px solid var(--ld-border)",
          background: "rgba(139,92,246,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {topRecurringMxn > 0 && (
          <p style={offerLineStyle}>
            Hasta <strong style={offerAmountStyle}>{fmtMxn(topRecurringMxn)} al mes</strong> por cada
            clínica, mientras siga suscrita
          </p>
        )}
        {topOneTimeMxn > 0 && (
          <p style={offerLineStyle}>
            {topRecurringMxn > 0 ? "o " : "Hasta "}
            <strong style={offerAmountStyle}>{fmtMxn(topOneTimeMxn)} de un solo pago</strong>, tú
            eliges la modalidad
          </p>
        )}
        <p style={{ ...offerLineStyle, color: hasOffer ? "var(--ld-fg-muted)" : "var(--ld-fg)" }}>
          Entrar es gratis. Te pagamos por SPEI o PayPal.
        </p>
      </div>

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
          label="Tu nombre o el de tu empresa"
          type="text"
          autoComplete="name"
          placeholder="Ana García · Marketing Dental MX"
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={inputDisabled}
          required
        />

        <FormField
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.com"
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

        <FormField label="¿Cómo quieres recibir tus comisiones? (opcional)">
          <select
            value={payoutMethod}
            onChange={e => setPayoutMethod(e.target.value)}
            disabled={inputDisabled}
            style={selectStyle}
          >
            {PAYOUT_METHODS.map(m => (
              <option key={m.value || "none"} value={m.value} style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}>
                {m.label}
              </option>
            ))}
          </select>
        </FormField>

        {payoutMethod && (
          <FormField
            label="Datos de pago"
            type="text"
            placeholder={currentMethod.placeholder}
            value={payoutDetails}
            onChange={e => setPayoutDetails(e.target.value)}
            disabled={inputDisabled}
          />
        )}

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={e => setAcceptedTerms(e.target.checked)}
            style={{ marginTop: 2, width: 16, height: 16, accentColor: "#7c3aed" }}
          />
          <span style={{ fontSize: 12, color: "var(--ld-fg-muted)", lineHeight: 1.5 }}>
            Acepto los{" "}
            <Link
              href="/terminos-afiliados"
              style={{ color: "var(--ld-brand-light)", textDecoration: "none" }}
            >
              términos del programa de afiliados
            </Link>{" "}
            y el{" "}
            <Link href="/privacidad" style={{ color: "var(--ld-brand-light)", textDecoration: "none" }}>
              aviso de privacidad
            </Link>
            .
          </span>
        </label>

        <button
          type="submit"
          disabled={isDisabled}
          style={{
            width: "100%",
            height: 44,
            borderRadius: 10,
            background: isDisabled
              ? "rgba(124,58,237,0.4)"
              : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            cursor: isDisabled ? "not-allowed" : "pointer",
            boxShadow: isDisabled
              ? "none"
              : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
            fontFamily: "inherit",
            transition: "all .15s",
          }}
        >
          {loading ? "Enviando registro…" : "Crear cuenta de afiliado →"}
        </button>
      </form>

      <div style={{ textAlign: "center", fontSize: 13, color: "var(--ld-fg-muted)" }}>
        ¿Ya tienes cuenta?{" "}
        <Link
          href="/afiliados/login"
          style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
        >
          Inicia sesión →
        </Link>
      </div>
    </div>
  );
}
