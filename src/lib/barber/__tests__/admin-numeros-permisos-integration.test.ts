// SOLO ADMINS (ws6-t1, punto 4): las tres rutas nuevas de la ficha de
// /admin/barberias —números del negocio, exportar y recibo de Stripe— con
// la sesión de admin REAL (admin_sessions en Postgres LOCAL) en cada estado
// en que el guard del dental la rechaza: sin cookie, token que no existe,
// caducada, revocada, admin desactivado y solo con sesión de barbería. En
// todos: 401 y ni un dato. Con sesión viva: 200 (o redirección del recibo).
// Además, la página y las rutas validan ANTES de leer nada (fuente).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test --test-concurrency=1 src/lib/barber/__tests__/admin-numeros-permisos-integration.test.ts
import { sesion } from "./_permisos-arnes";
import { skip } from "./_base-local";
import Module from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const admin: { token: string | null } = { token: null };
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const cargaPrevia = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  const mod = cargaPrevia.call(this, request, parent, isMain);
  if (request === "@/lib/barber/billing" || request.endsWith("/lib/barber/billing")) {
    return {
      __esModule: true,
      ...(mod as object),
      getBarberStripe: () => ({ invoices: { retrieve: async (id: string) => ({ id, hosted_invoice_url: `https://pay.stripe.test/${id}` }) } }),
    };
  }
  if (request !== "next/headers") return mod;
  const base = mod as { cookies: () => Promise<{ get: (n: string) => unknown }> };
  return {
    ...base,
    cookies: async () => {
      const c = await base.cookies();
      return { ...c, get: (n: string) => (n === "admin_token" && admin.token ? { name: n, value: admin.token } : c.get(n)) };
    },
  };
};

const RAIZ = join(__dirname, "../../../..");
const RUN = `aper${Date.now().toString(36)}`;
type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
const rutas: Record<string, { GET: (req: any, p: any) => Promise<Response> }> = {};
const ids = { a: "", ua: "", adminVivo: "", adminBaja: "" };
const TOK = { vivo: `${RUN}-vivo`, caducado: `${RUN}-caducado`, revocado: `${RUN}-revocado`, baja: `${RUN}-baja` };
const FACTURA = `in_${RUN}x`;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  rutas.numeros = await import("@/app/api/admin/barberias/[id]/numeros/route");
  rutas.export = await import("@/app/api/admin/barberias/[id]/export/route");
  rutas.recibo = await import("@/app/api/admin/barberias/[id]/recibo/route");

  const a = await prisma.barbershop.create({
    data: { name: "Per a", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Merida" },
  });
  const ua = await prisma.barberUser.create({
    data: { barbershopId: a.id, supabaseId: `${RUN}-ua`, email: `${RUN}-ua@test.local`, firstName: "P", lastName: "A", role: "OWNER" },
  });
  await prisma.barberClient.create({ data: { barbershopId: a.id, name: "Cliente Secreto", phone: `${RUN}1` } });
  await prisma.$executeRaw`
    INSERT INTO barber_subscription_payments (barbershop_id, stripe_invoice_id, status, amount_cents, paid_at)
    VALUES (${a.id}, ${FACTURA}, 'paid', 74900, now())`;

  const vivo = await prisma.adminUser.create({ data: { email: `${RUN}@admin.test`, passwordHash: "x" } });
  const baja = await prisma.adminUser.create({ data: { email: `${RUN}-baja@admin.test`, passwordHash: "x", isActive: false } });
  const s = (adminUserId: string, token: string, extra: Record<string, unknown> = {}) =>
    prisma.adminSession.create({ data: { adminUserId, tokenHash: hash(token), expiresAt: new Date(Date.now() + 3_600_000), ...extra } });
  await s(vivo.id, TOK.vivo);
  await s(vivo.id, TOK.caducado, { expiresAt: new Date(Date.now() - 60_000) });
  await s(vivo.id, TOK.revocado, { revokedAt: new Date() });
  await s(baja.id, TOK.baja);
  Object.assign(ids, { a: a.id, ua: ua.id, adminVivo: vivo.id, adminBaja: baja.id });
});

