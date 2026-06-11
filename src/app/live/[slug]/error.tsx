"use client";

/**
 * Error boundary de segmento (convención App Router) para /live/[slug].
 *
 * Next.js monta este componente cuando la página o cualquier hijo lanza un
 * error de cliente no atrapado por un boundary más cercano. Reemplaza el
 * "Application error: a client-side exception has occurred" pelón por una
 * tarjeta amable con botón de reintento. Es la red de seguridad final: el
 * render normal ya sanea los datos para no llegar aquí, pero si algo se
 * escapa, la TV de sala de espera muestra algo presentable, no una pantalla
 * en blanco.
 */

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import liveStyles from "./live-public.module.css";

export default function LiveError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Visible en la consola del navegador para diagnóstico del admin.
    console.error("[/live error boundary]", error);
  }, [error]);

  return (
    <div className={liveStyles.errorWrap}>
      <div className={liveStyles.errorCard}>
        <AlertCircle size={32} aria-hidden style={{ color: "#EF4444" }} />
        <h1>No se pudo mostrar la vista en vivo</h1>
        <p>
          Ocurrió un problema al dibujar el plano. Reintenta; si el problema
          persiste, el administrador de la clínica puede reabrir el editor en{" "}
          <code>/dashboard/clinic-layout</code> y volver a guardar el plano.
        </p>
        <button type="button" className={liveStyles.errorBtn} onClick={() => reset()}>
          Reintentar
        </button>
      </div>
    </div>
  );
}
