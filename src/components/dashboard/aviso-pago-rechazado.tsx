"use client";

import { AlertTriangle, CreditCard, Loader2 } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { usePagarAhora } from "./pagar-ahora";

/**
 * Aviso ROJO arriba de TODO el panel mientras el cobro del plan está rechazado y el acceso sigue vivo
 * (la gracia de 24 h; ver @/lib/billing/cobro-rechazado). Lo monta el layout de /dashboard, así que sale
 * igual con el menú de siempre que con el de dos niveles, en escritorio y en celular (la fila se parte).
 *
 * Dueño o administrador de facturación: la hora de suspensión y el botón de pagar. Los demás roles: el
 * mismo aviso SIN botón y con «Avisa al dueño de la clínica» (no pueden pagar: /api/billing/portal y el
 * cambio de plan exigen dueño/admin). La hora ya llega formateada en la zona de la clínica.
 *
 * No se puede cerrar: mientras no se pague, es lo más importante de la pantalla.
 */
export function AvisoPagoRechazado({
  accesoHasta,
  puedePagar,
  plan,
}: {
  /** «20 oct 2026, 2:35 p.m.» (formato de Caja), ya en la zona de la clínica. */
  accesoHasta: string;
  puedePagar: boolean;
  plan: string | null;
}) {
  const t = useT();
  const { pagar, pagando } = usePagarAhora(plan);

  return (
    <div
      role="alert"
      data-aviso="pago-rechazado"
      className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm font-semibold"
      style={{
        background: "var(--danger-soft-strong)",
        color: "var(--danger-strong, var(--danger))",
        borderBottom: "1px solid var(--danger-border-strong)",
      }}
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
      <div className="min-w-0 flex-1" style={{ minWidth: "min(100%, 16rem)" }}>
        {t(puedePagar ? "shell.pagoRechazado.mensaje" : "shell.pagoRechazado.mensajeOtros", { fecha: accesoHasta })}
      </div>
      {puedePagar && (
        <button
          type="button"
          onClick={pagar}
          disabled={pagando}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
          style={{ background: "var(--danger-strong, var(--danger))" }}
        >
          {pagando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}
          {pagando ? t("shell.pagoRechazado.abriendo") : t("shell.pagoRechazado.cta")}
        </button>
      )}
    </div>
  );
}
