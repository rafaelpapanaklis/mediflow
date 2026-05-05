// Periodontics — sugerencia de duración de cita según el motivo. SPEC §10.

const PATTERNS: Array<{ regex: RegExp; minutes: number; label: string }> = [
  // Sondaje (cualquier mención)
  { regex: /sondaje|periodontograma|periodontogram/i, minutes: 50, label: "Sondaje completo" },
  // Raspado y alisado
  { regex: /srp|raspado|alisado/i, minutes: 60, label: "SRP por cuadrante" },
  // Cirugía periodontal — palabras clave
  { regex: /cirug[ií]a|colgajo|injerto|rtg|gingivectom/i, minutes: 90, label: "Cirugía periodontal" },
  // Reevaluación
  { regex: /reevaluaci[oó]n|reevaluac/i, minutes: 45, label: "Reevaluación post-tratamiento" },
  // Mantenimiento
  { regex: /mantenimiento periodontal|recall periodontal/i, minutes: 45, label: "Mantenimiento periodontal" },
];

export function suggestPerioAppointmentDuration(reason: string):
  | { minutes: number; label: string }
  | null {
  if (!reason) return null;
  for (const p of PATTERNS) {
    if (p.regex.test(reason)) {
      return { minutes: p.minutes, label: p.label };
    }
  }
  return null;
}
