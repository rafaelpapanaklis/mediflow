/**
 * Sabina — los tipos del motor.
 *
 * `SabinaCtx`, `SabinaTool` y `SabinaResultado` NO se declaran aquí: son los de
 * `./tipos`, que es lo que implementan de verdad las diez herramientas. Al
 * construirse en paralelo, el motor tenía su propia copia —un ctx con solo
 * `clinicId`/`userId` y una herramienta cuyo `ejecutar` devolvía ya el
 * `SabinaResultado`— y las dos no encajaban: con el ctx del motor, las diez
 * herramientas cortaban con `sesion_invalida` (les falta `role`,
 * `permissionsOverride` y `timezone`). Una sola definición es lo que impide que
 * vuelva a pasar.
 *
 * Sin `server-only`: son tipos y funciones puras, así el test los importa sin
 * arrastrar prisma.
 */
import type { SabinaCtx, SabinaResultado, SabinaTool } from "./tipos";
import type { PropuestaPreparada } from "./engine-acciones";

export type { SabinaCtx, SabinaResultado, SabinaTool };

/**
 * Las dos mitades de `SabinaResultado`, con nombre.
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
  /** Entrada a precio normal (lo que NO salió del caché). */
  tokensEntrada: number;
  tokensSalida: number;
  /**
   * Entrada leída del caché y escrita al caché. Sin estos dos en el rastro no
   * hay forma de saber si el caché está funcionando: la petición sale bien
   * igual y lo único que cambia es la factura. `cacheLectura` en cero llamada
   * tras llamada = algo rompió el prefijo.
   */
  tokensCacheLectura: number;
  tokensCacheEscritura: number;
  ms: number;
  sinPermiso: string[];
  /** Nombres de las acciones que se PROPUSIERON (no ejecutaron) en el turno. */
  propuestas: string[];
}

/**
 * Los tokens de UN modelo en un turno. Un turno que escala gasta en dos
 * modelos, y cada uno tiene su precio: se cobran por separado.
 */
export interface SabinaConsumo {
  modelo: string;
  /** `input_tokens`: entrada a precio normal, SIN lo que salió del caché. */
  entrada: number;
  salida: number;
  /** `cache_read_input_tokens`: entrada leída del caché, a 0,1× el precio. */
  cacheLectura: number;
  /** `cache_creation_input_tokens`: entrada escrita al caché, a 1,25×. */
  cacheEscritura: number;
}

/** Lo que devuelve el motor. El endpoint lo traduce a JSON. */
export interface SabinaRespuesta {
  respuesta: string;
  herramientasUsadas: string[];
  tokens: { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number };
  /** Desglose de `tokens` por modelo, en el orden en que se usaron. */
  consumo: SabinaConsumo[];
  modelo: string;
  dificultad: SabinaDificultad;
  escalado: boolean;
  rondas: number;
  /** Permisos que faltaron; el endpoint no los publica, van al rastro. */
  sinPermiso: string[];
  /**
   * Lo que Sabina PROPUSO hacer en este turno, sin ejecutar. El endpoint lo guarda
   * y lo devuelve como tarjeta; solo se ejecuta si el usuario la confirma en otra
   * petición (engine-propuestas.ts).
   */
  propuestas: PropuestaPreparada[];
  /** true si el modelo nunca contestó (→ 503, nunca un 500 mudo). */
  fallo: boolean;
}
