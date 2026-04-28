export const DURATION_PRESETS_MIN = [15, 30, 45, 60, 90] as const;
export type DurationPresetMin = (typeof DURATION_PRESETS_MIN)[number];

export function defaultDurationFor(slotMinutes: number): number {
  if (slotMinutes >= 30) return slotMinutes;
  return 30;
}
