/**
 * La sesión RESUELTA, en caché 10 s (ws1-t1, 23-sep-2026, con el OK de Rafael).
 *
 * «Resolver la sesión» es leer las filas activas de la persona y elegir la de
 * la clínica activa. Es la lectura que getAuthContext y getCurrentUser hacen
 * en CADA /api: ~285 ms por petición medidos desde el servidor de QA. El token
 * NO se cachea: `supabase.auth.getUser()` lo sigue verificando en cada
 * petición, y el `supabaseId` que llega aquí es el que devolvió.
 *
 * ── LA LLAVE: persona + clínica de la cookie. Las dos, siempre. ──────────
 * La clínica activa sale de la cookie de clínica, y CAMBIAR DE SUCURSAL NO
 * RECARGA LA PÁGINA: la misma persona, en el mismo segundo, pide con la cookie
 * de la sede A y luego con la de la B. Con una llave solo por persona, la
 * segunda petición recibiría la sede A ya resuelta y las llamadas del armazón
 * devolverían DATOS DE LA OTRA CLÍNICA. Por eso:
 *   · la clínica de la cookie va en la llave tal cual se usa para elegir;
 *   · «sin clínica elegida» (sin cookie, o con la firma rota) es su PROPIO
 *     valor en la llave (`null`), distinto de cualquier clínica;
 *   · la llave va en JSON: ningún id, por raro que sea, se confunde con otro.
 * Lo fija `npm run test:sesion-en-cache`, que falla si alguien quita la
 * clínica de la llave o deja de pasarla. NO «simplifiques» la llave.
 *
 * ── CUÁNDO NO SE USA ──────────────────────────────────────────────────────
 * Solo se sirve de caché en LECTURAS de /api (GET/HEAD, según el `x-method`
 * que el middleware re-escribe junto a `x-pathname`). Van siempre frescas:
 *   · toda escritura (POST, PATCH, PUT, DELETE): quien escribe lo hace con su
 *     rol y su estado de ESTE momento. Además, durante los 10 s siguientes las
 *     lecturas de esa persona en esta instancia también van frescas, para que
 *     quien acaba de guardar (ajustes de la clínica) no lea lo de antes. Las
 *     rutas del 2FA (/api/auth/2fa/*) no pasan por aquí: lo marca
 *     `propagarDosFactores` con `marcarEscritura`, o quien lo apaga se quedaría
 *     10 s recibiendo 401 porque la fila en caché aún dice «tiene 2FA»;
 *   · /api/auth/*: el flujo del propio 2FA, el login y el logout;
 *   · las páginas (el layout de /dashboard): no llevan `x-method`;
 *   · una persona sin ninguna fila activa: no se guarda el «nadie».
 *
 * ── LO QUE CUESTA, y Rafael lo aceptó ────────────────────────────────────
 * A quien desactivan, o le cambian el rol, le quedan como mucho 10 s de
 * LECTURAS con lo de antes (las escrituras ya no: van frescas). Lo mismo con
 * un cambio de plan o de ajustes de la clínica hecho por OTRA persona, y con
 * la seguridad: si un admin activa «2FA obligatorio» o alguien enrola su 2FA,
 * las lecturas de /api de las OTRAS sesiones tardan ≤10 s en exigirlo.
 *
 * ── EN MEMORIA, POR INSTANCIA ─────────────────────────────────────────────
 * Vive en la memoria del proceso (`@/lib/route-cache`). En Vercel hay varias
 * instancias y cada una tiene la suya: es correcto (una instancia fría solo
 * resuelve de la base, como antes), pero significa que el «fresco tras
 * escribir» solo vale en la instancia que atendió la escritura. En otra, lo de
 * antes dura como mucho los mismos 10 s.
 */
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { cachedByKey, invalidateCachedKey } from "@/lib/route-cache";

export const VIDA_SESION_MS = 10_000;

function leerFilas(supabaseId: string) {
  return prisma.user.findMany({
    where: { supabaseId, isActive: true },
    include: { clinic: true },
    orderBy: { createdAt: "asc" },
  });
}

type Fila = Awaited<ReturnType<typeof leerFilas>>[number];

export interface SesionResuelta {
  /** Todas las filas ACTIVAS de la persona, de la más antigua a la más nueva. */
  filas: Fila[];
  /** La fila de la clínica de la cookie, si la persona está activa ahí. */
  deLaCookie: Fila | null;
  /** La que manda: la de la cookie o, si no, la primera por createdAt. */
  elegida: Fila | null;
}

