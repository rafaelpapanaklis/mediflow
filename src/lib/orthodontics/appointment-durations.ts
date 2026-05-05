// Orthodontics — sugerencia de duración de cita. SPEC §8.2.

const PATTERNS: Array<{ regex: RegExp; minutes: number; label: string }> = [
  { regex: /valoraci[oó]n ortod[oó]ntica|consulta ortod/i, minutes: 45, label: "Valoración ortodóntica" },
  { regex: /diagn[oó]stico.*ortod|estudios.*ortod/i, minutes: 60, label: "Diagnóstico + estudios" },
  { regex: /instalaci[oó]n.*brackets.*2|brackets ambas|brackets sup.*inf/i, minutes: 90, label: "Instalación brackets 2 arcadas" },
  { regex: /instalaci[oó]n.*brackets/i, minutes: 60, label: "Instalación brackets 1 arcada" },
  { regex: /alineadores.*entrega|set inicial alineadores/i, minutes: 45, label: "Entrega de alineadores set inicial" },
  { regex: /control.*cambio.*arco/i, minutes: 45, label: "Control con cambio de arco" },
  { regex: /control ortod[oó]ntico|control mensual/i, minutes: 30, label: "Control ortodóntico mensual" },
  { regex: /retiro.*brackets|retiro.*aparatolog|fin.*tratamiento.*orto/i, minutes: 60, label: "Retiro de brackets + retención" },
  { regex: /control.*retenci[oó]n/i, minutes: 20, label: "Control de retención" },
];

export function suggestOrthoAppointmentDuration(
  reason: string,
): { minutes: number; label: string } | null {
  if (!reason) return null;
  for (const p of PATTERNS) {
    if (p.regex.test(reason)) {
      return { minutes: p.minutes, label: p.label };
    }
  }
  return null;
}
