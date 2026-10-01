// ─────────────────────────────────────────────────────────────────────────────
// Validadores de los datos de identidad de la clínica que se guardan desde el
// panel (`/api/clinic`, `/api/settings`, `/api/clinic-landing`).
//
// El nombre acaba en el directorio público, en JSON-LD, en correos y en el
// recibo HTML que abre el admin de plataforma. La salida SIEMPRE se escapa
// (`serializeJsonLd`, `escapeHtml`); esto es la segunda capa: que ni siquiera
// se guarde una etiqueta (A1/A2, auditoría 30-sep-2026).
// ─────────────────────────────────────────────────────────────────────────────

/** Mínimo/máximo del nombre: los mismos que `landing-fields` (`name`). */
export const NOMBRE_CLINICA_MIN = 2;
export const NOMBRE_CLINICA_MAX = 120;

/** `<` o `>` (también en su forma de ancho completo) y caracteres de control. */
// eslint-disable-next-line no-control-regex
const PROHIBIDOS = /[<>＜＞\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** El valor no trae etiquetas ni caracteres de control. */
export function sinEtiquetas(v: string): boolean {
  return !PROHIBIDOS.test(v);
}

/** Nombre de clínica válido: texto de 2–120 caracteres, sin `<`, `>` ni controles. */
export function esNombreDeClinicaValido(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.trim().length >= NOMBRE_CLINICA_MIN &&
    v.length <= NOMBRE_CLINICA_MAX &&
    sinEtiquetas(v)
  );
}

export const MENSAJE_NOMBRE_INVALIDO =
  `El nombre de la clínica debe tener entre ${NOMBRE_CLINICA_MIN} y ${NOMBRE_CLINICA_MAX} caracteres y no puede llevar «<» ni «>».`;

/**
 * RFC mexicano: 3 letras (moral) o 4 (física) — pueden ser Ñ o & —, fecha
 * AAMMDD y homoclave de 3 caracteres. Cubre los genéricos XAXX010101000 y
 * XEXX010101000.
 */
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** Mayúsculas y sin espacios alrededor; el formato se valida aparte. */
export function normalizarRfc(v: string): string {
  return v.trim().toUpperCase();
}

export function esRfcValido(v: unknown): boolean {
  return typeof v === "string" && RFC.test(normalizarRfc(v));
}

export const MENSAJE_RFC_INVALIDO =
  "El RFC no tiene un formato válido (12 caracteres para persona moral, 13 para persona física).";
