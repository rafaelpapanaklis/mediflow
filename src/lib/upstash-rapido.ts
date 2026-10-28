/**
 * Opciones del cliente de Upstash Redis para que un Redis caído NO frene a nadie (login rápido, 28-oct).
 *
 * Por defecto `@upstash/redis` reintenta 5 veces con espera exponencial (50 ms · e^n): ~4,4 s por
 * comando antes de rendirse. El login hace 5 comandos en serie, así que con Upstash caído (o con un host
 * que no existe, como en panel.108) cada login tardaba ~22 s antes del fail-open. El fail-open de quien
 * lo usa no cambia. Dos juegos de opciones:
 *
 *  · RÁPIDAS (rate-limit, bloqueo de intentos del login, «Clínicas en línea»): un reintento a los 50 ms
 *    y un tope de `UPSTASH_TIEMPO_MAX_MS` por comando. Si Redis tarda, se cae a memoria y se sigue.
 *  · CANDADOS (`acquireLock`/`releaseLock` de failban: envío del inbox, turno del bot de WhatsApp, lead
 *    público, uso único del TOTP, DICOM, cobro): dos reintentos y `UPSTASH_TIEMPO_MAX_CANDADOS_MS`. Ante
 *    un error el candado se ABRE (fail-open), y abrirlo de más es un WhatsApp duplicado: con Upstash
 *    lento (no caído) tienen que esperar la respuesta buena (v2, m-1 de la revisión de t8).
 *
 * `signal` va como FUNCIÓN a propósito: así es una señal nueva por comando (y cubre sus reintentos) y,
 * al vencer, el cliente LANZA y quien llama cae a su red en memoria. Una señal fija quedaría abortada
 * tras el primer vencimiento y todos los comandos siguientes fallarían al instante.
 */
export const UPSTASH_TIEMPO_MAX_MS = 1_000;
export const UPSTASH_TIEMPO_MAX_CANDADOS_MS = 3_000;

export const OPCIONES_UPSTASH_RAPIDAS = {
  retry: { retries: 1, backoff: () => 50 },
  signal: () => AbortSignal.timeout(UPSTASH_TIEMPO_MAX_MS),
};

/** Las esperas entre reintentos son las de la librería (50 ms, ~136 ms); el tope total, 3 s. */
export const OPCIONES_UPSTASH_CANDADOS = {
  retry: { retries: 2, backoff: (n: number) => Math.exp(n) * 50 },
  signal: () => AbortSignal.timeout(UPSTASH_TIEMPO_MAX_CANDADOS_MS),
};
