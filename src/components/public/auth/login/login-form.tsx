"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "../../landing/primitives/logo";
import { SecureBadge } from "../../landing/primitives/secure-badge";
import { SocialButtons, GOOGLE_OAUTH_ENABLED } from "../social-buttons";
import { Divider } from "../divider";
import { FormField } from "../form-field";
import { PasswordInput } from "../password-input";
import { playLoginSuccessAnimation } from "./login-success-animation";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs para la animación de éxito (convergencia → palomita).
  const rootRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      // Cerrar sesión previa para evitar contaminación cross-account.
      try { await supabase.auth.signOut(); } catch { /* ignore */ }

      // Fail-ban: lockout por IP/cuenta tras varios intentos fallidos. Best-
      // effort y FAIL-OPEN: solo bloquea ante un 429 explícito; cualquier otro
      // resultado (o error de red) deja pasar para no romper logins legítimos.
      try {
        const guard = await fetch("/api/auth/login-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "check", email }),
        });
        if (guard.status === 429) {
          setError("Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
          setLoading(false);
          return;
        }
      } catch { /* fail-open */ }

      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        // Cuenta el fallo (fire-and-forget; no bloquea la UI).
        void fetch("/api/auth/login-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "fail", email }),
        }).catch(() => {});
        // Si el login FALLA no hay animación: error en el form, como siempre.
        setError("Email o contraseña incorrectos.");
        setLoading(false);
        return;
      }

      // Éxito → resetea contadores de fallo (fire-and-forget).
      void fetch("/api/auth/login-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "success", email }),
      }).catch(() => {});

      // Sembrar/limpiar cookie activeClinicId para el nuevo supabaseId.
      try { await fetch("/api/auth/post-login", { method: "POST" }); } catch { /* ignore */ }
      toast.success("¡Bienvenido!");

      // Animación de éxito (≈1.15 s, o fundido rápido con reduced-motion).
      // Va entre el toast y la navegación; si algo falla, navegamos igual.
      try {
        if (rootRef.current && emailRef.current && passwordRef.current) {
          await playLoginSuccessAnimation({
            form: rootRef.current,
            inputs: [emailRef.current, passwordRef.current],
          });
        }
      } catch { /* nunca bloquear el login */ }

      // Hard navigation: garantiza un único mount del layout y evita la
      // cascada de fetches por router.push + router.refresh síncronos
      // (remontaba el árbol cliente y disparaba useEffect[] varias veces
      // — ej. /api/dashboard/sidebar-counts 5x en <2s). Mismo patrón que
      // sidebar.tsx switchClinic/logout.
      window.location.href = "/dashboard";
    } catch (err: any) {
      setError(err?.message ?? "Error al iniciar sesión");
      setLoading(false);
    }
  }

  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* Logo arriba del form */}
      <div>
        <Logo size={22} color="var(--ld-brand-light)" />
      </div>

      {/* Título */}
      <div>
        <h1
          style={{
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            color: "var(--ld-fg)",
            margin: 0,
            marginBottom: 6,
          }}
        >
          Bienvenido de vuelta
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0 }}>
          Accede a tu panel de DaleControl
        </p>
      </div>

      {/* SSO */}
      {GOOGLE_OAUTH_ENABLED && (
        <>
          <SocialButtons redirectTo="/dashboard" />
          <Divider label="o con tu correo" />
        </>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(220,38,38,0.06)",
              border: "1px solid rgba(220,38,38,0.25)",
              color: "#dc2626",
              fontSize: 13,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <FormField
          ref={emailRef}
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="doctor@miclinica.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />

        <PasswordInput
          ref={passwordRef}
          label="Contraseña"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {/* Remember + Forgot */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--ld-fg-muted)" }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              style={{ accentColor: "var(--ld-brand)" }}
            />
            Recordarme
          </label>
          <Link
            href="/forgot-password"
            style={{ color: "var(--ld-brand-light)", textDecoration: "none", fontWeight: 500 }}
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading || !email || !password}
          style={{
            width: "100%",
            height: 46,
            borderRadius: 10,
            background: loading || !email || !password
              ? "#ede9fe"
              : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            color: loading || !email || !password ? "#8b5cf6" : "#fff",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            cursor: loading || !email || !password ? "not-allowed" : "pointer",
            boxShadow: loading || !email || !password
              ? "none"
              : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
            fontFamily: "inherit",
            transition: "all .15s",
          }}
        >
          {loading ? "Iniciando sesión…" : "Iniciar sesión →"}
        </button>
      </form>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <SecureBadge tone="light" />
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: 13, color: "var(--ld-fg-muted)" }}>
        ¿No tienes cuenta?{" "}
        <Link
          href="/#precios"
          style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
        >
          Ver planes →
        </Link>
      </div>

      {/* Small legal links */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 14,
          fontSize: 11,
          color: "var(--ld-fg-muted)",
          paddingTop: 12,
          borderTop: "1px solid var(--ld-border)",
        }}
      >
        <Link href="/privacidad" style={{ color: "inherit", textDecoration: "none" }}>Privacidad</Link>
        <span>·</span>
        <Link href="/terminos" style={{ color: "inherit", textDecoration: "none" }}>Términos</Link>
        <span>·</span>
        <a
          href="mailto:soporte@dalecontrol.com"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          Soporte
        </a>
      </div>
    </div>
  );
}
