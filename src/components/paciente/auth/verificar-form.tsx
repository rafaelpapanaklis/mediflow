"use client";

// Verificación de email por código (A2). POST /api/paciente/verify {email, code}.
// · 200 → la API ya dejó la cookie patient_session: window.location.assign(next
//   válido || "/paciente") para que el server la vea fresca.
// · "Reenviar código" → POST /api/paciente/verify/resend {email}, cooldown 30s.
// · Sin ?email= → se muestra input de correo.
import { useEffect, useState, type CSSProperties, type FocusEvent, type FormEvent } from "react";
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
  padding: "10px 14px",
  borderRadius: 10,
  background: "rgba(34,197,94,0.08)",
  border: "1px solid rgba(34,197,94,0.25)",
  color: "#86efac",
  fontSize: 13,
  lineHeight: 1.5,
};
const MUTED: CSSProperties = { fontSize: 14, color: "rgba(245,245,247,0.55)", lineHeight: 1.5, margin: 0 };
const LINK: CSSProperties = { color: "#a78bfa", fontWeight: 500, textDecoration: "none" };

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
function secondaryBtn(disabled: boolean): CSSProperties {
  return {
    width: "100%",
    height: 42,
    borderRadius: 10,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.12)",
    color: disabled ? "rgba(245,245,247,0.35)" : "rgba(245,245,247,0.7)",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
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

export function PacienteVerificarForm() {
  const searchParams = useSearchParams();
  const emailParam = (searchParams.get("email") || "").trim();
  const next = safeNext(searchParams.get("next"));
  const qs = next ? `?next=${encodeURIComponent(next)}` : "";
  const hasEmailParam = emailParam.length > 0;

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Contador del cooldown de "Reenviar código".
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const validEmail = email.trim().includes("@");
  const canVerify = !loading && code.length === 6 && validEmail;
  const resendDisabled = resending || cooldown > 0 || !validEmail;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canVerify) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/paciente/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        // La API ya dejó la cookie: navegación dura para que el server la vea.
        window.location.assign(next || "/paciente");
        return;
      }
      setError(
        data?.error ||
          (res.status === 429
            ? "Demasiados intentos. Espera unos minutos e inténtalo de nuevo."
            : "Código incorrecto o expirado."),
      );
      setLoading(false);
    } catch {
      setError("No pudimos conectar con el servidor. Inténtalo de nuevo.");
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendDisabled) return;
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const res = await fetch("/api/paciente/verify/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        setInfo("Te reenviamos el código. Revisa tu bandeja y el spam.");
      } else {
        setError(data?.error || "Espera un momento antes de pedir otro código.");
      }
      setCooldown(30);
    } catch {
      setError("No pudimos conectar con el servidor. Inténtalo de nuevo.");
    } finally {
      setResending(false);
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
            Verifica tu correo
          </h1>
          <p style={MUTED}>
            {hasEmailParam ? (
              <>
                Te enviamos un código a{" "}
                <strong style={{ color: "#f5f5f7", fontWeight: 600, overflowWrap: "anywhere" }}>{emailParam}</strong>.
                Revisa también el spam.
              </>
            ) : (
              <>Ingresa tu correo y el código de 6 dígitos que te enviamos. Revisa también el spam.</>
            )}
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div role="alert" style={ERROR_BOX}>
              {error}
            </div>
          )}
          {info && (
            <div role="status" style={OK_BOX}>
              {info}
            </div>
          )}

          {!hasEmailParam && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="pp-verify-email" style={LABEL}>
                Correo electrónico
              </label>
              <input
                id="pp-verify-email"
                type="email"
                autoComplete="email"
                placeholder="tucorreo@ejemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onFocus={focusIn}
                onBlur={focusOut}
                autoFocus={!hasEmailParam}
                required
                style={INPUT}
              />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor="pp-verify-code" style={LABEL}>
              Código de 6 dígitos
            </label>
            <input
              id="pp-verify-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus={hasEmailParam}
              autoComplete="one-time-code"
              placeholder="······"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onFocus={focusIn}
              onBlur={focusOut}
              required
              style={{ ...INPUT, height: 52, textAlign: "center", fontSize: 22, letterSpacing: 8, fontWeight: 600 }}
            />
          </div>

          <button type="submit" disabled={!canVerify} style={primaryBtn(!canVerify)}>
            {loading ? "Verificando…" : "Verificar →"}
          </button>

          <button type="button" onClick={handleResend} disabled={resendDisabled} style={secondaryBtn(resendDisabled)}>
            {resending ? "Reenviando…" : cooldown > 0 ? `Reenviar código (${cooldown}s)` : "Reenviar código"}
          </button>
        </form>

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
