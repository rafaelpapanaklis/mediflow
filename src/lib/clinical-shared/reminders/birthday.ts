// Clinical-shared — helpers de fechas para recordatorios de cumpleaños.

/**
 * Devuelve la próxima fecha del cumpleaños del paciente >= reference.
 * Trabaja en UTC para que las fechas sean estables sin importar el TZ
 * del runtime (Vercel cron corre en UTC). Maneja 29-feb cayendo en años
 * no bisiestos como 28-feb del año target.
 */
export function nextBirthday(dob: Date, reference: Date): Date {
  const month = dob.getUTCMonth();
  const day = dob.getUTCDate();
  let year = reference.getUTCFullYear();
  let candidate = makeUtcDate(year, month, day);
  if (candidate.getTime() < reference.getTime()) {
    year++;
    candidate = makeUtcDate(year, month, day);
  }
  return candidate;
}

function makeUtcDate(year: number, month: number, day: number): Date {
  // 29-feb en año no bisiesto se desplaza a 28-feb.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

/**
 * Calcula la edad cumpleaños que el paciente cumplirá en `target`.
 */
export function ageOnBirthday(dob: Date, target: Date): number {
  return target.getUTCFullYear() - dob.getUTCFullYear();
}
