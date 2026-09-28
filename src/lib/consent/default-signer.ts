// H24 (QA ws1-t9) — pura, sin React ni Prisma.
//
// «Nuevo consentimiento» defaulteaba el profesional al usuario CONECTADO
// (casi nunca quien firma: recepción abre la carta, el doctor la firma
// después) y el representante legal salía en blanco aunque el caso ya
// tuviera un tutor registrado (Ortodoncia, responsableDelPago del caso).
// Ver consents-tab.tsx (doctorInicial) y page.tsx (labelParentesco).

export interface DoctorOption {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * El doctor tratante del caso clínico manda sobre "quien está conectado".
 * Si no hay caso, o el doctor tratante ya no está en la lista de la
 * clínica (dado de baja, de otra clínica…), cae al criterio de siempre:
 * el usuario conectado si es doctor, si no el primero de la lista.
 */
export function resolveConsentDoctorId(
  doctors: DoctorOption[],
  defaultDoctorId: string | null | undefined,
  currentUserId: string,
): string {
  if (defaultDoctorId && doctors.some((d) => d.id === defaultDoctorId)) {
    return defaultDoctorId;
  }
  if (doctors.some((d) => d.id === currentUserId)) return currentUserId;
  return doctors[0]?.id ?? "";
}

export const PARENTESCO_LABEL: Record<string, string> = {
  madre: "Madre", padre: "Padre", tutor_legal: "Tutor legal",
  abuelo: "Abuelo", abuela: "Abuela", tio: "Tío", tia: "Tía",
  hermano: "Hermano", hermana: "Hermana", otro: "Otro",
};

export function labelParentesco(p: string): string {
  return PARENTESCO_LABEL[p] ?? p;
}
