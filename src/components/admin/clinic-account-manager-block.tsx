"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Bloque "MANAGER ASIGNADO" de la ficha de clínica en /admin (prototipo 1i/1j).
//
// Vive en el tab RESUMEN de /admin/clinics/[id] — ver el comentario de dónde se
// monta en clinic-detail-client.tsx.
//
// La tarjeta, el avatar y el selector con buscador se mudaron a
// account-manager-assign-block.tsx cuando los AFILIADOS también estrenaron
// manager de cuenta: son la MISMA pieza y sólo cambian el endpoint y la palabra
// "clínica"/"afiliado". Aquí queda únicamente la copia propia de clínicas.
// ═══════════════════════════════════════════════════════════════════════════

import { AccountManagerAssignBlock } from "./account-manager-assign-block";
import type { AccountManagerDTO } from "@/lib/account-manager/types";

interface Props {
  clinicId: string;
  /** Manager actualmente asignado (resuelto en el server). null = sin asignar. */
  initialManager: AccountManagerDTO | null;
}

export function ClinicAccountManagerBlock({ clinicId, initialManager }: Props) {
  return (
    <AccountManagerAssignBlock
      endpoint={`/api/admin/clinics/${clinicId}/account-manager`}
      initialManager={initialManager}
      subject="esta clínica"
      emptyHint="Esta clínica solo tiene soporte por tickets. Su tarjeta invita a abrir un ticket."
      removeDescription="La clínica se quedará sólo con soporte por tickets y su tarjeta volverá a invitar a abrir uno."
    />
  );
}
