"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EDU_BRAND } from "@/lib/edu/types";

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
 */
export function EduLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      // Cerrar sesión previa para evitar contaminación cross-account.
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError("Correo o contraseña incorrectos.");
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
      const data = (await check.json().catch(() => null)) as { ok?: boolean } | null;
      if (!check.ok || !data?.ok) {
        try {
          await supabase.auth.signOut();
        } catch {
          /* ignore */
        }
        setError(
          "Esta cuenta no pertenece a ningún instituto. Pide a la dirección de tu escuela que te dé de alta.",
        );
        setLoading(false);
        return;
      }

      // /instituto es el router de entrada: resuelve el contexto y manda a
      // /instituto/inicio.
      router.push("/instituto");
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
