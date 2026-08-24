"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LA RED DE SEGURIDAD DE /barber/mi-web.

   El cortafuegos fino vive pegado a la plantilla
   (components/barber/landing/limite-error.tsx) y es el que salva el
   trabajo sin publicar: un fallo al PINTAR la vista previa se queda
   dentro del marco y la barbería sigue editando.

   Esto es la red de abajo, para todo lo demás: un fallo en los controles,
   en el diccionario, en el guardado. Sin ella, un throw en esta pantalla
   sube hasta la raíz —en toda la app NO hay ningún otro `error.tsx`— y
   React desmonta el árbol entero: pantalla en blanco, sin sidebar y sin
   una sola línea en la consola de quien lo sufre.

   Con ella, `error.tsx` sustituye SÓLO el hueco de la página: el layout
   del panel (sidebar y topbar) sigue pintado, así que la barbería puede
   irse a Agenda o a Caja en un clic en vez de quedarse mirando el vacío.

   ── SIN DEPENDENCIAS A PROPÓSITO ──────────────────────────────────
   Ni diccionario, ni hojas de estilo, ni componentes compartidos: los
   estilos van en línea. Una pantalla de último recurso que depende de
   algo que también puede fallar no es una pantalla de último recurso.
   Por eso el texto está escrito aquí en español, el idioma por defecto
   del vertical, y no pasa por `t()`.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";

export default function ErrorMiWeb({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // El bug que motivó todo esto no dejaba rastro en la consola. Aquí sí.
    console.error("[barber/mi-web] la pantalla del editor falló:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        maxWidth: 560,
        margin: "48px auto",
        padding: 28,
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,.1)",
        background: "#fdfaf6",
        color: "#14100e",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <strong style={{ display: "block", fontSize: 21, fontWeight: 650, marginBottom: 10 }}>
        No se pudo abrir el editor de tu página
      </strong>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "#5c5049", margin: "0 0 20px" }}>
        Tu página web sigue publicada tal y como estaba: esto sólo afectó a la pantalla para
        editarla. Vuelve a intentarlo, y si sigue igual escríbenos desde Soporte.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          background: "#A2612F",
          color: "#fff",
          border: 0,
          padding: "12px 22px",
          borderRadius: 999,
          fontWeight: 650,
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        Volver a intentarlo
      </button>
      {error.digest && (
        <p style={{ marginTop: 18, fontSize: 12, color: "#8a7a70" }}>
          Código para soporte: <code>{error.digest}</code>
        </p>
      )}
    </div>
  );
}
