// Uso del panel (ws6-t4) — PERMISOS con las rutas REALES y getBarberContext
// REAL (arnés de permisos de ws6-t8) contra Postgres LOCAL:
//   · POST /api/barber/uso: sin sesión 401; la barbería y el usuario salen de
//     la SESIÓN (el cuerpo no puede escribir a nombre de otra); con «Ver como
//     barbería» o con sesión válida de admin NO se registra nada.
//   · GET /api/admin/barberias/[id]/actividad: solo admin (una barbería con
//     sesión → 401); cada barbería ve solo lo suyo (matriz + sus sucursales).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test --test-concurrency=1 src/lib/barber/__tests__/uso-permisos-integration.test.ts
import { sesion } from "./_permisos-arnes";
import { skip } from "./_base-local";
import Module from "node:module";
import { createHash } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// La cookie de admin, por encima del doble de next/headers del arnés.
const admin: { token: string | null } = { token: null };
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const cargaPrevia = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  const mod = cargaPrevia.call(this, request, parent, isMain);
  if (request !== "next/headers") return mod;
  const base = mod as { cookies: () => Promise<{ get: (n: string) => unknown }> };
  return {
    ...base,
    cookies: async () => {
      const c = await base.cookies();
      return {
        ...c,
        get: (n: string) => (n === "admin_token" && admin.token ? { name: n, value: admin.token } : c.get(n)),
      };
    },
  };
};

