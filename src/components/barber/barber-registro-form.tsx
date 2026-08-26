"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Scissors } from "lucide-react";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";
import { PhoneCountryInput } from "@/components/barber/phone-country-input";
import {
  BARBER_DEFAULT_PHONE_COUNTRY,
  normalizeBarberPhone,
} from "@/lib/barber/phone-countries";

const TEAM_SIZES = ["1", "2-3", "4-5", "6+"] as const;
type TeamSize = (typeof TEAM_SIZES)[number];

/** Chip-toggle (mismo patrón que el registro de laboratorios). */
function Chip({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        padding: "7px 14px",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "all .15s",
        border: selected ? "1px solid #A2612F" : "1px solid var(--ld-border)",
        background: selected ? "rgba(190,122,60,0.16)" : "rgba(255,255,255,0.03)",
        color: selected ? "#814A28" : "var(--ld-fg-muted)",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Alta pública de barbería. Sin selector de especialidad, sin nada clínico.
 * POST /api/barber/auth/register → NO inicia sesión: redirige a /login (el
 * login compartido; getCurrentUser sabe mandar BarberUsers a /barber).
 *
 * Textos en español DURO, a propósito: esta pantalla no pasa por el
 * diccionario (i18n del vertical vive dentro del panel). No agregar llaves
 * de adorno aquí — hay una prueba de alcance que las caza.
 *
 * TELÉFONO: se captura el país por separado (PhoneCountryInput) y el número
 * local pelado; lo que se ENVÍA lo arma normalizeBarberPhone — 10 dígitos
 * limpios en México, E.164 completo fuera. El servidor vuelve a validar con
 * esa misma función: aquí no se decide nada, solo se captura.
 */
export function BarberRegistroForm() {
  const [shopName, setShopName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  /** Dígitos del número LOCAL (sin lada) + país elegido, por separado. */
  const [phone, setPhone] = useState("");
  const [phoneIso, setPhoneIso] = useState(BARBER_DEFAULT_PHONE_COUNTRY);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [teamSize, setTeamSize] = useState<TeamSize>("1");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setPhoneError(null);

    if (!shopName.trim()) return setError("El nombre de la barbería es requerido.");
    if (!firstName.trim()) return setError("Tu nombre es requerido.");
    if (!lastName.trim()) return setError("Tu apellido es requerido.");
    if (!email.trim()) return setError("El correo electrónico es requerido.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");

    // Sin número válido NO se envía nada, y el error se pinta bajo el campo.
    // La misma función corre en el servidor: si aquí pasa, allá pasa.
    const tel = normalizeBarberPhone(phoneIso, phone);
    if (!tel.ok) return setPhoneError(tel.error);

    setLoading(true);
    try {
      const res = await fetch("/api/barber/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopName: shopName.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
          // MX: 10 dígitos limpios (como siempre). Resto: E.164 completo.
          phone: tel.stored,
          country: tel.iso,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          teamSize,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "No se pudo completar el registro. Intenta de nuevo.");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/login";
      }, 1800);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "No se pudo completar el registro. Intenta de nuevo.",
      );
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <BrandRow />
        <div
          role="status"
          style={{
            padding: "20px 22px",
            borderRadius: 14,
            background: "rgba(5,150,105,0.08)",
            border: "1px solid rgba(5,150,105,0.25)",
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
            ¡Tu barbería está lista!
          </h1>
          <p style={{ fontSize: 14, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
            Inicia sesión y elige tu plan: tu panel se abre en cuanto se confirma el pago.
          </p>
        </div>
        <Link
          href="/login"
          style={{
            width: "100%",
            height: 44,
            display: "grid",
            placeItems: "center",
            borderRadius: 10,
            background: "#A2612F",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <BrandRow />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--ld-fg)",
            margin: 0,
          }}
        >
          Registra tu barbería
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          Crea tu cuenta en un minuto. Después eliges tu plan y lo activas con tarjeta.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.45,
            color: "#b91c1c",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.25)",
          }}
        >
          {error}
        </div>
      )}

      <FormField
        label="Nombre de la barbería"
        value={shopName}
        onChange={(e) => setShopName(e.target.value)}
        placeholder="Ej. La Cueva del Barbero"
        autoComplete="organization"
        required
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField
          label="Tu nombre"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="Nombre"
          autoComplete="given-name"
          required
        />
        <FormField
          label="Tu apellido"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Apellido"
          autoComplete="family-name"
          required
        />
      </div>

      <FormField
        label="Correo electrónico"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tucorreo@ejemplo.com"
        autoComplete="email"
        required
      />

      <PasswordInput
        label="Contraseña"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Mínimo 8 caracteres"
        autoComplete="new-password"
        required
      />

      <PhoneCountryInput
        label="Teléfono (WhatsApp)"
        iso={phoneIso}
        onIsoChange={(next) => {
          setPhoneIso(next);
          setPhoneError(null);
        }}
        value={phone}
        onValueChange={(next) => {
          setPhone(next);
          setPhoneError(null);
        }}
        error={phoneError ?? undefined}
        hint="Es nuestro canal para ayudarte a arrancar."
        required
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField
          label="Ciudad"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Ciudad"
          autoComplete="address-level2"
        />
        <FormField
          label="Estado"
          value={state}
          onChange={(e) => setState(e.target.value)}
          placeholder="Estado"
          autoComplete="address-level1"
        />
      </div>

      <FormField label="¿Cuántos barberos son?">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TEAM_SIZES.map((size) => (
            <Chip
              key={size}
              label={size === "1" ? "Solo yo" : size}
              selected={teamSize === size}
              onSelect={() => setTeamSize(size)}
            />
          ))}
        </div>
      </FormField>

      <button
        type="submit"
        disabled={loading}
        style={{
          height: 44,
          borderRadius: 10,
          border: "none",
          background: loading ? "#CD9459" : "#A2612F",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: loading ? "wait" : "pointer",
          transition: "background .15s",
        }}
      >
        {loading ? "Creando tu barbería…" : "Crear mi barbería"}
      </button>

      <p style={{ fontSize: 12.5, color: "var(--ld-fg-muted)", margin: 0, textAlign: "center" }}>
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" style={{ color: "#A2612F", fontWeight: 600, textDecoration: "none" }}>
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}

function BrandRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: "linear-gradient(135deg, #A2612F, #BE7A3C)",
          display: "grid",
          placeItems: "center",
          color: "#fff",
        }}
      >
        <Scissors size={16} />
      </div>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ld-fg)", letterSpacing: "-0.01em" }}>
        DaleControl <span style={{ color: "#A2612F" }}>Barber</span>
      </span>
    </div>
  );
}
