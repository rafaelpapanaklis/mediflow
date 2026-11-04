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
 * DNS rebinding: la reja resuelve el DNS y la conexión volvía a resolverlo (Node no cachea), así que
 * un dominio con TTL 0 que alterna una IP pública y 127.0.0.1 pasaba la reja y conectaba adentro. Ahora
 * la petición va con `http(s).get` y un `lookup` propio que revisa con `esIpPublica` la IP que de
 * verdad se usa (y una IP literal, que Node conecta sin `lookup`, se revisa antes).
 *
 * Solo servidor (`node:dns`, `node:http`, `node:https`).
 */

/** 2 MB de sobra para un logo. */
export const LOGO_REMOTO_MAX_BYTES = 2_000_000;
export const LOGO_REMOTO_TIMEOUT_MS = 4000;

/**
 * ¿Se puede visitar esta URL desde el servidor? http(s) en su puerto de siempre, host que no sea
 * localhost y que RESUELVA solo a IP públicas (no basta con mirar el texto: `169.254.169.254.nip.io`
 * o un dominio con un registro A interno atraviesan cualquier filtro de cadenas).
 *
 * El DNS rebinding (que la conexión resuelva otra IP) lo cierra el `lookup` de `descargarLogoRemoto`.
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
    if (a === 198 && (b === 18 || b === 19)) return false; // pruebas de red (198.18.0.0/15)
    if (a === 192 && b === 0 && Number(v4[3]) === 0) return false; // 192.0.0.0/24 (IETF)
    if (a >= 224) return false; // multicast y reservados
    return true;
  }

  // IPv6
  if (ip === "::" || ip === "::1") return false;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return false; // única local
  if (/^fe[89ab]/.test(ip)) return false; // enlace local
  if (/^fe[c-f]/.test(ip)) return false; // site-local (fec0::/10, obsoleta)
  if (ip.startsWith("ff")) return false; // multicast
  if (ip.startsWith("2002:")) return false; // 6to4: lleva una IPv4 dentro (2002:7f00:1::)
  if (/^2001:0{0,4}:/.test(ip)) return false; // Teredo (2001:0::/32): también lleva una IPv4
  const h = hextetos(ip);
  if (h && h[0] === 0x100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return false; // descarte 100::/64
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

/** Los 8 hextetos de una IPv6 sin IPv4 incrustada (`100::1` → [0x100,0,…,1]); null si no se entiende. */
function hextetos(ip: string): number[] | null {
  const sinZona = ip.split("%")[0];
  if (sinZona.includes(".")) return null;
  const partes = sinZona.split("::");
  if (partes.length > 2) return null;
  const izq = partes[0] ? partes[0].split(":") : [];
  const der = partes.length === 2 && partes[1] ? partes[1].split(":") : [];
  const faltan = 8 - izq.length - der.length;
  if (partes.length === 1 ? faltan !== 0 : faltan < 1) return null;
  const todos = [...izq, ...Array(partes.length === 2 ? faltan : 0).fill("0"), ...der];
  if (!todos.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return null;
  return todos.map((x) => parseInt(x, 16));
}

export interface OpcionesDeLogoRemoto {
  timeoutMs?: number;
  maxBytes?: number;
  /** Solo para las pruebas (que sirven el logo desde 127.0.0.1): quién decide si se visita. */
  esSegura?: (url: string) => Promise<boolean>;
  /** Solo para las pruebas: qué IP acepta la conexión (por defecto `esIpPublica`). */
  ipPermitida?: (ip: string) => boolean;
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
    const res = await pedir(actual, opciones.ipPermitida ?? esIpPublica, signal);
    if (!res) {
      console.warn("[logo-remoto] logo rechazado: la conexión iba a una IP no pública");
      return null;
    }
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const destino = res.headers.location;
      res.destroy();
      if (!destino || saltos >= LOGO_REMOTO_MAX_REDIRECCIONES) return null;
      actual = new URL(destino, actual).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      return null;
    }
    const declarado = Number(res.headers["content-length"]);
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      res.destroy();
      return null;
    }
    const trozos: Buffer[] = [];
    let total = 0;
    for await (const trozo of res as AsyncIterable<Buffer>) {
      total += trozo.byteLength;
      if (total > maxBytes) {
        res.destroy();
        return null;
      }
      trozos.push(trozo);
    }
    if (total === 0) return null;
    return { buf: Buffer.concat(trozos), contentType: String(res.headers["content-type"] ?? "") };
  }
}

const IP_NO_PERMITIDA = "IP_NO_PERMITIDA";

/**
 * Un GET con `http`/`https` de Node cuya conexión SOLO va a una IP que `ipPermitida` acepta: el `lookup`
 * propio resuelve y revisa la misma IP con la que se conecta (sin la ventana del rebinding). Una IP
 * literal no pasa por `lookup` en Node, así que se revisa aquí antes. `null` = IP rechazada.
 */
async function pedir(
  url: string,
  ipPermitida: (ip: string) => boolean,
  signal: AbortSignal,
): Promise<import("node:http").IncomingMessage | null> {
  const [http, https, net, dns] = await Promise.all([
    import("node:http"),
    import("node:https"),
    import("node:net"),
    import("node:dns"),
  ]);
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !ipPermitida(host)) return null;

  const lookup = ((hostname: string, options: import("node:dns").LookupOptions, callback: (...a: unknown[]) => void) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, direcciones) => {
      if (err) return callback(err);
      const lista = direcciones as import("node:dns").LookupAddress[];
      if (lista.length === 0 || !lista.every((d) => ipPermitida(d.address))) {
        return callback(Object.assign(new Error("IP no permitida"), { code: IP_NO_PERMITIDA }));
      }
      if (options.all) return callback(null, lista);
      return callback(null, lista[0].address, lista[0].family);
    });
  }) as unknown as import("node:net").LookupFunction;

  const cliente = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    // `agent: false`: socket nuevo cada vez (uno reutilizado del agente global no pasaría por `lookup`).
    // User-Agent porque algunos CDN/WAF rechazan peticiones sin él (`fetch` mandaba `node`), e
    // `identity` para que nadie conteste comprimido (`fetch` descomprimía; `http.get` no).
    const headers = { accept: "image/*", "user-agent": "DaleControl-logo/1.0", "accept-encoding": "identity" };
    const req = cliente.get(u, { signal, lookup, agent: false, headers }, resolve);
    req.on("error", (e: NodeJS.ErrnoException) => (e.code === IP_NO_PERMITIDA ? resolve(null) : reject(e)));
  });
}