const RUN = `usop${Date.now().toString(36)}`;
type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
let uso: typeof import("@/app/api/barber/uso/route");
let fichaApi: typeof import("@/app/api/admin/barberias/[id]/actividad/route");
let listaApi: typeof import("@/app/api/admin/barberias/route");
let reg: typeof import("@/lib/barber/uso/registro");
const ids = { a: "", a2: "", b: "", ua: "", ub: "", adminUser: "" };
const TOKEN = `${RUN}-token-admin-de-prueba`;

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  uso = await import("@/app/api/barber/uso/route");
  fichaApi = await import("@/app/api/admin/barberias/[id]/actividad/route");
  listaApi = await import("@/app/api/admin/barberias/route");
  reg = await import("@/lib/barber/uso/registro");
  reg.olvidarUsoListo();

  const shop = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.barbershop.create({
      data: { name: `UsoP ${slug}`, slug: `${RUN}-${slug}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Merida", ...extra },
    });
  const a = await shop("a");
  const a2 = await shop("a2", { parentId: a.id, isMainBranch: false, branchName: "Norte" });
  const b = await shop("b");
  const user = (s: string, tag: string) =>
    prisma.barberUser.create({
      data: { barbershopId: s, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: "P", lastName: tag, role: "OWNER" },
    });
  const au = await prisma.adminUser.create({ data: { email: `${RUN}@admin.test`, passwordHash: "x" } });
  await prisma.adminSession.create({
    data: {
      adminUserId: au.id,
      tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  Object.assign(ids, { a: a.id, a2: a2.id, b: b.id, ua: (await user(a.id, "ua")).id, ub: (await user(b.id, "ub")).id, adminUser: au.id });
});

after(async () => {
  if (skip) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const sid = shops.map((s) => s.id);
  await prisma.$executeRaw`DELETE FROM "barber_usage_events" WHERE "barbershopId" = ANY(${sid}::text[])`.catch(() => 0);
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { parentId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: sid } } });
  if (ids.adminUser) await prisma.adminUser.deleteMany({ where: { id: ids.adminUser } });
  await prisma.$disconnect();
});

async function postUso(body: unknown, cookie = "") {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://localhost/api/barber/uso", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
  const res = await uso.POST(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function getFicha(id: string, mes?: string) {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(`http://localhost/api/admin/barberias/${id}/actividad${mes ? `?mes=${mes}` : ""}`);
  const res = await fichaApi.GET(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const lote = (extra: Record<string, unknown> = {}) => ({
  sid: `${RUN}-sid-1`,
  events: [
    { k: "S", p: "/barber/inicio" },
    { k: "C", p: "/barber/caja", a: "cobrar-ticket" },
  ],
  ...extra,
});

async function cuentas() {
  return prisma.$queryRaw<Array<{ barbershopId: string; userId: string; n: number }>>`
    SELECT "barbershopId", "userId", COUNT(*)::int AS "n" FROM "barber_usage_events"
    WHERE "barbershopId" = ANY(${[ids.a, ids.a2, ids.b]}::text[]) GROUP BY 1, 2 ORDER BY 1, 2`;
}

test("sin sesión de barbería → 401 y no se escribe nada", { skip }, async () => {
  sesion.supabaseId = null;
  admin.token = null;
  const r = await postUso(lote());
  assert.equal(r.status, 401);
  assert.deepEqual(await cuentas(), []);
});

test("la barbería y el usuario salen de la SESIÓN: el cuerpo no puede escribir a nombre de otra", { skip }, async () => {
  sesion.supabaseId = `${RUN}-ua`;
  const r = await postUso(lote({ barbershopId: ids.b, userId: ids.ub }));
  assert.equal(r.status, 200);
  assert.equal(r.body.guardados, 2);
  assert.deepEqual(
    (await cuentas()).map((c) => [c.barbershopId, c.userId, c.n]),
    [[ids.a, ids.ua, 2]],
  );
});

test("«Ver como barbería» (su cookie) → no se registra", { skip }, async () => {
  sesion.supabaseId = `${RUN}-ua`;
  const r = await postUso(lote(), "dcb_ver_como=1");
  assert.equal(r.body.omitido, "ver-como");
  assert.equal((await cuentas()).reduce((s, c) => s + c.n, 0), 2, "sigue igual");
});

test("con sesión VÁLIDA de admin de DaleControl → no se registra; con un token falso, sí", { skip }, async () => {
  sesion.supabaseId = `${RUN}-ua`;
  admin.token = TOKEN;
  const r = await postUso(lote(), `admin_token=${TOKEN}`);
  assert.equal(r.body.omitido, "admin");
  assert.equal((await cuentas()).reduce((s, c) => s + c.n, 0), 2);

  admin.token = "token-que-no-existe";
  const r2 = await postUso(lote(), "admin_token=token-que-no-existe");
  assert.equal(r2.body.guardados, 2, "una cookie de admin inválida no apaga el registro");
  admin.token = null;
});

test("la ficha de actividad es SOLO para admins: una barbería con sesión recibe 401", { skip }, async () => {
  sesion.supabaseId = `${RUN}-ua`;
  admin.token = null;
  const r = await getFicha(ids.a);
  assert.equal(r.status, 401);
  assert.equal(r.body.totales, undefined, "ni un número sale");
});

test("admin: cada barbería ve lo suyo (la matriz suma sus sucursales; la otra no se cuela)", { skip }, async () => {
  // Uso en la sucursal y en la otra barbería, con la sesión de cada quien.
  sesion.supabaseId = `${RUN}-ub`;
  await postUso({ sid: `${RUN}-sid-b`, events: [{ k: "C", p: "/barber/caja", a: "otra" }, { k: "C", p: "/barber/caja", a: "otra" }, { k: "C", p: "/barber/caja", a: "otra" }] });

  admin.token = TOKEN;
  const a = await getFicha(ids.a);
  assert.equal(a.status, 200);
  assert.equal(a.body.disponible, true);
  assert.equal(a.body.sedes, 2, "la matriz y su sucursal");
  assert.equal(a.body.totales.clics, 2, "solo los 2 toques de A (el lote de admin no contó)");
  assert.equal(a.body.acciones.some((x: { accion: string }) => x.accion === "otra"), false);
  assert.equal(a.body.usuarios.some((u: { userId: string }) => u.userId === ids.ub), false);

  const b = await getFicha(ids.b);
  assert.equal(b.body.totales.clics, 3);
  assert.equal(b.body.sedes, 1);

  const suc = await getFicha(ids.a2);
  assert.equal(suc.body.sedes, 1, "una sucursal solo se ve a sí misma");
  assert.equal(suc.body.totales.clics, 0);

  const nada = await getFicha(`${RUN}-no-existe`);
  assert.equal(nada.status, 404);

  // Un mes raro cae al mes en curso (no truena).
  const raro = await getFicha(ids.a, "2026-99");
  assert.equal(raro.status, 200);
  admin.token = null;
});

test("la LISTA del admin trae último uso y clics del mes de cada barbería", { skip }, async () => {
  admin.token = TOKEN;
  const { NextRequest } = await import("next/server");
  const res = await listaApi.GET(new NextRequest(`http://localhost/api/admin/barberias?q=${RUN}`));
  assert.equal(res.status, 200);
  const j = (await res.json()) as { barbershops: Array<{ id: string; lastUsageAt: string | null; clicksThisMonth: number | null }> };
  const fila = (id: string) => j.barbershops.find((s) => s.id === id)!;
  assert.equal(fila(ids.a).clicksThisMonth, 2);
  assert.ok(fila(ids.a).lastUsageAt);
  assert.equal(fila(ids.b).clicksThisMonth, 3);
  assert.equal(fila(ids.a2).clicksThisMonth, 0, "con la tabla, sin uso = 0 (no «—»)");
  assert.equal(fila(ids.a2).lastUsageAt, null);
  admin.token = null;
});
