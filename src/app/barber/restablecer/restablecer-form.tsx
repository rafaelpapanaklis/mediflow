"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { BarberBrandRow } from "@/components/barber/barber-registro-form";
import { Aviso, BotonCaramelo, CARAMELO, CamposNueva, Encabezado, nuevaLista } from "./piezas";

/**
 * Paso 2 de «Olvidé mi contraseña» en Barber.
 *
 * La pantalla ya NO cambia la contraseña desde el navegador (revisión ronda 7,
 * M1): eso servía con cualquier sesión abierta. Manda la nueva a
 * POST /barber/restablecer/guardar, que exige la cookie firmada del enlace de
 * recuperación, cambia la de ese usuario, quita la marca de la temporal (M3),
 * borra la cookie y cierra la sesión de recuperación. Después, /barber/entrar
 * con «Listo, ya puedes entrar».
 *
 * La página del servidor ya comprobó la cookie antes de pintar esto; si
 * caduca mientras se escribe, el servidor contesta `enlace_invalido` y se
 * ofrece pedir otro.
 */
export function BarberRestablecerForm({
  enlaceValido,
  guardarUrl,
  recuperarHref,
  loginHref,
  loginListoHref,
}: {
  /** false = /api/barber/auth/confirmar regresó con ?error= (caducado o ya usado). */
  enlaceValido: boolean;
  guardarUrl: string;
  recuperarHref: string;
  loginHref: string;
  loginListoHref: string;
}) {
  const [invalido, setInvalido] = useState(!enlaceValido);
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (guardando || !nuevaLista(nueva, repetida)) return;
    setError(null);
    setGuardando(true);
    try {
      const res = await fetch(guardarUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nueva, confirmacion: repetida }),
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        if (data?.code === "enlace_invalido") {
          setInvalido(true);
        } else {
          setError(data?.error ?? "No pudimos guardar la contraseña. Inténtalo de nuevo.");
        }
        setGuardando(false);
        return;
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

  if (invalido) {
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
