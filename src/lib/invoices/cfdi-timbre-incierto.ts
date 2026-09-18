// ¿El timbre PUDO haber salido? — la diferencia entre «Facturapi lo rechazó» y
// «Facturapi no nos contestó».
//
// PROBLEMA QUE RESUELVE (H-8). POST /api/cfdi aparta la factura en `cfdiUuid`
// justo antes de pedir el timbre y suelta ese apartado si algo falla, para que
// se pueda corregir y reintentar. Correcto… salvo en un caso: si la respuesta
// HTTP se pierde DESPUÉS de que Facturapi timbró —un corte de red, un 504 del
// gateway, un timeout—, la excepción salía igual que un rechazo, el apartado se
// soltaba y el reintento emitía un SEGUNDO CFDI. Dos timbres cobrados y dos
// comprobantes vigentes ante el SAT que, además, en dental no se pueden
// cancelar desde el panel.
//
// ANTE LA DUDA, «SÍ PUDO». Dejar una factura apartada es molesto y se
// desatasca mirando el panel de Facturapi; soltarla cuando el SAT ya timbró es
// un CFDI duplicado que cuesta dinero y no se deshace solo. Por eso todo lo que
// no sea una respuesta clara de Facturapi cuenta como incierto.
//
// DOS FUENTES, EN ESTE ORDEN:
//   1. La marca que pone `createInvoice` (lib/facturapi.ts). Es quien vio la
//      respuesta —o la falta de ella— y por eso manda: si habla, se le cree.
//   2. La heurística sobre el error, para todo lo que llegue sin marcar (otra
//      capa, una librería, código viejo).
//
// Es el MISMO criterio que el vertical educativo ya aplica en
// `src/lib/edu/facturacion.ts` (`pudoHaberTimbrado`), escrito aquí como módulo
// PURO —sin Prisma, sin red, sin next/server— para que lo use también el dental
// y para poder probarlo entero. El educativo no se toca desde aquí (es otro
// vertical); cuando alguien entre a ese archivo, debería importar esto y borrar
// su copia: hoy su heurística no cubre el 504 con cuerpo HTML.

/** Marca que `createInvoice` pone en el error. */
export const TIMBRE_INCIERTO_KEY = "timbreIncierto";

/**
 * Anota en el error si el timbre PUDO haber salido (`true`) o si Facturapi
 * contestó y NO timbró (`false`). Devuelve el mismo error para poder hacer
 * `throw marcarTimbre(err, true)`.
 *
 * Es una propiedad normal sobre el Error, no una subclase: así sobrevive a que
 * el módulo se cargue dos veces (bundler, mocks de test) sin que un
 * `instanceof` falle por identidad.
 */
export function marcarTimbre<E>(err: E, incierto: boolean): E {
  if (err && typeof err === "object") {
    try {
      Object.defineProperty(err, TIMBRE_INCIERTO_KEY, {
        value: incierto,
        enumerable: false,   // que no salga en un JSON.stringify del error
        configurable: true,
        writable: true,
      });
    } catch {
      // Un error congelado no se puede marcar: la heurística de abajo decide.
    }
  }
  return err;
}

/**
 * Errores de transporte: la petición pudo salir y la respuesta perderse.
 *
 * `fetch` de Node falla con TypeError("fetch failed") y la causa real en
 * `cause`; `AbortSignal.timeout` aborta con DOMException TimeoutError. Se
 * miran las dos, y además el texto, porque el mensaje viaja mejor que el tipo
 * entre capas.
 */
const TRANSPORTE = /fetch failed|network|socket|timeout|timed out|econn|enotfound|eai_again|abort/i;

/** Nombres de error que SIEMPRE son transporte, sin mirar el mensaje. */
const NOMBRES_TRANSPORTE = new Set(["TypeError", "AbortError", "TimeoutError", "FetchError"]);

/**
 * Nuestros propios mensajes de «no se sabe».
 *
 * Existe porque la marca se puede perder por el camino —un error congelado, un
 * `new Error(err.message)` de una capa futura, una serialización— y sin esto la
 * heurística leía nuestros mensajes de duda como si fueran un rechazo y soltaba
 * el apartado: justo al revés de lo que dice este módulo. Si el texto sobrevive,
 * el criterio sobrevive con él.
 */
const DUDA_PROPIA = /no se sabe si el cfdi|sin un motivo legible|sin uuid|respuesta ilegible/i;

/**
 * `true` = el timbre pudo haber salido; NO sueltes el apartado.
 * `false` = Facturapi contestó y no timbró; se puede soltar y reintentar.
 */
export function pudoHaberTimbrado(err: unknown): boolean {
  // 1) La marca de quien vio la respuesta gana sobre cualquier heurística.
  const marca = (err as any)?.[TIMBRE_INCIERTO_KEY];
  if (typeof marca === "boolean") return marca;

  // 2) Sin marca: lo que no se reconoce cuenta como incierto (lado seguro).
  if (!(err instanceof Error)) return true;
  if (NOMBRES_TRANSPORTE.has(err.name)) return true;
  if (TRANSPORTE.test(err.message)) return true;
  if (DUDA_PROPIA.test(err.message)) return true;

  // La `cause` de un TypeError de fetch trae el error real (ECONNRESET…), y a
  // veces lo que llega es el envoltorio con un mensaje genérico.
  const causa = (err as any).cause;
  if (causa) {
    if (typeof causa?.code === "string" && /^(econn|enotfound|eai_again|etimedout|epipe)/i.test(causa.code)) {
      return true;
    }
    if (causa instanceof Error && TRANSPORTE.test(causa.message)) return true;
  }

  // Un mensaje escrito por Facturapi («El RFC no es válido») es una respuesta:
  // hubo ida y vuelta y no hubo timbre.
  return false;
}

/** Lo que se le dice a la clínica cuando no sabemos si el timbre salió. */
export const CFDI_TIMBRE_INCIERTO_ERROR =
  "La conexión con Facturapi se cortó y NO se sabe si el CFDI llegó a timbrarse. " +
  "La factura quedó apartada a propósito y NO se puede volver a timbrar desde aquí: " +
  "si el timbre sí salió, intentarlo otra vez emitiría un segundo CFDI ante el SAT. " +
  "Escríbenos a soporte con el folio de la factura para revisarlo en Facturapi.";
