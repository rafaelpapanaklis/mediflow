// El tecleo del campo de fecha dd/mm/aaaa (`DateField`), sin React: se puede probar solo.
// C-70 (auditoría de uso): una fecha completa que no existe ya no se queda callada.

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Máscara tolerante de tecleo dd/mm/aaaa (día primero): acepta 1 o 2 dígitos
 * por segmento, autoinserta "/" y respeta los "/" que teclee el usuario.
 */
export function maskDMY(raw: string): { text: string; d: string; m: string; y: string } {
  const maxes = [2, 2, 4];
  const seg = ["", "", ""];
  let i = 0;
  for (const ch of raw) {
    if (ch === "/") {
      if (i < 2 && seg[i].length > 0) i++;
      continue;
    }
    if (ch < "0" || ch > "9") continue;
    if (seg[i].length >= maxes[i]) {
      if (i < 2) i++;
      else break;
    }
    seg[i] += ch;
  }
  const [d, m, y] = seg;
  let text = d;
  if (d.length === 2 || m.length > 0 || y.length > 0) {
    text += "/" + m;
    if (m.length === 2 || y.length > 0) text += "/" + y;
  }
  return { text, d, m, y };
}

/** Segmentos d/m/y → ISO si forman una fecha válida dentro de [min,max]. */
export function segmentsToISO(d: string, m: string, y: string, min?: string, max?: string): string | null {
  if (!d || !m || y.length !== 4) return null;
  const dd = +d, mm = +m, yy = +y;
  if (mm < 1 || mm > 12) return null;
  const dim = new Date(yy, mm, 0).getDate(); // último día del mes mm (1-based)
  if (dd < 1 || dd > dim) return null;
  const iso = `${y}-${pad2(mm)}-${pad2(dd)}`;
  if (min && iso < min) return null;
  if (max && iso > max) return null;
  return iso;
}

/**
 * Lo que hace el campo con lo tecleado:
 *   · vacío → `iso: ""` (se borra la fecha);
 *   · fecha completa y válida → su ISO;
 *   · fecha COMPLETA (año de 4 cifras) que no existe o cae fuera de rango → `iso: ""` e `invalida`: el valor
 *     anterior NO se queda guardado detrás de un texto que dice otra cosa;
 *   · a medio teclear → `iso: null` (no se toca el valor todavía).
 */
export function interpretarTecleo(raw: string, min?: string, max?: string): { text: string; iso: string | null; invalida: boolean } {
  const { text, d, m, y } = maskDMY(raw);
  if (!d && !m && !y) return { text, iso: "", invalida: false };
  const iso = segmentsToISO(d, m, y, min, max);
  if (iso) return { text, iso, invalida: false };
  if (y.length === 4) return { text, iso: "", invalida: true };
  return { text, iso: null, invalida: false };
}
