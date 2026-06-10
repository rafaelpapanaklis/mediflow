"use client";

// Recuperar contraseña (A2) — 2 modos según ?token=:
// · SIN token: email → POST /api/paciente/password/forgot → mensaje neutro
//   (sin enumeración de cuentas). 429 → caja de error.
// · CON token: contraseña nueva + confirmar (≥8, iguales) → POST
//   /api/paciente/password/reset {token, password} → mensaje + botón a login.
import { useState, type CSSProperties, type FocusEvent, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// ── Estilos (dark DaleControl, autocontenidos: sin depender de vars --ld-*) ──
const SCREEN: CSSProperties = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: "clamp(16px, 4vw, 40px)",
  background: "#0b0815",
  fontFamily: "var(--font-sans, system-ui, -apple-system, sans-serif)",
};
const CARD: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  boxSizing: "border-box",
  background: "#121020",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: "clamp(22px, 6vw, 34px)",
  display: "flex",
  flexDirection: "column",
  gap: 22,
};
const LABEL: CSSProperties = { fontSize: 12, fontWeight: 500, color: "#f5f5f7", letterSpacing: "-0.005em" };
const INPUT: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 44,
  padding: "0 14px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#f5f5f7",
  fontSize: 16,
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color .15s",
};
const ERROR_BOX: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "rgba(239,68,68,0.08)",
  border: "1px solid rgba(239,68,68,0.25)",
  color: "#fca5a5",
  fontSize: 13,
  lineHeight: 1.5,
};
const OK_BOX: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(34,197,94,0.08)",
  border: "1px solid rgba(34,197,94,0.25)",
  color: "#86efac",
  fontSize: 13,
  lineHeight: 1.5,
};
const NEUTRAL_BOX: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(139,92,246,0.08)",
  border: "1px solid rgba(139,92,246,0.25)",
  color: "#c4b5fd",
  fontSize: 13,
  lineHeight: 1.5,
};
const MUTED: CSSProperties = { fontSize: 14, color: "rgba(245,245,247,0.55)", lineHeight: 1.5, margin: 0 };
const LINK: CSSProperties = { color: "#a78bfa", fontWeight: 500, textDecoration: "none" };
const FIELD_ERR: CSSProperties = { fontSize: 11, color: "#f87171", lineHeight: 1.4 };
const FIELD_HINT: CSSProperties = { fontSize: 11, color: "rgba(245,245,247,0.45)", lineHeight: 1.4 };
const EYE_BTN: CSSProperties = {
  position: "absolute",
  right: 7,
  top: "50%",
  transform: "translateY(-50%)",
  width: 30,
  height: 30,
  borderRadius: 6,
  background: "transparent",
  border: "none",
  color: "rgba(245,245,247,0.55)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
};

function primaryBtn(disabled: boolean): CSSProperties {
  return {
    width: "100%",
    height: 46,
    borderRadius: 10,
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "inherit",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "rgba(124,58,237,0.4)" : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
    boxShadow: disabled ? "none" : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
    transition: "all .15s",
  };
}
function focusIn(e: FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "rgba(124,58,237,0.6)";
}
function focusOut(e: FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
}
/** Solo rutas internas: deben empezar con "/" y no con "//" (anti open-redirect). */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

function Brand() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 3,
            background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            boxShadow: "0 0 12px rgba(139,92,246,0.55)",
          }}
        />
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "#f5f5f7" }}>DaleControl</span>
      </div>
      <span style={{ fontSize: 12, color: "rgba(245,245,247,0.5)", paddingLeft: 18 }}>Portal del paciente</span>
    </div>
  );
}

