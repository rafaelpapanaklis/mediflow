// ws1-t8 (revisión final de ws1-t9, fallos nuevos 1 y 2): ¿la persona en sesión puede MOVER esta cita?
//
// La misma regla que PATCH /api/appointments/[id]/status, /complete y PATCH /api/appointments/[id]: un DOCTOR
// solo mueve SUS citas (403 `not_your_appointment`); el resto de los roles, cualquiera de la clínica (luego la
// máquina de estados decide si su rol puede esa transición). La ficha la usa para no ofrecer «Iniciar
// consulta» con la cita de otro doctor, y la hoja firmada para no ligarse (y cerrar) una cita ajena.

export function esCitaQuePuedeMover(
  cita: { doctorId?: string | null },
  usuario: { id: string; role?: string | null },
): boolean {
  return usuario.role !== "DOCTOR" || (!!cita.doctorId && cita.doctorId === usuario.id);
}
