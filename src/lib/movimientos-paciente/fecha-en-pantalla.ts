/**
 * La hora de un movimiento en pantalla: en la zona de la CLÍNICA (`zona`, que
 * manda la API), no en la del navegador. Así el mismo movimiento se lee igual en
 * pantalla, en el CSV y en el PDF (ws1-t9: 02:16 p. m. en pantalla contra 12:16
 * en el CSV). Sin `zona` cae a la del navegador; una zona inválida no rompe.
 */
export function fechaEnPantalla(iso: string, zona?: string): string {
  const opciones: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("es-MX", zona ? { ...opciones, timeZone: zona } : opciones).format(new Date(iso));
  } catch {
    try {
      return new Intl.DateTimeFormat("es-MX", opciones).format(new Date(iso));
    } catch {
      return iso;
    }
  }
}
