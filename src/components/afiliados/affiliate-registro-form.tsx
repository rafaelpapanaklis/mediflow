"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Logo } from "@/components/public/landing/primitives/logo";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";
import {
  PAYOUT_METHODS,
  saveSignupDraft,
  selectStyle,
} from "./affiliate-signup-shared";

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

const primaryButtonStyle: React.CSSProperties = {
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
};

/** Aviso de invitación. Mismo bloque en registro y en vinculación. */
const inviteNoticeStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(139,92,246,0.25)",
  background: "rgba(139,92,246,0.08)",
  fontSize: 13,
  color: "var(--ld-fg-muted)",
  lineHeight: 1.5,
};

export function AffiliateRegistroForm({
  topRecurringMxn = 0,
  topOneTimeMxn = 0,
  sessionEmail = null,
  alreadyAffiliate = false,
  inviteCode = "",
  inviterName = "",
}: {
  topRecurringMxn?: number;
  topOneTimeMxn?: number;
  /**
   * Correo de la sesión de DaleControl ya abierta (típicamente el dueño de una
   * clínica que llegó desde Configuración). Si viene, el alta NO pide correo ni
   * contraseña: se vincula la cuenta que ya existe.
   */
  sessionEmail?: string | null;
  /** Esa sesión ya tiene cuenta de afiliado. */
  alreadyAffiliate?: boolean;
  /**
   * Código de invitación de la URL (`?inv=`), ya normalizado en el servidor.
   * Viaja tal cual en el POST del alta: quien decide si vale es el servidor.
   */
  inviteCode?: string;
  /** Nombre de quien invita, sólo si el código resolvió a un afiliado activo. */
  inviterName?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("");
  const [payoutDetails, setPayoutDetails] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Algunos rechazos traen a dónde ir (p. ej. "ya eres afiliado" → el login del
  // portal). El enlace se pinta DENTRO del aviso, no sólo en el pie.
  const [errorLink, setErrorLink] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // El correo ya existe en DaleControl pero NO es de afiliado: hay que probar
  // identidad iniciando sesión. No es un error, es el siguiente paso.
  const [needsLogin, setNeedsLogin] = useState<string | null>(null);

  // Con sesión abierta el alta es una VINCULACIÓN: no se crea usuario nuevo.
  const linkMode = !!sessionEmail && !alreadyAffiliate;

  const currentMethod = PAYOUT_METHODS.find(m => m.value === payoutMethod) ?? PAYOUT_METHODS[0];

  /** Guarda lo ya escrito para que /afiliados/vincular lo recupere. */
  function stashDraft() {
    saveSignupDraft({
      name: name.trim(),
      payoutMethod,
      payoutDetails: payoutDetails.trim(),
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setErrorLink(null);

    if (!name.trim()) return setError("Tu nombre o el de tu empresa es requerido.");
    if (!linkMode) {
      if (!email.trim()) return setError("El correo electrónico es requerido.");
      if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    }
    if (!acceptedTerms) return setError("Debes aceptar los términos del programa para continuar.");

    setLoading(true);
    try {
      // Dos endpoints según el caso. `/link` no manda correo ni contraseña: el
      // servidor toma la identidad de la sesión verificada.
      const res = linkMode
        ? await fetch("/api/afiliados/auth/link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              payoutMethod: payoutMethod || undefined,
              payoutDetails: payoutDetails.trim() || undefined,
              inv: inviteCode || undefined,
            }),
          })
        : await fetch("/api/afiliados/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              email: email.trim(),
              password,
              payoutMethod: payoutMethod || undefined,
              payoutDetails: payoutDetails.trim() || undefined,
              inv: inviteCode || undefined,
            }),
          });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 409 needsLogin → el correo ya es de una cuenta de DaleControl.
        if (data?.needsLogin) {
          stashDraft();
          setNeedsLogin(email.trim());
          setLoading(false);
          return;
        }
        setError(data?.error ?? "No se pudo completar el registro. Intenta de nuevo.");
        setErrorLink(typeof data?.loginUrl === "string" ? data.loginUrl : null);
        setLoading(false);
        return;
      }

      // La sesión ya era afiliada (carrera contra otra pestaña) → a su panel.
      if (data?.alreadyLinked) {
        window.location.href = data.home ?? "/afiliados/inicio";
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        // Vinculando ya hay sesión: se puede ir directo al estado de la
        // solicitud. En el alta normal todavía no hay sesión → al login.
        window.location.href = linkMode ? "/afiliados/pendiente" : "/afiliados/login";
      }, 1500);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo completar el registro. Intenta de nuevo.");
      setLoading(false);
    }
  }

  // ── Ya es afiliado con la sesión abierta ─────────────────────────────────
  if (alreadyAffiliate) {
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
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.25)",
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
            Ya tienes cuenta de afiliado
          </h1>
          <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
            La cuenta <strong style={{ color: "var(--ld-fg)" }}>{sessionEmail}</strong> ya está en el
            programa de afiliados.
          </p>
        </div>
        <Link href="/afiliados/inicio" style={primaryButtonStyle}>
          Ir a mi panel de afiliado →
        </Link>
      </div>
    );
  }

  // ── El correo ya existe en DaleControl: hay que iniciar sesión ───────────
  if (needsLogin !== null) {
    // El `inv` viaja a la otra pantalla: si se quedara aquí, cambiar de
    // formulario borraría la invitación y el vínculo nunca se escribiría.
    const params = new URLSearchParams();
    if (needsLogin) params.set("email", needsLogin);
    if (inviteCode) params.set("inv", inviteCode);
    const qs = params.toString();
    const href = qs ? `/afiliados/vincular?${qs}` : "/afiliados/vincular";
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
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.25)",
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
            Ya tienes una cuenta en DaleControl
          </h1>
          <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
            Inicia sesión con tu contraseña de siempre y activamos tu cuenta de afiliado — no
            necesitas crear otra. Los datos que ya escribiste te siguen al siguiente paso.
          </p>
        </div>
        <Link href={href} style={primaryButtonStyle}>
          Iniciar sesión y activar →
        </Link>
        <button
          type="button"
          onClick={() => {
            setNeedsLogin(null);
            setError(null);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--ld-fg-muted)",
            fontSize: 13,
            fontFamily: "inherit",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          ← Usar otro correo
        </button>
      </div>
    );
  }

  // ── Alta completada ──────────────────────────────────────────────────────
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
            {linkMode ? "Cuenta de afiliado activada" : "Registro recibido"}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
            {linkMode
              ? "Tu solicitud está en revisión; te avisaremos al aprobarla. Tu cuenta y tu contraseña de siempre no cambiaron."
              : "Tu cuenta de afiliado está en revisión; te avisaremos al aprobarla."}
          </p>
        </div>
        {!linkMode && (
          <Link href="/afiliados/login" style={primaryButtonStyle}>
            Ir a iniciar sesión →
          </Link>
        )}
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

      {/* Invitación de otro afiliado. Se dice completo lo que significa: es un
          alta idéntica a cualquier otra, sin comisiones compartidas. */}
      {inviterName && (
        <div style={inviteNoticeStyle}>
          Te invitó{" "}
          <strong style={{ color: "var(--ld-fg)", fontWeight: 600 }}>{inviterName}</strong>. Entras
          como cualquier otro afiliado: ganas la misma comisión por cada clínica que traigas, eliges
          tu modalidad de pago y quien te invitó no recibe ninguna parte de tus comisiones.
        </div>
      )}

      {/* Camino corto: ya está dentro del sistema, no vuelve a escribir credenciales. */}
      {linkMode && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(139,92,246,0.25)",
            background: "rgba(139,92,246,0.08)",
            fontSize: 13,
            color: "var(--ld-fg-muted)",
            lineHeight: 1.5,
          }}
        >
          Ya tienes sesión iniciada como{" "}
          <strong style={{ color: "var(--ld-fg)", fontWeight: 600 }}>{sessionEmail}</strong>. Sumamos
          el rol de afiliado a esa misma cuenta: no creamos otra ni cambiamos tu contraseña.
        </div>
      )}

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
            {errorLink && (
              <>
                {" "}
                <Link
                  href={errorLink}
                  style={{ color: "#fca5a5", fontWeight: 600, textDecoration: "underline" }}
                >
                  Inicia sesión →
                </Link>
              </>
            )}
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

        {!linkMode && (
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
              label="Contraseña"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={inputDisabled}
              required
            />
          </>
        )}

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
          {loading
            ? linkMode
              ? "Activando…"
              : "Enviando registro…"
            : linkMode
              ? "Activar mi cuenta de afiliado →"
              : "Crear cuenta de afiliado →"}
        </button>
      </form>

      <div style={{ textAlign: "center", fontSize: 13, color: "var(--ld-fg-muted)" }}>
        {linkMode ? (
          <>
            ¿No eres tú?{" "}
            <Link
              href={inviteCode ? `/afiliados/vincular?inv=${encodeURIComponent(inviteCode)}` : "/afiliados/vincular"}
              style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
            >
              Usar otra cuenta →
            </Link>
          </>
        ) : (
          <>
            ¿Ya tienes cuenta?{" "}
            <Link
              href="/afiliados/login"
              style={{ color: "var(--ld-brand-light)", fontWeight: 500, textDecoration: "none" }}
            >
              Inicia sesión →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
