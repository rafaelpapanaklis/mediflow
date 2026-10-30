"use client";

import { useT } from "@/i18n/i18n-provider";
import { cerrarSesionPanel } from "@/lib/auth/cerrar-sesion-panel";

/**
 * «Cerrar sesión» de las barreras del 2FA (reto y enrolamiento obligatorio).
 * Ninguna barrera deja a la persona sin salida (repaso iPad ws1-t1, M3): sin el
 * teléfono ni los códigos de recuperación, cerrar la pestaña no servía —
 * `/login` la devolvía al reto porque la sesión seguía viva. Mismo cierre y
 * mismo aspecto que el de «Esta sede tiene clave».
 */
export function CerrarSesionBarrera({ origen }: { origen: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => cerrarSesionPanel(origen)}
      className="btn-new btn-new--ghost"
      style={{ width: "100%", height: 36, justifyContent: "center", fontSize: 12, color: "var(--text-3)" }}
    >
      {t("sedeClave.pantalla.cerrarSesion")}
    </button>
  );
}
