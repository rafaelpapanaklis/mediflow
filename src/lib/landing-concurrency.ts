/* ============================================================
   NO PISAR LO QUE ESCRIBIÓ OTRA PESTAÑA.

   El editor visual y el formulario de siempre son dos superficies
   vivas a la vez, a propósito. Hace falta un control de concurrencia
   de verdad. El primero que se escribió era éste:

       updateMany({ where: { id, updatedAt: <la marca que cargué> } })

   …y disparaba en FALSO el 100% de las veces. Dos motivos, los dos
   suficientes por sí solos, y los dos arreglados aquí:

   ── 1 · LA MARCA NO SE PUEDE EXPRESAR ─────────────────────────
   `clinics."updatedAt"` es un timestamp de PostgreSQL con precisión
   de MICROsegundos (la convención del repo es TIMESTAMPTZ(6); ver
   prisma/migrations/20260424120000_fase_4_agenda). Un `Date` de
   JavaScript solo llega al MILIsegundo, así que:

       en la base   2026-08-17 05:29:33.123456+00
       lo que lee Prisma / lo que viaja al navegador  …33.123Z
       el where     "updatedAt" = '…33.123'   →  0 filas. SIEMPRE.

   Y como el guardado nunca entra, el valor nunca se normaliza: la
   fila se queda con esos microsegundos para siempre y el editor no
   vuelve a guardar jamás. Encaja exactamente con el síntoma: una
   sola pestaña, un solo usuario, 409 todas las veces.

   Se arregla comparando por VENTANA DE UN MILISEGUNDO — la precisión
   que el cliente realmente puede observar y devolver — en vez de por
   igualdad exacta. Sigue siendo un solo UPDATE atómico.

   ── 2 · `updatedAt` NO ES UNA MARCA DE LA MINI-WEB ────────────
   Es de la FILA. La bumpean el webhook de Stripe, el contador de
   tokens de IA, el refresco del token de Google al reservar una cita,
   /api/settings, /api/clinic… más de veinte sitios. Cualquiera de
   ellos, mientras el editor está abierto, provocaba un 409 sin que
   nadie hubiera tocado la mini-web.

   Un conflicto DE VERDAD es: alguien cambió una de las columnas que
   yo estoy a punto de escribir. Así que cuando el UPDATE guardado no
   entra, se mira el CONTENIDO: se compara lo que el editor tenía por
   publicado contra lo que hay ahora en la base, columna por columna.

     · Todo igual  → el movimiento fue de otro sitio. Se reintenta
                     sobre la marca nueva. La clínica no se entera.
     · Algo cambió → conflicto real. Se dice QUÉ cambió y se devuelve
                     el valor de la base para que la pantalla pueda
                     ofrecer una salida que no sea "recarga y pierde
                     lo que escribiste".

   Sin "use client" ni imports de Prisma: es lógica pura sobre un
   almacén inyectado, para poder probarla sin base de datos.
   ============================================================ */

/** Cuántas veces se reintenta cuando la fila se movió por algo ajeno. */
const INTENTOS_POR_DEFECTO = 3;

/* ══════════════════════════════════════════════════════════════
   Comparar contenido
   ══════════════════════════════════════════════════════════════ */

/**
 * Serialización estable: el ORDEN de las claves de un objeto no es una
 * diferencia.
 *
 * `landingSections` viaja al navegador como JSON, se reconstruye ahí y
 * vuelve; Prisma lo lee de `jsonb`, que no conserva el orden de inserción.
 * Comparar con `JSON.stringify` a secas marcaría como conflicto un objeto
 * idéntico con las claves en otro orden.
 *
 * `undefined` se normaliza a `null`: una columna Json vacía llega como
 * `null` desde Prisma y como clave ausente desde JSON.
 */
