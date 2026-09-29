/* ============================================================
   EQUIPO — la contraseña que el dueño le pone a un miembro.

   Puro (sin red, sin Prisma): lo usan igual el formulario de Equipo y
   POST /api/team/[id]/set-password, para que las dos puntas digan lo mismo.
   Regla de Rafael (ws1-t4): mínimo 8 caracteres, con letras y números.

   ⛔ Nunca se registra: ni la contraseña, ni su longitud, ni una pista.
   ============================================================ */

export const MINIMO_CONTRASENA = 8;
// Tope defensivo: bcrypt (Supabase Auth) solo mira los primeros 72 bytes.
export const MAXIMO_CONTRASENA = 72;

export const ERRORES_CONTRASENA = {
  vacia: "Escribe la contraseña nueva.",
  corta: `La contraseña debe tener al menos ${MINIMO_CONTRASENA} caracteres.`,
  larga: `La contraseña no puede pasar de ${MAXIMO_CONTRASENA} caracteres.`,
  sinLetra: "La contraseña debe llevar al menos una letra.",
  sinNumero: "La contraseña debe llevar al menos un número.",
  espacios: "La contraseña no puede empezar ni terminar con espacios.",
  noCoincide: "Las dos contraseñas no coinciden.",
} as const;

/**
 * Devuelve el primer problema de la contraseña, o null si sirve.
 * `confirmacion` se revisa solo si se pasa (el servidor la recibe también).
 */
export function validarContrasenaNueva(contrasena: unknown, confirmacion?: unknown): string | null {
  if (typeof contrasena !== "string" || contrasena.length === 0) return ERRORES_CONTRASENA.vacia;
  // Un espacio al final que el dueño no ve es una contraseña que nadie sabe escribir.
  if (contrasena !== contrasena.trim()) return ERRORES_CONTRASENA.espacios;
  if (contrasena.length < MINIMO_CONTRASENA) return ERRORES_CONTRASENA.corta;
  if (new TextEncoder().encode(contrasena).length > MAXIMO_CONTRASENA) return ERRORES_CONTRASENA.larga;
  if (!/\p{L}/u.test(contrasena)) return ERRORES_CONTRASENA.sinLetra;
  if (!/\p{Nd}/u.test(contrasena)) return ERRORES_CONTRASENA.sinNumero;
  if (confirmacion !== undefined && confirmacion !== contrasena) return ERRORES_CONTRASENA.noCoincide;
  return null;
}
