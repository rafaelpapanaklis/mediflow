/**
 * Sabina — el caché de prompt, y por qué el corte va donde va.
 *
 * Sin `server-only` ni red: arma el cuerpo de `/v1/messages` y nada más, para
 * que `npm run test:sabina-cache` compruebe dónde cae cada `cache_control` sin
 * gastar un peso y para que `npm run sabina:costo` mida EXACTAMENTE lo que
 * manda producción (si midiera otro cuerpo, la cifra del reporte sería falsa).
 *
 * ── EL PROBLEMA ──────────────────────────────────────────────────────────
 * En CADA llamada al modelo viaja el manual entero: los esquemas de las 28
 * herramientas del catálogo (23 cuando se escribió esto; las seis ramas de
 * Sabina de esta ola lo dejaron en 28) más el prompt del sistema. Una pregunta
 * son dos o tres llamadas, así que ese bloque se paga dos o tres veces por
 * pregunta, en cada pregunta, de cada clínica. Y es idéntico en todas ellas.
 *
 * ── DÓNDE SE CORTA, Y POR QUÉ AHÍ ────────────────────────────────────────
 * Anthropic pinta el prompt en este orden: `tools` → `system` → `messages`.
 * El caché es una coincidencia de PREFIJO: un `cache_control` cachea todo lo
 * que va ANTES de él, y un solo byte distinto más arriba lo invalida entero.
 * Por eso hay dos cortes y no uno:
 *
 *  1. En la ÚLTIMA herramienta → cachea el catálogo entero y nada más. Ese
 *     bloque no depende de la clínica, ni del día, ni de la pregunta, ni de si
 *     es directa o abierta: es el MISMO para todo el mundo hasta que alguien
 *     toque el catálogo. Es el corte que permite que el caché se reaproveche
 *     ENTRE clínicas durante todo el día.
 *
 *  2. Al final del `system` → cachea catálogo + prompt. Es un prefijo más
 *     largo (más barato de leer), pero se parte en trozos: el prompt lleva el
 *     «hoy» de la clínica (cambia cada día y por zona horaria), la dificultad
 *     (dos variantes) y la frase de la tarjeta pendiente (por conversación).
 *     Dentro de UNA pregunta esos tres no cambian, así que las llamadas 2 y 3
 *     lo leen enteras; entre preguntas lo comparten las del mismo día, misma
 *     dificultad y sin tarjeta —que son la mayoría.
 *
 * Los dos juntos no se estorban: Anthropic cobra la escritura solo de lo que
 * va MÁS ALLÁ del trozo que ya acertó, así que tener el corte 1 dentro del
 * corte 2 no paga dos veces. Y si el corte 1 se quedara por debajo del mínimo
 * del modelo, simplemente no crea entrada: no cuesta nada tenerlo puesto.
 *
 * 🔴 NO reordenes el prompt del sistema para que el «hoy» deje de romper el
 * prefijo. Se pensó y se descartó: mover texto dentro del prompt cambia lo que
 * lee el modelo, y este trabajo es de COSTO — la misma Sabina, las mismas
 * contestaciones. El corte 1 ya da la parte que se comparte entre todos.
 */

/**
 * Tokens mínimos que un prefijo necesita para que Anthropic lo cachee. Por
 * debajo NO hay error: simplemente no se crea la entrada y `cache_creation`
 * vuelve en cero, que es la forma más cara de equivocarse porque no avisa.
 *
 * 4 096 es el mínimo de Haiku 4.5 (`SABINA_MODELO_DIRECTA`, el que contesta la
 * mayoría) y también el de Opus 4.5/4.6; Sonnet 4.6 —el modelo al que se
 * escala— pide 1 024, así que si cachea en Haiku cachea en los dos. El mínimo
 * NO baja con cada generación: es 512 en los más nuevos y 4 096 aquí, así que
 * no se puede deducir, hay que mirarlo. Lo comprueba `npm run sabina:costo`
 * contra el catálogo real.
 */
export const PREFIJO_CACHEADO_MINIMO_TOKENS = 4_096;

