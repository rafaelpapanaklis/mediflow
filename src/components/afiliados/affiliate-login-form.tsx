"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/public/landing/primitives/logo";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";

export function AffiliateLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      toast.success("¡Bienvenido!");
      // Enruta según quién inicia sesión: afiliado → /afiliados/inicio,
      // vendedor (equipo) → /afiliados/vendedor/inicio. Si whoami falla por lo
      // que sea, cae al panel del afiliado. Hard navigation: garantiza un único
      // mount del layout del panel.
      const r = await fetch("/api/afiliados/whoami").then((x) => x.json()).catch(() => null);
      window.location.href = r?.home ?? "/afiliados/inicio";
    } catch (err: any) {
      setError(err?.message ?? "Error al iniciar sesión");
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
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
          Portal de afiliados
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0 }}>
          Accede a tu panel de afiliado de DaleControl
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
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.com"
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

      <div style={{ textAlign: "center", fontSize: 13, color: "var(--ld-fg-muted)" }}>
        ¿Quieres ser afiliado?{" "}
        <Link
          href="/afiliados/registro"
          style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
        >
          Regístrate →
        </Link>
      </div>
    </div>
  );
}
