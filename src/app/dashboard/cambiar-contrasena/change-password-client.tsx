"use client";

import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { PasswordInput } from "@/components/public/auth/password-input";
import { PasswordStrength, scorePassword } from "@/components/public/auth/password-strength";

// Mismo criterio que el registro público y que la recuperación por correo
// (reset-password-form): mínimo 8 y fuerza >= "Regular". Una regla nueva sólo
// para esta pantalla haría que una contraseña válida en un formulario fuera
// inválida en el otro.
function isStrongEnough(pwd: string): boolean {
  return pwd.length >= 8 && scorePassword(pwd) >= 2;
}

export function ChangePasswordClient() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touchedPwd, setTouchedPwd] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwValid      = isStrongEnough(password);
  const confirmValid = confirm.length > 0 && confirm === password;
  const canSubmit    = pwValid && confirmValid && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "No pudimos actualizar la contraseña. Inténtalo de nuevo.");
        setSaving(false);
        return;
      }
      // Navegación dura: el gate vive en el layout del servidor, así que hay que
      // volver a montarlo para que lea la marca ya limpia (un router.push
      // reusaría el árbol y rebotaría de vuelta aquí).
      window.location.href = "/dashboard";
    } catch {
      setError("No pudimos actualizar la contraseña. Revisa tu conexión e inténtalo de nuevo.");
      setSaving(false);
    }
  }

  async function handleLogout() {
    try {
      // Mismo cierre que el sidebar: el endpoint borra las cookies httpOnly
      // (activeClinicId, df_2fa, df_2fa_pending) que el cliente no puede tocar.
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
      const { createClient } = await import("@/lib/supabase/client");
      await createClient().auth.signOut();
    } catch (err) {
      console.error("[cambiar-contrasena] logout failed", err);
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    // container-type para que la tarjeta responda al ANCHO DISPONIBLE y no al
    // viewport (el panel usa @container, no @media). No hay nada position:fixed
    // dentro — los toasts viven en el layout raíz, fuera de este contenedor.
    <div style={{ containerType: "inline-size", width: "100%", maxWidth: 440, margin: "0 auto" }}>
      <style>{`
        @container (max-width: 380px) {
          .mcp-card { padding: 18px 16px; }
          .mcp-actions { flex-direction: column-reverse; align-items: stretch; }
          .mcp-actions button { width: 100%; }
        }
      `}</style>

      <div
        className="card mcp-card p-6"
        style={{
          boxShadow: "var(--shadow-2)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          // Los componentes de contraseña son los del sitio público y pintan
          // sobre tokens --ld-*, que sólo existen bajo .landing-theme. Se
          // declaran aquí (ámbito local, sin tocar globals.css) para que el
          // input se vea igual en el panel, en claro y en oscuro: la caja es
          // blanca, así que el texto va oscuro en ambos temas.
          ["--ld-fg" as string]:       "#0f172a",
          ["--ld-fg-muted" as string]: "#64748b",
          ["--ld-border" as string]:   "#cbd5e1",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8 }}>
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 44, height: 44, background: "var(--brand-soft)", color: "var(--consult-active-accent)" }}
          >
            <KeyRound size={20} strokeWidth={1.75} />
          </div>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            Crea tu contraseña
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            Tu contraseña fue generada por el sistema. Crea una propia para continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div
              role="alert"
              style={{
                background: "var(--danger-soft)",
                border: "1px solid var(--danger-border-strong)",
                borderRadius: "var(--radius)",
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--danger)",
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
              autoFocus
              value={password}
              onChange={e => setPassword(e.target.value)}
              onBlur={() => setTouchedPwd(true)}
              error={touchedPwd && !pwValid ? "La contraseña es muy débil" : undefined}
              required
            />
            <PasswordStrength password={password} />
          </div>

          <PasswordInput
            label="Confirmar contraseña"
            placeholder="Repite la contraseña"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onBlur={() => setTouchedConfirm(true)}
            error={touchedConfirm && !confirmValid ? "Las contraseñas no coinciden" : undefined}
            required
          />

          {/* Sin "omitir" ni "recordarme después": el acceso al panel depende de
              completar esto. La única salida es cerrar sesión. */}
          <div
            className="mcp-actions"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
          >
            <button
              type="button"
              onClick={handleLogout}
              className="btn-new btn-new--ghost"
              style={{ height: 40, justifyContent: "center", fontSize: 12.5 }}
            >
              Cerrar sesión
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-new btn-new--primary"
              style={{ height: 40, justifyContent: "center" }}
            >
              {saving ? "Guardando…" : "Guardar y continuar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
