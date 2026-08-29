"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LA RED DE SEGURIDAD DEL PANEL DEL INSTITUTO.

   🔴 POR QUÉ EXISTE DESDE EL DÍA 1: cuando algo lanza durante el render,
   React sube buscando el primer límite de error y DESMONTA todo lo que
   está debajo. Si no hay ninguno, ese punto es la RAÍZ: se cae la
   aplicación entera —menú incluido— y no queda ni un botón para irse a
   otra parte. En este repo ya pasó una vez (barbería) y se diagnosticó
   mal durante días.

   Y en un build de PRODUCCIÓN no hay overlay rojo: la consola de quien lo
   sufre sale limpia, sin una sola pista. Por eso el useEffect de abajo
   escribe el error a mano.

   Con este archivo, error.tsx sustituye SÓLO el hueco de la pantalla: el
   layout del panel sigue pintado y la persona puede irse a otro lado en un
   clic en vez de mirar el vacío.

   ── SIN DEPENDENCIAS A PROPÓSITO ────────────────────────────────────
   Ni hoja de estilos del vertical, ni componentes compartidos, ni
   diccionario: los estilos van en línea y el texto en español. Una
   pantalla de último recurso que depende de algo que también puede fallar
   no es una pantalla de último recurso.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";

export default function ErrorInstituto({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[instituto] la pantalla falló:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        maxWidth: 560,
        margin: "40px auto",
        padding: 26,
        borderRadius: 14,
        border: "1px solid rgba(20,26,43,.12)",
        background: "#FFFFFF",
        color: "#141A2B",
        fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <strong style={{ display: "block", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
        No se pudo abrir esta pantalla
      </strong>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "#4A5468", margin: "0 0 20px" }}>
        Los datos de tu instituto siguen exactamente donde estaban: esto solo afectó a esta
        pantalla. Vuelve a intentarlo y, si sigue igual, avísale a la dirección con el código
        de abajo.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          background: "#344E8C",
          color: "#fff",
          border: 0,
          padding: "13px 24px",
          borderRadius: 999,
          fontWeight: 650,
          fontSize: 15,
          minHeight: 46,
          cursor: "pointer",
        }}
      >
        Volver a intentarlo
      </button>
      {error.digest && (
        <p style={{ marginTop: 18, fontSize: 12, color: "#67707F" }}>
          Código para soporte: <code>{error.digest}</code>
        </p>
      )}
    </div>
  );
}
