/**
 * La plomería común de las diez herramientas: el permiso, el tenant, el tope de
 * filas y la envoltura del resultado.
 *
 * Vive aparte porque cada una de esas cuatro cosas es una regla del contrato, y
 * una regla que cada herramienta reimplementa a su manera es una regla que
 * alguna herramienta va a implementar mal. Aquí se escriben una vez y las diez
 * pasan por el mismo sitio.
 */

import type { AuthContext } from "@/lib/auth-context";
import { hasPermission } from "@/lib/auth/permissions";
import { patientVisibilityAnd, type VisibilityViewer } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import type {
  PermissionKey,
  SabinaCandado,
  SabinaCtx,
  SabinaDb,
  SabinaResultado,
  SabinaTool,
} from "../tipos";

/**
 * 🔴 Ninguna herramienta devuelve más de 50 filas.
 *
 * No es una cifra de estilo: el contrato la fija porque un listado de 5 000
 * filas se come el contexto de la conversación Y el saldo del monedero de la
 * clínica (`AiWallet` cobra por token). El total REAL viaja aparte para que
 * Sabina pueda decir «500 pacientes con deuda; van los 50 mayores» en vez de
 * dar 50 por el todo.
 */
export const TOPE_FILAS = 50;

/** Un listado ya recortado, con el total de verdad al lado. */
export interface Lista<T> {
  /** Como mucho `TOPE_FILAS`. */
  filas: T[];
  /** Cuántas hay DE VERDAD, sin el tope. */
  total: number;
  /** `true` si `total > filas.length`: hubo recorte y hay que decirlo. */
  truncado: boolean;
}

/**
 * Recorta a 50 y conserva el total real.
 *
 * `total` se pasa aparte a propósito: casi siempre sale de un `count()` sobre el
 * MISMO `where` que la lista, y no de `lista.length` — que ya vendría recortado
 * por el `take` de la consulta y mentiría sobre el tamaño real.
 */
export function recortar<T>(filas: T[], total?: number): Lista<T> {
  const real = typeof total === "number" && total >= filas.length ? total : filas.length;
  return {
    filas: filas.slice(0, TOPE_FILAS),
    total: real,
    truncado: real > Math.min(filas.length, TOPE_FILAS),
  };
}

/** Frase del recorte, lista para pegar en un `resumen`. "" si no hubo recorte. */
export function fraseRecorte<T>(lista: Lista<T>, plural: string): string {
  if (!lista.truncado) return "";
  return ` (van ${lista.filas.length} de ${lista.total} ${plural})`;
}

/**
 * El cliente de base con el que consulta la herramienta.
 *
 * En producción es el `prisma` del repo. Las pruebas inyectan `ctx.db` con un
 * doble que tiene DOS clínicas sembradas: es lo que permite demostrar —y no
 * suponer— que ninguna herramienta devuelve filas de la clínica de al lado.
 * El cast es al tipo de SOLO LECTURA de `SabinaDb`, así que por aquí no entra
 * ningún `create`/`update`/`delete` ni por accidente.
 */
export function dbDe(ctx: SabinaCtx): SabinaDb {
  return ctx.db ?? (prisma as unknown as SabinaDb);
}

/**
 * Puente al `AuthContext` que esperan los where-builders del repo
 * (`buildPatientWhere`, `buildAppointmentWhere`, `buildRecordWhere`).
 *
 * Existe para poder REUSAR esos builders en vez de reescribir su criterio: son
 * los que aplican el scope del rol DOCTOR (solo sus citas, solo sus pacientes),
 * la visibilidad por paciente y el `deletedAt: null` de ARCO. Reimplementarlos
 * aquí habría hecho que Sabina y la pantalla dijeran números distintos.
 *
 * Los booleanos de rol se derivan EXACTAMENTE como en `getAuthContext`
 * (@/lib/auth-context), y solo se rellenan los campos que esos tres builders
 * leen: `clinicId`, `userId`, `isAdmin`, `isDoctor`.
 */
export function comoAuthContext(ctx: SabinaCtx): AuthContext {
  const isSuperAdmin = ctx.role === "SUPER_ADMIN";
  const isAdmin = ctx.role === "ADMIN" || isSuperAdmin;
  const isDoctor = ctx.role === "DOCTOR";
  return {
    userId: ctx.userId,
    clinicId: ctx.clinicId,
    role: ctx.role,
    permissionsOverride: ctx.permissionsOverride,
    isSuperAdmin,
    isAdmin,
    isDoctor,
    isReceptionist: ctx.role === "RECEPTIONIST",
    canManageTeam: isAdmin,
    canViewAllData: isAdmin,
  } as AuthContext;
}

