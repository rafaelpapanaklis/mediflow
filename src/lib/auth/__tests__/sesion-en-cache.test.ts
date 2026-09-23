/**
 * ws1-t1 · La sesión resuelta va en caché 10 s, con llave PERSONA + CLÍNICA.
 *
 * Run: npm run test:sesion-en-cache
 *
 * 🔴 ESTA PRUEBA EXISTE PARA QUE NADIE QUITE LA CLÍNICA DE LA LLAVE.
 * Cambiar de sucursal NO recarga la página: la misma persona pide con la
 * cookie de la sede A y, un segundo después, con la de la B. Si la llave fuera
 * solo la persona, la segunda petición recibiría la sede A ya resuelta y las
 * llamadas del armazón devolverían datos de la OTRA clínica. Rafael Clinica
 * tiene dos sucursales en producción: no es un caso de laboratorio.
 *
 * Se prueba con getAuthContext y getCurrentUser REALES y la caché REAL
 * (@/lib/route-cache); solo Prisma, Supabase, las cookies y las cabeceras son
 * de mentira. Si alguien quita la clínica de `claveDeSesion`, o deja de
 * pasarla desde getAuthContext/getCurrentUser, fallan los casos «cambio de
 * sucursal» y «sin clínica elegida».
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Fila {
  id: string;
  supabaseId: string;
  clinicId: string;
  role: string;
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: Date;
  permissionsOverride: string[];
  clinic: { id: string; name: string; category: string; require2fa: boolean };
}

function fila(sb: string, id: string, clinicId: string, createdAt: string, extra: Partial<Fila> = {}): Fila {
  return {
    id,
    supabaseId: sb,
    clinicId,
    role: "ADMIN",
    isActive: true,
    totpEnabled: false,
    createdAt: new Date(createdAt),
    permissionsOverride: [],
    clinic: { id: clinicId, name: `Sede ${clinicId}`, category: "DENTAL", require2fa: false },
    ...extra,
  };
}

// ── Estado de cada prueba ──────────────────────────────────────────────
let sesion = "sb_rafael";
let filas: Fila[] = [];
let cookieClinica: string | null = null;
let ruta: string | null = "/api/dashboard/sidebar-counts";
let metodo: string | null = "GET";
let lecturas = 0;
let cookie2fa = false;
// Reloj propio: cada prueba empieza una hora después de la anterior, así lo
// que dejó en caché la anterior ya venció y no hace falta vaciar nada.
let reloj = Date.UTC(2026, 8, 23, 12);
mock.method(Date, "now", () => reloj);

// Dos sucursales de la MISMA persona: A es la más antigua (el fallback).
const A = "cli_sucursal_a";
const B = "cli_sucursal_b";

beforeEach(() => {
  reloj += 60 * 60_000;
  sesion = "sb_rafael";
  filas = [
    fila("sb_rafael", "u_a", A, "2025-01-01"),
    fila("sb_rafael", "u_b", B, "2026-01-01", { role: "DOCTOR" }),
  ];
  cookieClinica = null;
  ruta = "/api/dashboard/sidebar-counts";
  metodo = "GET";
  lecturas = 0;
  cookie2fa = false;
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      user: {
        findMany: async ({ where, orderBy }: any) => {
          lecturas++;
          const r = filas.filter((f) =>
            Object.entries(where ?? {}).every(([k, v]) => (f as any)[k] === v),
          );
          if (orderBy?.createdAt === "asc") r.sort((a, b) => +a.createdAt - +b.createdAt);
          // Copias, como Prisma: cada lectura trae objetos nuevos.
          return r.map((f) => ({ ...f, clinic: { ...f.clinic } }));
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          filas = filas.map((f) => (f.supabaseId === where.supabaseId ? (count++, { ...f, ...data }) : f));
          return { count };
        },
      },
      supplierUser: { findFirst: async () => null },
      dentalLabUser: { findFirst: async () => null },
      barberUser: { findFirst: async () => null },
      realtyUser: { findFirst: async () => null },
    },
  },
});
mock.module("@/lib/supabase/server", {
  namedExports: { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: sesion } } }) } }) },
});
mock.module("@/lib/active-clinic", {
  namedExports: { readActiveClinicCookie: () => cookieClinica, logClinicFallback: () => {} },
});
// Lo que el middleware re-escribe en toda ruta /api.
mock.module("next/headers", {
  namedExports: {
    headers: () => ({
      get: (k: string) => (k === "x-pathname" ? ruta : k === "x-method" ? metodo : null),
    }),
  },
});
mock.module("@/lib/plan-status", {
  namedExports: { isPlanExpired: () => false, isApiPathBlockedForExpiredPlan: () => false },
});
mock.module("@/lib/auth/two-factor-cookie", { namedExports: { hasValidTwoFactorCookie: () => cookie2fa } });
class Redireccion extends Error { constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); } }
mock.module("react", { namedExports: { cache: <T>(f: T) => f } });
mock.module("next/navigation", { namedExports: { redirect: (d: string) => { throw new Redireccion(d); } } });

// Import perezoso: los módulos reales se cargan DESPUÉS de los mock.module.
const getAuthContext = async () => (await import("@/lib/auth-context")).getAuthContext();
const getCurrentUser = async (): Promise<any> => (await import("@/lib/auth")).getCurrentUser();
const claveDeSesion = async (s: string, c: string | null) =>
  (await import("@/lib/auth/sesion-en-cache")).claveDeSesion(s, c);

/** Nada de la sede `otra` puede aparecer en lo que se devolvió. */
function nadaDe(valor: unknown, otra: string) {
  const texto = JSON.stringify(valor);
  assert.ok(!texto.includes(otra), `la respuesta trae algo de ${otra}: ${texto}`);
  assert.ok(!texto.includes(`Sede ${otra}`));
}

