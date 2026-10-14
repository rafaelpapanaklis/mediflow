// Equipo → ficha del miembro → «Caja»: las reglas que no son de pantalla.
//
// Viven aparte para poder probarlas sin montar React. El servidor repite cada
// una (PATCH /api/team/[id] y POST /api/team/[id]/caja-pin): esto solo decide
// qué enseña y qué manda la pantalla.

/** Por qué la casilla «Puede usar Caja» no se puede mover, o `null` si sí. */
export type MotivoCajaFija = "super-admin" | "yo" | "sin-permiso" | null;

/**
 * - `super-admin`: el dueño entra a Caja por rol (canUseCaja): la casilla se ve
 *   marcada y fija, y no se escribe en la base.
 * - `yo`: quien edita no se da a sí mismo el acceso (el servidor responde 403).
 * - `sin-permiso`: quien no tiene «Editar equipo» ni siquiera la ve (la
 *   pantalla no la pinta); se deja el motivo por si algún día se enseña en
 *   solo lectura.
 */
export function motivoCajaFija(o: {
  rolDelMiembro: string;
  esYo: boolean;
  actorEsDueno: boolean;
  puedeEditarEquipo: boolean;
}): MotivoCajaFija {
  if (o.rolDelMiembro === "SUPER_ADMIN") return "super-admin";
  if (!o.puedeEditarEquipo) return "sin-permiso";
  if (o.esYo && !o.actorEsDueno) return "yo";
  return null;
}

/** ¿Se enseña la sección «Caja»? Solo con «Editar equipo». */
export function seccionCajaVisible(o: { puedeEditarEquipo: boolean }): boolean {
  return o.puedeEditarEquipo;
}

/**
 * ¿Viaja `canAccessCaja` en el PATCH? Solo si la persona CAMBIÓ la casilla:
 * guardar el teléfono no reescribe el acceso a Caja de nadie. Nunca para un
 * SUPER_ADMIN (no se escribe) ni cuando la casilla está fija.
 */
export function cajaQueViaja(o: {
  inicial: boolean;
  actual: boolean;
  fija: MotivoCajaFija;
}): boolean | undefined {
  if (o.fija !== null) return undefined;
  return o.actual !== o.inicial ? o.actual : undefined;
}

/** El texto corto del estado del PIN de la ficha, sin enseñar nada del PIN. */
export function estadoPinDeCaja(tieneCajaPin: boolean | null | undefined): "creado" | "sin-crear" {
  return tieneCajaPin === true ? "creado" : "sin-crear";
}
