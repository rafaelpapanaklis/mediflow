import { EDU_LOGIN_MENSAJES } from "@/lib/edu/puerta-core";

/**
 * Un solo `fetch` para todo el vertical.
 *
 * Existe por una razón muy concreta: los endpoints del instituto contestan
 * `{ error: "…" }` con un mensaje ESCRITO PARA UNA PERSONA ("La matrícula
 * A-01 ya está en uso"), y ese mensaje solo sirve si la pantalla lo lee. Un
 * `fetch` suelto en cada componente acaba enseñando "Error 409" o, peor,
 * un "Guardado" verde encima de algo que no se guardó.
 *
 * Reglas:
 *  · Si la respuesta no es 2xx → lanza Error con el texto del servidor.
 *  · Si el cuerpo no es JSON (una página de error de Next, un 502 del proxy)
 *    → lanza un mensaje genérico en español, no "Unexpected token < in JSON".
 *  · No reintenta. Reintentar una escritura sin saber si la primera pasó es
 *    cómo se duplican filas.
 *  · Un 401 DEVUELVE AL LOGIN (ver abajo).
 */

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-156 · UN 401 DEVUELVE AL LOGIN.
 *
 * Hasta esta ola, un 401 se traducía a «Tu sesión caducó. Vuelve a entrar»
 * y NINGÚN llamador redirigía. La escena real: la cajera vuelve de comer,
 * guarda un pago, lee el mensaje, lo intenta otra vez, lee lo mismo. Nada
 * la lleva a /instituto/login; la única salida era recargar a mano, y hay
 * que saber que eso es lo que hay que hacer.
 *
 * Cómo se hace, y por qué así:
 *
 *  · NAVEGACIÓN DURA (`window.location.href`) y no `router.push`: este
 *    módulo no es un componente y no tiene router, y además hace falta que
 *    el árbol de React se DESMONTE — media pantalla ya está pintada con
 *    datos de una sesión que ya no existe.
 *
 *  · Se lleva `?volver=` con la ruta actual, VALIDADA al leerla
 *    (eduRutaDeVuelta, puerta-core.ts), para que al volver a entrar
 *    aterrice donde estaba y no en Inicio. Guardar un pago, que te eche, y
 *    que al volver te deje en la pantalla de bienvenida es perder el hilo
 *    dos veces.
 *
 *  · UNA SOLA VEZ (`yendoAlLogin`). Una pantalla que dispara cuatro
 *    peticiones a la vez recibiría cuatro 401 y pediría cuatro
 *    navegaciones; con la bandera, la primera manda y las demás solo
 *    lanzan su error.
 *
 *  · Y AUN ASÍ SE LANZA EL ERROR. La navegación no es instantánea: sin el
 *    throw, el `try` de quien llamó seguiría a la línea siguiente y podría
 *    pintar un "Guardado" verde sobre algo que no se guardó, durante el
 *    segundo que tarda en irse la página.
 *
 * ⚠️ Esto SOLO se aplica a las pantallas del panel, que es lo único que
 * usa `eduRequest`. La carta de consentimiento y el presupuesto que abre
 * el PACIENTE sin sesión usan `fetch` directo a propósito: mandar a un
 * paciente al login del instituto no tendría ningún sentido.
 * ═══════════════════════════════════════════════════════════════════════
 */
let yendoAlLogin = false;

function alLogin(): void {
  if (typeof window === "undefined") return;
  if (yendoAlLogin) return;
  const aqui = `${window.location.pathname}${window.location.search}`;
  // Solo se ofrece volver a una ruta del panel. Fuera de /instituto no hay
  // nada a lo que regresar desde este login.
  const volver = aqui.startsWith("/instituto/") ? `&volver=${encodeURIComponent(aqui)}` : "";
  yendoAlLogin = true;
  window.location.href = `/instituto/login?motivo=sesion${volver}`;
}

export async function eduRequest<T>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
  } catch {
    throw new Error("No se pudo conectar. Revisa tu conexión y vuelve a intentarlo.");
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    // H-156: la sesión se cayó → a la puerta, con el camino de vuelta.
    if (res.status === 401) alLogin();

    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.status === 403
          ? "Tu cuenta no tiene permiso para hacer esto."
          : res.status === 401
            ? EDU_LOGIN_MENSAJES.sesion
            : "No se pudo completar la operación. Intenta de nuevo.";
    throw new Error(message);
  }

  return data as T;
}

/**
 * `eduRequest` para un FormData (la importación de padrón sube un archivo).
 *
 * Es el mismo contrato —mismo mapeo de errores, mismo 401 a la puerta— y
 * cambia una sola cosa: NO se pone `Content-Type`. El navegador tiene que
 * escribirlo él, porque lleva el `boundary` que separa las partes; ponerlo
 * a mano es cómo se llega a un multipart que el servidor no sabe partir.
 */
export async function eduUpload<T>(url: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, cache: "no-store" });
  } catch {
    throw new Error("No se pudo subir el archivo. Revisa tu conexión y vuelve a intentarlo.");
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401) alLogin();
    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.status === 403
          ? "Tu cuenta no tiene permiso para hacer esto."
          : res.status === 401
            ? EDU_LOGIN_MENSAJES.sesion
            : res.status === 413
              ? "El archivo es demasiado grande."
              : "No se pudo procesar el archivo. Intenta de nuevo.";
    throw new Error(message);
  }

  return data as T;
}
