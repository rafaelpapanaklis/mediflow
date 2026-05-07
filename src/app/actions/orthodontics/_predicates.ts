// Orthodontics — predicates puros (sin imports server-only). Se cargan desde
// los server actions Y desde los tests unitarios. NO reexportar desde el
// barrel; los tests importan directo desde este archivo.

/**
 * SOAP completo: requiere los 4 campos no vacíos tras trim. Regla SPEC §D
 * para firma de Treatment Card.
 */
export function canSignSoap(soap: {
  s: string;
  o: string;
  a: string;
  p: string;
}): boolean {
  return (
    soap.s.trim().length > 0 &&
    soap.o.trim().length > 0 &&
    soap.a.trim().length > 0 &&
    soap.p.trim().length > 0
  );
}

/**
 * FDI válido: dígitos en rango 11-48 con unidades 1-8.
 * El campo `location` permite texto libre como "vestibular sup. der entre 14
 * y 15"; validamos que cualquier número de 2 dígitos detectado esté en
 * rango. Sin números detectados → válido (texto libre puro).
 */
export function locationHasValidFdi(location: string): boolean {
  const matches = location.match(/\b\d{2}\b/g);
  if (!matches || matches.length === 0) return true;
  return matches.every((m) => {
    const n = parseInt(m, 10);
    if (n < 11 || n > 48) return false;
    const ones = n % 10;
    return ones >= 1 && ones <= 8;
  });
}

/**
 * Card draft válido: los hijos (elastics, IPR, brokenBrackets) deben tener
 * forma consistente. Útil para pre-validar payload antes de mandar al server.
 */
export function draftPayloadConsistent(payload: {
  elastics: Array<{ config: string }>;
  iprPoints: Array<{ toothA: number; toothB: number; amountMm: number }>;
  brokenBrackets: Array<{ toothFdi: number; brokenDate: string }>;
}): boolean {
  for (const e of payload.elastics) {
    if (!e.config || e.config.trim().length === 0) return false;
  }
  for (const p of payload.iprPoints) {
    if (p.toothA === p.toothB) return false;
    if (p.amountMm <= 0 || p.amountMm > 1) return false;
  }
  for (const b of payload.brokenBrackets) {
    if (!b.brokenDate) return false;
    if (b.toothFdi < 11 || b.toothFdi > 48) return false;
  }
  return true;
}
