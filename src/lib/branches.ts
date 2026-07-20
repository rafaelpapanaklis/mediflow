import "server-only";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/plan-status";
import { PATIENT_SHARING_ENABLED, normalizeClinicPair } from "@/lib/branches-shared";
import type { BranchBlockedReason, BranchQuota } from "@/lib/branches-shared";

/**
 * MULTI-CLÍNICA · FASE 1 — reglas de cupo de SUCURSALES.
 *
 * FUENTE ÚNICA de la regla "¿este dueño puede crear otra sede?", consumida por:
 *   • el layout de /dashboard (qué muestra el switcher del sidebar), y
 *   • POST /api/clinics (enforcement real).
 * La UI es sólo un espejo: el gate que manda es el del endpoint, que recuenta
 * contra la BD con el supabaseId de la SESIÓN.
 *
 * Un "dueño" es un supabaseId con rol SUPER_ADMIN en una clínica. El runtime
 * multi-clínica (1 supabaseId → N filas User, cookie de clínica activa,
 * aislamiento por clinicId) ya existía; esto sólo agrega crear + gatear.
 *
 * Fase 1 NO comparte datos entre sedes: cada sucursal sigue 100% aislada.
 */

export type { BranchBlockedReason, BranchQuota } from "@/lib/branches-shared";

type QuotaClinic = { plan?: string | null; subscriptionStatus?: string | null };

/**
 * Resuelve el cupo a partir de datos YA cargados por el caller (sin queries
 * propias más allá de la config de planes, que va con caché en memoria de 60s).
 *
 * `ownedCount` lo calcula cada caller desde su fuente confiable:
 *   • layout → getUserClinics() filtrando role === "SUPER_ADMIN",
 *   • API    → countOwnedClinics(supabaseId) contra la BD.
 */
export async function getBranchQuota(input: {
  clinic: QuotaClinic;
  isOwner: boolean;
  ownedCount: number;
}): Promise<BranchQuota> {
  const { maxClinics } = await getPlanLimits(input.clinic.plan);
  const max = maxClinics;
  const planAllowsBranches = max === null || max > 1;

  const status = input.clinic.subscriptionStatus ?? null;
  const subscriptionActive = status !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(status);

  const withinLimit = max === null || input.ownedCount < max;

  // El orden importa: es el motivo que se le muestra/devuelve al dueño.
  const blockedReason: BranchBlockedReason | null = !input.isOwner
    ? "ROLE"
    : !planAllowsBranches
      ? "PLAN"
      : !subscriptionActive
        ? "SUBSCRIPTION"
        : !withinLimit
          ? "LIMIT"
          : null;

  return {
    used: input.ownedCount,
    max,
    canCreate: blockedReason === null,
    planAllowsBranches,
    blockedReason,
  };
}

/**
 * Cuenta las clínicas de las que este supabaseId es DUEÑO. Anti-IDOR: el
 * supabaseId SIEMPRE sale de la sesión del server, nunca del body.
 * `@@unique([supabaseId, clinicId])` garantiza 1 fila User por clínica, así que
 * contar filas == contar clínicas.
 */
export async function countOwnedClinics(supabaseId: string): Promise<number> {
  return prisma.user.count({
    where: { supabaseId, role: "SUPER_ADMIN", isActive: true },
  });
}

/**
 * Slug único para la sucursal, derivado del nombre. Mismo criterio que el alta
 * de clínica nueva (src/app/api/auth/register/route.ts): ASCII, sin acentos,
 * máx 30 chars, con sufijo -1, -2… si ya existe.
 */
