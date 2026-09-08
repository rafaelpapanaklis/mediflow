"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, KeyRound, Minus } from "lucide-react";
import { EDU_BRAND } from "@/lib/edu/types";
import {
  EDU_PASSWORD_AYUDA,
  EDU_PASSWORD_MIN,
  eduPasswordCheck,
} from "@/lib/edu/puerta-core";

/**
 * Un renglón de la lista de requisitos. En VERDE cuando ya se cumple y en
 * gris cuando no — nunca en rojo: no es un error, es algo que todavía no
 * está, y pintar de rojo lo que la persona aún está tecleando la regaña por
 * ir a mitad de camino.
 *
 * El icono NO es lo único que distingue (una palomita y una raya se
 * parecen a través de una pantalla mala): cambia también el color y el
 * peso, y el texto se lee igual sin ver ninguno de los dos.
 */
function renglon(cumple: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: cumple ? "#14612f" : "var(--edu-text-3)",
    fontWeight: cumple ? 600 : 400,
  };
}

function marca(cumple: boolean) {
  return cumple ? (
    <Check size={14} aria-hidden="true" />
  ) : (
    <Minus size={14} aria-hidden="true" />
  );
}

/**
 * El formulario de /instituto/cambiar-contrasena (P2-9).
 *
 * QUÉ DECIDE Y QUÉ NO:
 *  · NO decide si la contraseña es buena: la regla es del servidor. Lo que
 *    sí hace —y es el arreglo del H-161— es aplicar EXACTAMENTE LA MISMA
 *    función que el endpoint (`eduPasswordCheck`, src/lib/edu/puerta-core.ts)
 *    para poder decir en el momento qué falta, en vez de mandar a validar de
 *    viaje y contestar con una frase distinta de la que pinta la ayuda.
 *  · NO guarda nada: ni la vieja ni la nueva quedan en ningún estado más
 *    tiempo del que dura la petición.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-161 · LA AYUDA DECÍA UNA REGLA Y EL SERVIDOR APLICABA OTRA.
 *
 * El texto pedía «mayúsculas, minúsculas y números» y el endpoint aceptaba
 * `contrasenita`: doce minúsculas seguidas. No es una errata de copy — es
 * la clase de desfase por el que una persona cree que le están exigiendo
 * una contraseña fuerte y no se la están exigiendo, y por el que otra se
 * pelea diez minutos con un campo que ya habría aceptado lo que escribió.
 *
 * La regla NO se endureció (es la misma de todo DaleControl, y cambiarla
 * solo aquí dejaría al instituto pidiendo una cosa y al resto otra): lo que
 * se hizo fue mudarla a UN sitio y hacer que la pantalla la diga entera,
 * con las tres alternativas marcándose solas según se teclea. Lo que se ve
 * es lo que se aplica.
 * ═══════════════════════════════════════════════════════════════════════
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
  // 🔴 La MISMA función que corre en el endpoint. Si fueran dos, volverían
  // a divergir — que es literalmente el hallazgo.
  const regla = useMemo(() => eduPasswordCheck(password), [password]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !coinciden) return;
    // El servidor lo vuelve a comprobar; esto evita el viaje y, sobre todo,
    // evita que el motivo del "no" llegue redactado de otra manera.
    if (!regla.ok) {
      setError(regla.motivo);
      return;
    }
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
          {/* 🔴 H-161 · la ayuda ES la regla: sale de la misma constante que
              el mensaje de error del endpoint. Y las tres alternativas se
              marcan solas, para que quien no entienda la frase vea cuál le
              falta. */}
          <span className="edu-field__hint">{EDU_PASSWORD_AYUDA} Y distinta de la temporal.</span>
          {/* Sin clase propia: los estilos van en línea porque son tres
              renglones de una sola pantalla, y edu-theme.css es una hoja
              compartida por todo el vertical — una clase nueva ahí es un
              nombre que otra ola puede volver a usar sin saberlo. */}
          <ul
            style={{
              listStyle: "none",
              margin: "6px 0 0",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <li style={renglon(regla.largoOk)}>
              {marca(regla.largoOk)} {EDU_PASSWORD_MIN} caracteres o más
            </li>
            <li style={{ fontSize: 12, color: "var(--edu-text-3)", marginTop: 2 }}>
              Y una de estas tres:
            </li>
            {regla.alternativas.map((a) => (
              <li key={a.clave} style={{ ...renglon(a.cumple), paddingLeft: 10 }}>
                {marca(a.cumple)} {a.texto}
              </li>
            ))}
          </ul>
          {regla.demasiadoLarga && (
            <span className="edu-field__hint" role="alert">
              {regla.motivo}
            </span>
          )}
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
          disabled={busy || !coinciden || !regla.ok}
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
