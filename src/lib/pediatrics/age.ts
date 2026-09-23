// Pediatrics — cálculo de edad del paciente con desglose en años/meses. Spec: §1.3, §4.A.1

import type { TFunction } from "@/i18n/t";

export type AgeBreakdown = {
  years: number;
  months: number;
  decimal: number;
  totalMonths: number;
  formatted: string;
  long: string;
};

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.4375;
const MONTHS_PER_YEAR = 12;

export function calculateAge(dateOfBirth: Date, refDate: Date = new Date()): AgeBreakdown {
  const dob = new Date(dateOfBirth);
  const ref = new Date(refDate);

  let years = ref.getFullYear() - dob.getFullYear();
  let months = ref.getMonth() - dob.getMonth();
  let dayDelta = ref.getDate() - dob.getDate();

  if (dayDelta < 0) {
    months -= 1;
    const prevMonthLast = new Date(ref.getFullYear(), ref.getMonth(), 0).getDate();
    dayDelta += prevMonthLast;
  }
  if (months < 0) {
    years -= 1;
    months += MONTHS_PER_YEAR;
  }

  const totalMonths = years * MONTHS_PER_YEAR + months;
  const totalDays = Math.max(0, Math.floor((ref.getTime() - dob.getTime()) / MS_PER_DAY));
  const decimal = Math.round((totalDays / (DAYS_PER_MONTH * MONTHS_PER_YEAR)) * 100) / 100;

  return {
    years,
    months,
    decimal,
    totalMonths,
    formatted: `${years}a ${months}m`,
    long: `${years} ${years === 1 ? "año" : "años"} ${months} ${months === 1 ? "mes" : "meses"}`,
  };
}

/**
 * La edad para leerla en pantalla, en el idioma de quien la mira: «8 años
 * 3 meses» / «8 years 3 months». Sin la parte que vale cero («7 meses», «8
 * años») y con singular («1 año 1 mes»). `formatted` se queda para el texto
 * que se escribe en notas y listas, que no pasa por el diccionario.
 */
export function edadLegible(totalMonths: number, t: TFunction): string {
  const years = Math.floor(totalMonths / MONTHS_PER_YEAR);
  const months = totalMonths % MONTHS_PER_YEAR;
  const partes: string[] = [];
  if (years > 0) partes.push(t("patients.pediatrics.ageYears", { count: years }));
  if (months > 0 || years === 0) partes.push(t("patients.pediatrics.ageMonths", { count: months }));
  return partes.join(" ");
}

/**
 * Predicado puro: paciente cuenta como pediátrico si tiene DOB y la
 * edad decimal es menor al cutoff. El default 18 alinea con LGDNNA y
 * con la obligación de consentimiento parental bajo LFPDPPP. Override
 * via `cutoffYears` si la clínica lo configura distinto en
 * `PediatricRecord.cutoffOverrideYears`.
 */
export function isPediatric(dateOfBirth: Date | null, cutoffYears: number = 18): boolean {
  if (!dateOfBirth) return false;
  const { decimal } = calculateAge(dateOfBirth);
  return decimal < cutoffYears;
}
