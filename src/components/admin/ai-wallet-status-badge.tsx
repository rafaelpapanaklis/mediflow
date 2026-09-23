"use client";

import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  estadoMonedero,
  ETIQUETA_ESTADO_MONEDERO,
  TONO_ESTADO_MONEDERO,
  type MonederoResumen,
} from "@/lib/ai-billing/saldo-estado";

/**
 * La pastilla de estado de un monedero de IA: la misma en la tabla de
 * /admin/ai-billing y en la ficha de la clínica. La regla vive en
 * @/lib/ai-billing/saldo-estado; aquí solo se viste.
 */
export function AiWalletStatusBadge({ monedero }: { monedero: MonederoResumen }) {
  const estado = estadoMonedero(monedero);
  return (
    <BadgeNew tone={TONO_ESTADO_MONEDERO[estado]} dot={estado !== "sin-monedero"}>
      {ETIQUETA_ESTADO_MONEDERO[estado]}
    </BadgeNew>
  );
}
