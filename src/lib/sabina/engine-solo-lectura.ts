/**
 * Sabina — el candado de SOLO LECTURA de la fase 1.
 *
 * 🔴 POR QUÉ EXISTE
 *
 * El motor corre las herramientas solo, en bucle, dentro de una misma petición.
 * Una herramienta que escriba dentro de ese bucle se ejecuta sin que el doctor
 * vea nada. Un «no escribas» en el prompt es una súplica, y un tipo de solo
 * lectura (`SabinaDb`) solo protege a quien lo usa: nada impide que mañana
 * alguien importe `prisma`, o el `POST` de `/api/appointments`, dentro de una
 * herramienta.
 *
 * Así que la regla no se deja en manos de quien escriba la herramienta. Mientras
 * una herramienta corre dentro del bucle (`soloLectura(...)`), este módulo
 * rechaza —en tiempo de ejecución, para TODO el proceso de esa llamada—:
 *
 *   1. Toda operación de Prisma que no sea de lectura. Se engancha en el único
 *      embudo por el que pasa cualquier consulta del cliente (`_executeRequest`
 *      del prototipo de `PrismaClient`): modelos, `$transaction`, extensiones y
 *      SQL crudo. Da igual qué instancia la lance ni desde qué archivo.
 *   2. Todo `fetch` que no sea GET/HEAD/OPTIONS (llamar a la propia API por HTTP,
 *      mandar un WhatsApp, un correo…).
 *   3. Todo `http`/`https` (`request`, `get`, `new ClientRequest`) que no sea
 *      GET/HEAD/OPTIONS —lo que usan por debajo librerías como `googleapis`— y
 *      cualquier sesión de `http2`.
 *
 * El contexto viaja por `AsyncLocalStorage`: solo afecta a la herramienta que
 * está corriendo, no a otras peticiones del mismo proceso ni al propio motor
 * (que sí tiene que hablar con Anthropic por POST fuera de este candado).
 *
 * Y si una herramienta se traga el error y contesta como si nada, el intento
 * queda apuntado y `soloLectura` lanza igual al terminar: un intento de escribir
 * nunca pasa desapercibido.
 *
 * 🔴 FALLA CERRADO. Si el embudo de Prisma no existe (una actualización de Prisma
 * lo renombró), `soloLectura` lanza en vez de correr la herramienta sin candado.
 * `npm run test:sabina-confirmacion` lo detecta antes: prueba el candado contra
 * el `@prisma/client` instalado de verdad.
 *
 * Límites conocidos, dichos para que nadie los suponga cubiertos. El candado
 * frena ACCIDENTES —una herramienta que escribe como escribe el resto del repo—,
 * no código escrito a propósito para rodearlo:
 *  · Un `SELECT` que llame a una función PROPIA de la base que escribe no se
 *    distingue de uno que lee (las del sistema que escriben sí se frenan). El repo
 *    no tiene funciones así.
 *  · Un GET que escribe en el servidor de destino (p. ej. un cron) no se frena:
 *    el método es lo único que se ve desde aquí.
 *  · Sockets crudos (`net`, `tls`): no se tocan, porque el `fetch` GET los usa. En
 *    el repo toda escritura sale por Prisma, `fetch` o `http(s)`.
 *  · Un callback registrado en un emisor ajeno que se dispara DESPUÉS de que la
 *    herramienta termina corre fuera de la fase (los `setTimeout` y las promesas
 *    que la herramienta deja sueltas, no: heredan la fase y se frenan).
 *
 * Sin `server-only`: lo importan las pruebas directamente.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { PrismaClient } from "@prisma/client";

/** Lo que se lanza cuando algo intenta escribir durante la fase de propuesta. */
export class EscrituraBloqueada extends Error {
  readonly code = "SABINA_ESCRITURA_BLOQUEADA";
  constructor(readonly intento: string, readonly fase: string) {
    super(`sabina_escritura_bloqueada: «${intento}» durante ${fase}. En la fase de propuesta no se escribe nada.`);
    this.name = "EscrituraBloqueada";
  }
}

/** El candado no se pudo poner. Nunca se corre una herramienta sin él. */
export class CandadoNoDisponible extends Error {
  readonly code = "SABINA_CANDADO_NO_DISPONIBLE";
  constructor(detalle: string) {
    super(`sabina_candado_no_disponible: ${detalle}`);
    this.name = "CandadoNoDisponible";
  }
}

interface Fase {
  /** Para el mensaje: «herramienta agendar_cita». */
  motivo: string;
  /** Cada intento de escritura bloqueado, aunque la herramienta se lo trague. */
  intentos: string[];
}

