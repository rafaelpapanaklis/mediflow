/**
 * Sabina — los tipos que comparten las tres capas.
 *
 * Esto es la traducción literal de «La forma de una herramienta» del contrato
 * (CONTRATO.md de este trabajo). No se añade nada que el contrato no pida, y no
 * se quita nada que pida: el motor y la pantalla se escriben CONTRA este
 * archivo sin haber visto las herramientas.
 *
 * 🔴 LAS DOS REGLAS QUE ESTE ARCHIVO EXISTE PARA SOSTENER
 *
 * 1. `clinicId` sale SIEMPRE de la sesión. Por eso `SabinaCtx` lo trae y
 *    `parametros` NO lo lleva nunca: si el modelo pudiera mandar un `clinicId`,
 *    podría mandar el de otra clínica. La regla (c) de CLAUDE.md añade que
 *    `clinicId: undefined` no filtra nada —Prisma descarta la clave y devuelve
 *    TODAS las clínicas—, así que aquí se corta ANTES de consultar: ver
 *    `crearSabinaCtx`, que devuelve `null` cuando el id puede faltar.
 *
 * 2. Sin permiso se DICE, no se omite. De ahí `motivo: "sin_permiso"` como
 *    variante propia de `SabinaResultado`: una lista vacía y un «no tienes
 *    acceso» son respuestas distintas, y confundirlas vuelve falsa la respuesta
 *    sin mentir en ninguna frase.
 */

import type { z } from "zod";
import type { PermissionKey } from "@/lib/auth/permissions";
import { DEFAULT_TZ } from "@/lib/agenda/date-ranges";

export type { PermissionKey };

/**
 * Lo que la herramienta sabe de quien pregunta. Todo sale de la sesión
 * (`getAuthContext()`), nunca del modelo ni del cliente.
 *
 * `role` y `permissionsOverride` viajan porque sin ellos NO se puede cumplir la
 * regla 2 del contrato: el permiso se comprueba contra el usuario, y el usuario
 * es rol + override (ver `hasPermission` en @/lib/auth/permissions — el override
 * REEMPLAZA al default del rol, no se mergea). Son exactamente los dos campos
 * que `denyIfMissingPermission` pide en los endpoints, así que el criterio de
 * Sabina y el de la pantalla no pueden separarse.
 */
export interface SabinaCtx {
  /** De la sesión. Nunca vacío: `crearSabinaCtx` corta antes. */
  clinicId: string;
  /** De la sesión. Quien pregunta. */
  userId: string;
  /** Role de Prisma como string ("ADMIN" | "DOCTOR" | …). */
  role: string;
  /** Override granular. Siempre presente como array (vacío = default del rol). */
  permissionsOverride: string[];
  /**
   * Zona horaria de LA CLÍNICA, no la del servidor. En Vercel el proceso corre
   * en UTC: una clínica de México que pregunta «cuántas citas tengo hoy» a las
   * 19:00 recibiría el día siguiente. Misma convención y mismo default que
   * `safeTz` de @/lib/agenda/date-ranges.
   */
  timezone: string;
  /** Categoría de la clínica (ClinicCategory). Decide si el profesional se llama "Dr.". */
  clinicCategory?: string;
  /**
   * Cliente de base. Se omite en producción (se usa el `prisma` del repo); las
   * pruebas inyectan aquí un doble con dos clínicas sembradas para demostrar
   * que ninguna herramienta cruza el tenant. Ver `dbDe` en ./tools/base.
   */
  db?: SabinaDb;
}

/**
 * La rendija por la que las herramientas hablan con la base: SOLO LECTURA.
 *
 * No es cosmética. Es lo que hace imposible, por tipos, que una herramienta
 * escriba: aquí no existe `create`, ni `update`, ni `delete`, ni `upsert`, ni
 * `$transaction`, ni `$executeRaw`. La regla 4 del contrato («solo lectura,
 * siempre») deja de depender de que nadie se despiste.
 */
