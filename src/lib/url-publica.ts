// La URL PÚBLICA de una petición, para construir un `Location` de redirect.
//
// `request.url` / `request.nextUrl` traen el origen INTERNO con el que arrancó
// el servidor. En Vercel da igual —la plataforma resuelve el host— pero
// AUTOALOJADO DETRÁS DE UN PROXY (dev.108 / panel.108: `next start -H
// 127.0.0.1`, Caddy delante) un `Location` armado con ellos sale como
// `https://localhost:3301/login` y el navegador se va a su propia máquina
// (ERR_SSL_PROTOCOL_ERROR tras «Crea tu contraseña», H11 de la revisión final).
//
// El host sale de `x-forwarded-host` (lo que el proxy dice que pidió el
// navegador) y, si no está, de `host`. Sin ninguna de las dos, se queda como
// estaba (Vercel, `next dev` a pelo).
//
// ⚠️ Esas cabeceras se las puede inventar quien llame directo al puerto: esto
// vale SOLO para decidir a dónde mandar un redirect —nunca para autorizar,
// validar origen ni firmar nada—. El CSRF del middleware sigue comparando
// contra `host`.
//
// Sin imports de Next a propósito: lo cargan el middleware (Edge) y rutas Node.

interface ConCabeceras {
  headers: { get(nombre: string): string | null };
}

const primero = (v: string | null) => (v ?? "").split(",")[0].trim();

/** Origen público (`https://host`) de la petición, o `null` si no se puede saber. */
export function origenPublicoDe(req: ConCabeceras, urlInterna: string): string {
  const interna = new URL(urlInterna);
  // Una cadena de proxies deja "a.example, b.interno": manda el primero.
  const host = primero(req.headers.get("x-forwarded-host")) || primero(req.headers.get("host"));
  if (!host) return interna.origin;
  const proto = primero(req.headers.get("x-forwarded-proto")).replace(/:$/, "") || interna.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

/** `new URL(ruta, origenPúblico)`: para `NextResponse.redirect(urlPublicaDe(...))`. */
export function urlPublicaDe(req: ConCabeceras & { url: string }, ruta: string): URL {
  return new URL(ruta, origenPublicoDe(req, req.url));
}

/**
 * Para el middleware: la misma URL de la petición con host, puerto y protocolo
 * públicos. Devuelve un clon de `nextUrl` (se le cambia `pathname` y se redirige).
 */
export function urlPublica<T extends ConCabeceras & { nextUrl: URL & { clone(): any } }>(request: T) {
  const url = request.nextUrl.clone() as URL;
  const reenviado = primero(request.headers.get("x-forwarded-host")) || primero(request.headers.get("host"));
  if (!reenviado) return url;

  url.host = reenviado;
  // El setter de `host` SOLO toca el puerto si el valor lo trae. Sin esto,
  // `panel.108-181-149-131.sslip.io` + el 3300 interno = `panel.108-…:3300`.
  if (!reenviado.includes(":")) url.port = "";

  const proto = primero(request.headers.get("x-forwarded-proto"));
  if (proto) url.protocol = `${proto.replace(/:$/, "")}:`;
  return url;
}