/*
 * El estado vive en `globalThis` con una clave `Symbol.for`, no en el módulo:
 * Next puede empaquetar este archivo en más de un bundle, mientras que
 * `@prisma/client` y `http` son UNA sola instancia por proceso. Con un
 * `AsyncLocalStorage` por copia del módulo, el enganche puesto por una copia no
 * vería la fase abierta por otra.
 */
const CLAVE = Symbol.for("dalecontrol.sabina.solo-lectura");
const MARCA = Symbol.for("dalecontrol.sabina.solo-lectura.enganche");

interface Global {
  als: AsyncLocalStorage<Fase>;
}

function global_(): Global {
  const g = globalThis as unknown as Record<symbol, Global | undefined>;
  if (!g[CLAVE]) g[CLAVE] = { als: new AsyncLocalStorage<Fase>() };
  return g[CLAVE]!;
}

/** ¿Estamos dentro de una fase de solo lectura? */
export function enSoloLectura(): boolean {
  return !!global_().als.getStore();
}

function bloquear(intento: string): EscrituraBloqueada | null {
  const fase = global_().als.getStore();
  if (!fase) return null;
  fase.intentos.push(intento);
  return new EscrituraBloqueada(intento, fase.motivo);
}

/* ═══════════════════════════════════════════════════════════════════════
   PRISMA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Operaciones de modelo que SOLO leen. Es una lista blanca a propósito: una
 * operación que Prisma añada mañana entra bloqueada hasta que alguien la mire.
 */
const LECTURAS_PRISMA = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** SQL crudo: se mira el texto. */
const SQL_CRUDO = new Set(["queryRaw", "executeRaw"]);

/**
 * El SQL sin literales ni comentarios: solo lo que Postgres EJECUTA. Recorre el
 * texto una vez, como el lexer de Postgres, entendiendo '…' (con ''), E'…' (con
 * barra invertida), "…", $etiqueta$…$etiqueta$, comentarios de línea y comentarios
 * de bloque anidados. `null` si algo queda sin cerrar: un texto que no se sabe
 * leer no se da por lectura.
 *
 * Quitar primero los comentarios y luego las cadenas (o al revés) con regex no
 * sirve: `SELECT '--'` escondía todo lo que venía detrás, y un literal con
 * etiqueta de dólar o con escape también (lo encontró la revisión adversarial y
 * se comprobó contra un PrismaClient real).
 */
export function codigoSql(sql: string): string | null {
  let salida = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const sig = sql[i + 1];
    if (c === "-" && sig === "-") {
      const fin = sql.indexOf("\n", i + 2);
      i = fin === -1 ? n : fin + 1;
      salida += " ";
      continue;
    }
    if (c === "/" && sig === "*") {
      let prof = 1;
      i += 2;
      while (i < n && prof > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          prof += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          prof -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (prof > 0) return null;
      salida += " ";
      continue;
    }
    if (c === "'") {
      // E'…' admite barra invertida como escape; '…' solo ''.
      const conEscapes = i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/[A-Za-z0-9_$]/.test(sql[i - 2]));
      i += 1;
      let cerrada = false;
      while (i < n) {
        if (conEscapes && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          cerrada = true;
          break;
        }
        i += 1;
      }
      if (!cerrada) return null;
      salida += "''";
      continue;
    }
    if (c === '"') {
      // U&"\0064…": el nombre va escrito con escapes y no se puede leer.
      if (i > 0 && sql[i - 1] === "&") return null;
      const inicio = i + 1;
      i += 1;
      let cerrada = false;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          cerrada = true;
          break;
        }
        i += 1;
      }
      if (!cerrada) return null;
      // Un identificador entre comillas es un NOMBRE, no un dato: `"nextval"(…)`
      // ejecuta nextval. Se deja su texto, CON las comillas, para que el filtro de
      // palabras lo vea y `"true"` (una columna) no se confunda con el literal.
      salida += ` "${sql.slice(inicio, i - 1)}" `;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m && !(i > 0 && /[A-Za-z0-9_]/.test(sql[i - 1]))) {
        const etiqueta = m[0];
        const fin = sql.indexOf(etiqueta, i + etiqueta.length);
        if (fin === -1) return null;
        i = fin + etiqueta.length;
        salida += "''";
        continue;
      }
    }
    salida += c;
    i += 1;
  }
  return salida;
}

