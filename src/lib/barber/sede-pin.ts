/**
 * DaleControl BARBER — la sede de la PANTALLA viaja en cada escritura (ronda
 * 2, M3). Módulo PURO y client-safe (sin React): lo instala BarberSedePin en
 * el layout del panel y lo prueban las pruebas de Node.
 *
 * EL CASO: dos pestañas. La primera se cargó en la sede A; en la segunda se
 * cambia a B (la cookie dcb_branch es de todo el navegador). Sin esto, un
 * «Guardar» de la primera pestaña —alta de cliente, abrir turno, cobrar—
 * caería en B mientras la pantalla dice A.
 *
 * CÓMO: se envuelve window.fetch UNA vez. Toda petición de escritura
 * (POST/PUT/PATCH/DELETE) a /api/barber/* del mismo origen lleva el
 * encabezado x-dcb-sede con la sede con la que se pintó la pantalla.
 * getBarberContext lo compara con la sede que resuelve y, si no coincide, no
 * da contexto (la ruta responde 401 y no escribe nada). Aquí ese 401 se
 * traduce: se pregunta (sin encabezado) cuál es la sede de la sesión y, si es
 * otra, la respuesta pasa a ser un 409 con el aviso de recargar. Un 401 de
 * sesión caducada se queda como está.
 *
 * Exentas: el propio cambio de sede (lo hace una pantalla vieja a propósito)
 * y las rutas de cuenta (/api/barber/auth/*).
 */
import { BARBER_BRANCH_PIN_HEADER } from "@/lib/barber/branch-cookie";

export const BARBER_SEDE_CURRENT_PATH = "/api/barber/branches/current";
const EXEMPT_PREFIXES = ["/api/barber/branches/switch", "/api/barber/auth/"];
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface PinState {
  branchId: string | null;
  message: string;
  original: FetchFn;
}

type PinWindow = { fetch: FetchFn; location: { href: string; origin: string }; __dcbSedePin?: PinState };

/** ¿Esta petición lleva la sede de la pantalla? */
export function needsSedePin(method: string, url: URL, origin: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  if (url.origin !== origin) return false;
  if (!url.pathname.startsWith("/api/barber/")) return false;
  return !EXEMPT_PREFIXES.some((p) => url.pathname.startsWith(p));
}

function requestParts(input: RequestInfo | URL, init: RequestInit | undefined, base: string) {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = init?.method ?? (isRequest ? (input as Request).method : "GET");
  const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined));
  return { url: new URL(href, base), method, headers };
}

/**
 * Instala (o actualiza) la sede de la pantalla. Idempotente: llamarla en cada
 * render solo cambia la sede guardada; el envoltorio se pone una sola vez.
 */
export function installSedePin(win: PinWindow, branchId: string | null, message: string): void {
  if (win.__dcbSedePin) {
    win.__dcbSedePin.branchId = branchId;
    win.__dcbSedePin.message = message;
    return;
  }
  const state: PinState = { branchId, message, original: win.fetch.bind(win) };
  win.__dcbSedePin = state;

  win.fetch = async (input, init) => {
    const pin = state.branchId;
    const { url, method, headers } = requestParts(input, init, win.location.href);
    if (!pin || !needsSedePin(method, url, win.location.origin)) return state.original(input, init);

    headers.set(BARBER_BRANCH_PIN_HEADER, pin);
    const res = await state.original(input, { ...init, method, headers });
    if (res.status !== 401) return res;

    // ¿Fue por la sede o por la sesión? Se pregunta sin encabezado.
    try {
      const cur = await state.original(BARBER_SEDE_CURRENT_PATH, { cache: "no-store" });
      if (cur.ok) {
        const body = (await cur.json()) as { branchId?: string };
        if (body.branchId && body.branchId !== pin) {
          return new Response(JSON.stringify({ error: state.message, code: "BRANCH_CHANGED" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    } catch {
      /* sin red: se devuelve el 401 tal cual */
    }
    return res;
  };
}
