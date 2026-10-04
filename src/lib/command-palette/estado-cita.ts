// ws1-t1 (tercera ronda — N-41): en Ctrl K una cita cancelada salía igual que una viva. Solo los estados que
// cambian lo que hace recepción con la cita se dicen; para el resto, nada (la fecha y el doctor bastan). Puro.
export function etiquetaDeEstadoEnBusqueda(status: string | null | undefined, locale: string = "es"): string | null {
  const en = locale.toLowerCase().startsWith("en");
  if (status === "CANCELLED") return en ? "Cancelled" : "Cancelada";
  if (status === "NO_SHOW") return en ? "No-show" : "No asistió";
  return null;
}