/** El `viewer` mínimo de @/lib/patient-visibility. clinicId SIEMPRE de la sesión. */
export function visorDe(ctx: SabinaCtx): VisibilityViewer {
  return { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
}

/**
 * ¿Este paciente existe en la clínica, no está archivado y el usuario lo puede
 * ver? Un solo query, para las herramientas que reciben un `patientId` ya
 * resuelto (recetas, estudios, análisis — MAPA-clinico.md).
 *
 * 🔴 Existe porque `canViewPatient` (@/lib/patient-visibility) NO mira
 * `deletedAt` (hallazgo N19): un paciente archivado por ARCO sigue "visible"
 * para esa función, y ni `POST /api/prescriptions` ni `POST /api/xrays` lo
 * comprueban aparte. Aquí se añade el filtro a mano en vez de heredar el
 * hueco: Sabina no debe recetar ni mostrar clínica de un paciente archivado.
 */
export async function pacienteVisibleYActivo(ctx: SabinaCtx, patientId: string): Promise<boolean> {
  if (!patientId) return false;
  const db = dbDe(ctx);
  const visAnd = patientVisibilityAnd(visorDe(ctx));
  const hit = await db.patient.findFirst({
    where: {
      id: patientId,
      clinicId: ctx.clinicId, // 🔴 SIEMPRE de la sesión
      deletedAt: null,
      ...(visAnd.length ? { AND: visAnd } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
}

/** ¿El usuario de la sesión tiene esta key? Mismo criterio que los endpoints. */
export function tienePermiso(ctx: SabinaCtx, key: PermissionKey): boolean {
  return hasPermission({ role: ctx.role, permissionsOverride: ctx.permissionsOverride }, key);
}

/**
 * 🔴 El corte de la regla (c) de CLAUDE.md, en el único sitio por el que pasan
 * las diez herramientas.
 *
 * `clinicId: undefined` NO filtra: Prisma descarta la clave y devuelve las filas
 * de TODAS las clínicas. Un `where` armado con un ctx a medias no da error, da
 * una fuga silenciosa. Así que si el id puede faltar, se lanza ANTES de
 * consultar y el resultado sale como `error`, nunca como una lista.
 */
export function exigirSesion(ctx: SabinaCtx): void {
  if (!ctx || typeof ctx !== "object") throw new Error("sesion_invalida: falta el contexto");
  if (typeof ctx.clinicId !== "string" || ctx.clinicId.trim() === "") {
    throw new Error("sesion_invalida: falta clinicId de la sesión");
  }
  if (typeof ctx.userId !== "string" || ctx.userId.trim() === "") {
    throw new Error("sesion_invalida: falta userId de la sesión");
  }
  if (typeof ctx.timezone !== "string" || ctx.timezone.trim() === "") {
    throw new Error("sesion_invalida: falta la zona horaria de la clínica");
  }
}

/**
 * ¿Abre el candado? `false` ante cualquier cosa que no sea un `true` explícito:
 * un candado que devuelve `undefined` por un despiste queda cerrado, no abierto.
 */
async function abreCandado(candado: SabinaCandado, ctx: SabinaCtx): Promise<boolean> {
  return (await candado.abre(ctx)) === true;
}

/**
 * Declara una herramienta. Lo único que hace de más respecto al literal es
 * envolver `ejecutar` con `exigirSesion`, para que la guarda del tenant corra
 * también si alguien llama `tool.ejecutar(...)` directo, sin pasar por el
 * runner.
 *
 * Con el `candado` hace lo mismo: el runner ya lo mira antes (y es el que dice
 * `sin_permiso`), pero una llamada directa a `ejecutar` —otra puerta, un script,
 * una herramienta que llame a otra— no se lo salta. Lanza en vez de devolver
 * datos. Cuesta una lectura más; es el precio de que el hallazgo 23 no vuelva.
 */
export function definirHerramienta<P, R>(def: SabinaTool<P, R>): SabinaTool<P, R> {
  const crudo = def.ejecutar;
  return {
    ...def,
    ejecutar(ctx: SabinaCtx, params: P): Promise<R> {
      exigirSesion(ctx);
      const candado = def.candado;
      if (!candado) return crudo(ctx, params);
      return abreCandado(candado, ctx).then((abre) => {
        if (!abre) throw new Error(`sin_permiso: ${candado.etiqueta}`);
        return crudo(ctx, params);
      });
    },
  };
}

/**
 * Corre una herramienta y devuelve SIEMPRE la forma del contrato.
 *
 * El orden de los cortes importa y es el del contrato:
 *  1. sesión — sin clinicId no se consulta (regla 1).
 *  2. permiso — y si falta, `sin_permiso` CON la key, para que el motor pueda
 *     decir «no tienes acceso a X» en vez de «no hay datos» (regla 3). Después,
 *     el `candado` si la herramienta lo trae, con la misma salida: lo que no es
 *     una key también se DICE. Va antes de los parámetros, igual que la key.
 *  3. parámetros — lo que manda el modelo se valida con zod; un rango absurdo
 *     es un `error` explicado, no una consulta a ciegas.
 *  4. la consulta — y cualquier excepción sale como `error` con su detalle. Un
 *     500 mudo no existe en esta capa.
 */
export async function correrHerramienta<P, R>(
  tool: SabinaTool<P, R>,
  ctx: SabinaCtx,
  paramsCrudos: unknown,
): Promise<SabinaResultado<R>> {
  try {
    exigirSesion(ctx);
  } catch (e) {
    return { ok: false, motivo: "error", detalle: mensaje(e) };
  }

  if (!tienePermiso(ctx, tool.permiso)) {
    return { ok: false, motivo: "sin_permiso", permiso: tool.permiso };
  }

  if (tool.candado) {
    let abre: boolean;
    try {
      abre = await abreCandado(tool.candado, ctx);
    } catch (e) {
      return { ok: false, motivo: "error", detalle: mensaje(e) };
    }
    if (!abre) return { ok: false, motivo: "sin_permiso", permiso: tool.candado.etiqueta };
  }

  const parseado = tool.parametros.safeParse(paramsCrudos ?? {});
  if (!parseado.success) {
    return {
      ok: false,
      motivo: "error",
      detalle: `parametros_invalidos: ${parseado.error.issues
        .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
        .join("; ")}`,
    };
  }
  const params = parseado.data as P;

  let datos: R;
  try {
    datos = await tool.ejecutar(ctx, params);
  } catch (e) {
    return { ok: false, motivo: "error", detalle: mensaje(e) };
  }

  if (tool.vacio(datos)) return { ok: false, motivo: "sin_datos" };
  return { ok: true, datos, resumen: tool.resumir(datos, params) };
}

function mensaje(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "error_desconocido";
}

/** "1 cita" / "3 citas" — para que los resúmenes no digan "1 citas". */
export function plural(n: number, singular: string, muchos: string): string {
  return `${n} ${n === 1 ? singular : muchos}`;
}

/**
 * Importe en pesos, como lo escribe el panel: sin centavos si es entero.
 *
 * Con centavos van SIEMPRE los dos dígitos. Antes 1500.5 salía «$1,500.5», y el
 * modelo lo copiaba así junto a un «$820.00» que había formateado él.
 * `conCentavos` fuerza los dos decimales aunque sea entero: es lo que usa una
 * lista para que todas sus cantidades tengan la misma forma (ver `pesosDeLista`).
 */
export function pesos(n: number, conCentavos = false): string {
  const redondo = Math.round((n + Number.EPSILON) * 100) / 100;
  const decimales = conCentavos || !Number.isInteger(redondo) ? 2 : 0;
  return `$${redondo.toLocaleString("es-MX", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`;
}

/** Porcentaje entero, o "n/d" cuando no se puede calcular (regla 5: no se inventa). */
export function pct(n: number | null): string {
  return n === null ? "n/d" : `${n}%`;
}

/**
 * El listado de un `resumen`: una fila por línea, cada una con «- ».
 *
 * Existe por lo que vivió Rafael el 14-sep-2026: pidió «enlista los pacientes que
 * deben» y Sabina contestó nombres y montos separados por comas. El modelo copia
 * la forma del `resumen` que le llega; si el resumen trae la lista ya partida en
 * líneas y con el dinero formateado, la respuesta sale igual, y la pantalla la
 * pinta como lista (`parseSabinaMarkdown`).
 *
 * Con menos de dos filas devuelve "": una lista de un solo elemento es ruido, y
 * ese caso se dice en la frase de arriba. Va con salto de línea delante para
 * pegarlo directo detrás de la cabecera.
 */
export function lineasDeLista<T>(filas: readonly T[], aLinea: (fila: T) => string): string {
  if (filas.length < 2) return "";
  return filas
    .slice(0, TOPE_FILAS)
    .map((f) => `\n- ${aLinea(f).replace(/\s+/g, " ").trim()}`)
    .join("");
}

/**
 * Formateador para las cantidades de UNA lista: si alguna trae centavos, todas los
 * llevan. Así la columna se lee igual en cada línea («$1,500.00» y «$820.50», no
 * «$1,500» y «$820.50») y la pantalla las alinea.
 */
export function pesosDeLista(montos: readonly number[]): (n: number) => string {
  const conCentavos = montos.some((m) => !Number.isInteger(Math.round((m + Number.EPSILON) * 100) / 100));
  return (n) => pesos(n, conCentavos);
}