/**
 * La llave de una sesión resuelta: persona + clínica de la cookie.
 * `null` = sin clínica elegida, que es un estado propio y no colisiona con
 * ninguna clínica. Lanza sin persona: una llave sin dueño no existe.
 */
export function claveDeSesion(supabaseId: string, clinicaDeLaCookie: string | null): string {
  if (typeof supabaseId !== "string" || supabaseId.trim() === "") {
    throw new Error("[sesion-en-cache] llave sin sesión");
  }
  // "" se resuelve igual que null (no elige ninguna sede), y así se guarda.
  const clinica = typeof clinicaDeLaCookie === "string" && clinicaDeLaCookie !== "" ? clinicaDeLaCookie : null;
  return JSON.stringify(["sesion", supabaseId, clinica]);
}

// Personas que escribieron hace menos de VIDA_SESION_MS en esta instancia.
const escribieron = new Map<string, number>();

function podaEscribieron(ahora: number) {
  if (escribieron.size < 500) return;
  escribieron.forEach((hasta, k) => { if (hasta <= ahora) escribieron.delete(k); });
}

/**
 * Para escrituras que cambian la sesión y NO pasan por resolverSesion (las
 * rutas del 2FA resuelven con getTwoFactorActor): las lecturas siguientes de
 * esa persona en esta instancia van frescas durante VIDA_SESION_MS.
 */
export function marcarEscritura(supabaseId: string): void {
  if (!supabaseId) return;
  const ahora = Date.now();
  podaEscribieron(ahora);
  escribieron.set(supabaseId, ahora + VIDA_SESION_MS);
}

type Modo = "cache" | "fresco" | "escritura";

function modoDeEstaPeticion(): Modo {
  let ruta: string | null = null;
  let metodo: string | null = null;
  try {
    const h = headers();
    ruta = h.get("x-pathname");
    metodo = h.get("x-method");
  } catch {
    return "fresco";
  }
  if (!ruta || !metodo || !ruta.startsWith("/api/")) return "fresco";
  if (metodo !== "GET" && metodo !== "HEAD") return "escritura";
  if (ruta.startsWith("/api/auth/")) return "fresco";
  return "cache";
}

function elegir(filas: Fila[], clinicaDeLaCookie: string | null): SesionResuelta {
  const deLaCookie = clinicaDeLaCookie
    ? filas.find((f) => f.clinicId === clinicaDeLaCookie) ?? null
    : null;
  return { filas, deLaCookie, elegida: deLaCookie ?? filas[0] ?? null };
}

// Cada petición recibe SUS objetos: si una ruta tocara `ctx.clinic` o la fila,
// no puede ensuciar lo que va a leer la siguiente.
function copia(s: SesionResuelta): SesionResuelta {
  const filas = s.filas.map((f) => ({ ...f, clinic: f.clinic ? { ...f.clinic } : f.clinic }));
  const i = (f: Fila | null) => (f ? s.filas.indexOf(f) : -1);
  return {
    filas,
    deLaCookie: i(s.deLaCookie) >= 0 ? filas[i(s.deLaCookie)] : null,
    elegida: i(s.elegida) >= 0 ? filas[i(s.elegida)] : null,
  };
}

/**
 * Las filas activas de la persona y la elegida para la clínica de la cookie.
 * Una sola lectura de `users` cuando no hay caché; ninguna cuando la hay.
 */
export async function resolverSesion(
  supabaseId: string,
  clinicaDeLaCookie: string | null,
): Promise<SesionResuelta> {
  const modo = modoDeEstaPeticion();
  const ahora = Date.now();

  if (modo === "escritura") marcarEscritura(supabaseId);
  const acabaDeEscribir = (escribieron.get(supabaseId) ?? 0) > ahora;
  if (modo !== "cache" || acabaDeEscribir) {
    return elegir(await leerFilas(supabaseId), clinicaDeLaCookie);
  }

  const clave = claveDeSesion(supabaseId, clinicaDeLaCookie);
  const resuelta = await cachedByKey(clave, VIDA_SESION_MS, async () =>
    elegir(await leerFilas(supabaseId), clinicaDeLaCookie),
  );
  // Sin filas activas no se guarda: quien acaba de darse de alta no puede
  // quedarse 10 s viendo «no tienes clínica».
  if (resuelta.filas.length === 0) invalidateCachedKey(clave);
  return copia(resuelta);
}
