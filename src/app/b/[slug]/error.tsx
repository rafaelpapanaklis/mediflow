"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LA RED DE SEGURIDAD DE LA PÁGINA PÚBLICA DE UNA BARBERÍA.

   Aquí no hay editor ni trabajo sin guardar que perder, pero hay algo
   igual de caro: esta es la liga que la barbería manda por WhatsApp y
   pega en su bio de Instagram. Sin esta red, cualquier fallo al pintar
   —una plantilla, el JSON-LD, un dato con una forma que nadie esperaba—
   devuelve un 500 y el cliente que iba a reservar ve una pantalla de
   error del navegador.

   ── ¿PUEDE UN HORARIO MAL FORMADO LLEGAR HASTA AQUÍ? ──────────────
   Hoy no: `normalizarConfigBarberWeb` es la ÚNICA puerta entre el Json
   de `barber_landing_configs` y las plantillas, y deja siempre siete
   días bien formados o ninguno (lo fija
   components/barber/templates/__tests__/horario.test.tsx). Pero eso es
   una garantía de HOY, sostenida por una función; esta red no depende de
   ella. El patrón que tumbó el editor —un throw al pintar sin ningún
   límite de error encima— existía igual aquí.

   Sin dependencias: estilos en línea, cero componentes compartidos. Y
   sin decir nunca QUÉ falló: esto lo lee un cliente de la barbería, no
   un programador.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";

export default function ErrorPaginaBarberia({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[b/slug] la página pública de la barbería falló:", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        textAlign: "center",
        background: "#14100e",
        color: "#f7f1e8",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>
          Esta página no se pudo cargar
        </h1>
        <p style={{ opacity: 0.72, lineHeight: 1.55, marginBottom: 22 }}>
          Estamos teniendo un problema para enseñarte esta barbería. Vuelve a intentarlo en un
          momento.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            background: "#A2612F",
            color: "#fff",
            border: 0,
            padding: "13px 24px",
            borderRadius: 999,
            fontWeight: 650,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </div>
    </main>
  );
}
