/**
 * Lo que un campo de teléfono deja pasar al teclear: dígitos y los signos con
 * los que la gente escribe un número (+ espacio - ( ) .). Las letras se caen
 * en el momento, igual que en el registro. El servidor sigue validando.
 */
export function soloTelefono(v: string): string {
  return v.replace(/[^\d+\s().-]/g, "");
}
