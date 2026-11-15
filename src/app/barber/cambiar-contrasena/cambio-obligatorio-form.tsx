"use client";

import { useState, type FormEvent } from "react";
import { BARBER_ENTRAR_CORREO_KEY, BarberBrandRow } from "@/components/barber/barber-registro-form";
import { BARBER_PASSWORD_READY_PARAM } from "@/lib/barber/contrasena";
import { Aviso, BotonCaramelo, CARAMELO, CamposNueva, Encabezado, nuevaLista } from "../restablecer/piezas";

/**
 * Formulario del cambio obligatorio. Sin «contraseña actual»: acaba de
 * entrar con la temporal (el servidor comprueba que la nueva sea distinta).
 * Al terminar va a la entrada con el aviso «Listo…» (o al panel, si la
 * sesión sigue viva: la entrada lo pasa sola).
 *
 * Textos en español duro, como /barber/entrar (fuera del panel no hay
 * diccionario). El servidor ya contesta en español.
 */
export function BarberCambioObligatorioForm({
  nombre,
  apiUrl,
  loginHref,
  correo = "",
}: {
  nombre: string;
  apiUrl: string;
  loginHref: string;
  /** Correo con el que entra, para dejarlo puesto en la entrada (nunca por la URL). */
  correo?: string;
}) {
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (guardando || !nuevaLista(nueva, repetida)) return;
    setError(null);
    setGuardando(true);
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nueva, confirmacion: repetida }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        if (data?.code === "sin_sesion") {
          window.location.href = loginHref;
          return;
        }
        setError(
          res.status === 429
            ? "Demasiados intentos. Espera unos minutos y vuelve a intentarlo."
            : (data?.error ?? "No pudimos guardar tu contraseña. Inténtalo de nuevo."),
        );
        setGuardando(false);
        return;
      }
      // M4 (ronda 6): el cambio puede cerrar la sesión, y entonces /barber
      // acababa en la entrada con el formulario vacío y sin explicación (lo
      // natural era teclear otra vez la temporal). Ahora va a la entrada con
      // el aviso fijo de /barber/restablecer: si la sesión sigue viva, esa
      // página lo pasa directo al panel (`destino`); si no, dice «Listo, ya
      // puedes entrar con tu contraseña nueva» con su correo ya puesto. El
      // correo viaja por sessionStorage, igual que desde el registro: nunca
      // en la URL. Nada del servidor de contraseñas cambia.
      try {
        if (correo) window.sessionStorage.setItem(BARBER_ENTRAR_CORREO_KEY, correo);
      } catch {
        /* sin sessionStorage: el aviso sale igual y el correo se teclea */
      }
      const { name, value } = BARBER_PASSWORD_READY_PARAM;
      window.location.href = `${loginHref}?${name}=${value}`;
    } catch {
      setError("No pudimos conectar. Revisa tu internet e inténtalo de nuevo.");
      setGuardando(false);
    }
  }

  // Siempre hay salida: no es la cuenta de esta persona, o lo hace luego.
  async function salir() {
    setSaliendo(true);
    try {
      await fetch("/api/barber/auth/logout", { method: "POST" });
    } catch {
      /* igual se va a la entrada */
    }
    window.location.href = loginHref;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <BarberBrandRow />
      <Encabezado
        titulo={nombre ? `Hola, ${nombre}: pon tu contraseña` : "Pon tu contraseña"}
        texto="Entraste con una contraseña temporal. Cámbiala por una tuya para seguir; solo la vas a saber tú."
      />
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
        {guardando ? "Guardando…" : "Guardar y entrar"}
      </BotonCaramelo>
      <button
        type="button"
        onClick={salir}
        disabled={saliendo}
        style={{
          background: "none",
          border: "none",
          color: CARAMELO,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: saliendo ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {saliendo ? "Saliendo…" : "Cerrar sesión"}
      </button>
    </form>
  );
}
