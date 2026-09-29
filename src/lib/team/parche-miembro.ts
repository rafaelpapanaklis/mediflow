/* ============================================================
   Equipo → Editar: QUÉ SE PRECARGA y QUÉ SE MANDA al guardar.

   El bug (ws1-t5, T1, 28-sep-2026): la página de Equipo no traía la cédula
   profesional, la cédula de especialidad ni la especialidad oficial (NOM-024),
   así que el modal «Editar» las mostraba VACÍAS y el PATCH mandaba el formulario
   completo — "" se guarda como null. Cambiar solo el teléfono de un médico le
   borraba la cédula. Pasaba con cualquier doctor.

   Dos defensas, y las dos importan:
     1. `formDeMiembro` — el formulario arranca con TODO lo guardado.
     2. `parcheDeCambios` — al guardar solo viaja lo que la persona tocó. Aunque
        un campo llegara vacío por otro bug, si nadie lo tocó no se manda y no
        se pisa nada.

   Puro (sin React ni red) para poder probarlo.
   ============================================================ */

/** Los campos del formulario de Equipo que viajan en el PATCH de /api/team/[id]. */
export const CAMPOS_DEL_PARCHE = [
  "firstName", "lastName", "email", "role", "specialty", "color", "phone", "services",
  "cedulaProfesional", "especialidad", "cedulaEspecialidad",
] as const;

export type CampoDelParche = (typeof CAMPOS_DEL_PARCHE)[number];

export interface DatosEditablesDeMiembro {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  specialty: string;
  color: string;
  phone: string;
  services: string[];
  cedulaProfesional: string;
  especialidad: string;
  cedulaEspecialidad: string;
}

/** Lo que llega de la lista del equipo (los null de la base pueden venir como undefined). */
export interface MiembroGuardado {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  specialty?: string | null;
  color?: string | null;
  phone?: string | null;
  services?: string[] | null;
  cedulaProfesional?: string | null;
  especialidad?: string | null;
  cedulaEspecialidad?: string | null;
}

/** El formulario de edición, arrancando con todo lo que la ficha ya tiene. */
export function formDeMiembro(m: MiembroGuardado, colorPorDefecto = ""): DatosEditablesDeMiembro {
  return {
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email,
    role: m.role,
    specialty: m.specialty ?? "",
    color: m.color ?? colorPorDefecto,
    phone: m.phone ?? "",
    services: [...(m.services ?? [])],
    cedulaProfesional: m.cedulaProfesional ?? "",
    especialidad: m.especialidad ?? "",
    cedulaEspecialidad: m.cedulaEspecialidad ?? "",
  };
}

function igual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return (a ?? "") === (b ?? "");
}

/**
 * Solo los campos que cambiaron entre el formulario con el que se abrió el modal
 * (`inicial`) y el que se va a guardar (`actual`). Vacío = no hay nada que mandar.
 */
export function parcheDeCambios(
  inicial: DatosEditablesDeMiembro,
  actual: DatosEditablesDeMiembro,
): Partial<DatosEditablesDeMiembro> {
  const parche: Record<string, unknown> = {};
  for (const campo of CAMPOS_DEL_PARCHE) {
    if (!igual(inicial[campo], actual[campo])) parche[campo] = actual[campo];
  }
  return parche as Partial<DatosEditablesDeMiembro>;
}

/**
 * ¿Este rol lleva datos de médico (especialidad, servicios, NOM-024, color de
 * agenda)? Recepción y solo lectura no atienden pacientes; el ADMIN y el dueño
 * sí pueden (firman recetas con su cédula), así que a ellos se les siguen
 * pidiendo.
 */
export function rolLlevaDatosClinicos(role: string): boolean {
  return role !== "RECEPTIONIST" && role !== "READONLY";
}
