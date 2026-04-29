/**
 * Validador de CURP (Clave Única de Registro de Población) — NOM-024.
 *
 * Formato oficial RENAPO:
 *   AAAA######HMM AAAA##
 *   1-4: 4 letras del nombre
 *   5-10: fecha de nacimiento AAMMDD
 *   11: H | M (sexo)
 *   12-13: clave de entidad federativa de nacimiento
 *   14-16: 3 letras de consonantes internas
 *   17: caracter de homoclave (letra o dígito)
 *   18: dígito verificador
 *
 * NO valida la homoclave/dígito contra RENAPO; solo formato. La
 * validación contra RENAPO requiere consulta online.
 */
const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

export function validateCURP(curp: string): boolean {
  if (typeof curp !== "string") return false;
  return CURP_RE.test(curp.toUpperCase());
}

/**
 * Valida que la combinación curp + curpStatus + passportNo sea coherente.
 *
 * - COMPLETE  → curp obligatorio y válido
 * - FOREIGN   → passportNo obligatorio, curp opcional
 * - PENDING   → ningún campo requerido (warning UI hasta completar)
 */
export type CurpStatusValue = "COMPLETE" | "PENDING" | "FOREIGN";

export interface CurpInput {
  curp?: string | null;
  curpStatus: CurpStatusValue;
  passportNo?: string | null;
}

export function validateCurpRecord(
  input: CurpInput,
): { ok: true } | { ok: false; error: string } {
  switch (input.curpStatus) {
    case "COMPLETE":
      if (!input.curp) return { ok: false, error: "curp_required" };
      if (!validateCURP(input.curp)) return { ok: false, error: "curp_invalid_format" };
      return { ok: true };
    case "FOREIGN":
      if (!input.passportNo) return { ok: false, error: "passport_required" };
      return { ok: true };
    case "PENDING":
      return { ok: true };
    default:
      return { ok: false, error: "curp_status_invalid" };
  }
}
