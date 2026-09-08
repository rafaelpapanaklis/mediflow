"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EDU_BRAND } from "@/lib/edu/types";
import {
  eduLoginMensaje,
  eduLoginMotivo,
  eduRutaDeVuelta,
  EDU_LOGIN_MENSAJES,
  type EduLoginMotivo,
} from "@/lib/edu/puerta-core";

/**
 * Login DEDICADO de DaleControl Institucional.
 *
 * Deliberadamente sin: precios, "crea tu cuenta", registro público ni una
 * sola liga al producto dental. A este login no se llega comprando: se
 * llega porque la dirección del instituto te dio de alta. Poner aquí un
 * "regístrate" sería mentirle a un alumno que no puede registrarse.
 *
 * 🔴 signOut() ANTES de entrar (mismo patrón que el login de clínica y el
 * de laboratorios): la cookie de Supabase es UNA para todo el dominio. Si
 * alguien viene de una sesión de clínica y no la cerramos, la sesión nueva
 * se monta encima de la anterior y getEduContext puede resolver contra el
 * usuario equivocado. Cerrar primero cuesta un round-trip y evita una
 * contaminación entre cuentas que después nadie sabe reproducir.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-153 · ESTA PUERTA CUENTA LOS INTENTOS FALLIDOS.
 *
 * Hasta esta ola no contaba ninguno: ni por IP ni por cuenta, sin bloqueo
 * y sin CAPTCHA — lo único que frenaba era el límite genérico de GoTrue. Y
 * las contraseñas que reparte este producto tienen forma PÚBLICA y conocida
 * (`Edu-XXXX-XXXY`, ~38 bits), así que la puerta giraba libre delante de
 * expedientes clínicos con nombre y apellido de paciente.
 *
 * El contador vive en el SERVIDOR (POST /api/instituto/auth/intento, sobre
 * src/lib/failban.ts, con su propio espacio de nombres `instituto-login`).
 * Aquí solo se le avisa, en tres momentos: antes de intentar, al fallar y
 * al entrar.
 *
 * ⚠️ FAIL-OPEN a propósito: solo un **429 explícito** detiene el intento.
 * Si el endpoint no contesta, o la red se cae, se entra igual. Un problema
 * de infraestructura no puede dejar a una escuela entera en la puerta —y
 * el conteo de fallos sigue siendo del servidor, así que saltarse este
 * aviso desde la consola no salta el bloqueo.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔴 H-156 · quien llega rebotado de un 401 trae `?motivo=sesion`, y ese
  // aviso se PINTA. Antes, la cajera leía "Tu sesión caducó" dentro del
  // panel, nadie la traía aquí, y al llegar por su cuenta se encontraba un
  // login mudo que no explicaba por qué la habían echado.
  const motivoUrl: EduLoginMotivo | null = eduLoginMotivo(params.get("motivo"));
  // Y a dónde vuelve al entrar. Validado (puerta-core): un `?volver=` que
  // acepte cualquier cosa es un redirect abierto.
  const volver = eduRutaDeVuelta(params.get("volver"));

  /** Avisa al contador de fallos. Nunca lanza: es best-effort. */
  async function marcar(phase: "fail" | "success", correo: string) {
    try {
      await fetch("/api/instituto/auth/intento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, email: correo }),
      });
    } catch {
      /* fail-open */
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const correo = email.trim();
    try {
      const supabase = createClient();
      // Cerrar sesión previa para evitar contaminación cross-account.
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }

      // ── H-153 · ¿esta IP o esta cuenta están bloqueadas? ──────────────
      // Solo un 429 detiene: cualquier otra cosa (500, red caída, cuerpo
      // raro) deja pasar. Ver la cabecera.
      try {
        const guard = await fetch("/api/instituto/auth/intento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "check", email: correo }),
        });
        if (guard.status === 429) {
          setError(EDU_LOGIN_MENSAJES.bloqueo);
          setLoading(false);
          return;
        }
      } catch {
        /* fail-open */
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: correo,
        password,
      });
      if (authError) {
        // Fire-and-forget: sumar el fallo no debe retrasar el mensaje.
        void marcar("fail", correo);
        setError(EDU_LOGIN_MENSAJES.credenciales);
        setLoading(false);
        return;
      }

      // La contraseña era correcta, pero eso NO quiere decir que esta cuenta
      // sea de un instituto: la cookie de Supabase es la misma para todo el
      // dominio, así que aquí puede entrar una credencial de clínica.
      // Sin esta comprobación el router de /instituto la regresaría a este
      // login sin decir una palabra y se vería como un formulario que no
      // responde. Preguntamos primero y, si no es de aquí, cerramos la
      // sesión que acabamos de abrir y lo decimos.
      const check = await fetch("/api/instituto/auth/session", { cache: "no-store" });
      const data = (await check.json().catch(() => null)) as {
        ok?: boolean;
        motivo?: string;
        error?: string;
        debeCambiar?: boolean;
      } | null;

      if (!check.ok || !data?.ok) {
        try {
          await supabase.auth.signOut();
        } catch {
          /* ignore */
        }
        // 🔴 H-158 · el mensaje sale del SERVIDOR, que es el único que sabe
        // si esta cuenta está DADA DE BAJA o si no es de ningún instituto.
        // El texto de "dada de baja" pide REACTIVAR y no "que te den de
        // alta": darla de alta otra vez crea una cuenta nueva y deja el
        // historial clínico colgando de la vieja.
        const motivo = eduLoginMotivo(data?.motivo);
        setError(data?.error || (motivo ? eduLoginMensaje(motivo) : EDU_LOGIN_MENSAJES.ajena));
        setLoading(false);
        return;
      }

      // Entró: se borran los contadores de fallos de esta IP y esta cuenta.
      void marcar("success", correo);

      // Con la temporal puesta, el panel no abre (el layout redirige): se
      // manda DIRECTO a estrenarla, sin el rebote de por medio.
      if (data.debeCambiar) {
        router.push("/instituto/cambiar-contrasena");
        return;
      }

      // H-156 · vuelve a donde la echaron, si venía de ahí. Si no,
      // /instituto es el router de entrada: resuelve el contexto y manda a
      // /instituto/inicio (o a /instituto/mi-dia si es alumno).
      router.push(volver ?? "/instituto");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo iniciar sesión.");
      setLoading(false);
    }
  }

  return (
    <div className="edu-auth__inner">
      <div className="edu-auth__mark">
        <div className="edu-sidebar__logo" aria-hidden="true">
          <GraduationCap size={19} />
        </div>
        <div>
          <div className="edu-sidebar__brandname">{EDU_BRAND.product}</div>
          <div className="edu-sidebar__brandsub">{EDU_BRAND.vertical}</div>
        </div>
      </div>

      <div>
        <h1 className="edu-auth__title">Entra a tu instituto</h1>
        <p className="edu-auth__lead">
          Usa el correo con el que te dio de alta la dirección de tu escuela.
        </p>
      </div>

      <form className="edu-form" onSubmit={handleSubmit} noValidate>
        {/* El aviso de por qué te trajeron aquí (H-156) se pinta mientras no
            haya un error más reciente: un mensaje viejo encima de uno nuevo
            se lee como si el nuevo no hubiera pasado. */}
        {!error && motivoUrl && (
          <div role="status" className="edu-alert">
            {eduLoginMensaje(motivoUrl)}
          </div>
        )}
        {error && (
          <div role="alert" className="edu-alert">
            {error}
          </div>
        )}

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-email">
            Correo electrónico
          </label>
          <input
            id="edu-email"
            className="edu-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nombre@instituto.mx"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-password">
            Contraseña
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-password"
              className="edu-input"
              type={reveal ? "text" : "password"}
              autoComplete="current-password"
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
        </div>

        <button
          type="submit"
          className="edu-btn edu-btn--primary"
          disabled={loading || !email || !password}
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <p className="edu-auth__foot">
        ¿No puedes entrar? La dirección de tu instituto da de alta las cuentas y
        restablece las contraseñas.
      </p>
    </div>
  );
}
