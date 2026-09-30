"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarX, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

const CLAVE_CERRADO = "dc_aviso_google_caido_cerrado";

/**
 * Aviso para quien administra la clínica cuando Google ya no acepta la conexión
 * de Google Calendar (token revocado/caducado): las citas nuevas dejan de
 * copiarse y hasta hoy nadie se enteraba. Solo se pinta para ADMIN/SUPER_ADMIN
 * (los demás no pueden reconectar) y solo si `/api/google/estado` dice «caido».
 *
 * Se cierra por sesión del navegador, no para siempre: reaparece en la
 * siguiente sesión mientras siga caído. Cualquier fallo de la consulta = sin aviso.
 */
export function AvisoGoogleCaido({ esAdmin }: { esAdmin: boolean }) {
  const t = useT();
  const [caido, setCaido] = useState(false);

  useEffect(() => {
    if (!esAdmin) return;
    try { if (window.sessionStorage.getItem(CLAVE_CERRADO) === "1") return; } catch {}
    let vivo = true;
    fetch("/api/google/estado")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.estado === "caido") setCaido(true); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [esAdmin]);

  if (!esAdmin || !caido) return null;

  return (
    <div
      role="alert"
      className="flex-shrink-0 flex items-center gap-3 px-4 py-2 text-sm font-semibold"
      style={{ background: "var(--danger-soft-strong)", color: "var(--danger-strong, var(--danger))", borderBottom: "1px solid var(--danger-border-strong)" }}
    >
      <CalendarX className="w-4 h-4 flex-shrink-0" aria-hidden />
      <div className="flex-1">
        {t("settings.client.gcalBannerText")}{" "}
        <Link href="/dashboard/settings?tab=integraciones" className="underline">
          {t("settings.client.gcalBannerAction")}
        </Link>
      </div>
      <button
        type="button"
        onClick={() => {
          setCaido(false);
          try { window.sessionStorage.setItem(CLAVE_CERRADO, "1"); } catch {}
        }}
        className="flex-shrink-0 p-1 rounded hover:bg-black/10 transition-colors"
        aria-label={t("shell.announcementBanner.dismiss")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
