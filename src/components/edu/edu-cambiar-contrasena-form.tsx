"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { EDU_BRAND } from "@/lib/edu/types";

/**
 * El formulario de /instituto/cambiar-contrasena (P2-9).
 *
 * QUÉ DECIDE Y QUÉ NO:
 *  · NO decide si la contraseña es buena. Aquí solo se comprueba lo obvio
 *    (que las dos coincidan y el largo mínimo) para no gastar un viaje; la
 *    regla de fuerza completa vive en el ENDPOINT, que es el mismo criterio
 *    del resto de DaleControl y contesta con el motivo escrito.
 *  · NO guarda nada: ni la vieja ni la nueva quedan en ningún estado más
 *    tiempo del que dura la petición.
 *
 * Al terminar navega DURO a /instituto/inicio: el layout del panel vuelve a
 * leer la marca `mustChangePassword` de la base (ya en false) y deja pasar.
 * Una navegación suave podría servir el panel con el contexto viejo.
 */
export function EduCambiarContrasenaForm({
  forzado,
  email,
}: {
  /** true = llegó redirigido por la marca; el panel no abre hasta cambiar. */
  forzado: boolean;
  /** Solo para PINTAR a quién se le cambia. El endpoint usa la SESIÓN. */
  email: string;
}) {
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coinciden = password.length > 0 && password === repetida;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !coinciden) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/instituto/auth/cambiar-contrasena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "No se pudo cambiar la contraseña. Intenta de nuevo.");
        setBusy(false);
        return;
      }
      // Dura a propósito — ver la cabecera.
      window.location.href = "/instituto/inicio";
    } catch {
      setError("No se pudo conectar. Revisa tu conexión y vuelve a intentar.");
      setBusy(false);
    }
  }

  return (
    <div className="edu-auth__inner">
      <div className="edu-auth__mark">
        <div className="edu-sidebar__logo" aria-hidden="true">
          <KeyRound size={19} />
        </div>
        <div>
          <div className="edu-sidebar__brandname">{EDU_BRAND.product}</div>
          <div className="edu-sidebar__brandsub">{EDU_BRAND.vertical}</div>
        </div>
      </div>

      <div>
        <h1 className="edu-auth__title">
          {forzado ? "Estrena tu contraseña" : "Cambiar contraseña"}
        </h1>
        <p className="edu-auth__lead">
          {forzado
            ? "La contraseña con la que entraste la generó el sistema y la conoce quien te dio de alta. Define la tuya para poder usar el panel: a partir de aquí, solo tú la sabes."
            : `Define una contraseña nueva para ${email}. Vale para todo DaleControl con este correo.`}
        </p>
      </div>

      <form className="edu-form" onSubmit={handleSubmit} noValidate>
        {error && (
          <div role="alert" className="edu-alert">
            {error}
          </div>
        )}

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-pass-nueva">
            Contraseña nueva
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-pass-nueva"
              className="edu-input"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="edu-reveal"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <span className="edu-field__hint">
            Al menos 8 caracteres, combinando mayúsculas, minúsculas y números. Distinta de la
            temporal.
          </span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-pass-repite">
            Repítela
          </label>
          <input
            id="edu-pass-repite"
            className="edu-input"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            placeholder="••••••••"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            required
          />
          {repetida.length > 0 && !coinciden && (
            <span className="edu-field__hint">Las dos contraseñas no coinciden todavía.</span>
          )}
        </div>

        <button
          type="submit"
          className="edu-btn edu-btn--primary"
          disabled={busy || !coinciden || password.length < 8}
        >
          {busy ? "Guardando…" : "Guardar y entrar"}
        </button>
      </form>

      <p className="edu-auth__foot">
        {forzado
          ? "Si no puedes completar esto, pídele a la dirección de tu instituto que te genere otra contraseña temporal."
          : "Si la olvidas, la dirección de tu instituto puede generarte una temporal nueva."}
      </p>
    </div>
  );
}
