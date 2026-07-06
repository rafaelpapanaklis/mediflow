"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "../../landing/primitives/logo";
import { PasswordInput } from "../password-input";
import { PasswordStrength, scorePassword } from "../password-strength";

type Status = "checking" | "ready" | "invalid";

/**
 * Paso 2 de la recuperación: definir la nueva contraseña.
 * Se llega aquí con la sesión de recovery YA en cookies (la dejó
 * /auth/confirm vía verifyOtp o exchangeCodeForSession). Sin sesión →
 * enlace inválido/caducado → CTA para pedir otro.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<Status>(
    searchParams.get("error") ? "invalid" : "checking",
  );
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Valida la sesión de recovery. También cubre el caso en que Supabase
  // redirige con el error en el HASH (#error_code=otp_expired), que el
  // route handler no puede ver (el fragmento nunca llega al servidor).
  useEffect(() => {
    if (status === "invalid") return;
    let cancelled = false;

    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("error")) {
      setStatus("invalid");
      return;
    }

    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) setStatus(data.user ? "ready" : "invalid");
      })
      .catch(() => {
        if (!cancelled) setStatus("invalid");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mismo criterio que el registro: mínimo 8 y fuerza >= "Regular".
  const pwValid = password.length >= 8 && scorePassword(password) >= 2;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !pwValid) return;
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        const msg = updateError.message ?? "";
        if (/different from the old password/i.test(msg)) {
          setError("La nueva contraseña debe ser diferente a la anterior.");
        } else if (/session/i.test(msg)) {
          setStatus("invalid");
        } else {
          setError("No pudimos actualizar la contraseña. Inténtalo de nuevo.");
        }
        setSaving(false);
        return;
      }
      // Cerrar la sesión de recovery para que el login arranque limpio.
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      toast.success("Contraseña actualizada. Inicia sesión con tu nueva contraseña.");
      router.push("/login");
    } catch {
      setError("No pudimos actualizar la contraseña. Revisa tu conexión e inténtalo de nuevo.");
      setSaving(false);
    }
  }

  const header = (
    <>
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
          Restablecer contraseña
        </h1>
        <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          Elige una contraseña nueva para tu cuenta.
        </p>
      </div>
    </>
  );

  if (status === "checking") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {header}
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--ld-fg-muted)", fontSize: 13 }}>
          Verificando tu enlace…
        </div>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {header}
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.25)",
            color: "#dc2626",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Este enlace ya no es válido.</strong> Los enlaces de
          recuperación caducan por seguridad y solo sirve el más reciente.
          Pide uno nuevo y ábrelo en este mismo navegador.
        </div>
        <Link
          href="/forgot-password"
          style={{
            width: "100%",
            height: 44,
            borderRadius: 10,
            background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            boxShadow: "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          Pedir otro enlace →
        </Link>
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

  const submitDisabled = saving || !pwValid;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {header}

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

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <PasswordInput
            label="Nueva contraseña"
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            error={touched && !pwValid ? "La contraseña es muy débil" : undefined}
            required
          />
          <PasswordStrength password={password} />
        </div>

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
          {saving ? "Guardando…" : "Guardar contraseña →"}
        </button>
      </form>

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
