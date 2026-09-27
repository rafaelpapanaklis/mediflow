"use client";

/* ═══════════════════════════════════════════════════════════════════════
   OYENTE GLOBAL DE FRAGMENTOS QUE NO CARGAN — lo que no llega a error.tsx.

   Los límites de error solo ven lo que lanza durante el render. Un
   `await import(...)` dentro de un clic, o un fragmento que falla mientras la
   página arranca, acaba como promesa rechazada o como error suelto en
   `window`: no desmonta nada, pero deja el botón muerto sin explicación.

   ── CUÁNDO RECARGA SOLO Y CUÁNDO PREGUNTA ─────────────────────────
   Aquí la pantalla NO está en blanco, así que puede haber algo a medio
   escribir (una nota clínica, un presupuesto). Si en esta página no se ha
   tecleado nada, recarga UNA vez igual que los límites de error. Si ya se
   tecleó, no recarga por su cuenta: avisa y deja el botón, para que el
   usuario guarde o copie antes.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from "react";
import toast from "react-hot-toast";
import { esErrorDeFragmento, hayRecargaEnCurso, recargarUnaVez } from "@/lib/recarga-despliegue";

const ID_AVISO = "recarga-por-despliegue";

function avisar() {
  toast(
    () => (
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span>Hay una versión nueva. Guarda lo que estés escribiendo y recarga la página.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            flexShrink: 0,
            border: 0,
            borderRadius: 8,
            padding: "6px 12px",
            background: "#0f172a",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Recargar
        </button>
      </span>
    ),
    // Mismo id: diez fragmentos fallando a la vez dejan UN aviso, no diez.
    { id: ID_AVISO, duration: Infinity },
  );
}

export function RecargaPorDespliegue() {
  useEffect(() => {
    let tecleo = false;
    const alTeclear = () => {
      tecleo = true;
    };

    const atender = (motivo: unknown) => {
      if (!esErrorDeFragmento(motivo)) return;
      // Un límite de error vio el mismo fallo y ya la pidió: no hay que avisar
      // de nada, la página se va a recargar.
      if (hayRecargaEnCurso()) return;
      if (tecleo) {
        avisar();
        return;
      }
      // Si el guardia no deja recargar (ya se recargó hace un momento y sigue
      // fallando), se avisa en vez de callar.
      if (!recargarUnaVez()) avisar();
    };

    const alError = (e: ErrorEvent) => atender(e.error ?? e.message);
    const alRechazo = (e: PromiseRejectionEvent) => atender(e.reason);

    window.addEventListener("input", alTeclear, true);
    window.addEventListener("error", alError);
    window.addEventListener("unhandledrejection", alRechazo);
    return () => {
      window.removeEventListener("input", alTeclear, true);
      window.removeEventListener("error", alError);
      window.removeEventListener("unhandledrejection", alRechazo);
    };
  }, []);

  return null;
}
