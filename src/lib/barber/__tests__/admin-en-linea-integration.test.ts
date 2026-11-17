// «En línea» del admin de barberías contra Postgres LOCAL: la consulta real de
// la lista (con el JOIN a barber_shops y las sucursales de las matrices), la
// de la ficha por persona y la de Actividad. Solo crea y borra SUS filas (no
// aparta la tabla). Se salta sola si DATABASE_URL no es local (_base-local.ts).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/admin-en-linea-integration.test.ts
//
// Necesita sql/barber_usage_events.sql pegado en esa base local.
import { skip } from "./_base-local";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const RUN = `enl${Date.now().toString(36)}`;

type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
let act: typeof import("@/lib/barber/uso/actividad");
let reg: typeof import("@/lib/barber/uso/registro");

const ids = { m: "", s: "", o: "", um: "", us: "", uo: "" };
const ahora = new Date();
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  act = await import("@/lib/barber/uso/actividad");
  reg = await import("@/lib/barber/uso/registro");
  reg.olvidarUsoListo();

  const shop = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.barbershop.create({
      data: { name: `EnLinea ${slug}`, slug: `${RUN}-${slug}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Merida", ...extra },
    });
  const m = await shop("m");
  const s = await shop("s", { parentId: m.id, isMainBranch: false, branchName: "Norte" });
  const o = await shop("o");
  const user = (sid: string, tag: string) =>
    prisma.barberUser.create({
      data: { barbershopId: sid, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: "EnLinea", lastName: tag.toUpperCase(), role: "OWNER" as never },
    });
  Object.assign(ids, { m: m.id, s: s.id, o: o.id, um: (await user(m.id, "um")).id, us: (await user(s.id, "us")).id, uo: (await user(o.id, "uo")).id });

  const fila = (shopId: string, userId: string, type: string, at: Date) =>
    prisma.$executeRaw`INSERT INTO "barber_usage_events" ("id","barbershopId","userId","sessionId","type","screen","action","target","createdAt")
      VALUES (${`${RUN}-${Math.random().toString(36).slice(2)}`}, ${shopId}, ${userId}, ${`${RUN}-x`}, ${type}, ${"/barber/inicio"}, ${null}, ${null}, ${at})`;
  await fila(ids.m, ids.um, "CLICK", hace(30)); // matriz: hace 30 min → fuera
  await fila(ids.s, ids.us, "VIEW", hace(2)); // sucursal: hace 2 min → en línea
  await fila(ids.o, ids.uo, "CLICK", hace(20)); // otra: hace 20 min → fuera
});

after(async () => {
  if (skip) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const sid = shops.map((x) => x.id);
  if (sid.length) {
    await prisma.$executeRaw`DELETE FROM "barber_usage_events" WHERE "barbershopId" = ANY(${sid}::text[])`.catch(() => 0);
    await prisma.barberUser.deleteMany({ where: { barbershopId: { in: sid } } });
    await prisma.barbershop.deleteMany({ where: { parentId: { in: sid } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: sid } } });
  }
  await prisma.$disconnect();
});

test("lista filtrada SOLO a matrices: la matriz sale en línea por su sucursal; la otra no", { skip }, async () => {
  const l = await act.usoParaLista([ids.m, ids.o], prisma, ahora);
  assert.equal(l.disponible, true);
  assert.equal(l.enLinea.has(ids.m), true);
  assert.equal(l.enLinea.has(ids.o), false);
  // El último uso y los clics siguen siendo de CADA sede (la matriz: hace 30 min, 1 clic).
  assert.equal(l.porBarberia.get(ids.m)!.ultimoUso, hace(30).toISOString());
  assert.equal(l.porBarberia.get(ids.m)!.clicsMes >= 0, true);
});

test("lista completa: matriz y sucursal en línea; una sucursal no hereda de su matriz", { skip }, async () => {
  const l = await act.usoParaLista([ids.m, ids.s, ids.o], prisma, ahora);
  assert.deepEqual([ids.m, ids.s, ids.o].map((id) => l.enLinea.has(id)), [true, true, false]);
  // Solo la sucursal pedida (sin la matriz): ella sí, la matriz no se lista.
  const solo = await act.usoParaLista([ids.s], prisma, ahora);
  assert.equal(solo.enLinea.has(ids.s), true);
});

test("ficha: por persona (usuariosEnLinea) y en Actividad (enLinea por persona)", { skip }, async () => {
  const s = await act.usuariosEnLinea([ids.um, ids.us, ids.uo], prisma, ahora);
  assert.deepEqual([...s], [ids.us]);
  const r = await act.actividadDeBarberias([ids.m, ids.s], null, prisma, ahora);
  const porId = Object.fromEntries(r.usuarios.map((u) => [u.userId, u.enLinea]));
  assert.equal(porId[ids.us], true);
  assert.equal(porId[ids.um], false);
  assert.equal(ids.uo in porId, false, "la otra barbería no aparece");
});
