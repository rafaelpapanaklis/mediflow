/**
 * Opciones del cliente de Upstash Redis para que un Redis caído NO frene a nadie (login rápido, 28-oct).
 *
 * Por defecto `@upstash/redis` reintenta 5 veces con espera exponencial (50 ms · e^n): ~4,4 s por
 * comando antes de rendirse. El login hace 5 comandos en serie, así que con Upstash caído (o con un host
 * que no existe, como en panel.108) cada login tardaba ~22 s antes del fail-open. Aquí: un reintento a
 * los 50 ms y un tope de `UPSTASH_TIEMPO_MAX_MS` por comando. El fail-open de quien lo usa no cambia.
 *
 * `signal` va como FUNCIÓN a propósito: así es una señal nueva por comando y, al vencer, el cliente LANZA
 * (y quien llama cae a su red en memoria). Con una señal fija, el cliente devolvería «Aborted» como si
 * fuera la respuesta de Redis, y además quedaría abortada para siempre tras el primer vencimiento.
 */
export const UPSTASH_TIEMPO_MAX_MS = 1_000;

export const OPCIONES_UPSTASH_RAPIDAS = {
  retry: { retries: 1, backoff: () => 50 },
  signal: () => AbortSignal.timeout(UPSTASH_TIEMPO_MAX_MS),
};
