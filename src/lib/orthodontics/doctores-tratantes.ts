// ═══════════════════════════════════════════════════════════════════════════
// Ortodoncia — quién puede ser DOCTOR TRATANTE de un caso (ws1-t5, ronda 6).
//
// Antes cada lista del módulo (el alta del caso, los datos del caso y
// Configuración) pedía `role: "DOCTOR"` a secas. En la clínica más común de
// México el dueño ES el ortodoncista y entra con rol de administrador: no
// salía en ninguna lista y Configuración le decía «no tiene doctores dados de
// alta». El resto del panel (Agenda, reserva web, portal, analítica) ya
// cuenta como doctor a DOCTOR + ADMIN + SUPER_ADMIN; esto pone a Ortodoncia
// en la misma regla y, de paso, usa por fin la especialidad «Ortodoncia» que
// se marca en Equipo para poner primero a quien la tiene.
//
// PURO: sin Prisma, sin React. El lector de base vive en
// `doctores-tratantes-db.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { hasPermission } from "@/lib/auth/permissions";

/** Los mismos roles que la Agenda y la reserva aceptan como «quien atiende». */
export const ROLES_QUE_ATIENDEN = ["DOCTOR", "ADMIN", "SUPER_ADMIN"] as const;

export interface UsuarioCandidato {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  /** Equipo → Especialidad (selector). */
  specialty?: string | null;
  /** Equipo → Especialidad de la cédula (NOM-024, texto libre). */
  especialidad?: string | null;
  /** Equipo/Agenda → si aparece en el calendario. */
  agendaActive?: boolean | null;
  isActive?: boolean | null;
  /** Permisos propios del usuario (Equipo): reemplazan a los de su rol. */
  permissionsOverride?: string[] | null;
}

export interface DoctorTratanteOpcion {
  id: string;
  fullName: string;
  /** Marcó «Ortodoncia» en Equipo (especialidad o especialidad de la cédula). */
  esOrtodoncista: boolean;
}

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** «Ortodoncia», «ortodoncista», «Ortodoncia y ortopedia maxilar»… */
export function esOrtodoncista(u: Pick<UsuarioCandidato, "specialty" | "especialidad">): boolean {
  return [u.specialty, u.especialidad].some((v) => typeof v === "string" && sinAcentos(v).includes("ortodonc"));
}

/**
 * ¿Esta persona atiende pacientes? Un usuario con rol Doctor, siempre. Un
 * administrador (o el dueño), si está en la Agenda o si marcó Ortodoncia como
 * su especialidad: así no se cuela la administradora que solo lleva la caja y
 * a la que ya se sacó del calendario.
 */
/**
 * ¿Puede abrir el módulo de Ortodoncia? Un doctor tratante que no entra al
 * módulo no puede abrir sus propios casos (la URL lo manda a Inicio): no se
 * ofrece. Es el permiso `specialties.orthodontics`, con el override de Equipo.
 */
export function tieneAccesoAOrtodoncia(u: Pick<UsuarioCandidato, "role" | "permissionsOverride">): boolean {
  return hasPermission({ role: u.role, permissionsOverride: u.permissionsOverride ?? [] }, "specialties.orthodontics");
}

export function atiendePacientes(u: UsuarioCandidato): boolean {
  if (u.isActive === false) return false;
  if (!tieneAccesoAOrtodoncia(u)) return false;
  if (u.role === "DOCTOR") return true;
  if (u.role !== "ADMIN" && u.role !== "SUPER_ADMIN") return false;
  return u.agendaActive !== false || esOrtodoncista(u);
}

/** Lista para los selectores: ortodoncistas primero y, dentro, por nombre. */
export function opcionesDeDoctorTratante(usuarios: readonly UsuarioCandidato[]): DoctorTratanteOpcion[] {
  return usuarios
    .filter(atiendePacientes)
    .map((u) => ({
      id: u.id,
      fullName: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Sin nombre",
      esOrtodoncista: esOrtodoncista(u),
    }))
    .sort((a, b) => {
      if (a.esOrtodoncista !== b.esOrtodoncista) return a.esOrtodoncista ? -1 : 1;
      return a.fullName.localeCompare(b.fullName, "es", { sensitivity: "base" });
    });
}

/**
 * Con qué doctor arranca el alta de un caso nuevo. Es una PROPUESTA: el
 * selector sigue editable.
 *   1. El «Doctor tratante por defecto» de Configuración, si sigue en la lista
 *      (si lo dieron de baja o le cambiaron el rol, ya no se propone).
 *   2. Si en Equipo hay exactamente UN ortodoncista, ese.
 *   3. Si la clínica tiene un solo doctor, ese.
 *   4. Nada: que lo elija quien abre el caso.
 */
export function doctorPropuestoParaElAlta(args: {
  porDefecto: string | null | undefined;
  opciones: readonly DoctorTratanteOpcion[];
}): string {
  const { porDefecto, opciones } = args;
  if (porDefecto && opciones.some((o) => o.id === porDefecto)) return porDefecto;
  const ortodoncistas = opciones.filter((o) => o.esOrtodoncista);
  if (ortodoncistas.length === 1) return ortodoncistas[0].id;
  if (opciones.length === 1) return opciones[0].id;
  return "";
}

/** Texto de la opción en el selector: «Ana Ruiz · Ortodoncia». */
export function etiquetaDeDoctor(o: DoctorTratanteOpcion): string {
  return o.esOrtodoncista ? `${o.fullName} · Ortodoncia` : o.fullName;
}
