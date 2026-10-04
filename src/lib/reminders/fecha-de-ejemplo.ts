// La fecha de ejemplo de la vista previa de recordatorios (ws1-t1, tercera ronda — N-54).
//
// EL FALLO QUE CIERRA: la vista previa decía siempre «lunes 24 de junio» (y en WhatsApp «lunes 28 de abril»),
// fechas fijas que en 2026 ni siquiera caen en lunes. Ahora es MAÑANA, con el mismo formato que el envío
// («martes 6 de octubre»). Puro: recibe el instante, la zona y el idioma.

export function fechaDeEjemplo(ahora: Date, timeZone?: string | null, locale: string = "es"): string {
  const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
  const en = locale.toLowerCase().startsWith("en");
  let zona: string | undefined;
  try {
    if (timeZone) {
      new Intl.DateTimeFormat("es-MX", { timeZone });
      zona = timeZone;
    }
  } catch {
    zona = undefined;
  }
  return new Intl.DateTimeFormat(en ? "en-US" : "es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(zona ? { timeZone: zona } : {}),
  })
    .format(manana)
    .replace(",", en ? "," : "");
}
