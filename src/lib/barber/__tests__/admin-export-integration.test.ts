// Exportar de la ficha de /admin/barberias (ws6-t1) contra Postgres LOCAL:
// solo admins, ZIP con manifest + CSV de clientes, citas, tickets y líneas;
// la matriz trae sus sucursales, la sucursal solo lo suyo, nunca otra
// barbería; y el CSV no deja pasar fórmulas de Excel.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test --test-concurrency=1 src/lib/barber/__tests__/admin-export-integration.test.ts
import { sesion } from "./_permisos-arnes";
import { skip } from "./_base-local";
import Module from "node:module";
import { createHash } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

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
      return { ...c, get: (n: string) => (n === "admin_token" && admin.token ? { name: n, value: admin.token } : c.get(n)) };
    },
  };
};

const RUN = `aexp${Date.now().toString(36)}`;
type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
let ruta: typeof import("@/app/api/admin/barberias/[id]/export/route");
let core: typeof import("@/lib/barber/admin-export");
const ids = { a: "", a2: "", b: "", adminUser: "" };
const TOKEN = `${RUN}-token-admin`;

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  ruta = await import("@/app/api/admin/barberias/[id]/export/route");
  core = await import("@/lib/barber/admin-export");
  const shop = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.barbershop.create({
      data: { name: `Exp ${slug}`, slug: `${RUN}-${slug}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Merida", ...extra },
    });
  const a = await shop("a");
  const a2 = await shop("a2", { parentId: a.id, isMainBranch: false, branchName: "Norte" });
  const b = await shop("b");
  const au = await prisma.adminUser.create({ data: { email: `${RUN}@admin.test`, passwordHash: "x" } });
  await prisma.adminSession.create({
    data: { adminUserId: au.id, tokenHash: createHash("sha256").update(TOKEN).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  Object.assign(ids, { a: a.id, a2: a2.id, b: b.id, adminUser: au.id });

  const user = await prisma.barberUser.create({
    data: { barbershopId: a.id, supabaseId: `${RUN}-ua`, email: `${RUN}-ua@test.local`, firstName: "E", lastName: "A", role: "OWNER" },
  });
  const ca = await prisma.barberClient.create({ data: { barbershopId: a.id, name: "Ana Matriz", phone: `${RUN}1`, notes: "=HYPERLINK(\"http://x\")" } });
  await prisma.barberClient.create({ data: { barbershopId: a2.id, name: "Beto Norte", phone: `${RUN}2` } });
  await prisma.barberClient.create({ data: { barbershopId: b.id, name: "Ciro Ajeno", phone: `${RUN}3` } });
  const start = new Date("2026-10-05T17:00:00Z");
  await prisma.barberAppointment.create({ data: { barbershopId: a.id, clientId: ca.id, startAt: start, endAt: new Date(start.getTime() + 1_800_000), status: "DONE" } });
  await prisma.barberSale.create({
    data: {
      barbershopId: a.id, soldByUserId: user.id, clientId: ca.id, paymentMethod: "CASH", subtotal: 200, tip: 20, total: 220,
      items: { create: [{ description: "Corte, con barba", qty: 1, unitPrice: 200 }] },
    },
  });
});

after(async () => {
  if (skip) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const sid = shops.map((s) => s.id);
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: sid } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: sid } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { parentId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: sid } } });
  if (ids.adminUser) await prisma.adminUser.deleteMany({ where: { id: ids.adminUser } });
  await prisma.$disconnect();
});

async function getExport(id: string) {
  const { NextRequest } = await import("next/server");
  const res = await ruta.GET(new NextRequest(`http://localhost/api/admin/barberias/${id}/export`), { params: Promise.resolve({ id }) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), disp: res.headers.get("content-disposition"), buf };
}

test("CSV: comillas como el del dental, y una celda que empieza con = no se vuelve fórmula", { skip }, () => {
  assert.equal(core.celdaCsv('Corte, "fade"'), '"Corte, ""fade"""');
  assert.equal(core.celdaCsv("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(core.celdaCsv("@cmd"), "'@cmd");
  assert.equal(core.celdaCsv("-100"), "-100");
  assert.equal(core.celdaCsv(-100), "-100");
  assert.equal(core.celdaCsv(null), "");
  assert.equal(core.celdaCsv(new Date("2026-11-16T00:00:00Z")), "2026-11-16T00:00:00.000Z");
  assert.equal(core.aCsv(["a", "b"], []), "a,b");
});

test("sin sesión de admin → 401 (también con sesión de barbería), sin ZIP", { skip }, async () => {
  admin.token = null;
  sesion.supabaseId = `${RUN}-ua`;
  const r = await getExport(ids.a);
  assert.equal(r.status, 401);
  assert.notEqual(r.type, "application/zip");
  sesion.supabaseId = null;
});

test("con admin: ZIP de la matriz con su sucursal (y nada de otra barbería)", { skip }, async () => {
  admin.token = TOKEN;
  const r = await getExport(ids.a);
  assert.equal(r.status, 200);
  assert.equal(r.type, "application/zip");
  assert.match(r.disp ?? "", new RegExp(`attachment; filename="dalecontrol-barberia-${RUN}-a-`));
  const zip = await JSZip.loadAsync(r.buf);
  assert.deepEqual(Object.keys(zip.files).sort(), ["citas.csv", "clientes.csv", "manifest.json", "tickets-lineas.csv", "tickets.csv"]);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.deepEqual(manifest.counts, { clientes: 2, citas: 1, tickets: 1, lineas: 1 });
  assert.deepEqual(manifest.sedes.map((s: { id: string }) => s.id), [ids.a, ids.a2]);
  const clientes = await zip.file("clientes.csv")!.async("string");
  assert.ok(clientes.startsWith(core.CSV_CLIENTES.join(",")));
  assert.ok(clientes.includes("Ana Matriz") && clientes.includes("Beto Norte"));
  assert.ok(clientes.includes(",Norte,"), "cada fila dice su sede");
  assert.ok(!clientes.includes("Ciro Ajeno"), "nada de otra barbería");
  assert.ok(clientes.includes(`"'=HYPERLINK(""http://x"")"`), "la fórmula va desactivada");
  const tickets = await zip.file("tickets.csv")!.async("string");
  assert.match(tickets, /,CASH,200,20,220,sale,no,/);
  const lineas = await zip.file("tickets-lineas.csv")!.async("string");
  assert.ok(lineas.includes('"Corte, con barba"'));
  admin.token = null;
});

test("con admin: la sucursal exporta solo lo suyo; una barbería que no existe → 404", { skip }, async () => {
  admin.token = TOKEN;
  const r = await getExport(ids.a2);
  assert.equal(r.status, 200);
  const zip = await JSZip.loadAsync(r.buf);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.deepEqual(manifest.counts, { clientes: 1, citas: 0, tickets: 0, lineas: 0 });
  const clientes = await zip.file("clientes.csv")!.async("string");
  assert.ok(clientes.includes("Beto Norte") && !clientes.includes("Ana Matriz"));
  assert.equal((await zip.file("citas.csv")!.async("string")), core.CSV_CITAS.join(","));
  assert.equal((await getExport(`${RUN}-no-existe`)).status, 404);
  admin.token = null;
});
