"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "../../landing/primitives/logo";
import { SocialButtons } from "../social-buttons";
import { Divider } from "../divider";
import { FormField } from "../form-field";
import { PasswordInput } from "../password-input";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      // Cerrar sesión previa para evitar contaminación cross-account.
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError("Email o contraseña incorrectos.");
        setLoading(false);
        return;
      }
      // Sembrar/limpiar cookie activeClinicId para el nuevo supabaseId.
      try { await fetch("/api/auth/post-login", { method: "POST" }); } catch { /* ignore */ }
      toast.success("¡Bienvenido!");
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
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Logo arriba del form */}
      <div>
        <Logo size={22} color="var(--ld-brand-light)" />
      </div>

      {/* Título */}
      <div>
        <h1
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "var(--ld-fg)",
            margin: 0,
            marginBottom: 6,
          }}
        >
          Bienvenido de vuelta
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0 }}>
          Accede a tu panel de MediFlow
        </p>
      </div>

      {/* SSO */}
      <SocialButtons redirectTo="/dashboard" />

      <Divider label="o con tu correo" />

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
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="doctor@miclinica.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />

        <PasswordInput
          label="Contraseña"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {/* Remember + Forgot */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
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
            height: 44,
            borderRadius: 10,
            background: loading || !email || !password
              ? "rgba(124,58,237,0.4)"
              : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            color: "#fff",
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

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: 13, color: "var(--ld-fg-muted)" }}>
        ¿Aún no tienes cuenta?{" "}
        <Link
          href="/signup"
          style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
        >
          Prueba gratis 14 días →
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
          href="mailto:soporte@mediflow.mx"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          Soporte
        </a>
      </div>
    </div>
  );
}
