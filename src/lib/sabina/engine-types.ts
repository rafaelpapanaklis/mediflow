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
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
  sinPermiso: string[];
}

/**
 * Los tokens de UN modelo en un turno. Un turno que escala gasta en dos
 * modelos, y cada uno tiene su precio: se cobran por separado.
 */
export interface SabinaConsumo {
  modelo: string;
  entrada: number;
  salida: number;
}

/** Lo que devuelve el motor. El endpoint lo traduce a JSON. */
export interface SabinaRespuesta {
  respuesta: string;
  herramientasUsadas: string[];
  tokens: { entrada: number; salida: number };
  /** Desglose de `tokens` por modelo, en el orden en que se usaron. */
  consumo: SabinaConsumo[];
  modelo: string;
  dificultad: SabinaDificultad;
  escalado: boolean;
  rondas: number;
  /** Permisos que faltaron; el endpoint no los publica, van al rastro. */
  sinPermiso: string[];
  /** true si el modelo nunca contestó (→ 503, nunca un 500 mudo). */
  fallo: boolean;
}
