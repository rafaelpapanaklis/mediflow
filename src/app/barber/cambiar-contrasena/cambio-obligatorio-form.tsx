"use client";

import { useState, type FormEvent } from "react";
import { BarberBrandRow } from "@/components/barber/barber-registro-form";
import { Aviso, BotonCaramelo, CARAMELO, CamposNueva, Encabezado, nuevaLista } from "../restablecer/piezas";

/**
 * Formulario del cambio obligatorio. Sin «contraseña actual»: acaba de
 * entrar con la temporal (el servidor comprueba que la nueva sea distinta).
 * Al terminar entra al panel con la sesión de siempre.
 *
 * Textos en español duro, como /barber/entrar (fuera del panel no hay
 * diccionario). El servidor ya contesta en español.
 */
export function BarberCambioObligatorioForm({
  nombre,
  apiUrl,
  destino,
  loginHref,
}: {
  nombre: string;
  apiUrl: string;
  destino: string;
  loginHref: string;
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
      // Navegación dura: el panel se monta otra vez y ya sin la marca.
      window.location.href = destino;
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
