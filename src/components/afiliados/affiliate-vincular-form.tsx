"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/public/landing/primitives/logo";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";
import {
  PAYOUT_METHODS,
  consumeSignupDraft,
  selectStyle,
} from "./affiliate-signup-shared";

/**
 * Vinculación: activa la cuenta de afiliado de alguien que YA tiene cuenta en
 * DaleControl (dueño o staff de una clínica). Nunca crea un usuario nuevo ni
 * cambia una contraseña — el alta la hace POST /api/afiliados/auth/link, que
 * saca el supabaseId de la sesión verificada en el servidor.
 *
 * Dos modos:
 *  · `sessionEmail` presente → la persona YA tiene sesión abierta (viene del
 *    panel de su clínica). Un clic, sin volver a escribir credenciales.
 *  · sin sesión → inicia sesión con su contraseña DE SIEMPRE y, sólo si eso
 *    funciona, se llama al endpoint. Contraseña mala = no se crea nada.
 */
export function AffiliateVincularForm({
  sessionEmail,
  initialEmail = "",
}: {
  sessionEmail: string | null;
  initialEmail?: string;
}) {
  const hasSession = !!sessionEmail;

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("");
  const [payoutDetails, setPayoutDetails] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rechazos que traen a dónde ir (cuenta de vendedor, correo ya afiliado).
  const [errorLink, setErrorLink] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Rescata lo que la persona ya había escrito en /afiliados/registro.
  useEffect(() => {
    const draft = consumeSignupDraft();
    if (!draft) return;
    if (draft.name) setName(draft.name);
    if (draft.payoutMethod) setPayoutMethod(draft.payoutMethod);
    if (draft.payoutDetails) setPayoutDetails(draft.payoutDetails);
  }, []);

  const currentMethod = PAYOUT_METHODS.find(m => m.value === payoutMethod) ?? PAYOUT_METHODS[0];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setErrorLink(null);

    if (!name.trim()) return setError("Tu nombre o el de tu empresa es requerido.");
    if (!hasSession) {
      if (!email.trim()) return setError("El correo electrónico es requerido.");
      if (!password) return setError("Escribe tu contraseña de DaleControl.");
    }
    if (!acceptedTerms) return setError("Debes aceptar los términos del programa para continuar.");

    setLoading(true);
    try {
      // 1) Sólo si no hay sesión: probar identidad con la contraseña EXISTENTE.
      //    Si falla, se corta aquí y no se crea absolutamente nada.
      if (!hasSession) {
        const supabase = createClient();
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) {
          setError("Correo o contraseña incorrectos. Usa la misma contraseña con la que entras a DaleControl.");
          setLoading(false);
          return;
        }
      }

      // 2) El alta. El servidor ignora cualquier identidad del body: toma el
      //    supabaseId y el correo de la sesión que acaba de validar.
      const res = await fetch("/api/afiliados/auth/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          payoutMethod: payoutMethod || undefined,
          payoutDetails: payoutDetails.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error ?? "No se pudo activar tu cuenta de afiliado. Intenta de nuevo.");
        setErrorLink(typeof data?.loginUrl === "string" ? data.loginUrl : null);
        setLoading(false);
        return;
      }

      // Ya era afiliado → directo a su panel, sin duplicar nada.
      if (data?.alreadyLinked) {
        window.location.href = data.home ?? "/afiliados/inicio";
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/afiliados/pendiente";
      }, 1500);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo activar tu cuenta de afiliado. Intenta de nuevo.");
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
            Cuenta de afiliado activada
          </h1>
          <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
            Tu solicitud está en revisión; te avisaremos al aprobarla. Tu cuenta y tu contraseña de
            siempre no cambiaron.
          </p>
        </div>
      </div>
    );
  }

  const inputDisabled = loading;
  const isDisabled = loading || !acceptedTerms;

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
          Activa tu cuenta de afiliado
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          {hasSession
            ? "Ya tienes cuenta en DaleControl, así que no necesitas crear otra: sumamos el rol de afiliado a la que ya usas."
            : "Ya tienes cuenta en DaleControl con este correo. Inicia sesión con tu contraseña de siempre y activamos tu cuenta de afiliado — no necesitas crear otra."}
        </p>
      </div>

      {hasSession && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid var(--ld-border)",
            background: "rgba(139,92,246,0.06)",
            fontSize: 13,
            color: "var(--ld-fg-muted)",
            lineHeight: 1.5,
          }}
        >
          Sesión iniciada como{" "}
          <strong style={{ color: "var(--ld-fg)", fontWeight: 600 }}>{sessionEmail}</strong>. Tu
          contraseña no cambia y tu clínica sigue funcionando igual.
        </div>
      )}

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
            {errorLink && (
              <>
                {" "}
                <Link
                  href={errorLink}
                  style={{ color: "#fca5a5", fontWeight: 600, textDecoration: "underline" }}
                >
                  Ir al portal de afiliados →
                </Link>
              </>
            )}
          </div>
        )}

        {!hasSession && (
          <>
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
              label="Tu contraseña de DaleControl"
              autoComplete="current-password"
              placeholder="La misma con la que entras al sistema"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={inputDisabled}
              required
            />
          </>
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

        <FormField label="¿Cómo quieres recibir tus comisiones? (opcional)">
          <select
            value={payoutMethod}
            onChange={e => setPayoutMethod(e.target.value)}
            disabled={inputDisabled}
            style={selectStyle}
          >
            {PAYOUT_METHODS.map(m => (
              <option
                key={m.value || "none"}
                value={m.value}
                style={{ backgroundColor: "#18181b", color: "#f4f4f5" }}
              >
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
          {loading
            ? "Activando…"
            : hasSession
              ? "Activar mi cuenta de afiliado →"
              : "Iniciar sesión y activar →"}
        </button>
      </form>

      <div
        style={{
          textAlign: "center",
          fontSize: 13,
          color: "var(--ld-fg-muted)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div>
          ¿Ya eres afiliado?{" "}
          <Link
            href="/afiliados/login"
            style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
          >
            Inicia sesión →
          </Link>
        </div>
        <div>
          <Link href="/afiliados" style={{ color: "var(--ld-fg-muted)", textDecoration: "none" }}>
            Conoce el programa →
          </Link>
        </div>
      </div>
    </div>
  );
}
