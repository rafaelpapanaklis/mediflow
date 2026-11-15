/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — cómo se ESCRIBE un teléfono en pantalla.

   Un solo formateador para todo el vertical (antes había cuatro copias que
   partían 2-4-4: un cliente de Mérida salía «99 9260 2093» en
   Conversaciones; prueba de Rafael en producción, 15-nov-2026).

   México, 10 dígitos (plan de numeración del IFT):
     · lada de 3 dígitos (casi todo el país) → 3-3-4: «999 260 2093»;
     · las tres ladas de 2 dígitos (CDMX 55, Guadalajara 33, Monterrey 81)
       → 2-4-4: «55 1234 5678», como se escriben ahí.
   Otro país (con + delante, o más de 10 dígitos que no son de México) →
   «+lada» y el número en grupos: «+1 415 555 0100», «+34 600 111 222».
   Lo que no se reconoce (un número incompleto) se deja como viene.

   Puro y client-safe. La limpieza de +52 / +521 / espacios es la del dental
   (mxTenDigits, @/lib/phone-mx), importada sin tocarla.
   ═══════════════════════════════════════════════════════════════════════ */
import { mxTenDigits } from "@/lib/phone-mx";

/** Ladas de DOS dígitos en México: se escriben 2-4-4. */
export const MX_TWO_DIGIT_LADAS: readonly string[] = ["55", "33", "81"];

/**
 * Códigos de país de 1 y de 2 dígitos (plan E.164 de la UIT); todos los
 * demás son de 3. Basta para saber dónde termina la lada sin una tabla de
 * cada país.
 */
const CC_1 = ["1", "7"];
const CC_2 = [
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46",
  "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63",
  "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98",
];

/** El número nacional en grupos fáciles de dictar. */
function grupos(n: string): string {
  if (n.length === 11) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;
  if (n.length === 10) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (n.length === 9) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (n.length === 8) return `${n.slice(0, 4)} ${n.slice(4)}`;
  if (n.length === 7) return `${n.slice(0, 3)} ${n.slice(3)}`;
  const out: string[] = [];
  for (let i = 0; i < n.length; i += 3) out.push(n.slice(i, i + 3));
  // Un dígito suelto al final se pega al grupo anterior («123 4567», no «123 456 7»).
  if (out.length > 1 && out[out.length - 1].length === 1) {
    const ultimo = out.pop()!;
    out[out.length - 1] += ultimo;
  }
  return out.join(" ");
}

/** «+lada número» para un número de otro país (dígitos con su código). */
function internacional(d: string): string {
  const cc = CC_1.includes(d.slice(0, 1)) ? d.slice(0, 1) : CC_2.includes(d.slice(0, 2)) ? d.slice(0, 2) : d.slice(0, 3);
  const resto = d.slice(cc.length);
  return resto ? `+${cc} ${grupos(resto)}` : `+${cc}`;
}

export function formatBarberPhone(phone: string | null | undefined): string {
  const raw = typeof phone === "string" ? phone : "";
  if (!raw.trim()) return raw;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  // Con + y lada que no es la de México: otro país.
  if (trimmed.startsWith("+") && !digits.startsWith("52")) {
    return digits.length >= 8 ? internacional(digits) : raw;
  }
  const d = mxTenDigits(raw);
  if (d) {
    if (MX_TWO_DIGIT_LADAS.includes(d.slice(0, 2))) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }
  // Más de 10 dígitos que no son de México (llegó sin el +): otro país.
  if (digits.length > 10) return internacional(digits);
  return raw;
}