/**
 * ¿Este SQL solo lee?
 *
 * Sobre el código ya sin literales ni comentarios (`codigoSql`): tiene que
 * empezar por SELECT o WITH, ser UNA sola sentencia y no nombrar nada que
 * modifique datos o deje efecto fuera de la consulta (NOTIFY, objetos grandes,
 * secuencias, `set_config` de sesión, funciones que ejecutan SQL escrito en una
 * cadena como `query_to_xml`). Ante la duda, NO: un falso positivo solo hace
 * fallar una lectura.
 *
 * `SELECT set_config('app.current_clinic_id', $1, true)` pasa: es la variable
 * de TRANSACCIÓN que pone la extensión de RLS de `@/lib/prisma`, no un dato.
 * Con `false` (de sesión, que en PgBouncer se queda pegada a la conexión) no.
 */
export function esSqlDeLectura(sql: string): boolean {
  if (typeof sql !== "string") return false;
  const codigo = codigoSql(sql);
  if (codigo === null) return false;
  const limpio = codigo
    .replace(/\bset_config\s*\(\s*''\s*,\s*(\$\d*|'')\s*,\s*true\s*\)/gi, " ")
    .trim();
  if (!/^(select|with)\b/i.test(limpio)) return false;
  if (/;\s*\S/.test(limpio)) return false;
  return !/\b(insert|update|delete|merge|upsert|truncate|drop|alter|create|grant|revoke|copy|call|do|lock|vacuum|analyze|refresh|reindex|cluster|comment|listen|unlisten|notify|prepare|execute|into|set_config|nextval|setval|dblink\w*|query_to_\w+|cursor_to_\w+|lo_\w+|pg_\w+)\b/i.test(
    limpio,
  );
}

/** El texto SQL de una petición cruda de Prisma, en las formas que usa el cliente. */
function sqlDe(args: unknown): string | null {
  const desde = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as { strings?: unknown; sql?: unknown; query?: unknown };
      if (Array.isArray(o.strings) && o.strings.every((s) => typeof s === "string")) {
        return (o.strings as string[]).join(" $ ");
      }
      if (typeof o.sql === "string") return o.sql;
      if (typeof o.query === "string") return o.query;
    }
    return null;
  };
  if (Array.isArray(args)) return desde(args[0]);
  return desde(args);
}

/** ¿Esta petición de Prisma escribe? Lo que no se reconoce, escribe. */
export function peticionPrismaEscribe(p: { action?: unknown; args?: unknown }): boolean {
  const accion = typeof p?.action === "string" ? p.action : "";
  if (LECTURAS_PRISMA.has(accion)) return false;
  if (SQL_CRUDO.has(accion)) {
    const sql = sqlDe(p.args);
    return sql === null || !esSqlDeLectura(sql);
  }
  return true;
}

function instalarEnPrisma(): void {
  const proto = (PrismaClient as unknown as { prototype: Record<string | symbol, unknown> }).prototype;
  const actual = proto._executeRequest as ((p: unknown) => Promise<unknown>) & { [MARCA]?: true };
  if (typeof actual !== "function") {
    throw new CandadoNoDisponible(
      "PrismaClient.prototype._executeRequest no existe en esta versión de Prisma; revisa engine-solo-lectura.ts",
    );
  }
  if (actual[MARCA]) return;

  const enganche = function (this: unknown, p: { action?: unknown; model?: unknown; args?: unknown }) {
    if (enSoloLectura() && peticionPrismaEscribe(p)) {
      const modelo = typeof p?.model === "string" ? `${p.model}.` : "";
      const error = bloquear(`prisma ${modelo}${String(p?.action ?? "¿?")}`);
      if (error) return Promise.reject(error);
    }
    return actual.call(this, p);
  } as typeof actual;
  enganche[MARCA] = true;
  proto._executeRequest = enganche;
}

/* ═══════════════════════════════════════════════════════════════════════
   RED
   ═══════════════════════════════════════════════════════════════════════ */

const METODOS_LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);

function metodoDeFetch(input: unknown, init: unknown): string {
  const deInit = (init as { method?: unknown } | undefined)?.method;
  if (typeof deInit === "string") return deInit.toUpperCase();
  const deInput = (input as { method?: unknown } | undefined)?.method;
  if (typeof deInput === "string") return deInput.toUpperCase();
  return "GET";
}

