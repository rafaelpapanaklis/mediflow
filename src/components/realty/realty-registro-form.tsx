"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Building2, Home, UserRound } from "lucide-react";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { REALTY_MODES, type RealtyMode } from "@/lib/realty/types";

const TEAM_SIZES = ["1", "2-5", "6-15", "16+"] as const;
type TeamSize = (typeof TEAM_SIZES)[number];

const MODE_ICONS: Record<RealtyMode, React.ComponentType<{ size?: number | string }>> = {
  AGENCY: Building2,
  AGENT: UserRound,
  OWNER: Home,
};

/**
 * Alta pública de una cuenta de inmuebles, en DOS pasos.
 *
 * 🔴 El paso 1 NO es un adorno de onboarding: el modo (AGENCY / AGENT /
 * OWNER) decide qué pantallas existen en el panel para siempre. Preguntarlo
 * primero, con una línea de explicación de cada uno, es más barato que
 * enseñarle Comisiones a un señor que nada más renta su departamento.
 *
 * i18n por CONVENCIÓN B: el servidor ya bajó el sub-árbol `realty.registro`
 * y aquí el prefijo va VACÍO. Anteponerlo otra vez pintaría las llaves
 * crudas (ver src/lib/realty/i18n.ts).
 */
export function RealtyRegistroForm({ dict }: { dict: Dictionary }) {
  const t = makeRealtyT(dict);

  const [mode, setMode] = useState<RealtyMode | null>(null);
  const [accountName, setAccountName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [teamSize, setTeamSize] = useState<TeamSize>("1");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || !mode) return;
    setError(null);

    if (!accountName.trim()) return setError(t("errors.accountName"));
    if (!firstName.trim()) return setError(t("errors.firstName"));
    if (!lastName.trim()) return setError(t("errors.lastName"));
    if (!email.trim()) return setError(t("errors.email"));
    if (password.length < 8) return setError(t("errors.password"));
    if (!phone.trim()) return setError(t("errors.phone"));

    setLoading(true);
    try {
      const res = await fetch("/api/realty/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          accountName: accountName.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim(),
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          // Solo la inmobiliaria con agentes tiene tamaño de equipo que
          // declarar; el asesor solo y el propietario son uno.
          teamSize: mode === "AGENCY" ? teamSize : "1",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? t("errors.generic"));
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errors.generic"));
      setLoading(false);
    }
  }

  // ── Éxito ─────────────────────────────────────────────────────────────
  // No redirige solo con un setTimeout: el usuario decide cuándo. Un salto
  // automático a /login después de crear la cuenta es justo el momento en
  // que alguien todavía está leyendo qué pasó.
  if (success) {
    return (
      <div style={{ maxWidth: 420, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 10 }}>
          {t("success.title")}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--ld-muted, #64748b)" }}>
          {t("success.body")}
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ld-muted, #64748b)", marginTop: 8 }}>
          {t("success.next")}
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-block",
            marginTop: 22,
            background: "#2F6B4D",
            color: "#fff",
            padding: "12px 24px",
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 15,
            textDecoration: "none",
          }}
        >
          {t("success.cta")}
        </Link>
      </div>
    );
  }

  // ── Paso 1: ¿qué eres? ────────────────────────────────────────────────
  if (!mode) {
    return (
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#2F6B4D", marginBottom: 8 }}>
          {t("step.mode")}
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{t("mode.title")}</h1>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ld-muted, #64748b)",
            marginBottom: 22,
          }}
        >
          {t("mode.subtitle")}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {REALTY_MODES.map((m) => {
            const Icon = MODE_ICONS[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  textAlign: "left",
                  padding: "16px 18px",
                  borderRadius: 14,
                  border: "1px solid rgba(20,32,26,.14)",
                  background: "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(63,132,97,.12)",
                    color: "#27543E",
                  }}
                >
                  <Icon size={19} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 650, color: "#14201A" }}>
                    {t(`mode.${m}.label`)}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.5, color: "#5b6b62" }}>
                    {t(`mode.${m}.help`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p style={{ marginTop: 20, fontSize: 13, color: "var(--ld-muted, #64748b)" }}>
          {t("form.haveAccount")}{" "}
          <Link href="/login" style={{ color: "#2F6B4D", fontWeight: 600 }}>
            {t("form.signIn")}
          </Link>
        </p>
      </div>
    );
  }

  // ── Paso 2: los datos ─────────────────────────────────────────────────
  const nameLabel =
    mode === "AGENCY"
      ? t("form.accountName")
      : mode === "AGENT"
        ? t("form.accountNameAgent")
        : t("form.accountNameOwner");

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 460, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "#2F6B4D" }}>{t("step.form")}</span>
        <button
          type="button"
          onClick={() => setMode(null)}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#2F6B4D",
            background: "transparent",
            border: 0,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("mode.change")}
        </button>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        {t(`mode.${mode}.label`)}
      </h1>
      <p
        style={{
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--ld-muted, #64748b)",
          marginBottom: 20,
        }}
      >
        {t(`mode.${mode}.help`)}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormField
          label={nameLabel}
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          autoComplete="organization"
          required
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField
            label={t("form.firstName")}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            required
          />
          <FormField
            label={t("form.lastName")}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            required
          />
        </div>

        <FormField
          label={t("form.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <PasswordInput
          label={t("form.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        <FormField
          label={t("form.phone")}
          hint={t("form.phoneHint")}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          required
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField
            label={t("form.city")}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
          />
          <FormField
            label={t("form.state")}
            value={state}
            onChange={(e) => setState(e.target.value)}
            autoComplete="address-level1"
          />
        </div>

        {mode === "AGENCY" && (
          <FormField label={t("form.teamSize")}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TEAM_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setTeamSize(size)}
                  aria-pressed={teamSize === size}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    border:
                      teamSize === size
                        ? "1px solid #2F6B4D"
                        : "1px solid rgba(20,32,26,.16)",
                    background: teamSize === size ? "#2F6B4D" : "#fff",
                    color: teamSize === size ? "#fff" : "#46524B",
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          </FormField>
        )}

        {error && (
          <p role="alert" style={{ fontSize: 13, color: "#B3261E", margin: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 4,
            height: 46,
            borderRadius: 10,
            border: "1px solid #27543E",
            background: loading ? "#77837B" : "#2F6B4D",
            color: "#fff",
            fontSize: 15,
            fontWeight: 650,
            cursor: loading ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? t("form.submitting") : t("form.submit")}
        </button>

        <p style={{ fontSize: 13, color: "var(--ld-muted, #64748b)", margin: 0 }}>
          {t("form.haveAccount")}{" "}
          <Link href="/login" style={{ color: "#2F6B4D", fontWeight: 600 }}>
            {t("form.signIn")}
          </Link>
        </p>
      </div>
    </form>
  );
}
