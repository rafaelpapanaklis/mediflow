/**
 * DaleControl INSTITUCIONAL — permisos por rol. Módulo PURO y client-safe
 * (sin prisma, sin "server-only"): lo usan el sidebar (visibilidad de
 * items), las páginas y las APIs (vía assertEduPermission).
 *
 * Mismo mecanismo que src/lib/auth/permissions.ts (dental) y
 * src/lib/barber/permissions.ts (barbería). Las olas que siguen NO inventan
 * su propio check: usan hasEduPermission / assertEduPermission. Punto único.
 *
 * REGLA DEL OVERRIDE (idéntica a User.permissionsOverride del dental): si
 * permissionsOverride trae keys, esas REEMPLAZAN al default del rol — no se
 * suman. Consecuencia que muerde en producción: un permiso NUEVO agregado
 * al default de un rol NO le llega a quien ya tiene override; hay que
 * agregárselo también a su override (por eso cada .sql de una ola que
 * añade keys trae su backfill).
 */
import type { EduRole } from "@/lib/edu/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * REGLA DEL CATÁLOGO — léela antes de agregar una key.
 *
 * Cada key de EDU_ALL_PERMISSIONS la tiene que EXIGIR de verdad una
 * pantalla o un endpoint que ya exista. Un interruptor que se guarda y no
 * cambia nada es peor que no tenerlo: la dirección del instituto cree que
 * cerró algo y no cerró nada.
 *
 * Por eso cada ola agrega SUS keys, en el mismo commit que la pantalla que
 * las lee — no las adelanta. La Ola 0 arrancó con UNA sola key real,
 * "inicio.view", porque había UNA sola pantalla. La Ola 1A agrega cuatro
 * y las cuatro tienen dueño: padron.view lo exige /instituto/padron,
 * padron.manage lo exigen /instituto/padron/estructura y TODA mutación del
 * padrón, docentes.view lo exige /instituto/docentes y supervision.assign
 * lo exigen los endpoints de /api/instituto/supervision.
 *
 * El candado no es la buena voluntad: la prueba de
 * __tests__/edu-permissions.test.ts recorre src/app/instituto,
 * src/components/edu y src/lib/edu y falla si una key del catálogo se queda
 * sin lector.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const EDU_ALL_PERMISSIONS = {
  "inicio.view": "Entrar al panel del instituto",
  "padron.view": "Ver el padrón de alumnos",
  "padron.manage": "Dar de alta y de baja alumnos, programas y generaciones",
  "docentes.view": "Ver la lista de docentes",
  "supervision.assign": "Asignar alumnos a un docente supervisor",
} as const;

export type EduPermissionKey = keyof typeof EDU_ALL_PERMISSIONS;

export const EDU_ALL_PERMISSION_KEYS = Object.keys(
  EDU_ALL_PERMISSIONS,
) as EduPermissionKey[];

/**
 * Agrupación visual para la pantalla de permisos del instituto (la
 * construye la ola de Equipo). Cada key del catálogo va en EXACTAMENTE un
 * grupo: si se queda fuera, nadie puede encenderla ni apagarla y el
 * interruptor existe solo en la base de datos.
 */
export const EDU_PERMISSION_GROUPS: { title: string; keys: EduPermissionKey[] }[] = [
  { title: "Panel", keys: ["inicio.view"] },
  {
    title: "Padrón académico",
    keys: ["padron.view", "padron.manage", "docentes.view", "supervision.assign"],
  },
];

