// src/lib/recarga-despliegue.ts
//
// Recarga la página UNA vez cuando el navegador se quedó con la versión anterior.
//
// 🔴 POR QUÉ: cada despliegue cambia el nombre (el hash) de los fragmentos de JS.
// Una pestaña que ya estaba abierta sigue pidiendo los nombres viejos, el
// servidor responde 404 y React se queda sin el componente: pantalla en blanco o
// la tarjeta de error, y el usuario sin saber que bastaba con recargar.
//
// SIN dependencias y sin React: los límites de error son la última red y no
// pueden apoyarse en algo que también puede fallar. Todo lo que toca al
// navegador entra por `Entorno`, así que se prueba con `tsx --test`.
//
// ── EL GUARDIA ────────────────────────────────────────────────────────────
// Antes de recargar se apunta la hora en sessionStorage. Mientras ese apunte
// tenga menos de VENTANA_MS no se vuelve a recargar: si el fragmento sigue
// faltando tras la recarga (despliegue roto, bloqueador de anuncios), se enseña
// el error en vez de entrar en bucle. El apunte caduca para que un SEGUNDO
// despliegue, horas después y en la misma pestaña, también se recupere solo.
// Sin sessionStorage no hay guardia posible, así que no se recarga.

export const CLAVE_RECARGA = "dc:recarga-despliegue";

/** Como mucho una recarga automática por pestaña en este lapso. */
export const VENTANA_MS = 5 * 60 * 1000;

/**
 * Lo que un límite de error espera con «Actualizando…» en pantalla antes de dar
 * la recarga por no ocurrida y enseñar la tarjeta de error con sus botones.
 */
export const ESPERA_RECARGA_MS = 8000;

const PATRONES: RegExp[] = [
  /loading (css )?chunk [^\s]+ failed/i, // webpack
  /failed to load chunk/i, // turbopack
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
];

function coincide(error: unknown): boolean {
  if (typeof error === "string") return PATRONES.some(p => p.test(error));
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === "ChunkLoadError") return true;
  return typeof e.message === "string" && PATRONES.some(p => p.test(e.message as string));
}

/**
 * ¿El error es de no haber podido cargar un fragmento de JS o de CSS?
 *
 * Mira también `cause` (hasta 3 niveles): hay envoltorios que relanzan el error
 * original dentro de otro. Un «Failed to fetch» pelado NO cuenta: es una llamada
 * a la API que falló, y recargar ahí solo le borraría al usuario lo que tecleó.
 */
export function esErrorDeFragmento(error: unknown): boolean {
  let actual: unknown = error;
  for (let nivel = 0; nivel < 3 && actual != null; nivel++) {
    if (coincide(actual)) return true;
    if (typeof actual !== "object") return false;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

export interface Entorno {
  /** null cuando sessionStorage no existe o está bloqueado. */
  almacen: Pick<Storage, "getItem" | "setItem"> | null;
  ahora: number;
  enLinea: boolean;
  recargar: () => void;
}

/** El entorno real del navegador. En el servidor devuelve uno que nunca recarga. */
export function entornoDelNavegador(): Entorno {
  if (typeof window === "undefined") {
    return { almacen: null, ahora: Date.now(), enLinea: false, recargar: () => {} };
  }
  let almacen: Entorno["almacen"] = null;
  try {
    // En modo privado o con las cookies bloqueadas, solo tocarlo ya lanza.
    almacen = window.sessionStorage;
  } catch {
    almacen = null;
  }
  return {
    almacen,
    ahora: Date.now(),
    enLinea: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    recargar: () => window.location.reload(),
  };
}

/**
 * ¿Se puede recargar ahora? Solo LEE: sirve para decidir, mientras se pinta, si
 * se enseña «Actualizando…» o la tarjeta de error.
 */
export function puedeRecargar(entorno: Entorno = entornoDelNavegador()): boolean {
  // Sin red, recargar cambia una pantalla de error por la de «sin conexión».
  if (!entorno.enLinea || !entorno.almacen) return false;
  try {
    const apunte = entorno.almacen.getItem(CLAVE_RECARGA);
    if (apunte == null) return true;
    const cuando = Number(apunte);
    // Un apunte ilegible se toma por reciente: ante la duda, no se recarga.
    if (!Number.isFinite(cuando)) return false;
    return entorno.ahora - cuando >= VENTANA_MS;
  } catch {
    return false;
  }
}

/**
 * Recarga si el guardia lo permite y devuelve si lo hizo. El apunte se escribe
 * ANTES de recargar: si no se puede escribir, no se recarga.
 */
export function recargarUnaVez(entorno: Entorno = entornoDelNavegador()): boolean {
  if (!puedeRecargar(entorno)) return false;
  try {
    entorno.almacen!.setItem(CLAVE_RECARGA, String(entorno.ahora));
  } catch {
    return false;
  }
  enCurso = true;
  entorno.recargar();
  return true;
}

// Vive lo que vive la página: la propia recarga la devuelve a false.
let enCurso = false;

/**
 * ¿Ya se pidió la recarga en ESTA carga de la página? El mismo fallo lo pueden
 * ver dos a la vez (el oyente global y un límite de error). El segundo encuentra
 * el guardia puesto, pero no es un bucle: la recarga va en camino, y no debe
 * pintar la tarjeta de error ni el aviso durante ese instante.
 */
export function hayRecargaEnCurso(): boolean {
  return enCurso;
}

/** Recarga solo si el error es de fragmento. Devuelve si ESTA llamada recargó. */
export function recargarSiEsDeFragmento(
  error: unknown,
  entorno: Entorno = entornoDelNavegador(),
): boolean {
  if (!esErrorDeFragmento(error)) return false;
  return recargarUnaVez(entorno);
}

/**
 * Lo que usan los límites de error, en dos tiempos:
 *  · `seVaARecargar` al PINTAR (solo lee): ¿se enseña «Actualizando…»?
 *  · `asegurarRecarga` en el EFECTO: la pide si nadie la pidió aún, y devuelve
 *    si hay una recarga en camino, la haya pedido quien la haya pedido.
 */
export function seVaARecargar(error: unknown): boolean {
  return esErrorDeFragmento(error) && (hayRecargaEnCurso() || puedeRecargar());
}

export function asegurarRecarga(error: unknown): boolean {
  if (!esErrorDeFragmento(error)) return false;
  if (hayRecargaEnCurso()) return true;
  return recargarUnaVez();
}
