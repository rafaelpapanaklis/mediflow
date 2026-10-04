// «Mi perfil»: cada persona del equipo edita SUS datos profesionales (ws1-t1, arreglos de las revisiones,
// 3-oct-2026; caso de una doctora que no podía corregir su cédula).
//
// Un DOCTOR no tiene `team.edit` ni `settings.view` por defecto: no entraba a Equipo ni a Configuración →
// Perfil, así que su cédula profesional (la que sale en recetas, consentimientos y el expediente, NOM-004/024)
// solo la podía cambiar el dueño. Ahora `PATCH /api/users/me` acepta también la cédula, la especialidad
// oficial y la cédula de especialidad, SIEMPRE sobre la fila de la sesión.
//
// Lo que NUNCA se cambia por aquí: rol, permisos, estado (activo), correo de acceso, color ni «Aparece en la
// agenda». Esos son de quien administra el equipo (Equipo → Editar / Permisos).
//
// PURO: sin Prisma ni React.

/** Los únicos campos que viajan de «Mi perfil». */
export const CAMPOS_PROPIOS = [
  "firstName", "lastName", "phone", "specialty", "cedulaProfesional", "especialidad", "cedulaEspecialidad",
] as const;

export type CampoPropio = (typeof CAMPOS_PROPIOS)[number];

const LARGO: Record<CampoPropio, number> = {
  firstName: 80,
  lastName: 80,
  phone: 30,
  specialty: 80,
  cedulaProfesional: 30,
  especialidad: 120,
  cedulaEspecialidad: 30,
};

/** Campos que no pueden quedar vacíos (los demás, vacío = se borra). */
const OBLIGATORIOS = new Set<CampoPropio>(["firstName", "lastName"]);

export type CambiosPropios =
  | { ok: true; data: Partial<Record<CampoPropio, string | null>>; campo?: undefined; motivo?: undefined }
  | { ok: false; campo: CampoPropio; motivo: "tipo" | "vacio" | "largo"; data?: undefined };

/**
 * Qué se escribe en la fila de la sesión. Solo los campos de `CAMPOS_PROPIOS` que vienen en el cuerpo; cualquier
 * otra clave (role, permissionsOverride, isActive, email, clinicId…) se ignora.
 *
 * `phone` y `specialty` conservan lo de siempre de esta ruta (Configuración → Perfil): vacío = no se toca. Los
 * datos NOM-024 se pueden borrar a propósito: vacío = null (como en Equipo).
 */
export function leerCambiosPropios(cuerpo: unknown): CambiosPropios {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const data: Partial<Record<CampoPropio, string | null>> = {};
  for (const campo of CAMPOS_PROPIOS) {
    const v = c[campo];
    if (v === undefined) continue;
    if (v === null) {
      if (OBLIGATORIOS.has(campo)) return { ok: false, campo, motivo: "vacio" };
      if (campo === "phone" || campo === "specialty") continue;
      data[campo] = null;
      continue;
    }
    if (typeof v !== "string") return { ok: false, campo, motivo: "tipo" };
    const limpio = v.trim().replace(/\s+/g, " ");
    if (limpio.length > LARGO[campo]) return { ok: false, campo, motivo: "largo" };
    if (!limpio) {
      if (OBLIGATORIOS.has(campo)) return { ok: false, campo, motivo: "vacio" };
      if (campo === "phone" || campo === "specialty") continue;
      data[campo] = null;
      continue;
    }
    data[campo] = limpio;
  }
  return { ok: true, data };
}

/** Solo lo que cambió viaja (como en Equipo): un campo que nadie tocó nunca se pisa. */
export function cambiosDeMiPerfil(
  inicial: Record<CampoPropio, string>,
  actual: Record<CampoPropio, string>,
): Partial<Record<CampoPropio, string>> {
  const parche: Partial<Record<CampoPropio, string>> = {};
  for (const k of CAMPOS_PROPIOS) if ((inicial[k] ?? "") !== (actual[k] ?? "")) parche[k] = actual[k];
  return parche;
}

export interface TextosMiPerfil {
  titulo: string;
  subtitulo: string;
  personales: string;
  profesionales: string;
  profesionalesAyuda: string;
  nombre: string;
  apellidos: string;
  telefono: string;
  correo: string;
  correoAyuda: string;
  rol: string;
  rolAyuda: string;
  especialidadEquipo: string;
  sinEspecialidad: string;
  cedula: string;
  especialidadOficial: string;
  especialidadOficialEjemplo: string;
  cedulaEspecialidad: string;
  guardar: string;
  guardando: string;
  guardado: string;
  error: string;
  errores: Record<CambiosPropiosError, string>;
}

type CambiosPropiosError = "tipo" | "vacio" | "largo";

const ES: TextosMiPerfil = {
  titulo: "Mi perfil",
  subtitulo: "Tus datos personales y profesionales.",
  personales: "Datos personales",
  profesionales: "Datos profesionales",
  profesionalesAyuda: "Salen en tus recetas, consentimientos y en el expediente (NOM-004 y NOM-024).",
  nombre: "Nombre(s)",
  apellidos: "Apellidos",
  telefono: "Teléfono",
  correo: "Correo de acceso",
  correoAyuda: "Lo cambia quien administra el equipo.",
  rol: "Rol",
  rolAyuda: "Tu rol y tus permisos los define quien administra el equipo.",
  // C-113 (ws1-t8): «Especialidad» y «Especialidad oficial» parecían el mismo campo repetido.
  especialidadEquipo: "Área en la clínica (agenda y equipo)",
  sinEspecialidad: "Sin especialidad",
  cedula: "Cédula profesional",
  especialidadOficial: "Especialidad como dice tu cédula",
  especialidadOficialEjemplo: "Ej. Ortodoncia y Ortopedia Dentomaxilofacial",
  cedulaEspecialidad: "Cédula de especialidad",
  guardar: "Guardar cambios",
  guardando: "Guardando…",
  guardado: "Tus datos se guardaron.",
  error: "No se pudieron guardar tus datos. Intenta de nuevo.",
  errores: {
    tipo: "Revisa los datos: hay un campo con un valor no válido.",
    vacio: "Escribe tu nombre y tus apellidos.",
    largo: "Uno de los campos es demasiado largo.",
  },
};

const EN: TextosMiPerfil = {
  titulo: "My profile",
  subtitulo: "Your personal and professional details.",
  personales: "Personal details",
  profesionales: "Professional details",
  profesionalesAyuda: "They appear on your prescriptions, consent forms and the medical record.",
  nombre: "First name(s)",
  apellidos: "Last name(s)",
  telefono: "Phone",
  correo: "Login email",
  correoAyuda: "Changed by whoever manages the team.",
  rol: "Role",
  rolAyuda: "Your role and permissions are set by whoever manages the team.",
  especialidadEquipo: "Area in the clinic (agenda and team)",
  sinEspecialidad: "No specialty",
  cedula: "Professional license",
  especialidadOficial: "Specialty as on your license",
  especialidadOficialEjemplo: "E.g. Orthodontics",
  cedulaEspecialidad: "Specialty license",
  guardar: "Save changes",
  guardando: "Saving…",
  guardado: "Your details were saved.",
  error: "Your details could not be saved. Try again.",
  errores: {
    tipo: "Check the details: one field has an invalid value.",
    vacio: "Enter your first and last name.",
    largo: "One of the fields is too long.",
  },
};

export function textosMiPerfil(locale: string | null | undefined): TextosMiPerfil {
  return (locale ?? "es").toLowerCase().startsWith("en") ? EN : ES;
}