/**
 * Defaults por rol. Los cuatro entran al panel: DIRECCION y CAJA porque
 * administran, DOCENTE y ALUMNO porque el panel se usa DE PIE en el piso
 * clínico y es su herramienta de trabajo.
 *
 * Lo que cada rol puede HACER dentro se irá diferenciando ola por ola
 * (autorizar es del docente, cobrar es de caja); mientras esa key no
 * exista, no se escribe aquí.
 *
 * ── Ola 1A · por qué el DOCENTE ve el padrón y no lo administra ─────────
 * El docente necesita la lista para saber a quién trae en el sillón y con
 * quién más la comparte, así que lleva "padron.view" y "docentes.view".
 * Pero lo que VE está recortado a sus alumnos vigentes — eso no lo decide
 * el permiso sino el ALCANCE (eduPadronScope, en padron-core.ts): el
 * permiso abre la pantalla, el alcance decide las filas.
 *
 * "padron.manage" y "supervision.assign" son de DIRECCION: dar de alta,
 * dar de baja y repartir alumnos es administrar la escuela.
 *
 * ALUMNO y CAJA no reciben nada de esto. Un residente no tiene por qué
 * leer el padrón completo de su generación, y caja cobra: no inscribe.
 */
export const EDU_ROLE_DEFAULTS: Record<EduRole, EduPermissionKey[]> = {
  DIRECCION: ["inicio.view", "padron.view", "padron.manage", "docentes.view", "supervision.assign"],
  DOCENTE: ["inicio.view", "padron.view", "docentes.view"],
  ALUMNO: ["inicio.view"],
  CAJA: ["inicio.view"],
};

/** Forma mínima que necesita cualquier check: rol + override. */
export interface EduPermissionUser {
  role: EduRole;
  permissionsOverride?: string[] | null;
}

/**
 * Permisos efectivos: override vacío o ausente → default del rol; override
 * con keys → esas REEMPLAZAN al default (no se mergean). Las keys que ya no
 * existen en el catálogo se descartan, para que un cambio de catálogo no
 * deje a nadie con permisos fantasma guardados en BD.
 */
export function getEduEffectivePermissions(user: EduPermissionUser): EduPermissionKey[] {
  // Cinturón: si llega algo casteado (`ctx.role as any`) que no es un
  // usuario, se niega todo en vez de adivinar.
  if (typeof user !== "object" || user === null) return [];
  const override = (user.permissionsOverride ?? []).filter(
    (k): k is EduPermissionKey => typeof k === "string" && k in EDU_ALL_PERMISSIONS,
  );
  if (override.length > 0) return override;
  return EDU_ROLE_DEFAULTS[user.role] ?? [];
}

/** ¿El usuario (rol + override) tiene esta key? */
export function hasEduPermission(user: EduPermissionUser, key: EduPermissionKey): boolean {
  return getEduEffectivePermissions(user).includes(key);
}

/** Error tipado que lanzan los asserts; las APIs lo mapean a 403. */
export class EduForbiddenError extends Error {
  readonly permission: EduPermissionKey;
  constructor(permission: EduPermissionKey) {
    super(`Permiso requerido: ${permission}`);
    this.name = "EduForbiddenError";
    this.permission = permission;
  }
}

/**
 * Assert de permiso para route handlers / server actions del vertical.
 * Recibe el CONTEXTO de sesión (nunca un rol suelto: sin usuario no hay
 * override que consultar).
 *
 *   const ctx = await getEduContext();
 *   if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
 *   try { assertEduPermission(ctx, "inicio.view"); }
 *   catch { return NextResponse.json({ error: "Sin permiso" }, { status: 403 }); }
 */
export function assertEduPermission(
  ctx: { role: EduRole; user: { permissionsOverride?: string[] | null } },
  key: EduPermissionKey,
): void {
  const ok = hasEduPermission(
    { role: ctx.role, permissionsOverride: ctx.user?.permissionsOverride },
    key,
  );
  if (!ok) throw new EduForbiddenError(key);
}

/**
 * Devuelve solo las keys válidas y sin repetir; descarta las inventadas.
 * Es lo que tiene que pasar TODO lo que venga del cliente antes de
 * guardarse en EduUser.permissionsOverride.
 */
export function sanitizeEduPermissionKeys(input: unknown): EduPermissionKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<EduPermissionKey>();
  for (const k of input) {
    if (typeof k === "string" && k in EDU_ALL_PERMISSIONS) seen.add(k as EduPermissionKey);
  }
  return Array.from(seen);
}
