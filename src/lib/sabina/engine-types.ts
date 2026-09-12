/**
 * Sabina — los tipos del CONTRATO, tal como los fija el gerente de ws1.
 *
 * Viven en `engine-types.ts` y no en un `types.ts` suelto porque las tres capas
 * se construyen en paralelo y cada pantalla solo escribe en sus rutas: el motor
 * es dueño de `src/lib/sabina/engine*`. Las herramientas (ws1-t1) declaran su
 * propia copia en `tools/`; al integrar, la que manda es UNA sola — ver el
 * punto 6 del reporte.
 *
 * Sin `server-only`: son tipos y funciones puras, así el test los importa sin
 * arrastrar prisma.
 */
import type { ZodType } from "zod";
import type { PermissionKey } from "@/lib/auth/permissions";

/**
 * Lo que el motor le pasa a cada herramienta. `clinicId` y `userId` salen de la
 * SESIÓN y los pone el motor al construir el ctx — regla (c) de CLAUDE.md y
 * regla 1 del contrato. El modelo no los ve, no los elige y no puede
 * sobrescribirlos: `sanearArgumentos()` los borra si vienen en un argumento.
 */
export interface SabinaCtx {
  clinicId: string;
  userId: string;
  /** Inyectable para que las pruebas no dependan del reloj. */
  ahora?: Date;
}

/**
 * La forma de una herramienta (contrato §"La forma de una herramienta").
 * `parametros` NO lleva clinicId a propósito.
 */
export interface SabinaTool<P = any, R = any> {
  /** snake_case, en español. Es lo que el modelo ve y elige. */
  nombre: string;
  /** Para el modelo: qué contesta y CUÁNDO usarla. Una o dos frases. */
  descripcion: string;
  /** Esquema de los parámetros (zod). SIN clinicId: sale de la sesión. */
  parametros: ZodType<P>;
  /** Key de permiso que exige, del catálogo de src/lib/auth/permissions.ts */
  permiso: PermissionKey;
  /** La consulta. `ctx` trae clinicId y userId de la sesión, ya validados. */
  ejecutar(ctx: SabinaCtx, params: P): Promise<R>;
}

/**
 * El resultado de ejecutar una herramienta. `sin_permiso` es lo que permite
 * cumplir la regla 3: el motor lo convierte en una frase explícita en vez de
 * omitir el dato en silencio.
 *
 * La unión es EXACTAMENTE la del contrato; lo único que se añade es un nombre
 * para cada mitad. Hace falta porque `tsconfig.json` de este repo declara
 * `"strict": false`, y sin `strictNullChecks` TypeScript NO estrecha una unión
 * por un discriminante booleano (`ok: true` / `ok: false`) — sí lo hace por uno
 * de texto (`motivo`). Con estos alias el motor estrecha por `motivo` y no
 * necesita un `any` en cada rama.
 */
export type SabinaResultadoOk<R = unknown> = { ok: true; datos: R; resumen: string };

export type SabinaResultadoFallo =
  | { ok: false; motivo: "sin_permiso"; permiso: string }
  | { ok: false; motivo: "sin_datos" }
  | { ok: false; motivo: "error"; detalle: string };

export type SabinaResultado<R = unknown> = SabinaResultadoOk<R> | SabinaResultadoFallo;

/** Quién pregunta, para comprobar permisos. Sale de getAuthContext(). */
export interface SabinaUsuario {
  role: string;
  permissionsOverride?: string[] | null;
}

/** Dificultad de la pregunta — decide el modelo. */
export type SabinaDificultad = "directa" | "abierta";

/** El rastro que SÍ se registra. Nunca lleva pregunta ni respuesta. */
export interface SabinaRastro {
  clinicId: string;
  userId: string;
  conversacionId: string | null;
  modelo: string;
  dificultad: SabinaDificultad;
  escalado: boolean;
  herramientas: string[];
  rondas: number;
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
  sinPermiso: string[];
}

/** Lo que devuelve el motor. El endpoint lo traduce a JSON. */
export interface SabinaRespuesta {
  respuesta: string;
  herramientasUsadas: string[];
  tokens: { entrada: number; salida: number };
  modelo: string;
  dificultad: SabinaDificultad;
  escalado: boolean;
  rondas: number;
  /** Permisos que faltaron; el endpoint no los publica, van al rastro. */
  sinPermiso: string[];
  /** true si el modelo nunca contestó (→ 503, nunca un 500 mudo). */
  fallo: boolean;
}
