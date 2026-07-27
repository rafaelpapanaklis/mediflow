"use client";

import { CheckCircle2 } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useT } from "@/i18n/i18n-provider";

/**
 * Indicador de CFDI de una factura — ÚNICA fuente visual del estado fiscal.
 *
 * Nació inline en la lista de Caja (billing-client.tsx) y ahora lo comparten
 * Caja, la pestaña Facturación de la ficha del paciente y el detalle de
 * factura: los tres muestran exactamente el mismo badge/botón sin duplicar el
 * patrón. Tres estados, en este orden:
 *
 *   1. `cfdiUuid`            → badge verde ✓ "Facturado (CFDI)".
 *   2. SAT configurado       → botón "Timbrar" (solo si el caller pasa onStamp).
 *   3. SAT sin configurar    → texto neutro "SAT no configurado".
 */
interface InvoiceCfdiBadgeProps {
  /** UUID del CFDI timbrado. Si existe, manda sobre cualquier otro estado. */
  cfdiUuid?: string | null;
  /** ¿La clínica tiene Facturapi/SAT configurado? */
  facturApiEnabled?: boolean;
  /** Abre el flujo de timbrado. Sin él no se ofrece la acción (solo lectura). */
  onStamp?: () => void;
}

export function InvoiceCfdiBadge({ cfdiUuid, facturApiEnabled = false, onStamp }: InvoiceCfdiBadgeProps) {
  const t = useT();

  if (cfdiUuid) {
    return (
      <BadgeNew tone="success">
        <CheckCircle2 size={11} strokeWidth={2.5} aria-hidden />
        {t("billing.billingClient.cfdiInvoiced")}
      </BadgeNew>
    );
  }

  if (facturApiEnabled) {
    if (!onStamp) return null; // superficie de solo lectura: nada que mostrar
    return (
      <button type="button" onClick={onStamp} className="btn-new btn-new--ghost btn-new--sm">
        {t("billing.billingClient.cfdiStamp")}
      </button>
    );
  }

  return (
    <span style={{ fontSize: 10, color: "var(--text-4)" }}>
      {t("billing.billingClient.satNotConfigured")}
    </span>
  );
}