after(async () => {
  if (skip) return;
  await prisma.$executeRaw`DELETE FROM barber_subscription_payments WHERE barbershop_id = ${ids.a}`;
  await prisma.barberClient.deleteMany({ where: { barbershopId: ids.a } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: ids.a } });
  await prisma.barbershop.deleteMany({ where: { id: ids.a } });
  await prisma.adminUser.deleteMany({ where: { id: { in: [ids.adminVivo, ids.adminBaja] } } });
  await prisma.$disconnect();
});

async function pedir(cual: string) {
  const { NextRequest } = await import("next/server");
  const sufijo = cual === "recibo" ? `recibo?factura=${FACTURA}` : cual;
  const res = await rutas[cual].GET(new NextRequest(`http://localhost/api/admin/barberias/${ids.a}/${sufijo}`), {
    params: Promise.resolve({ id: ids.a }),
  });
  const cuerpo = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, cuerpo, location: res.headers.get("location") };
}

const RECHAZOS: Array<[string, () => void]> = [
  ["sin cookie de admin", () => { admin.token = null; sesion.supabaseId = null; }],
  ["token que no existe", () => { admin.token = `${RUN}-inventado`; }],
  ["sesión caducada", () => { admin.token = TOK.caducado; }],
  ["sesión revocada", () => { admin.token = TOK.revocado; }],
  ["admin desactivado", () => { admin.token = TOK.baja; }],
  ["solo sesión de barbería (su dueño)", () => { admin.token = null; sesion.supabaseId = `${RUN}-ua`; }],
];

for (const [nombre, poner] of RECHAZOS) {
  test(`${nombre} → 401 en números, exportar y recibo, sin un dato`, { skip }, async () => {
    poner();
    for (const cual of ["numeros", "export", "recibo"]) {
      const r = await pedir(cual);
      assert.equal(r.status, 401, `${cual}: ${r.status}`);
      assert.equal(r.location, null);
      assert.equal(/Cliente Secreto|clientes|749/.test(r.cuerpo), false, `${cual} no suelta datos`);
    }
    sesion.supabaseId = null;
    admin.token = null;
  });
}

test("con sesión de admin viva: números 200, exportar 200 (ZIP) y recibo → Stripe", { skip }, async () => {
  admin.token = TOK.vivo;
  assert.equal((await pedir("numeros")).status, 200);
  assert.equal((await pedir("export")).status, 200);
  const r = await pedir("recibo");
  assert.equal(r.status, 302);
  assert.equal(r.location, `https://pay.stripe.test/${FACTURA}`);
  admin.token = null;
});

test("fuente: la página pide requireAdminPage y cada ruta valida la sesión ANTES de leer nada", () => {
  const pagina = readFileSync(join(RAIZ, "src/app/admin/barberias/[id]/page.tsx"), "utf8");
  assert.ok(pagina.indexOf("await requireAdminPage()") > 0);
  assert.ok(pagina.indexOf("await requireAdminPage()") < pagina.indexOf("cargarPagosBarberia(params.id)"));
  for (const r of ["numeros", "export", "recibo"]) {
    const src = readFileSync(join(RAIZ, `src/app/api/admin/barberias/[id]/${r}/route.ts`), "utf8");
    const guard = Math.max(src.indexOf("await isAdminAuthed()"), src.indexOf("await getAdminSession()"));
    assert.ok(guard > 0, `${r}: sin guard de admin`);
    for (const lectura of ["numerosDelNegocio(", "exportarBarberia(", "esCobroDeBarberia(", "getBarberStripe("]) {
      const i = src.indexOf(lectura, src.indexOf("export async function GET"));
      if (i > 0) assert.ok(guard < i, `${r}: ${lectura} antes del guard`);
    }
  }
});
