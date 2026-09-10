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
 * 🔴 S-2 · Y ESTE FORMULARIO YA NO HABLA CON GoTrue. La contraseña se manda
 * a `POST /api/instituto/auth/intento`, que es quien llama a
 * `signInWithPassword` —en el servidor—, quien ve el resultado y quien
 * cuenta el fallo o el éxito. Antes autenticaba aquí y venía a DECLARAR lo
 * que había pasado (`phase: "fail" | "success"`), y como nada probaba esa
 * declaración, cualquiera bloqueaba desde internet la cuenta de la dirección
 * mandando cinco `fail`, y cualquiera se desbloqueaba a sí mismo mandando un
 * `success`. La sesión la deja puesta el endpoint, en la misma cookie de
 * siempre: para todo lo de después (`auth/session`, el panel) no cambia nada.
 *
 * ⚠️ Lo que ya NO es fail-open: si el endpoint no contesta, NO se entra. No
 * puede serlo, porque ese endpoint es ahora el que autentica. Lo que sigue
 * siendo fail-open —del lado del servidor— es el CONTADOR: si el candado no
 * responde, el intento se hace igual. Está escrito en la ruta.
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const correo = email.trim();
    try {
      // Cerrar sesión previa para evitar contaminación cross-account: la
      // cookie de Supabase es UNA para todo el dominio, y si viene de una
      // sesión de clínica la nueva se montaría encima.
      try {
        await createClient().auth.signOut();
      } catch {
        /* ignore */
      }

      // ── S-2 · EL INTENTO LO HACE EL SERVIDOR ─────────────────────────
      // Se manda correo y contraseña; el endpoint autentica contra GoTrue,
      // cuenta el fallo o el éxito y deja la cookie de sesión puesta. Un
      // 429 es el candado (IP o cuenta bloqueada); cualquier otro fallo es
      // "no entraste", y aquí NO se sigue: sin sesión no hay panel.
      const intento = await fetch("/api/instituto/auth/intento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: correo, password }),
      });
      if (intento.status === 429) {
        setError(EDU_LOGIN_MENSAJES.bloqueo);
        setLoading(false);
        return;
      }
      if (!intento.ok) {
        const fallo = (await intento.json().catch(() => null)) as { error?: string } | null;
        setError(fallo?.error || EDU_LOGIN_MENSAJES.credenciales);
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
        // La sesión la abrió el servidor hace un instante, así que el
        // cliente se construye AQUÍ: uno creado antes no habría visto la
        // cookie y `signOut()` no tendría nada que cerrar.
        try {
          await createClient().auth.signOut();
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

      // (Los contadores de fallos de esta IP y esta cuenta ya los borró el
      // endpoint del intento, que es quien vio que la contraseña era buena.)

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