export async function generateClinicSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 30) || "sucursal";
  let slug = base;
  let i = 1;
  while (await prisma.clinic.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

/* ══════════════════════════════════════════════════════════════════════════
 * MULTI-CLÍNICA · FASE 2 — PACIENTES COMPARTIDOS entre sedes vinculadas.
 *
 * Qué se comparte: SOLO la LECTURA de pacientes y su contenido clínico
 * (lista, búsqueda, ficha, expediente/historia, radiografías, consultas).
 * Qué NO: citas, facturas, pagos, Caja, Finanzas y analytics siguen atadas
 * estrictamente a la sede activa — cada sucursal cobra y corta por separado.
 *
 * Las ESCRITURAS tampoco se comparten: crear/editar/archivar un paciente sigue
 * exigiendo `clinicId = sede activa` en los handlers (PUT/PATCH/DELETE de
 * /api/patients/[id] ya lo hacían). Un paciente prestado se ve, no se toca.
 * ══════════════════════════════════════════════════════════════════════════ */

export {
  PATIENT_SHARING_ENABLED,
  normalizeClinicPair,
  clinicPairKey,
} from "@/lib/branches-shared";
export type { ClinicPatientLinkRow, OwnedBranchRow } from "@/lib/branches-shared";

/**
 * HELPER ÚNICO de visibilidad de pacientes. Devuelve las clínicas cuyos
 * pacientes puede LEER la sede activa: siempre la propia, más las vinculadas
 * explícitamente.
 *
 * ⚠️ Invariantes que sostienen la seguridad del feature:
 *  1. El `clinicId` de entrada SIEMPRE sale de la sesión del server
 *     (ctx.clinicId / user.clinicId), JAMÁS de un query param o del body.
 *  2. Con el flag apagado devuelve `[clinicId]` — exactamente el
 *     comportamiento de hoy, sin tocar la BD.
 *  3. SIN transitividad: se leen sólo los pares donde la sede activa participa,
 *     así que A↔B y B↔C no le dan a A los pacientes de C.
 *
 * Nota de rendimiento: es una query indexada (@@index en clinicAId/clinicBId)
 * y devuelve a lo sumo `maxClinics-1` filas. Los endpoints la llaman una vez
 * por request.
 */
export async function getVisiblePatientClinicIds(clinicId: string): Promise<string[]> {
  if (!PATIENT_SHARING_ENABLED) return [clinicId];

  const links = await prisma.clinicPatientLink.findMany({
    where: { OR: [{ clinicAId: clinicId }, { clinicBId: clinicId }] },
    select: { clinicAId: true, clinicBId: true },
  });

  // Array + indexOf en vez de Set: tsconfig no tiene downlevelIteration y el
  // proyecto evita iterar Sets (ver lección de tsconfig no-strict). Son pocas
  // sedes, el costo es irrelevante.
  const ids: string[] = [clinicId];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const other = link.clinicAId === clinicId ? link.clinicBId : link.clinicAId;
    if (other && ids.indexOf(other) === -1) ids.push(other);
  }
  return ids;
}

/** Visibilidad + nombres de las sedes AJENAS, para pintar el badge de origen. */
export interface PatientVisibility {
  /** Clínicas legibles. Siempre incluye la activa, en la posición 0. */
  clinicIds: string[];
  /** true si hay al menos una sede ajena (o sea: el badge tiene sentido). */
  shared: boolean;
  /** id → nombre, SOLO de las sedes ajenas. La activa nunca lleva badge. */
  otherClinicNames: Record<string, string>;
}

/**
 * Igual que getVisiblePatientClinicIds pero resolviendo también el NOMBRE de
 * las sedes ajenas. Lo usan la lista y la ficha para el badge "viene de X".
 * Si no hay vínculos, no pega la segunda query.
 */
export async function getPatientVisibility(clinicId: string): Promise<PatientVisibility> {
  const clinicIds = await getVisiblePatientClinicIds(clinicId);
  if (clinicIds.length <= 1) {
    return { clinicIds, shared: false, otherClinicNames: {} };
  }

  const others = clinicIds.filter((id) => id !== clinicId);
  const rows = await prisma.clinic.findMany({
    where: { id: { in: others } },
    select: { id: true, name: true },
  });

  const otherClinicNames: Record<string, string> = {};
  for (let i = 0; i < rows.length; i++) {
    otherClinicNames[rows[i].id] = rows[i].name;
  }
  return { clinicIds, shared: true, otherClinicNames };
}

/**
 * Filtro de clínica listo para un `where` de Prisma sobre entidades de
 * PACIENTE. Devuelve el id pelado cuando no hay nada compartido (query
 * idéntica a la de hoy, mismo plan de ejecución) y un `{ in: [...] }` sólo
 * cuando de verdad hay sedes vinculadas.
 *
 * ⚠️ FALLA CERRADO con lista vacía. Devolver `undefined` sería catastrófico:
 * en Prisma, `where: { clinicId: undefined }` NO filtra nada — la condición
 * desaparece y la query devolvería pacientes de TODAS las clínicas. Ante una
 * lista vacía (que hoy no puede ocurrir, pero podría si alguien refactoriza el
 * caller) devolvemos `{ in: [] }`, que no matchea NADA.
 */
