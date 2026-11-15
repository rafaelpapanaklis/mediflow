/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — la fecha corta de las pantallas («15-nov, 12:30 a.m.»).

   UNA sola función para los formateadores de las pantallas (admin-ui,
   whatsapp/ui, el bot). Con `timeZone` —la zona de la barbería— el texto es
   el MISMO en el servidor y en el navegador. Sin ella, el servidor (UTC en
   Vercel) y el navegador (hora de México) escribían horas distintas y React
   tiraba el HTML del servidor: «Minified React error #418» en WhatsApp, Bot y
   Soporte, también en producción (QA C, 15-nov-2026). Sin `timeZone` se
   comporta como antes (zona de quien la ejecuta).

   Pura y client-safe.
   ═══════════════════════════════════════════════════════════════════════ */
export function formatBarberShortWhen(iso: string, locale: string, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}
