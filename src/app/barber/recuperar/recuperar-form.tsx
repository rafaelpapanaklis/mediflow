"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { FormField } from "@/components/public/auth/form-field";
import { BarberBrandRow } from "@/components/barber/barber-registro-form";

const CARAMELO = "#A2612F";
/** Igual que el dental: un envío por minuto (Supabase además limita 1/60 s por dirección). */
const ESPERA_REENVIO_S = 60;

/**
 * Formulario de /barber/recuperar. Mismo flujo que «Olvidé mi contraseña» del
 * dental, con la cara de /barber/entrar y su ruta propia
 * (/api/barber/auth/recuperar), cuyo enlace de correo regresa a Barber.
 *
 * La respuesta del servidor es SIEMPRE neutra y la pantalla también: nunca
 * dice si el correo tiene cuenta o no.
 *
 * Textos en español duro, como /barber/entrar: esta pantalla no pasa por el
 * diccionario (el i18n del vertical vive dentro del panel).
 */
export function BarberRecuperarForm({ loginHref, apiUrl }: { loginHref: string; apiUrl: string }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function pedirEnlace() {
    if (sending || cooldown > 0) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (res.status === 429) {
        setError("Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "No pudimos enviar la solicitud. Inténtalo de nuevo.");
        return;
      }
      setSent(true);
      setCooldown(ESPERA_REENVIO_S);
    } catch {
      setError("No pudimos conectar. Revisa tu internet e inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await pedirEnlace();
  }

  const apagado = sending || !email.trim() || (sent && cooldown > 0);

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <BarberBrandRow />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ld-fg)", margin: 0 }}>
          ¿Olvidaste tu contraseña?
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          Escribe el correo con el que entras a tu barbería y te mandamos un enlace para poner una nueva.
        </p>
      </div>

      {sent && (
        // Neutro a propósito: nunca confirma que el correo tenga cuenta.
        <div
          role="status"
          data-barber-recuperar="enviado"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.45,
            color: "#814A28",
            background: "rgba(190,122,60,0.10)",
            border: "1px solid rgba(190,122,60,0.35)",
          }}
        >
          <strong>Listo.</strong> Si ese correo tiene cuenta, te llega un enlace en unos minutos. Ábrelo en este
          mismo navegador y revisa también tu carpeta de spam.
        </div>
      )}

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
        label="Correo electrónico"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tucorreo@ejemplo.com"
        autoComplete="email"
        required
      />

      <button
        type="submit"
        disabled={apagado}
        style={{
          height: 44,
          borderRadius: 10,
          border: "none",
          background: sending ? "#CD9459" : apagado ? "#EBD3B4" : CARAMELO,
          color: !sending && apagado ? "#814A28" : "#fff",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: sending ? "wait" : apagado ? "not-allowed" : "pointer",
          transition: "background .15s",
        }}
      >
        {sending
          ? "Enviando…"
          : !sent
            ? "Enviar enlace"
            : cooldown > 0
              ? `Reenviar enlace (${cooldown} s)`
              : "Reenviar enlace"}
      </button>

      <p style={{ fontSize: 12.5, color: "var(--ld-fg-muted)", margin: 0, textAlign: "center" }}>
        <Link href={loginHref} style={{ color: CARAMELO, fontWeight: 600, textDecoration: "none" }}>
          ← Volver a entrar
        </Link>
      </p>
    </form>
  );
}
