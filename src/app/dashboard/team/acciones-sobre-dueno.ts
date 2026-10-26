// Equipo → tarjeta de un miembro: qué botones salen sobre la ficha del DUEÑO.
//
// Vive aparte para poder probarlo sin montar React. El servidor ya lo rechaza
// (PATCH y DELETE de /api/team/[id] responden 403 cuando quien no es SUPER_ADMIN
// toca el rol, el estado, el correo o la baja de un SUPER_ADMIN); esto solo evita
// enseñar botones que terminan en ese 403.

/**
 * ¿La tarjeta de este miembro sale SIN «Editar», «Desactivar» ni «Eliminar»?
 * Sí cuando el miembro es el dueño (SUPER_ADMIN) y quien mira no lo es: un ADMIN
 * no edita el rol ni el estado del dueño, ni lo da de baja (decisión de Rafael,
 * 26-oct-2026). Entre dueños, y sobre cualquier otro rol, todo sigue igual.
 */
export function fichaDelDuenoProtegida(o: { rolDelMiembro: string; rolDeQuienMira: string }): boolean {
  return o.rolDelMiembro === "SUPER_ADMIN" && o.rolDeQuienMira !== "SUPER_ADMIN";
}
