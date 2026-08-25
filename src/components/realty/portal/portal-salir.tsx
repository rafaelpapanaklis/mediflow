"use client";

import { useMemo, useState } from "react";
import { LogOut } from "lucide-react";
import { portalT } from "@/components/realty/portal/portal-i18n";

/**
 * Cerrar sesión. Borra la cookie del portal y recarga en la raíz.
 *
 * No consulta la base: salir tiene que funcionar aunque la inmobiliaria ya
 * no exista o la base esté caída. Y si la petición falla, se navega al
 * login de todos modos — nunca dejar a alguien "adentro" porque el botón
 * de salir no respondió.
 */
export function PortalSalir({ compacto = false }: { compacto?: boolean }) {
  const t = useMemo(() => portalT(), []);
  const [ocupado, setOcupado] = useState(false);

  const salir = async () => {
    setOcupado(true);
    try {
      await fetch("/api/realty/portal/auth/session", { method: "DELETE" });
    } catch {
      /* da igual: abajo se navega igual */
    }
    window.location.href = "/i/portal";
  };

  if (compacto) {
    return (
      <button
        type="button"
        className="dcr-top__out"
        onClick={() => void salir()}
        disabled={ocupado}
        aria-label={t("sesion.salir")}
      >
        <LogOut size={15} aria-hidden="true" />
        <span>{t("nav.salir")}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="dcr-btn dcr-btn--ghost dcr-btn--block"
      onClick={() => void salir()}
      disabled={ocupado}
    >
      {ocupado ? t("sesion.saliendo") : t("sesion.salir")}
    </button>
  );
}
