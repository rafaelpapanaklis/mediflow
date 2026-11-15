"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { leerErrorContrasena } from "@/lib/auth/errores-contrasena";
import { BarberBrandRow } from "@/components/barber/barber-registro-form";
import { Aviso, BotonCaramelo, CARAMELO, CamposNueva, Encabezado, nuevaLista } from "./piezas";

type Estado = "revisando" | "lista" | "invalido";

/**
 * Paso 2 de «Olvidé mi contraseña» en Barber. Mismo mecanismo que
 * /reset-password del dental: se llega con la sesión de recuperación YA en
 * cookies (la dejó /api/barber/auth/confirmar) y la contraseña se cambia con
 * supabase.auth.updateUser desde el navegador. Sin sesión → el enlace
 * caducó → ofrecer otro.
 *
 * Al terminar cierra la sesión de recuperación y manda a /barber/entrar con
 * «Listo, ya puedes entrar» (no al inicio de sesión de las clínicas).
 */
export function BarberRestablecerForm({
  errorEnUrl,
  recuperarHref,
  loginHref,
  loginListoHref,
}: {
  /** /api/barber/auth/confirmar regresó con ?error=: enlace caducado o ya usado. */
  errorEnUrl: boolean;
  recuperarHref: string;
  loginHref: string;
  loginListoHref: string;
}) {
  const [estado, setEstado] = useState<Estado>(errorEnUrl ? "invalido" : "revisando");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ¿Hay sesión de recuperación? También cubre el error que Supabase manda
  // en el HASH (#error_code=otp_expired): el servidor nunca lo ve.
  useEffect(() => {
    if (estado === "invalido") return;
    if (typeof window !== "undefined" && window.location.hash.includes("error")) {
      setEstado("invalido");
      return;
    }
    let cancelado = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelado) setEstado(data.user ? "lista" : "invalido");
      })
      .catch(() => {
        if (!cancelado) setEstado("invalido");
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (guardando || !nuevaLista(nueva, repetida)) return;
    setError(null);
    setGuardando(true);
    try {
      const supabase = createClient();
      const { error: fallo } = await supabase.auth.updateUser({ password: nueva });
      if (fallo) {
        const deContrasena = leerErrorContrasena(fallo);
        if (deContrasena?.motivo === "igual") {
          setError("La contraseña nueva tiene que ser distinta de la anterior.");
        } else if (deContrasena) {
          setError(deContrasena.mensaje);
        } else if (/session/i.test(fallo.message ?? "")) {
          setEstado("invalido");
        } else {
          setError("No pudimos guardar la contraseña. Inténtalo de nuevo.");
        }
        setGuardando(false);
        return;
      }
      // Igual que el dental: se cierra la sesión de recuperación y se entra limpio.
      try {
        await supabase.auth.signOut();
      } catch {
        /* no importa: la entrada pide la contraseña igual */
      }
      window.location.href = loginListoHref;
    } catch {
      setError("No pudimos conectar. Revisa tu internet e inténtalo de nuevo.");
      setGuardando(false);
    }
  }

  const volver = (
    <p style={{ fontSize: 12.5, color: "var(--ld-fg-muted)", margin: 0, textAlign: "center" }}>
      <Link href={loginHref} style={{ color: CARAMELO, fontWeight: 600, textDecoration: "none" }}>
        ← Volver a entrar
      </Link>
    </p>
  );

  const encabezado = (
    <>
      <BarberBrandRow />
      <Encabezado titulo="Pon tu contraseña nueva" texto="Con ella vas a entrar a tu barbería de aquí en adelante." />
    </>
  );

  if (estado === "revisando") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {encabezado}
        <p style={{ fontSize: 13, color: "var(--ld-fg-muted)", textAlign: "center", margin: "16px 0" }}>
          Revisando tu enlace…
        </p>
      </div>
    );
  }

  if (estado === "invalido") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }} data-barber-restablecer="invalido">
        {encabezado}
        <Aviso tono="error">
          <strong>Este enlace ya no sirve.</strong> Caducan por seguridad y solo vale el más reciente. Pide otro y
          ábrelo en este mismo navegador.
        </Aviso>
        <Link
          href={recuperarHref}
          style={{
            height: 44,
            borderRadius: 10,
            background: CARAMELO,
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          Pedir otro enlace
        </Link>
        {volver}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {encabezado}
      {error && <Aviso tono="error">{error}</Aviso>}
      <CamposNueva
        nueva={nueva}
        repetida={repetida}
        onNueva={setNueva}
        onRepetida={setRepetida}
        tocado={tocado}
        onTocar={() => setTocado(true)}
      />
      <BotonCaramelo disabled={!nuevaLista(nueva, repetida)} ocupado={guardando}>
        {guardando ? "Guardando…" : "Guardar contraseña"}
      </BotonCaramelo>
      {volver}
    </form>
  );
}
