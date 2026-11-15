/**
 * Mayúscula SOLO en la primera letra («Sábado, 14 de noviembre»). En español
 * no se capitalizan las palabras sueltas: `text-transform: capitalize` da
 * «Sábado, 14 De Noviembre» y «11:00 A.M.».
 */
export function upperFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}
