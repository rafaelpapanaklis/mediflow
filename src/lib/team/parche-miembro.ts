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
  "cedulaProfesional", "especialidad", "cedulaEspecialidad", "agendaActive",
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
  /** «Atiende pacientes»: aparece en la agenda y se le pueden asignar casos. */
  agendaActive: boolean;
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
  /** Sin dato (la lista vieja no lo traía) cuenta como «atiende»: es el default de la base. */
  agendaActive?: boolean | null;
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
    agendaActive: m.agendaActive !== false,
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
 * Cuándo el rol de quien se edita NO se puede tocar — y por qué:
 *   · «dueno»  — es SUPER_ADMIN. El modal solo ofrece Doctor/Administrador/Recepción
 *                (el servidor no deja asignar SUPER_ADMIN), así que ofrecer esos
 *                botones a un dueño era una trampa: el que se tocaba por error
 *                («yo también atiendo, soy Doctor») devolvía «No puedes cambiar tu
 *                propio rol» y el guardado ENTERO —la cédula incluida— no se hacía.
 *   · «propio» — es uno mismo (el servidor no deja cambiarse el propio rol).
 *   · null     — alta, o editando a otra persona que no es dueña.
 */
export type RolFijo = "dueno" | "propio" | null;

export function motivoRolFijo(args: { esEdicion: boolean; rol: string; esYo: boolean }): RolFijo {
  if (!args.esEdicion) return null;
  if (args.rol === "SUPER_ADMIN") return "dueno";
  return args.esYo ? "propio" : null;
}

/**
 * Solo los campos que cambiaron entre el formulario con el que se abrió el modal
 * (`inicial`) y el que se va a guardar (`actual`). Vacío = no hay nada que mandar.
 *
 * `rolFijo`: el rol no se puede cambiar (`motivoRolFijo` ≠ null). Aunque el
 * formulario lo trajera distinto, NO viaja: el resto de los datos se guarda y el
 * rol queda como está.
 */
export function parcheDeCambios(
  inicial: DatosEditablesDeMiembro,
  actual: DatosEditablesDeMiembro,
  opciones: { rolFijo?: boolean } = {},
): Partial<DatosEditablesDeMiembro> {
  const parche: Record<string, unknown> = {};
  for (const campo of CAMPOS_DEL_PARCHE) {
    if (campo === "role" && opciones.rolFijo) continue;
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

/**
 * ¿Se le ofrece «Atiende pacientes»? Quien tiene agenda propia: el doctor, el
 * administrador y el dueño. Recepción y solo lectura no atienden.
 */
export function puedeMarcarAtiende(role: string): boolean {
  return role === "DOCTOR" || role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * ¿Tiene sentido el botón «Horario» de esta persona? El doctor, siempre; el
 * administrador y el dueño solo si atienden pacientes (el servidor ya les da
 * horario: `ROLES_CON_AGENDA` en horario-doctor/service.ts). Antes el botón
 * salía solo con rol DOCTOR y un dueño que atiende no podía fijar su horario.
 */
export function ofreceHorario(m: { role: string; agendaActive?: boolean | null }): boolean {
  if (m.role === "DOCTOR") return true;
  return (m.role === "ADMIN" || m.role === "SUPER_ADMIN") && m.agendaActive !== false;
}
