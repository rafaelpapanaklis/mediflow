/**
 * DaleControl INSTITUCIONAL — DE DÓNDE SALIÓ UNA FIRMA.
 *
 * SERVIDOR, sin prisma. Un archivo de doce líneas útiles porque la
 * alternativa es que cada endpoint que firme algo vuelva a decidir por su
 * cuenta cómo leer `x-forwarded-for`, y el segundo que lo haga leerá otra
 * cabecera.
 *
 * 🔴 ESTO NO SE LEE DEL BODY. Nunca. Un `signedIp` que manda el navegador es
 * un dato que el firmante elige, y entonces no es un rastro: es una casilla.
 * La IP y el user-agent salen de la petición HTTP y de ningún otro sitio.
 *
 * ⚠️ Lo que este rastro SÍ es y lo que NO es. Detrás de un proxy,
 * `x-forwarded-for` la pone la infraestructura (en Vercel, el edge) y es
 * fiable; en un servidor expuesto directo, un cliente la puede inventar. Se
 * guarda igual, porque el caso que importa —"¿desde qué sesión se firmó esto
 * el 3 de marzo?"— se contesta con esto o no se contesta con nada. No es una
 * prueba de identidad; la identidad es `decidedById`, que viene de la sesión.
 */

/** Tope de las dos columnas del schema. Cortar aquí evita que Postgres
 *  reviente la escritura de una firma por una cabecera larguísima. */
const IP_MAX = 60;
const UA_MAX = 300;

export interface EduRequestSignature {
  ip: string | null;
  userAgent: string | null;
}

export function eduRequestSignature(request: Request): EduRequestSignature {
  const h = request.headers;

  // El primer valor de x-forwarded-for es el cliente; los siguientes son los
  // proxies por los que pasó. Quedarse con la lista entera llenaría la
  // columna de infraestructura y dejaría fuera lo único que interesa.
  const fwd = h.get("x-forwarded-for");
  const real = h.get("x-real-ip");
  const ip = (fwd ? fwd.split(",")[0] : real ?? "").trim();
  const ua = (h.get("user-agent") ?? "").trim();

  return {
    ip: ip ? ip.slice(0, IP_MAX) : null,
    userAgent: ua ? ua.slice(0, UA_MAX) : null,
  };
}
