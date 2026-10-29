/**
 * El logo de la clínica (`Clinic.logoUrl`) visto desde el SERVIDOR — auditoría de seguridad
 * «cloudflare», nº2 (SSRF).
 *
 * 🔴 POR QUÉ: `logoUrl` lo escribe la propia clínica en Configuración, y los PDF (receta, presupuesto,
 * cabecera de factura, nota, consentimiento…) lo BAJAN desde nuestro servidor. Sin reja, una clínica
 * podía apuntarlo a `http://169.254.169.254/…` (metadatos de la nube), a `127.0.0.1:<puerto>` o a la red
 * privada —o a una URL pública que responda 302 hacia ahí— y era nuestro servidor el que hacía la
 * petición, con la red interna al alcance. La receta pública (`/api/prescriptions/[id]/verify/pdf`) la
 * dispara sin sesión.
 *
 * La reja es COPIA de `isSafeRemoteLogoUrl` de `src/lib/realty/media.ts` (esa vertical no se toca), con
 * una diferencia: aquí también pasa `http:` en el puerto 80, porque `esUrlDeLogoValida` siempre lo
 * aceptó y una clínica con su logo en http no debe quedarse sin logo. Lo que importa para el SSRF —
 * que la IP de destino sea pública, sin puertos raros, y que cada redirección se revise igual— es
 * lo mismo.
 *
 * Solo servidor (resuelve DNS con `node:dns`).
 */

/** 2 MB de sobra para un logo. */
export const LOGO_REMOTO_MAX_BYTES = 2_000_000;
export const LOGO_REMOTO_TIMEOUT_MS = 4000;

/**
 * ¿Se puede visitar esta URL desde el servidor? http(s) en su puerto de siempre, host que no sea
 * localhost y que RESUELVA solo a IP públicas (no basta con mirar el texto: `169.254.169.254.nip.io`
 * o un dominio con un registro A interno atraviesan cualquier filtro de cadenas).
 *
 * Queda el hueco teórico del DNS rebinding (que la resolución del fetch devuelva otra IP); para un
 * logo, esto más las redirecciones revisadas y el tope de bytes es la proporción correcta.
 */
export async function esUrlRemotaSegura(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "https:") {
    if (u.port && u.port !== "443") return false;
  } else if (u.protocol === "http:") {
    if (u.port && u.port !== "80") return false;
  } else {
    return false;
  }
  if (u.username || u.password) return false;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;

  let direcciones: string[];
  try {
    const dns = await import("node:dns/promises");
    const encontradas = await dns.lookup(host, { all: true, verbatim: true });
    direcciones = encontradas.map((a) => a.address);
  } catch {
    return false; // no resuelve: no se visita
  }
  if (direcciones.length === 0) return false;
  return direcciones.every(esIpPublica);
}

/** ¿Esta IP está fuera de la red privada? Se rechaza todo lo dudoso. */
export function esIpPublica(address: string): boolean {
  const ip = address.toLowerCase();

  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return false; // este host y privadas
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false; // metadatos de la nube y APIPA
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast y reservados
    return true;
  }

  // IPv6
  if (ip === "::" || ip === "::1") return false;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return false; // única local
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return false; // enlace local
  }
  // ::ffff:10.0.0.1 — una IPv4 privada disfrazada de IPv6. `new URL()` la normaliza a hexadecimal
  // (`::ffff:a00:1`), así que se reconocen las dos formas (la copia de realty solo ve la primera).
  const mapeada = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapeada) return esIpPublica(mapeada[1]);
  const mapeadaHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapeadaHex) {
    const [x, y] = [parseInt(mapeadaHex[1], 16), parseInt(mapeadaHex[2], 16)];
    return esIpPublica(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`);
  }
  // Otras formas que llevan una IPv4 dentro (compatible `::a.b.c.d`/`::x:y`, NAT64 `64:ff9b::`): fuera.
  if (ip.startsWith("::") || ip.startsWith("64:ff9b:")) return false;
  return true;
}

export interface OpcionesDeLogoRemoto {
  timeoutMs?: number;
  maxBytes?: number;
  /** Solo para las pruebas (que sirven el logo desde 127.0.0.1): quién decide si se visita. */
  esSegura?: (url: string) => Promise<boolean>;
}

/** Un `http://` que salta a `https://` o a `www.` es lo normal; más de tres saltos, no. */
export const LOGO_REMOTO_MAX_REDIRECCIONES = 3;

/**
 * Baja el logo con la reja. Cada destino se revisa ANTES de pedirlo, también el de cada redirección:
 * se siguen a mano (`redirect: "manual"`, hasta 3), porque con `follow` un 302 de una URL pública
 * saltaba a una IP interna sin que nadie lo viera. Un solo plazo para TODO —DNS incluido, que no
 * tiene timeout propio— y tope de bytes por `content-length` y mientras se lee (una respuesta sin
 * longitud no se carga entera en memoria). Nunca lanza: devuelve null y el PDF sale sin logo.
 */
export async function descargarLogoRemoto(
  url: string | null | undefined,
  opciones: OpcionesDeLogoRemoto = {},
): Promise<{ buf: Buffer; contentType: string } | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const signal = AbortSignal.timeout(opciones.timeoutMs ?? LOGO_REMOTO_TIMEOUT_MS);
  const vencido = new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true }));
  try {
    return await Promise.race([bajar(url, opciones, signal), vencido]);
  } catch {
    return null;
  }
}

async function bajar(
  url: string,
  opciones: OpcionesDeLogoRemoto,
  signal: AbortSignal,
): Promise<{ buf: Buffer; contentType: string } | null> {
  const maxBytes = opciones.maxBytes ?? LOGO_REMOTO_MAX_BYTES;
  const esSegura = opciones.esSegura ?? esUrlRemotaSegura;
  let actual = url;
  for (let saltos = 0; ; saltos++) {
    if (!(await esSegura(actual))) {
      console.warn("[logo-remoto] logo rechazado por la reja de SSRF");
      return null;
    }
    const res = await fetch(actual, { cache: "no-store", redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!destino || saltos >= LOGO_REMOTO_MAX_REDIRECCIONES) return null;
      actual = new URL(destino, actual).toString();
      continue;
    }
    if (!res.ok || !res.body) return null;
    const declarado = Number(res.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      await res.body.cancel().catch(() => undefined);
      return null;
    }
    const lector = res.body.getReader();
    const trozos: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await lector.cancel().catch(() => undefined);
        return null;
      }
      trozos.push(value);
    }
    if (total === 0) return null;
    return { buf: Buffer.concat(trozos), contentType: res.headers.get("content-type") ?? "" };
  }
}