// ══════════════════════════ La llave ══════════════════════════

test("llave · la clínica va en la llave: A, B y «sin clínica» son tres llaves distintas", async () => {
  const conA = await claveDeSesion("sb_rafael", A);
  const conB = await claveDeSesion("sb_rafael", B);
  const sin = await claveDeSesion("sb_rafael", null);
  assert.notEqual(conA, conB, "cambiar de sucursal tiene que cambiar la llave");
  assert.notEqual(sin, conA, "«sin clínica elegida» no puede colisionar con la clínica A");
  assert.notEqual(sin, conB);
  assert.notEqual(sin, await claveDeSesion("sb_rafael", "null"), "ni con una clínica que se llame «null»");
  assert.equal(await claveDeSesion("sb_rafael", ""), sin, "cookie vacía = sin clínica: se resuelven igual");
  assert.ok(conA.includes(A) && conB.includes(B), "la clínica va en la llave tal cual");
});

test("llave · la persona va en la llave, y sin persona no hay llave", async () => {
  assert.notEqual(await claveDeSesion("sb_rafael", A), await claveDeSesion("sb_otra", A));
  await assert.rejects(() => claveDeSesion("", A), /llave sin sesión/);
});

// ══════════════════════════ Cambio de sucursal ══════════════════════════

test("🔴 getAuthContext · cambio de sucursal: misma sesión, cookie A y luego B → la B no ve NADA de la A", async () => {
  cookieClinica = A;
  const enA = await getAuthContext();
  assert.equal(enA?.clinicId, A);
  assert.equal(lecturas, 1);

  // La caché funciona de verdad: sin esto, la prueba de abajo no probaría nada.
  const otraVezA = await getAuthContext();
  assert.equal(otraVezA?.clinicId, A);
  assert.equal(lecturas, 1, "misma persona y misma sede dentro de los 10 s: sale de caché");

  // Cambia de sucursal SIN recargar: un segundo después, la cookie ya es la B.
  reloj += 1_000;
  cookieClinica = B;
  const enB = await getAuthContext();
  assert.equal(enB?.clinicId, B, "la sede es la de la cookie NUEVA");
  assert.equal(enB?.userId, "u_b");
  assert.equal(enB?.role, "DOCTOR", "con el rol de ESA sede");
  assert.equal(enB?.clinic.id, B);
  assert.equal(enB?.clinic.name, `Sede ${B}`);
  nadaDe(enB, A);
  assert.equal(lecturas, 2, "la sede B se resolvió de la base: no se reutilizó nada de la A");

  // Y de vuelta: cada sede tiene su entrada y ninguna pisa a la otra.
  cookieClinica = A;
  const vueltaA = await getAuthContext();
  assert.equal(vueltaA?.clinicId, A);
  nadaDe(vueltaA, B);
  cookieClinica = B;
  assert.equal((await getAuthContext())?.clinicId, B);
  assert.equal(lecturas, 2);
});

test("🔴 getCurrentUser · cambio de sucursal: misma sesión, cookie A y luego B → la B no ve NADA de la A", async () => {
  cookieClinica = A;
  assert.equal((await getCurrentUser()).clinicId, A);
  assert.equal((await getCurrentUser()).clinicId, A);
  assert.equal(lecturas, 1, "la segunda sale de caché");

  reloj += 1_000;
  cookieClinica = B;
  const enB = await getCurrentUser();
  assert.equal(enB.clinicId, B);
  assert.equal(enB.id, "u_b");
  assert.equal(enB.clinic.name, `Sede ${B}`);
  nadaDe(enB, A);
  assert.equal(lecturas, 2);
});

test("🔴 getAuthContext · «sin clínica elegida» no hereda la sede de la cookie anterior, ni al revés", async () => {
  // Con cookie de la B (la más nueva) queda en caché la B...
  cookieClinica = B;
  assert.equal((await getAuthContext())?.clinicId, B);
  // ...y sin cookie tiene que salir el fallback de siempre (la primera, A), no la B.
  cookieClinica = null;
  const sinCookie = await getAuthContext();
  assert.equal(sinCookie?.clinicId, A, "sin cookie: la primera por createdAt, no la sede de la caché");
  nadaDe(sinCookie, B);
  // Y al revés: con «sin clínica» ya en caché (A), elegir la B entra en la B.
  cookieClinica = B;
  assert.equal((await getAuthContext())?.clinicId, B);
  cookieClinica = null;
  assert.equal((await getAuthContext())?.clinicId, A);
  assert.equal(lecturas, 2, "dos llaves (B y sin clínica), una lectura cada una");
});