export function clinicScopeFilter(clinicIds: string[]): string | { in: string[] } {
  if (!clinicIds || clinicIds.length === 0) return { in: [] };
  return clinicIds.length === 1 ? clinicIds[0] : { in: clinicIds };
}

/**
 * Ids de las clínicas de las que este supabaseId es DUEÑO (SUPER_ADMIN activo).
 * Es la base ANTI-IDOR de la API de vínculos: cualquier clinicId que llegue en
 * un body debe estar en esta lista, que se deriva sólo de la sesión.
 */
export async function getOwnedClinicIds(supabaseId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { supabaseId, role: "SUPER_ADMIN", isActive: true },
    select: { clinicId: true },
  });
  return rows.map((r) => r.clinicId);
}

/** Sedes del dueño con nombre, ordenadas, para la matriz de configuración. */
export async function getOwnedBranches(
  supabaseId: string,
): Promise<Array<{ clinicId: string; clinicName: string }>> {
  const rows = await prisma.user.findMany({
    where: { supabaseId, role: "SUPER_ADMIN", isActive: true },
    select: { clinic: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ clinicId: r.clinic.id, clinicName: r.clinic.name }));
}

/**
 * Vínculos donde participa AL MENOS UNA sede del dueño.
 *
 * ⚠️ Ojo con la asimetría (bug encontrado en revisión adversarial): exigir que
 * AMBOS lados fueran suyos hacía que un vínculo se volviera INVISIBLE —y por
 * tanto IRREVOCABLE— en cuanto el dueño dejaba de serlo de una de las dos
 * sedes (un socio que se va, un SUPER_ADMIN desactivado). La sede ajena seguía
 * leyendo pacientes para siempre y nadie podía cortar el vínculo desde la UI.
 *
 * Con "al menos uno" el dueño SIEMPRE ve —y puede cortar— todo lo que exponga
 * a sus propias sedes. Es la propiedad que importa: cerrar la puerta de tu casa
 * nunca debe depender de que el vecino coopere.
 */
export async function listPatientLinks(ownedClinicIds: string[]) {
  if (ownedClinicIds.length === 0) return [];
  return prisma.clinicPatientLink.findMany({
    where: {
      OR: [
        { clinicAId: { in: ownedClinicIds } },
        { clinicBId: { in: ownedClinicIds } },
      ],
    },
    select: { id: true, clinicAId: true, clinicBId: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Scope de MedicalRecord para las superficies compartidas.
 *
 * Las notas marcadas `isPrivate` son del doctor que las escribió: /api/records
 * ya las oculta a los demás dentro de la misma clínica. Al compartir entre
 * sedes hay que ser MÁS estricto, no menos: de una sede AJENA nunca se leen
 * notas privadas, porque el doctor que las escribió no tiene siquiera fila
 * User en la sede que las está leyendo (los ids de doctor son por clínica, así
 * que "es mía" es indecidible cruzando la frontera).
 *
 * Devuelve el filtro de clínica pelado cuando no hay nada compartido, así la
 * query queda idéntica a la de hoy.
 */
export function sharedRecordScope(
  activeClinicId: string,
  visibleClinicIds: string[],
): Record<string, unknown> {
  const others = visibleClinicIds.filter((id) => id !== activeClinicId);
  if (others.length === 0) return { clinicId: activeClinicId };
  return {
    OR: [
      { clinicId: activeClinicId },
      { clinicId: { in: others }, isPrivate: false },
    ],
  };
}

/**
 * Crea el vínculo (idempotente). El par se normaliza ANTES de escribir, así el
 * @@unique([clinicAId, clinicBId]) hace imposible el duplicado invertido.
 * NO valida pertenencia: eso es responsabilidad del endpoint, que ya cotejó
 * ambos ids contra getOwnedClinicIds de la sesión.
 */
export async function createPatientLink(input: {
  clinicXId: string;
  clinicYId: string;
  createdById: string | null;
}) {
  const { clinicAId, clinicBId } = normalizeClinicPair(input.clinicXId, input.clinicYId);
  const existing = await prisma.clinicPatientLink.findUnique({
    where: { clinicAId_clinicBId: { clinicAId, clinicBId } },
    select: { id: true, clinicAId: true, clinicBId: true },
  });
  if (existing) return existing;

  return prisma.clinicPatientLink.create({
    data: { clinicAId, clinicBId, createdById: input.createdById },
    select: { id: true, clinicAId: true, clinicBId: true },
  });
}
