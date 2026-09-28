// Cómo se nombra a un profesional en pantalla (ws1-t4 ronda 6). Puro.
//
// El usuario NO tiene campo de tratamiento, título ni género (`model User`:
// firstName, lastName, specialty, cédulas). Con un prefijo fijo salía «Dr.
// Renata» y «Dr. Mariana» en Hoy, y «Dr/a. Mariana» en la ficha. El género no
// se adivina por el nombre: se quita el prefijo y se escribe nombre y
// apellido, como ya hace la Agenda («Mariana Cortés»).

export interface ProfesionalConNombre {
  firstName?: string | null;
  lastName?: string | null;
}

const limpio = (v: string | null | undefined) => String(v ?? "").replace(/\s+/g, " ").trim();

/** «Mariana Cortés». Sin apellido, «Mariana»; sin nada, cadena vacía. */
export function nombreDeProfesional(p: ProfesionalConNombre | null | undefined): string {
  if (!p) return "";
  return [limpio(p.firstName), limpio(p.lastName)].filter(Boolean).join(" ");
}
