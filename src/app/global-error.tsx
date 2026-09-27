"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LÍMITE DE ERROR GLOBAL — lo que atrapa cuando falla el propio layout raíz.

   🔴 POR QUÉ: `error.tsx` se pinta DENTRO del layout raíz, así que no puede
   atrapar un fallo del layout mismo. Sin este archivo ese caso era la pantalla
   en blanco de Next, sin salida. Este SUSTITUYE al layout: por eso trae su
   propio <html> y <body>, y por eso no usa globals.css, fuentes ni
   diccionario — nada de eso está cargado cuando esto se pinta.

   Igual que `error.tsx`: si lo que falló fue cargar un fragmento de JS (la
   pestaña tiene la versión anterior a un despliegue), recarga UNA vez.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import { ESPERA_RECARGA_MS, asegurarRecarga, seVaARecargar } from "@/lib/recarga-despliegue";

const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [seRecarga, setSeRecarga] = useState(() => seVaARecargar(error));
  const pidioRecarga = useRef(false);

  useEffect(() => {
    console.error("[app] error en el layout raíz:", error);
    // Mismo cuidado que en error.tsx: el efecto doble de desarrollo no cuenta
    // como recarga fallida, y si la recarga no ocurre se enseña la tarjeta.
    if (pidioRecarga.current) return;
    if (asegurarRecarga(error)) {
      pidioRecarga.current = true;
      setTimeout(() => setSeRecarga(false), ESPERA_RECARGA_MS);
    } else {
      setSeRecarga(false);
    }
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#f8fafc", color: "#0f172a", fontFamily: FUENTE }}>
        {seRecarga ? (
          <div
            role="status"
            style={{
              minHeight: "100vh",
              display: "grid",
              placeItems: "center",
              padding: 24,
              fontSize: 15,
              color: "#475569",
            }}
          >
            Actualizando a la versión más reciente…
          </div>
        ) : (
          <div
            role="alert"
            style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}
          >
            <div
              style={{
                maxWidth: 520,
                width: "100%",
                boxSizing: "border-box",
                textAlign: "center",
                background: "#ffffff",
                border: "1px solid rgba(15,23,42,.10)",
                borderRadius: 16,
                padding: 32,
                boxShadow: "0 12px 32px -16px rgba(15,23,42,.25)",
              }}
            >
              <strong style={{ display: "block", fontSize: 21, fontWeight: 650, marginBottom: 10 }}>
                No se pudo mostrar esta pantalla
              </strong>
              <p style={{ fontSize: 15, lineHeight: 1.55, color: "#475569", margin: "0 0 22px" }}>
                Tu información está a salvo: esto solo afectó a lo que se estaba pintando. Vuelve a
                intentarlo y, si sigue igual, escríbenos desde Soporte con el código de abajo.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    background: "#0f172a",
                    color: "#fff",
                    border: 0,
                    padding: "12px 22px",
                    borderRadius: 999,
                    fontWeight: 650,
                    fontSize: 15,
                    fontFamily: FUENTE,
                    cursor: "pointer",
                  }}
                >
                  Volver a intentarlo
                </button>
                {/* <a> y no <Link>: navegación dura, que vuelve a pedir el layout
                    raíz entero en vez de reusar el que acaba de fallar. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/"
                  style={{
                    padding: "12px 22px",
                    borderRadius: 999,
                    fontWeight: 650,
                    fontSize: 15,
                    color: "#0f172a",
                    border: "1px solid rgba(15,23,42,.16)",
                    textDecoration: "none",
                  }}
                >
                  Ir al inicio
                </a>
              </div>
              {error.digest && (
                <p style={{ marginTop: 20, fontSize: 12, color: "#64748b" }}>
                  Código para soporte: <code>{error.digest}</code>
                </p>
              )}
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
