"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LÍMITE DE ERROR DEL PORTAL DEL CLIENTE.

   Existe aparte del de /i (la web pública) porque el texto de aquél habla
   de anuncios de inmuebles: "el anuncio sigue publicado" no significa nada
   para alguien que entró a ver cuánto debe de renta.

   Quien mira esto es un inquilino o un propietario en su celular. No sabe
   qué es un stack trace y no le sirve saberlo. Se le ofrece lo único que
   puede hacer —volver a cargar— y una salida al login por si lo que se
   rompió fue su sesión.

   SIN DEPENDENCIAS a propósito: estilos en línea y texto en duro. Una
   pantalla de último recurso no puede depender del diccionario, del CSS ni
   de un componente que también podrían estar fallando.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";

export default function ErrorPortal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/i/portal] el portal falló:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "70vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#F5F1E8",
        color: "#14201A",
        fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <strong style={{ display: "block", fontSize: 21, fontWeight: 650, marginBottom: 10 }}>
          No pudimos cargar esto
        </strong>
        <p style={{ fontSize: 15.5, lineHeight: 1.55, color: "#46524b", margin: "0 0 22px" }}>
          Vuelve a intentar en un momento. Tu información sigue guardada.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            background: "#2F6B4D",
            color: "#fff",
            border: 0,
            padding: "14px 28px",
            borderRadius: 12,
            fontWeight: 650,
            fontSize: 16,
            cursor: "pointer",
            width: "100%",
            maxWidth: 320,
          }}
        >
          Volver a cargar
        </button>
        <p style={{ marginTop: 16 }}>
          <a
            href="/i/portal"
            style={{ fontSize: 14.5, color: "#27543E", fontWeight: 600 }}
          >
            Entrar de nuevo con mi WhatsApp
          </a>
        </p>
        {error.digest ? (
          <p style={{ marginTop: 18, fontSize: 12, color: "#7d8a83" }}>
            Referencia: <code>{error.digest}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
