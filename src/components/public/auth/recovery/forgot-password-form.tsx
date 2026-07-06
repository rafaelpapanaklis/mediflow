"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Logo } from "../../landing/primitives/logo";
import { FormField } from "../form-field";

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Paso 1 de la recuperación: pedir el enlace por correo.
 * La respuesta del API es SIEMPRE neutra (anti-enumeración) — la UI jamás
 * afirma si el correo existe o no.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown del botón "Reenviar" (60s por envío; Supabase además limita
  // 1 correo/60s por dirección).
  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = setInterval(() => {
      setCooldown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestLink() {
    if (sending || cooldown > 0) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (res.status === 429) {
        setError("Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "No pudimos enviar la solicitud. Inténtalo de nuevo.");
        return;
      }
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError("No pudimos enviar la solicitud. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await requestLink();
  }

  const submitDisabled = sending || !email;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
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
          ¿Olvidaste tu contraseña?
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          Escribe el correo con el que entras a DaleControl y te enviaremos un
          enlace para restablecerla.
        </p>
      </div>

      {sent ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Neutra a propósito: nunca confirma si el correo existe */}
          <div
            role="status"
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(5,150,105,0.07)",
              border: "1px solid rgba(5,150,105,0.3)",
              color: "#047857",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong>Solicitud enviada.</strong> Si el correo está registrado, te
            llegará un enlace para restablecer tu contraseña en unos minutos.
            Revisa también la carpeta de spam.
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(220,38,38,0.06)",
                border: "1px solid rgba(220,38,38,0.25)",
                color: "#dc2626",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={requestLink}
            disabled={sending || cooldown > 0}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 10,
              background: sending || cooldown > 0 ? "#ede9fe" : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
              color: sending || cooldown > 0 ? "#8b5cf6" : "#fff",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: sending || cooldown > 0 ? "not-allowed" : "pointer",
              boxShadow: sending || cooldown > 0
                ? "none"
                : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
              fontFamily: "inherit",
              transition: "all .15s",
            }}
          >
            {sending
              ? "Enviando…"
              : cooldown > 0
                ? `Reenviar enlace (${cooldown}s)`
                : "Reenviar enlace"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(220,38,38,0.06)",
                border: "1px solid rgba(220,38,38,0.25)",
                color: "#dc2626",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <FormField
            label="Correo electrónico"
            type="email"
            autoComplete="email"
            placeholder="doctor@miclinica.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <button
            type="submit"
            disabled={submitDisabled}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 10,
              background: submitDisabled ? "#ede9fe" : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
              color: submitDisabled ? "#8b5cf6" : "#fff",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: submitDisabled ? "not-allowed" : "pointer",
              boxShadow: submitDisabled
                ? "none"
                : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
              fontFamily: "inherit",
              transition: "all .15s",
            }}
          >
            {sending ? "Enviando…" : "Enviar enlace →"}
          </button>
        </form>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: 13, color: "var(--ld-fg-muted)" }}>
        <Link
          href="/login"
          style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
        >
          ← Volver a iniciar sesión
        </Link>
      </div>
    </div>
  );
}