test("🔴 getCurrentUser · «sin clínica elegida» no hereda la sede de la cookie anterior", async () => {
  cookieClinica = B;
  assert.equal((await getCurrentUser()).clinicId, B);
  cookieClinica = null;
  const sinCookie = await getCurrentUser();
  assert.equal(sinCookie.clinicId, A);
  nadaDe(sinCookie, B);
});

test("getAuthContext · otra persona con la misma cookie no reutiliza la sesión de la primera", async () => {
  filas.push(fila("sb_otra", "u_otra", B, "2026-02-01", { role: "RECEPTIONIST" }));
  cookieClinica = B;
  assert.equal((await getAuthContext())?.userId, "u_b");
  sesion = "sb_otra";
  const otra = await getAuthContext();
  assert.equal(otra?.userId, "u_otra");
  assert.equal(otra?.role, "RECEPTIONIST");
  assert.equal(lecturas, 2);
});

// ══════════════════════════ Cuándo NO se usa ══════════════════════════

test("vida · a los 10 s la entrada vence y se vuelve a leer; un instante antes, no", async () => {
  cookieClinica = A;
  await getAuthContext();
  reloj += 9_999;
  await getAuthContext();
  assert.equal(lecturas, 1);
  reloj += 2;
  await getAuthContext();
  assert.equal(lecturas, 2, "vencida no se sirve nunca");
});

test("escrituras · un POST resuelve fresco, y las lecturas de esa persona 10 s después también", async () => {
  cookieClinica = A;
  await getAuthContext();
  assert.equal(lecturas, 1);

  metodo = "POST";
  await getAuthContext();
  await getAuthContext();
  assert.equal(lecturas, 3, "cada escritura lee de la base");

  metodo = "GET";
  reloj += 5_000;
  await getAuthContext();
  assert.equal(lecturas, 4, "quien acaba de escribir no lee lo de antes");

  reloj += 5_001;
  await getAuthContext();
  await getAuthContext();
  assert.equal(lecturas, 5, "pasados los 10 s vuelve a usar la caché");
});

test("escrituras · a quien desactivan le quedan ≤10 s de LECTURAS, pero ya no puede escribir", async () => {
  cookieClinica = A;
  assert.equal((await getAuthContext())?.clinicId, A);
  filas = filas.map((f) => ({ ...f, isActive: false }));
  // El riesgo aceptado: la lectura sale de caché.
  assert.equal((await getAuthContext())?.clinicId, A);
  // La escritura, no.
  metodo = "PATCH";
  assert.equal(await getAuthContext(), null);
});

test("fuera de caché · /api/auth/*, las páginas (sin x-method) y lo que no es /api", async () => {
  cookieClinica = A;
  for (const [r, m] of [
    ["/api/auth/2fa/verify", "GET"],
    ["/dashboard", null],
    [null, null],
    ["/dashboard/agenda", "GET"],
  ] as const) {
    ruta = r;
    metodo = m;
    lecturas = 0;
    await getAuthContext();
    await getAuthContext();
    assert.equal(lecturas, 2, `${r} ${m}: siempre fresco`);
  }
});

test("sin filas · «no tienes clínica» no se guarda: quien acaba de darse de alta entra enseguida", async () => {
  const guardadas = filas;
  filas = [];
  cookieClinica = A;
  assert.equal(await getAuthContext(), null);
  filas = guardadas;
  assert.equal((await getAuthContext())?.clinicId, A);
  assert.equal(lecturas, 2);
});

test("copias · lo que una ruta toque en ctx.clinic no llega a la petición siguiente", async () => {
  cookieClinica = A;
  const uno = await getAuthContext();
  uno!.clinic.name = "tocado por una ruta";
  uno!.user.role = "SUPER_ADMIN";
  const dos = await getAuthContext();
  assert.equal(lecturas, 1);
  assert.equal(dos?.clinic.name, `Sede ${A}`);
  assert.equal(dos?.user.role, "ADMIN");
});

test("2FA · quien lo apaga no se queda 10 s en 401: propagarDosFactores marca la escritura", async () => {
  const { propagarDosFactores } = await import("@/lib/auth/two-factor-identity");
  filas = filas.map((f) => ({ ...f, totpEnabled: true }));
  cookie2fa = true;
  cookieClinica = A;
  assert.equal((await getAuthContext())?.clinicId, A, "con 2FA y su cookie, entra (y queda en caché)");

  // POST /api/auth/2fa/disable: apaga el 2FA de la persona y borra la cookie df_2fa.
  // Esa ruta resuelve con getTwoFactorActor, no con resolverSesion.
  await propagarDosFactores("sb_rafael", { totpEnabled: false });
  cookie2fa = false;

  reloj += 1_000;
  const despues = await getAuthContext();
  assert.equal(despues?.clinicId, A, "la fila en caché decía «tiene 2FA»: sin la marca, esto sería null (401)");
  assert.equal(despues?.user.totpEnabled, false);
});
