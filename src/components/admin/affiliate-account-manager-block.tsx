"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Bloque "MANAGER ASIGNADO" de la ficha de AFILIADO en /admin.
//
// Espejo del de clínicas: comparte tarjeta, avatar y selector con buscador vía
// account-manager-assign-block.tsx. Lo único propio es el endpoint
// (/api/admin/affiliates/[id]/account-manager) y la copia — a un afiliado se le
// asigna manager para que tenga a quién escribirle por sus comisiones, no por
// soporte del expediente.
// ═══════════════════════════════════════════════════════════════════════════

import { AccountManagerAssignBlock } from "./account-manager-assign-block";
import type { AccountManagerDTO } from "@/lib/account-manager/types";

interface Props {
  affiliateId: string;
  /** Manager actualmente asignado (resuelto en el server). null = sin asignar. */
  initialManager: AccountManagerDTO | null;
}

export function AffiliateAccountManagerBlock({ affiliateId, initialManager }: Props) {
  return (
    <AccountManagerAssignBlock
      endpoint={`/api/admin/affiliates/${affiliateId}/account-manager`}
      initialManager={initialManager}
      subject="este afiliado"
      emptyHint="Este afiliado solo tiene soporte por tickets. Asígnale un manager para que tenga a quién escribirle por WhatsApp."
      removeDescription="El afiliado se quedará sólo con soporte por tickets y dejará de ver los datos de contacto de su manager."
    />
  );
}
