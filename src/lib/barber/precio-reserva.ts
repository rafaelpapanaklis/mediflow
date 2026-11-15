/**
 * Cómo se pinta un precio en la reserva en línea.
 *
 * Igual que la página pública (`precioBarberWeb`): los centavos salen solo si los hay.
 * Antes la reserva redondeaba a pesos enteros y un servicio de $99.99 se veía como
 * «$100» al apartar, aunque la página y el cobro decían $99.99.
 */
export function formatoPrecioReserva(locale: "es-MX" | "en-US"): { format: (n: number) => string } {
  const redondo = new Intl.NumberFormat(locale, { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const conCentavos = new Intl.NumberFormat(locale, { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
  return { format: (n) => (Math.round(n * 100) % 100 === 0 ? redondo : conCentavos).format(n) };
}