function instalarEnFetch(): void {
  const actual = globalThis.fetch as (typeof fetch & { [MARCA]?: true }) | undefined;
  if (typeof actual !== "function" || actual[MARCA]) return;

  const enganche = function (this: unknown, input: unknown, init?: unknown) {
    if (enSoloLectura()) {
      const metodo = metodoDeFetch(input, init);
      if (!METODOS_LECTURA.has(metodo)) {
        const error = bloquear(`fetch ${metodo}`);
        if (error) return Promise.reject(error);
      }
    }
    return (actual as (...a: unknown[]) => unknown).apply(this, arguments as unknown as unknown[]);
  } as unknown as typeof fetch & { [MARCA]?: true };
  // Next marca su fetch parcheado con propiedades propias (`__nextPatched`…) y
  // solo lo vuelve a parchear si no las ve. Se copian para no entrar en una
  // cadena de envolturas que crece en cada petición.
  for (const clave of Reflect.ownKeys(actual)) {
    if (clave in enganche) continue;
    try {
      (enganche as unknown as Record<string | symbol, unknown>)[clave] = (actual as unknown as Record<string | symbol, unknown>)[clave];
    } catch {
      /* propiedad de solo lectura: se deja */
    }
  }
  enganche[MARCA] = true;
  globalThis.fetch = enganche;
}

function metodoDeRequest(args: unknown[]): string {
  for (const a of args) {
    if (a && typeof a === "object" && !(a instanceof URL)) {
      const m = (a as { method?: unknown }).method;
      if (typeof m === "string") return m.toUpperCase();
    }
  }
  return "GET";
}

function instalarFuncion(modulo: Record<string, unknown>, clave: string, nombre: string, escribe: (args: unknown[]) => string | null): void {
  const actual = modulo[clave] as ((...a: unknown[]) => unknown) & { [MARCA]?: true };
  if (typeof actual !== "function" || actual[MARCA]) return;
  const enganche = function (this: unknown, ...args: unknown[]) {
    if (enSoloLectura()) {
      const intento = escribe(args);
      if (intento) {
        const error = bloquear(`${nombre} ${intento}`);
        if (error) throw error;
      }
    }
    return actual.apply(this, args);
  } as typeof actual;
  enganche[MARCA] = true;
  try {
    modulo[clave] = enganche;
  } catch {
    /* propiedad congelada: queda cubierto por Prisma y fetch */
  }
}

/** `new http.ClientRequest(...)` directo: se sustituye la clase exportada por una que mira el método. */
function instalarEnClientRequest(modulo: Record<string, unknown>, nombre: string): void {
  const Actual = modulo.ClientRequest as (new (...a: any[]) => object) & { [MARCA]?: true };
  if (typeof Actual !== "function" || Actual[MARCA]) return;
  class Vigilada extends Actual {
    constructor(...args: any[]) {
      if (enSoloLectura()) {
        const metodo = metodoDeRequest(args);
        if (!METODOS_LECTURA.has(metodo)) {
          const error = bloquear(`${nombre}.ClientRequest ${metodo}`);
          if (error) throw error;
        }
      }
      super(...args);
    }
  }
  (Vigilada as unknown as { [MARCA]?: true })[MARCA] = true;
  try {
    modulo.ClientRequest = Vigilada;
  } catch {
    /* congelada */
  }
}

const metodoQueEscribe = (args: unknown[]) => {
  const metodo = metodoDeRequest(args);
  return METODOS_LECTURA.has(metodo) ? null : metodo;
};

/** Pone los enganches/** Pone los enganches (una vez por proceso; fetch se revisa en cada fase). */
export function instalarCandado(): void {
  instalarEnPrisma();
  instalarEnFetch();
  // `get` NO pasa por la propiedad `request` del módulo (llama a la interna), y
  // acepta `{ method: "DELETE" }`: se engancha aparte. Lo encontró la revisión.
  for (const [modulo, nombre] of [
    [http, "http"],
    [https, "https"],
  ] as const) {
    const m = modulo as unknown as Record<string, unknown>;
    instalarFuncion(m, "request", `${nombre}.request`, metodoQueEscribe);
    instalarFuncion(m, "get", `${nombre}.get`, metodoQueEscribe);
    instalarEnClientRequest(m, nombre);
  }
  // HTTP/2 no se usa en el repo: en la fase de propuesta no se abre ninguna sesión.
  instalarFuncion(http2 as unknown as Record<string, unknown>, "connect", "http2.connect", () => "connect");
}

/**
 * Corre `fn` en fase de SOLO LECTURA.
 *
 * Lanza `EscrituraBloqueada` si `fn` intentó escribir —aunque se tragara el
 * error— y `CandadoNoDisponible` si el candado no se pudo poner (en ese caso
 * `fn` NO corre).
 */
export async function soloLectura<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  instalarCandado();
  const fase: Fase = { motivo, intentos: [] };
  const valor = await global_().als.run(fase, fn);
  if (fase.intentos.length > 0) {
    throw new EscrituraBloqueada(fase.intentos.join(", "), motivo);
  }
  return valor;
}
