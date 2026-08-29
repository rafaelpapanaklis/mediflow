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
 */
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
    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.status === 403
          ? "Tu cuenta no tiene permiso para hacer esto."
          : res.status === 401
            ? "Tu sesión caducó. Vuelve a entrar."
            : "No se pudo completar la operación. Intenta de nuevo.";
    throw new Error(message);
  }

  return data as T;
}