/** La marca de Anthropic. TTL por defecto: ~5 minutos, que es el que sale a cuenta aquí. */
const CACHE_EPHEMERAL = { type: "ephemeral" as const };

/**
 * ¿Se manda `cache_control`? Sí, salvo que alguien apague el caché con
 * `SABINA_CACHE=0`. Es el freno de mano: si Anthropic cambiara el formato y
 * empezara a rechazar el cuerpo, Sabina vuelve a contestar poniendo esa
 * variable en Vercel, sin redeploy y sin tocar código. El cobro sigue siendo
 * correcto con el caché apagado: los contadores llegan en cero y se cobra todo
 * como entrada normal, exactamente como antes de esta rama.
 */
export function cacheActivo(): boolean {
  return process.env.SABINA_CACHE !== "0";
}

/** Un esquema de herramienta tal como lo pide la API. */
export interface EsquemaHerramienta {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Lo que el motor le entrega a la llamada (el mismo shape que `LlamadaModelo`). */
export interface EntradaPayload {
  system: string;
  messages: unknown[];
  tools: readonly EsquemaHerramienta[];
  /**
   * Última ronda: el modelo tiene que cerrar con palabras. Las herramientas
   * siguen VIAJANDO —si no, se rompe el prefijo cacheado justo en la llamada
   * con más historial encima— y lo que se manda es `tool_choice: none`, la
   * forma documentada de decir «no llames a ninguna». Lo que el modelo puede
   * hacer es lo mismo que con la lista vacía: nada.
   */
  sinHerramientas?: boolean;
}

/** El cuerpo de `/v1/messages`, menos `model` y `max_tokens`. */
export interface PayloadAnthropic {
  system: Array<{ type: "text"; text: string; cache_control?: typeof CACHE_EPHEMERAL }>;
  messages: unknown[];
  tools?: Array<EsquemaHerramienta & { cache_control?: typeof CACHE_EPHEMERAL }>;
  tool_choice?: { type: "none" };
}

/**
 * Arma el cuerpo con los dos cortes de caché puestos.
 *
 * `system` pasa de texto suelto a un bloque `text`: es la forma equivalente que
 * documenta Anthropic (mismos bytes renderizados) y la única que admite
 * `cache_control`. El modelo lee exactamente lo mismo.
 */
export function payloadAnthropic(entrada: EntradaPayload): PayloadAnthropic {
  const activo = cacheActivo();
  const esquemas = [...entrada.tools];

  const tools = esquemas.map((t, i) =>
    // El corte va en la ÚLTIMA: cachea todo el catálogo que viene antes.
    activo && i === esquemas.length - 1 ? { ...t, cache_control: CACHE_EPHEMERAL } : { ...t },
  );

  return {
    system: [
      activo
        ? { type: "text", text: entrada.system, cache_control: CACHE_EPHEMERAL }
        : { type: "text", text: entrada.system },
    ],
    messages: entrada.messages,
    ...(tools.length > 0 ? { tools } : {}),
    // Sin herramientas en el catálogo no hay nada que desactivar.
    ...(entrada.sinHerramientas && tools.length > 0 ? { tool_choice: { type: "none" as const } } : {}),
  };
}

/** Los contadores de caché que devuelve la API, con sus nombres de la casa. */
export interface TokensCache {
  /** `cache_read_input_tokens` — se cobran a 0,1× la entrada. */
  lectura: number;
  /** `cache_creation_input_tokens` — se cobran a 1,25× la entrada. */
  escritura: number;
}

/**
 * Lee los dos contadores del `usage` de la respuesta.
 *
 * A prueba de que Anthropic no los mande, los mande como texto o les cambie el
 * nombre: cualquier cosa que no sea un número finito y positivo cae a 0, y
 * entonces el cobro es el de antes de esta rama —nunca de más, nunca roto—.
 * Es la diferencia entre no ahorrar y cobrarle mal a una clínica.
 */
export function tokensCacheDeUsage(usage: unknown): TokensCache {
  const u = (usage ?? {}) as Record<string, unknown>;
  const leer = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  return {
    lectura: leer(u.cache_read_input_tokens),
    escritura: leer(u.cache_creation_input_tokens),
  };
}