export interface SabinaDb {
  appointment: {
    findMany(args: any): Promise<any[]>;
    count(args: any): Promise<number>;
    groupBy(args: any): Promise<any[]>;
  };
  patient: {
    findMany(args: any): Promise<any[]>;
    count(args: any): Promise<number>;
    groupBy(args: any): Promise<any[]>;
  };
  invoice: {
    findMany(args: any): Promise<any[]>;
    count(args: any): Promise<number>;
    aggregate(args: any): Promise<any>;
    groupBy(args: any): Promise<any[]>;
  };
  payment: {
    findMany(args: any): Promise<any[]>;
  };
  clinic: {
    findFirst(args: any): Promise<any>;
  };
  resource: {
    count(args: any): Promise<number>;
  };
  clinicSchedule: {
    findMany(args: any): Promise<any[]>;
  };
  $queryRaw(query: any): Promise<any[]>;
}

/** Una herramienta del catálogo, tal cual la define el contrato. */
export interface SabinaTool<P = any, R = any> {
  /** snake_case, en español. Es lo que el modelo ve y elige. */
  nombre: string;
  /** Para el modelo: qué contesta y CUÁNDO usarla. Una o dos frases. */
  descripcion: string;
  /** Esquema de los parámetros (zod). SIN clinicId: sale de la sesión. */
  parametros: z.ZodType<P>;
  /** Key de permiso que exige, del catálogo de @/lib/auth/permissions. */
  permiso: PermissionKey;
  /** La consulta. `ctx` trae clinicId y userId de la sesión, ya validados. */
  ejecutar(ctx: SabinaCtx, params: P): Promise<R>;
  /**
   * La línea legible del hallazgo — el `resumen` de `SabinaResultado`. Es lo que
   * permite a Sabina contestar sin releerse toda la tabla, así que no es un
   * adorno: lleva el número que contesta la pregunta.
   */
  resumir(datos: R, params: P): string;
  /** ¿Este resultado es «sin datos»? Decide `motivo: "sin_datos"`. */
  vacio(datos: R): boolean;
}

/** El resultado de ejecutar una herramienta. Siempre esta forma. */
export type SabinaResultado<R = any> =
  | { ok: true; datos: R; resumen: string }
  | { ok: false; motivo: "sin_permiso"; permiso: string }
  | { ok: false; motivo: "sin_datos" }
  | { ok: false; motivo: "error"; detalle: string };

/**
 * Construye el `SabinaCtx` desde el contexto de sesión del panel. Es la ÚNICA
 * puerta de entrada que debería usar el motor.
 *
 * 🔴 Devuelve `null` cuando `clinicId` o `userId` pueden faltar, y eso es el
 * punto entero de la función: con `clinicId: undefined` Prisma descarta la clave
 * y una herramienta devolvería las filas de TODAS las clínicas. Se corta aquí,
 * antes de que exista un ctx con el que consultar.
 */
export function crearSabinaCtx(
  // Acepta `null` a propósito: `getAuthContext()` devuelve null sin sesión, y el
  // motor tiene que poder escribir `crearSabinaCtx(await getAuthContext())` de
  // una línea sin un guard previo. Un null entra y sale como null.
  auth:
    | {
        clinicId?: string | null;
        userId?: string | null;
        role?: string | null;
        permissionsOverride?: string[] | null;
        clinic?: { timezone?: string | null; category?: string | null } | null;
      }
    | null
    | undefined,
): SabinaCtx | null {
  const clinicId = typeof auth?.clinicId === "string" ? auth.clinicId.trim() : "";
  const userId = typeof auth?.userId === "string" ? auth.userId.trim() : "";
  const role = typeof auth?.role === "string" ? auth.role.trim() : "";
  if (!clinicId || !userId || !role) return null;

  const tz = auth?.clinic?.timezone;
  return {
    clinicId,
    userId,
    role,
    permissionsOverride: auth?.permissionsOverride ?? [],
    // Mismo criterio que `safeTz`: una tz vacía cae al default de México, NO a
    // la del proceso (UTC en Vercel), que es el fallo que vaciaba el tablero a
    // las 18:00.
    timezone: tz && tz.length > 0 ? tz : DEFAULT_TZ,
    clinicCategory: auth?.clinic?.category ?? undefined,
  };
}
