"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import s from "../plan-tratamiento-rediseno/plan.module.css";

/**
 * «Descargar PDF» del plan de tratamiento (ws1-t12). Pide `GET /api/treatments/[id]/pdf`
 * y lo baja con el nombre que da el servidor. Aquí no se arma nada: precios, totales y
 * lo que sale o no sale (las notas nunca) los decide el servidor. Con error se queda en
 * la ventana y lo dice, en vez de abrir una pestaña con un JSON.
 */

const NOMBRE = /filename="([^"]+)"/;

export function DescargarPlanPdf({ planId, antigua = false }: {
  planId: string;
  /** Ficha sin el menú nuevo: el botón lleva la ropa de la ventana de siempre. */
  antigua?: boolean;
}) {
  const t = useT();
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    if (bajando) return;
    setBajando(true);
    setError(null);
    try {
      const r = await fetch(`/api/treatments/${encodeURIComponent(planId)}/pdf`);
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const nombre = NOMBRE.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "plan-de-tratamiento.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError(t("planTratamiento.pdf.error"));
    } finally {
      setBajando(false);
    }
  }

  return (
    <>
      {error && (
        <span
          role="alert"
          className={antigua ? "text-xs text-[var(--danger-strong)] mr-auto" : s.pdfError}
        >
          {error}
        </span>
      )}
      <button
        type="button"
        className={antigua
          ? "px-3 h-9 rounded-lg border border-border text-sm font-semibold hover:bg-muted transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] inline-flex items-center gap-1.5 disabled:opacity-50"
          : s.boton}
        onClick={descargar}
        disabled={bajando}
        aria-busy={bajando || undefined}
      >
        <Download size={14} strokeWidth={1.75} aria-hidden />
        {bajando ? t("planTratamiento.pdf.descargando") : t("planTratamiento.pdf.boton")}
      </button>
    </>
  );
}
