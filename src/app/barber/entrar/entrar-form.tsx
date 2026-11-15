"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { FormField } from "@/components/public/auth/form-field";
import { PasswordInput } from "@/components/public/auth/password-input";
import {
  BARBER_ENTRAR_CORREO_KEY,
  BarberBrandRow,
} from "@/components/barber/barber-registro-form";

const CARAMELO = "#A2612F";

/**
 * Formulario de /barber/entrar. Mismo inicio de sesión que /login — el
 * servidor comprueba la contraseña en POST /api/auth/login (bloqueo
 * persistente por cuenta e IP, cookies de sesión escritas en su respuesta) y
 * después /api/auth/post-login limpia las cookies de una sesión anterior —
 * pero sin nada de clínicas y con salida a /barber.
 *
 * Textos en español DURO, a propósito, igual que el registro: esta pantalla
 * no pasa por el diccionario (el i18n del vertical vive dentro del panel).
 */
export function BarberEntrarForm({
  destino,
  registerHref,
  forgotHref,
  aviso = null,
  otraEntradaHref = null,
}: {
  /** A dónde ir al entrar: /barber, o Suscripción si se trae un plan elegido. */
  destino: string;
  registerHref: string;
  forgotHref: string;
  /** Aviso fijo que decide la página (cuenta dada de baja, cuenta que no es de barbería). */
  aviso?: string | null;
  /**
   * Solo cuando la cuenta abierta NO es de barbería: la entrada que sí le
   * toca. Es el único enlace de todo el vertical que sale hacia allá.
   */
  otraEntradaHref?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quien llega del registro con «ese correo ya tiene cuenta» no lo teclea
  // dos veces. Se lee una vez y se borra; nunca viaja en la URL.
  useEffect(() => {
    try {
      const guardado = window.sessionStorage.getItem(BARBER_ENTRAR_CORREO_KEY);
      if (guardado) {
        setEmail(guardado);
        window.sessionStorage.removeItem(BARBER_ENTRAR_CORREO_KEY);
      }
    } catch {
      /* navegación privada sin sessionStorage: se teclea y ya */
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
    } catch {
      setError("No pudimos conectar. Revisa tu internet e inténtalo de nuevo.");
      setLoading(false);
      return;
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      // El 429 trae su propio texto (bloqueo de ESTE correo o tope de la red).
      setError(
        data?.error ??
          (res.status === 429
            ? "Demasiados intentos. Espera unos minutos e inténtalo de nuevo."
            : "Correo o contraseña incorrectos."),
      );
      setLoading(false);
      return;
    }

    // Igual que /login: limpia la clínica activa y el 2FA de una sesión previa.
    try {
      await fetch("/api/auth/post-login", { method: "POST" });
    } catch {
      /* no bloquea la entrada */
    }

    // Navegación dura: un solo montaje del panel con la sesión ya puesta.
    window.location.href = destino;
  }

  const incompleto = !email.trim() || !password;

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <BarberBrandRow />

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
          Entra a tu barbería
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          Tu agenda, tu fila y tu caja, donde las dejaste.
        </p>
      </div>

      {aviso && !error && (
        <div
          role="status"
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
          {aviso}
          {otraEntradaHref && (
            <>
              {" "}
              <Link href={otraEntradaHref} style={{ color: CARAMELO, fontWeight: 600 }}>
                ¿Tienes clínica? Entra aquí
              </Link>
            </>
          )}
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

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <PasswordInput
          label="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Tu contraseña"
          autoComplete="current-password"
          required
        />
        <Link
          href={forgotHref}
          style={{
            alignSelf: "flex-end",
            fontSize: 12.5,
            fontWeight: 600,
            color: CARAMELO,
            textDecoration: "none",
          }}
        >
          Olvidé mi contraseña
        </Link>
      </div>

      <button
        type="submit"
        disabled={loading || incompleto}
        style={{
          height: 44,
          borderRadius: 10,
          border: "none",
          // Apagado: crema con texto oscuro (blanco sobre caramelo claro no se lee).
          background: loading ? "#CD9459" : incompleto ? "#EBD3B4" : CARAMELO,
          color: !loading && incompleto ? "#814A28" : "#fff",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: loading ? "wait" : incompleto ? "not-allowed" : "pointer",
          transition: "background .15s",
        }}
      >
        {loading ? "Entrando…" : "Entrar"}
      </button>

      <p style={{ fontSize: 12.5, color: "var(--ld-fg-muted)", margin: 0, textAlign: "center" }}>
        ¿No tienes cuenta?{" "}
        <Link href={registerHref} style={{ color: CARAMELO, fontWeight: 600, textDecoration: "none" }}>
          Registra tu barbería
        </Link>
      </p>
    </form>
  );
}