export function canonico(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  const claves = Object.keys(o).filter(k => o[k] !== undefined).sort();
  return `{${claves.map(k => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
}

/** ¿Son el mismo contenido, sin importar el orden de las claves? */
export function mismoContenido(a: unknown, b: unknown): boolean {
  return canonico(a) === canonico(b);
}

/**
 * De las columnas que se van a escribir, cuáles se movieron por debajo.
 *
 * `base` es lo que el editor tenía por PUBLICADO cuando cargó (o lo que
 * acaba de publicar él mismo). `actual` es lo que hay en la base ahora.
 * Una columna que no cambió no es un conflicto aunque `updatedAt` se haya
 * movido: el movimiento vino de otro sitio.
 *
 * Una clave ausente en `base` se lee como `null` — es lo que significa un
 * `undefined` después de pasar por JSON, y es el caso de una columna Json
 * vacía.
 */
export function camposEnConflicto(
  campos: string[],
  base: Record<string, unknown>,
  actual: Record<string, unknown>,
): string[] {
  return campos.filter(c => !mismoContenido(base[c], actual[c]));
}

/* ══════════════════════════════════════════════════════════════
   La marca de tiempo
   ══════════════════════════════════════════════════════════════ */

/**
 * La ventana de UN milisegundo que contiene a la marca.
 *
 * `>= 33.123` y `< 33.124` cubre `33.123456`, que es lo que puede haber
 * guardado en una columna de microsegundos y que el cliente NUNCA podrá
 * escribir en un `Date`. Con igualdad exacta esa fila era inalcanzable.
 *
 * Dos guardados dentro del MISMO milisegundo se considerarían la misma
 * versión. Es teórico —dos publicaciones humanas no caen en el mismo
 * milisegundo— y del lado seguro: peor sería no poder guardar nunca.
 */
export function ventanaDeMarca(d: Date): { gte: Date; lt: Date } {
  const ms = Math.floor(d.getTime());
  return { gte: new Date(ms), lt: new Date(ms + 1) };
}

/** ¿Las dos marcas son la misma versión, al milisegundo? */
export function mismaMarca(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return Math.floor(a.getTime()) === Math.floor(b.getTime());
}

/* ══════════════════════════════════════════════════════════════
   El guardado
   ══════════════════════════════════════════════════════════════ */

export interface FilaDeGuardia {
  updatedAt: Date;
  [columna: string]: unknown;
}

/**
 * Lo mínimo que hace falta de la base. Se inyecta para poder probar la
 * lógica —que es donde estaba el fallo— sin levantar PostgreSQL.
 */
export interface AlmacenDeClinica {
  /** UPDATE … WHERE id = … AND "updatedAt" >= gte AND "updatedAt" < lt. Cuántas filas tocó. */
  actualizarSi(marca: { gte: Date; lt: Date }, data: Record<string, unknown>): Promise<number>;
  /** UPDATE … WHERE id = … sin guardia. Devuelve la marca nueva, o null si no existe la fila. */
  actualizar(data: Record<string, unknown>): Promise<Date | null>;
  /** SELECT "updatedAt" + las columnas pedidas. */
  leer(columnas: string[]): Promise<FilaDeGuardia | null>;
}

export type ResultadoDeGuardado =
  | { estado: "ok"; updatedAt: Date }
  | { estado: "sin-fila" }
  | {
      estado: "conflicto";
      /** Las columnas que de verdad cambió alguien más. */
      campos: string[];
      /** Lo que hay ahora en la base, SOLO de esas columnas. */
      actual: Record<string, unknown>;
      updatedAt: Date;
    };

export interface OpcionesDeGuardado {
  /** Lo que se escribe. Ya validado por @/lib/landing-fields. */
  data: Record<string, unknown>;
  /** La marca con la que cargó quien guarda. null = sin control (el formulario de siempre). */
  esperado: Date | null;
  /**
   * Lo que quien guarda tenía por PUBLICADO, de las mismas columnas de `data`.
   * Sin esto no se puede distinguir "me pisaron" de "la fila se movió por otra
   * cosa", así que se es conservador y cualquier movimiento cuenta como conflicto.
   */
  base: Record<string, unknown> | null;
  intentos?: number;
  /** Se llama cuando el guardado con guardia no entró. Para dejar rastro en el log. */
  alFallarLaGuardia?: (info: { esperado: Date; actual: Date | null; campos: string[] }) => void;
}

/**
 * Guarda sin pisar a nadie, y sin negarse a guardar cuando no hay a quién pisar.
 */
export async function guardarSinPisar(
  almacen: AlmacenDeClinica,
  opciones: OpcionesDeGuardado,
): Promise<ResultadoDeGuardado> {
  const { data, esperado, base, alFallarLaGuardia } = opciones;
  const columnas = Object.keys(data);

  // Sin marca no hay control de concurrencia. Es el camino del formulario de
  // siempre, que nunca la mandó; se escribe y punto.
  if (!esperado) {
    const marca = await almacen.actualizar(data);
    return marca ? { estado: "ok", updatedAt: marca } : { estado: "sin-fila" };
  }

  let marca = esperado;
  const tope = opciones.intentos ?? INTENTOS_POR_DEFECTO;

  for (let intento = 0; intento < tope; intento++) {
    const tocadas = await almacen.actualizarSi(ventanaDeMarca(marca), data);
    if (tocadas > 0) {
      const fila = await almacen.leer([]);
      return fila ? { estado: "ok", updatedAt: fila.updatedAt } : { estado: "sin-fila" };
    }

    // No entró: la fila se movió. ¿Se movió lo MÍO, o algo que no me toca?
    const fila = await almacen.leer(columnas);
    if (!fila) return { estado: "sin-fila" };

    const campos = base ? camposEnConflicto(columnas, base, fila) : columnas;
    alFallarLaGuardia?.({ esperado: marca, actual: fila.updatedAt, campos });

    if (campos.length > 0) {
      const actual: Record<string, unknown> = {};
      for (const c of campos) actual[c] = fila[c] ?? null;
      return { estado: "conflicto", campos, actual, updatedAt: fila.updatedAt };
    }

    // El contenido de mis columnas es el que yo tenía: el movimiento fue de
    // otro sitio (Stripe, tokens de IA, el token de Google…). Se reintenta
    // sobre la marca nueva.
    if (mismaMarca(marca, fila.updatedAt)) {
      // La marca no se movió y aun así el UPDATE no entró: no es una carrera,
      // es que la fila ya no cumple el WHERE por otro motivo. Cortar antes de
      // dar vueltas.
      return { estado: "conflicto", campos: columnas, actual: {}, updatedAt: fila.updatedAt };
    }
    marca = fila.updatedAt;
  }

  // Se agotaron los intentos con la fila moviéndose todo el rato por debajo.
  const fila = await almacen.leer(columnas);
  if (!fila) return { estado: "sin-fila" };
  const actual: Record<string, unknown> = {};
  for (const c of columnas) actual[c] = fila[c] ?? null;
  return { estado: "conflicto", campos: columnas, actual, updatedAt: fila.updatedAt };
}