function Eye({ off }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function PacienteRecuperarForm() {
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") || "").trim();
  const next = safeNext(searchParams.get("next"));
  const qs = next ? `?next=${encodeURIComponent(next)}` : "";
  const hasToken = token.length > 0;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordError = password && password.length < 8 ? "Mínimo 8 caracteres." : "";
  const confirmError = confirm && confirm !== password ? "Las contraseñas no coinciden." : "";
  const canForgot = !loading && /\S+@\S+\.\S+/.test(email.trim());
  const canReset = !loading && password.length >= 8 && confirm === password;

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    if (!canForgot) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/paciente/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        setSent(true);
      } else {
        setError(data?.error || "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
      }
      setLoading(false);
    } catch {
      setError("No pudimos conectar con el servidor. Inténtalo de nuevo.");
      setLoading(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!canReset) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/paciente/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
      } else {
        setError(data?.error || "El enlace no es válido o ya expiró. Solicita uno nuevo.");
      }
      setLoading(false);
    } catch {
      setError("No pudimos conectar con el servidor. Inténtalo de nuevo.");
      setLoading(false);
    }
  }

  return (
    <div style={SCREEN}>
      <div style={CARD}>
        <Brand />

        <div>
          <h1
            style={{
              fontSize: "clamp(22px, 5vw, 26px)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#f5f5f7",
              margin: "0 0 6px",
            }}
          >
            {hasToken ? "Crea una nueva contraseña" : "Recupera tu contraseña"}
          </h1>
          <p style={MUTED}>
            {hasToken
              ? "Debe tener al menos 8 caracteres."
              : "Te enviaremos un enlace a tu correo para restablecerla."}
          </p>
        </div>

        {hasToken ? (
          done ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div role="status" style={OK_BOX}>
                Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión.
              </div>
              <Link
                href="/paciente/login"
                style={{ ...primaryBtn(false), display: "grid", placeItems: "center", textDecoration: "none" }}
              >
                Ir a iniciar sesión →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {error && (
                <div role="alert" style={ERROR_BOX}>
                  {error}{" "}
                  <Link
                    href="/paciente/recuperar"
                    style={{ color: "#fecaca", fontWeight: 600, textDecoration: "underline" }}
                  >
                    Solicitar nuevo enlace →
                  </Link>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="pp-reset-password" style={LABEL}>
                  Contraseña nueva
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="pp-reset-password"
                    type={showPwd ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onFocus={focusIn}
                    onBlur={focusOut}
                    autoFocus
                    required
                    style={{ ...INPUT, padding: "0 44px 0 14px" }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPwd(s => !s)}
                    aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                    style={EYE_BTN}
                  >
                    <Eye off={showPwd} />
                  </button>
                </div>
                {passwordError ? (
                  <div style={FIELD_ERR}>{passwordError}</div>
                ) : (
                  <div style={FIELD_HINT}>Mínimo 8 caracteres.</div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="pp-reset-confirm" style={LABEL}>
                  Confirma tu contraseña
                </label>
                <input
                  id="pp-reset-confirm"
                  type={showPwd ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onFocus={focusIn}
                  onBlur={focusOut}
                  required
                  style={INPUT}
                />
                {confirmError && <div style={FIELD_ERR}>{confirmError}</div>}
              </div>

              <button type="submit" disabled={!canReset} style={primaryBtn(!canReset)}>
                {loading ? "Guardando…" : "Restablecer contraseña →"}
              </button>
            </form>
          )
        ) : sent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div role="status" style={NEUTRAL_BOX}>
              Si el correo existe, te enviamos un enlace para restablecer tu contraseña. Revisa también el spam.
            </div>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#a78bfa",
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Usar otro correo
            </button>
          </div>
        ) : (
          <form onSubmit={handleForgot} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {error && (
              <div role="alert" style={ERROR_BOX}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="pp-forgot-email" style={LABEL}>
                Correo electrónico
              </label>
              <input
                id="pp-forgot-email"
                type="email"
                autoComplete="email"
                placeholder="tucorreo@ejemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onFocus={focusIn}
                onBlur={focusOut}
                autoFocus
                required
                style={INPUT}
              />
            </div>

            <button type="submit" disabled={!canForgot} style={primaryBtn(!canForgot)}>
              {loading ? "Enviando…" : "Enviar enlace →"}
            </button>
          </form>
        )}

        <div
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "rgba(245,245,247,0.55)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingTop: 16,
          }}
        >
          <Link href={`/paciente/login${qs}`} style={LINK}>
            Volver a iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
