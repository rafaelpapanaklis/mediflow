import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { getVisiblePatientClinicIds, clinicScopeFilter } from "@/lib/branches";
import { patientVisibilityFilter, type VisibilityViewer } from "@/lib/patient-visibility";
import { puedeClinico } from "@/lib/auth/guardia-clinica";

/**
 * QUIÉN PUEDE ESCRIBIR EL ODONTOGRAMA. Recepción y solo-lectura NO.
 *
 * Estaba declarado —con estas mismas palabras— en /reset y en /sync, y solo
 * ahí. PUT y DELETE de /api/odontogram y de /api/odontogram/note no lo
 * comprobaban: solo pedían sesión y que el paciente fuera de la clínica
 * (PAC-05). Como la pestaña Odontograma se le enseña a todos los roles, una
 * recepcionista podía pintar y borrar hallazgos diente por diente y borrar
 * las notas clínicas una a una — exactamente el destrozo que /reset le
 * prohíbe, pero en cámara lenta y sin dejar rastro.
 *
 * Vive aquí y no en cada ruta porque estaba en dos sitios y faltaba en
 * cuatro: esa es la manera de que se separen.
 *
 * El odontograma es expediente clínico. Quien lo escribe firma un hallazgo.
 */
export const ROLES_QUE_ESCRIBEN_ODONTOGRAMA = new Set<string>(["SUPER_ADMIN", "ADMIN", "DOCTOR"]);

type QuienPide = { role: string; permissionsOverride?: string[] | null };

/**
 * ¿Puede esta persona escribir el odontograma? (auditoría 30-sep, M6)
 *
 * Antes miraba solo el ROL (la lista de arriba), así que a un doctor al que el
 * dueño le quitó «Editar notas SOAP» se le seguía dejando pintar hallazgos. Ahora
 * decide el guardia clínico compartido con `medicalRecord.edit` y el override por
 * persona. Con los permisos por default de cada rol el resultado es el mismo que
 * la lista de roles (SUPER_ADMIN, ADMIN y DOCTOR sí; recepción y solo lectura no).
 */
export function puedeEscribirOdontograma(user: QuienPide): boolean {
  return puedeClinico(user, "editar");
}

/** ¿Puede LEERLO? `medicalRecord.view` — antes el GET no pedía ningún permiso. */
export function puedeLeerOdontograma(user: QuienPide): boolean {
  return puedeClinico(user, "ver");
}

/**
 * Resuelve el usuario de la clínica activa a partir de la sesión.
 * Compartido por las rutas /api/odontogram/* (principal, note, sync, reset).
 *
 * ws1-t8 · M1: antes era una copia local de la resolución (supabase.auth +
 * prisma.user.findFirst) y por eso NO pasaba por el gate de 2FA: con solo la
 * contraseña se leía y se reescribía el odontograma. Ahora delega en
 * getAuthContext — el mismo patrón que las demás copias de getDbUser — y hereda
 * sus gates (2FA siempre; plan vencido en /api). Misma clínica elegida (cookie
 * activa o, si no, la primera por createdAt).
 */
export async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

/**
 * Verifica que el paciente pertenezca a la clínica (aislamiento multi-tenant)
 * Y que el viewer pueda VERLO (Patient.visibleUserIds — Ola 3).
 *
 * Antes este helper hacía el findFirst "pelado" por clinicId que prohíbe la
 * regla dura de patient-visibility.ts:34-47: un doctor excluido de la lista no
 * veía al paciente en ningún listado pero, con el id, podía REEMPLAZARLE el
 * odontograma completo vía /sync (y PUT/DELETE/note). El viewer es parámetro
 * OBLIGATORIO a propósito: ningún caller nuevo puede olvidarlo sin que truene
 * el build. Semántica del filtro (patientVisibilityFilter): lista vacía = lo
 * ve todo el equipo; ADMIN/SUPER_ADMIN pasan siempre.
 *
 * MULTI-CLÍNICA · FASE 2: con `sharedRead: true` el gate acepta además a los
 * pacientes de las sedes VINCULADAS. Es OPT-IN y sólo lo pasa la LECTURA del
 * odontograma (GET /api/odontogram): escribir, sincronizar o resetear el
 * odontograma de un paciente prestado sigue prohibido, porque esas rutas
 * llaman sin la opción y siguen exigiendo la sede activa. Con sharing
 * encendido, un paciente prestado RESTRINGIDO queda fail-closed (la lista
 * guarda userIds de su sede origen y aquí se compara el userId de la sede
 * activa) — mismo resultado 404 que ya imponía el assertPatientVisible del
 * GET, así que este cambio no altera el comportamiento cross-sede.
 */
export async function ensurePatientInClinic(
  patientId: string,
  viewer: VisibilityViewer,
  opts?: { sharedRead?: boolean },
): Promise<boolean> {
  const clinicFilter = opts?.sharedRead
    ? clinicScopeFilter(await getVisiblePatientClinicIds(viewer.clinicId))
    : viewer.clinicId;
  const visibility = patientVisibilityFilter(viewer); // null = admin, ve todo
  const p = await prisma.patient.findFirst({
    where: {
      id: patientId,
      clinicId: clinicFilter,
      ...(visibility ? { AND: [visibility] } : {}),
    },
    select: { id: true },
  });
  return p !== null;
}

/** Detecta el error específico de "tabla no existe" (Prisma P2021 / Postgres 42P01). */
export function isMissingTableError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; message?: string; meta?: { code?: string } };
  if (e.code === "P2021") return true;
  if (e.code === "42P01") return true;
  if (e.meta?.code === "42P01") return true;
  if (
    typeof e.message === "string" &&
    /relation .* does not exist|odontogram_entries.*does not exist/i.test(e.message)
  ) {
    return true;
  }
  return false;
}
