"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LÍMITE DE ERROR DE LA WEB PÚBLICA DE INMUEBLES (/i/[slug]).

   Aquí el que mira NO es el cliente de DaleControl: es alguien que llegó
   por Google o por un anuncio buscando una casa. Si esta pantalla se cae
   sin límite, ve un blanco absoluto y se va — y la inmobiliaria pierde un
   prospecto sin enterarse nunca de que existió.

   Por eso el texto NO habla de errores técnicos ni pide reintentar en la
   consola: ofrece el único camino que le sirve a un visitante (volver a
   cargar) y no lo culpa de nada. Sin marca de "algo salió mal en el
   sistema": eso es información nuestra, no suya.

   SIN DEPENDENCIAS a propósito (estilos en línea, texto en duro): una
   pantalla de último recurso no puede depender de nada que también falle.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";

export default function ErrorWebPublica({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/i] la página pública falló:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#F5F1E8",
        color: "#14201A",
        fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <strong style={{ display: "block", fontSize: 22, fontWeight: 650, marginBottom: 10 }}>
          Esta página no se pudo mostrar
        </strong>
        <p style={{ fontSize: 15.5, lineHeight: 1.55, color: "#4c5a52", margin: "0 0 22px" }}>
          Vuelve a cargarla en un momento. Si buscabas un inmueble en particular, el anuncio
          sigue publicado.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            background: "#2F6B4D",
            color: "#fff",
            border: 0,
            padding: "13px 26px",
            borderRadius: 999,
            fontWeight: 650,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Volver a cargar
        </button>
        {error.digest && (
          <p style={{ marginTop: 18, fontSize: 12, color: "#7d8a83" }}>
            Referencia: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
