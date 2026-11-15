/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — cómo se ESCRIBE un teléfono en pantalla.

   Un solo formateador para todo el vertical (antes había cuatro copias que
   partían 2-4-4: un cliente de Mérida salía «99 9260 2093» en
   Conversaciones; prueba de Rafael en producción, 15-nov-2026).

   México, 10 dígitos (plan de numeración del IFT):
     · lada de 3 dígitos (casi todo el país) → 3-3-4: «999 260 2093»;
     · las tres ladas de 2 dígitos (CDMX 55, Guadalajara 33, Monterrey 81)
       → 2-4-4: «55 1234 5678», como se escriben ahí.
   Cualquier otra cosa (otro país, un número incompleto) se deja como viene.

   Puro y client-safe. La limpieza de +52 / +521 / espacios es la del dental
   (mxTenDigits, @/lib/phone-mx), importada sin tocarla.
   ═══════════════════════════════════════════════════════════════════════ */
import { mxTenDigits } from "@/lib/phone-mx";

/** Ladas de DOS dígitos en México: se escriben 2-4-4. */
export const MX_TWO_DIGIT_LADAS: readonly string[] = ["55", "33", "81"];

export function formatBarberPhone(phone: string | null | undefined): string {
  const raw = typeof phone === "string" ? phone : "";
  if (!raw.trim()) return raw;
  // Un número con lada de otro país (+1…, +34…) no se toca.
  const trimmed = raw.trim();
  if (trimmed.startsWith("+") && !trimmed.replace(/[\s-]/g, "").startsWith("+52")) return raw;
  const d = mxTenDigits(raw);
  if (!d) return raw;
  if (MX_TWO_DIGIT_LADAS.includes(d.slice(0, 2))) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
