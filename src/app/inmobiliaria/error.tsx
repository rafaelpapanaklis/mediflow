"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LA RED DE SEGURIDAD DEL PANEL DE INMUEBLES.

   🔴 POR QUÉ EXISTE DESDE EL DÍA 1: en barber la "pantalla en blanco total"
   salió exactamente de no tener esto. Cuando algo lanza durante el render,
   React sube buscando el primer límite de error y DESMONTA todo lo que está
   debajo. Si no hay ninguno, ese punto es la RAÍZ: se cae la aplicación
   entera, sidebar incluido, y no queda ni un botón para irse a otra parte.

   Y en un build de PRODUCCIÓN no hay overlay rojo: la consola de quien lo
   sufre sale limpia, sin una sola pista. Por eso el useEffect de abajo
   escribe el error a mano.

   Con este archivo, `error.tsx` sustituye SÓLO el hueco de la página: el
   layout del panel (sidebar y topbar) sigue pintado y la persona puede
   irse a Inmuebles o a Cobranza en un clic en vez de mirar el vacío.

   ── SIN DEPENDENCIAS A PROPÓSITO ──────────────────────────────────
   Ni diccionario, ni hojas de estilo, ni componentes compartidos: los
   estilos van en línea y el texto en español, el idioma por defecto del
   vertical. Una pantalla de último recurso que depende de algo que también
   puede fallar no es una pantalla de último recurso.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";

export default function ErrorInmobiliaria({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[inmobiliaria] la pantalla falló:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        maxWidth: 560,
        margin: "48px auto",
        padding: 28,
        borderRadius: 14,
        border: "1px solid rgba(20,32,26,.1)",
        background: "#F8FAF8",
        color: "#14201A",
        fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <strong style={{ display: "block", fontSize: 21, fontWeight: 650, marginBottom: 10 }}>
        No se pudo abrir esta pantalla
      </strong>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "#4c5a52", margin: "0 0 20px" }}>
        Tus inmuebles, tus contratos y tus cobros siguen exactamente donde estaban: esto solo
        afectó a esta pantalla. Vuelve a intentarlo, y si sigue igual escríbenos desde Soporte.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          background: "#2F6B4D",
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
        <p style={{ marginTop: 18, fontSize: 12, color: "#7d8a83" }}>
          Código para soporte: <code>{error.digest}</code>
        </p>
      )}
    </div>
  );
}
