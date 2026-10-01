/**
 * ARNÉS DE AISLAMIENTO — ws1-t10. Recorre `src/app/api/**` y llama a cada
 * handler REAL como la persona de la clínica A, pidiendo ids de la clínica B
 * (y de la sede hermana C), contra la base falsa de `base-falsa.ts`.
 *
 * Lo usa `aislamiento-clinicas.test.ts`. Está aparte para que el inventario y
 * la clasificación se puedan probar sin ejecutar las mil rutas.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BaseFalsa, CAMPOS_ID, ID, MARCA, proximaCita, type Dueno, type Fuga } from "./base-falsa";
import { AJUSTES, aplicarAjuste } from "./cuerpos";

export const RAIZ_API = join(process.cwd(), "src", "app", "api");
export const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Metodo = (typeof METODOS)[number];

export interface RutaApi {
  /** Ruta relativa a src/app/api, p. ej. `patients/[id]/route.ts`. */
  archivo: string;
  /** URL con los segmentos dinámicos ya sustituidos por `idB`. */
  url: string;
  /** Forma pública de la ruta, p. ej. `/api/patients/[id]`. */
  patron: string;
  params: Record<string, string | string[]>;
  metodos: Metodo[];
}

/** Inventario automático: toda carpeta con `route.ts` bajo src/app/api. */
export function inventarioDeRutas(raiz = RAIZ_API): RutaApi[] {
  const rutas: RutaApi[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir).sort()) {
      const p = join(dir, nombre);
      if (statSync(p).isDirectory()) {
        if (nombre === "__tests__") continue;
        recorrer(p);
      } else if (nombre === "route.ts") {
        const fuente = readFileSync(p, "utf8");
        const metodos = METODOS.filter((m) =>
          new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`).test(fuente),
        );
        const segs = relative(raiz, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
        const params: Record<string, string | string[]> = {};
        const urlSegs = segs.map((s) => {
          const m = s.match(/^\[(\[)?(\.\.\.)?([^\]]+)\]\]?$/);
          if (!m) return s;
          params[m[3]] = m[2] ? [ID.B] : ID.B;
          return ID.B;
        });
        rutas.push({
          archivo: relative(raiz, p).split(sep).join("/"),
          url: `/api/${urlSegs.join("/")}`.replace(/\/$/, ""),
          patron: `/api/${segs.join("/")}`.replace(/\/$/, ""),
          params,
          metodos,
        });
      }
    }
  };
  recorrer(raiz);
  return rutas;
}

/** Qué clase de puerta tiene una ruta, mirando su fuente (para el informe). */
export type Puerta =
  | "sesion-clinica" // getAuthContext / getCurrentUser / loadClinicSession / createClient().auth.getUser
  | "admin-plataforma"
  | "paciente-portal"
  | "cron"
  | "publica-o-token"; // sin sesión de clínica: token, firma, webhook, abierta

export function puertaDe(fuente: string): Puerta {
  if (/getAuthContext|getCurrentUser|loadClinicSession|requireAuth|auth\.getUser|crearSabinaCtx|getTwoFactorActor/.test(fuente)) return "sesion-clinica";
  if (/isAdminAuthed|getAdminSession|requireAdmin\(/.test(fuente)) return "admin-plataforma";
  if (/getPatientPortalContext/.test(fuente)) return "paciente-portal";
  if (/CRON_SECRET/.test(fuente)) return "cron";
  return "publica-o-token";
}

// ── Petición de ataque ──────────────────────────────────────────────────────
/** Cuerpo universal: cada campo `…Id` del esquema apunta a una fila de B. */
export function cuerpoDeAtaque(objetivo: Dueno = "B"): Record<string, unknown> {
  const x = ID[objetivo];
  const c: Record<string, unknown> = Object.fromEntries(CAMPOS_ID.map((k) => [k, valorDeId(k, objetivo)]));
  Object.assign(c, {
    ids: [x], patientIds: [x], appointmentIds: [x], invoiceIds: [x],
    items: [{ id: x }], action: "confirm", status: "ACTIVE", date: "2026-06-15", from: "2026-06-01", to: "2026-06-30",
    startsAt: proximaCita().toISOString(), endsAt: new Date(proximaCita().getTime() + 30 * 60_000).toISOString(),
  });
  return c;
}

/** El valor de un campo `…Id`: los de doctor apuntan al DOCTOR de esa clínica (`idBd`), el resto a la fila `idB`. */
export function valorDeId(campo: string, objetivo: Dueno): string {
  return /doctor|dentist|provider|professional/i.test(campo) ? `${ID[objetivo]}d` : ID[objetivo];
}

export function consultaDeAtaque(objetivo: Dueno = "B"): string {
  const q = new URLSearchParams();
  for (const k of CAMPOS_ID) q.set(k, valorDeId(k, objetivo));
  q.set("date", "2026-06-15"); q.set("from", "2026-06-01"); q.set("to", "2026-06-30"); q.set("q", "a"); q.set("search", "a");
  return q.toString();
}

export type Veredicto =
  | "sin-sesion" // una ruta de sesión de clínica contestó 401: el arnés no pudo entrar (no es un bloqueo)
  | "bloqueada" // 401/403/404 sin tocar filas ajenas
  | "validada" // 400/409/422: el handler rechazó la petición
  | "sin-acceso-ajeno" // llegó a la base y no tocó nada que no fuera de A
  | "sin-base" // respondió sin consultar la base (estática, redirección, error previo)
  | "fuga"; // tocó o devolvió filas de otra clínica

export interface Resultado {
  ruta: string;
  archivo: string;
  metodo: Metodo;
  puerta: Puerta;
  estado: number | null;
  veredicto: Veredicto;
  fugas: Fuga[];
  marcasEnRespuesta: Dueno[];
  consultas: number;
  crudo: number;
  noSoportado: string[];
  error?: string;
  /** Primeros caracteres de la respuesta: para entender por qué una ruta no se dejó conducir. */
  respuesta?: string;
  ms: number;
  /** Con qué dueño se pidieron los ids (B = ataque, A = control positivo). */
  objetivo: Dueno;
  /** Ataque mixto: id de la URL propio, ids del cuerpo ajenos. */
  mixta?: boolean;
}

export interface OpcionesEjecucion {
  permitidos?: Dueno[];
  permitidosEscritura?: Dueno[];
  duenoDeC?: "mismo" | "otro";
  /** A quién pertenecen los ids de la petición: B (ataque, por defecto) o A (control). */
  objetivo?: Dueno;
  /**
   * Ataque MIXTO: el id de la URL es de A (la ruta lo encuentra y sigue) pero los
   * ids del cuerpo y de la consulta son de B. Prueba lo que el ataque simple no
   * alcanza: atar una fila PROPIA a una ajena (una factura mía al paciente de
   * otra clínica) cuando la ruta ya pasó el chequeo de su propio id.
   */
  mixta?: boolean;
  /** Cookies de la petición (p. ej. la de «clínica activa»). */
  cookies?: Record<string, string>;
  /** Cuerpo exacto de la petición (sustituye al universal): para las pruebas de regresión puntuales. */
  cuerpo?: Record<string, unknown>;
  /** Tiempo máximo por llamada. */
  limiteMs?: number;
}

export interface Contexto {
  base: BaseFalsa | null;
  cabeceras: Headers;
  cookies: Record<string, string>;
}
export const contexto: Contexto = { base: null, cabeceras: new Headers(), cookies: {} };

export async function ejecutarRuta(
  ruta: RutaApi,
  metodo: Metodo,
  fuente: string,
  cargar: (archivo: string) => Promise<any>,
  opciones: OpcionesEjecucion = {},
): Promise<Resultado> {
  const t0 = Date.now();
  const objetivo = opciones.objetivo ?? "B";
  const base = new BaseFalsa({
    permitidos: opciones.permitidos,
    permitidosEscritura: opciones.permitidosEscritura,
    duenoDeC: opciones.duenoDeC,
  });
  contexto.base = base;
  contexto.cookies = opciones.cookies ?? {};
  const deLaUrl = opciones.mixta ? "A" : objetivo;
  const rutaUrl = ruta.url.split(ID.B).join(ID[deLaUrl]);
  const params = Object.fromEntries(
    Object.entries(ruta.params).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x.split(ID.B).join(ID[deLaUrl])) : v.split(ID.B).join(ID[deLaUrl])]),
  );
  const ajuste = AJUSTES[`${metodo} ${ruta.patron}`]?.({ id: ID[objetivo], doc: `${ID[objetivo]}d` });
  const consulta = new URLSearchParams(consultaDeAtaque(objetivo));
  if (ajuste) {
    const q = aplicarAjuste(Object.fromEntries(consulta), ajuste, "query");
    for (const k of [...consulta.keys()]) if (!(k in q)) consulta.delete(k);
    for (const [k, v] of Object.entries(q)) consulta.set(k, String(v));
  }
  const url = `http://localhost${rutaUrl}?${consulta.toString()}`;
  contexto.cabeceras = new Headers({ "x-pathname": rutaUrl, "x-method": metodo });
  const { NextRequest } = await import("next/server");
  const init: any = {
    method: metodo,
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", "x-pathname": rutaUrl, "x-method": metodo },
  };
  if (metodo !== "GET") init.body = JSON.stringify(opciones.cuerpo ?? aplicarAjuste(cuerpoDeAtaque(objetivo), ajuste, "body"));
  const peticion = new NextRequest(url, init);

  const base_res: Omit<Resultado, "estado" | "veredicto" | "fugas" | "marcasEnRespuesta" | "consultas" | "crudo" | "noSoportado" | "ms"> = {
    ruta: ruta.patron, archivo: ruta.archivo, metodo, puerta: puertaDe(fuente), objetivo, ...(opciones.mixta ? { mixta: true } : {}),
  };
  let estado: number | null = null;
  let texto = "";
  let error: string | undefined;
  try {
    const modulo = await cargar(ruta.archivo);
    const handler = modulo[metodo];
    const respuesta: Response = await Promise.race([
      handler(peticion, { params }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tiempo agotado")), opciones.limiteMs ?? 15_000)),
    ]);
    if (respuesta && typeof (respuesta as any).status === "number") {
      estado = respuesta.status;
      try { texto = (await respuesta.clone().text()).slice(0, 2_000_000); } catch { /* flujo */ }
    }
  } catch (e: any) {
    const digest = String(e?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) { estado = 307; }
    else error = String(e?.message ?? e).slice(0, 300);
  }

  const marcas = (["B", "C"] as Dueno[]).filter((d) => !base.permitidos.has(d) && texto.includes(MARCA[d]));
  const fugas = base.fugas;
  const esSesion = puertaDe(fuente) === "sesion-clinica";
  let veredicto: Veredicto;
  if (fugas.length > 0 || marcas.length > 0) veredicto = "fuga";
  else if (esSesion && estado === 401) veredicto = "sin-sesion";
  else if (estado === 401 || estado === 403 || estado === 404) veredicto = "bloqueada";
  else if (estado === 400 || estado === 409 || estado === 422 || estado === 429) veredicto = "validada";
  else if (base.consultas > 0) veredicto = "sin-acceso-ajeno";
  else veredicto = "sin-base";
  return {
    ...base_res, estado, veredicto, fugas, marcasEnRespuesta: marcas, consultas: base.consultas,
    crudo: base.crudo, noSoportado: [...new Set(base.noSoportado)], error, respuesta: texto.slice(0, 420), ms: Date.now() - t0,
  };
}
