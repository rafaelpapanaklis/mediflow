// ═══════════════════════════════════════════════════════════════════════
// Auditoría de PERMISOS (ws6-t8, 16-nov-2026) — QUITAR UN ACCESO LO QUITA YA.
//
// Rafael: «que no vaya a ser que le quites un acceso y esta persona lo siga
// teniendo». Todo pasa por las rutas REALES y el getBarberContext REAL (solo
// la sesión de Supabase está doblada, ver _permisos-arnes.ts): el dueño
// cambia los permisos con el mismo PUT que usa la matriz de Equipo y, en la
// SIGUIENTE petición de la persona —sin cerrar sesión, sin esperar— la ruta
// ya contesta 403 (o 401 si la cuenta se dio de baja).
//
//   · 12 permisos que mueven dinero o datos: dar → puede; quitar → no puede.
//   · Cambiar de rol y dar de baja: efecto en la siguiente llamada.
//   · G1: «apagar TODO» dejaba a la persona con TODOS los permisos del rol.
//   · ESCALADA: nadie se da más de lo que tiene, ni sube su rol, ni toca al
//     dueño, ni crea un dueño sin serlo; el Encargado no toca la suscripción;
//     Recepción no ve ni cambia sueldos/comisiones.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/permisos-quitar-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { sesion, llamar, type Resp } from "./_permisos-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";
import {
  BARBER_NO_PERMISSIONS,
  BARBER_ROLE_DEFAULT_PERMISSIONS,
  resolveBarberPermissions,
  type BarberPermissionKey,
} from "../permissions";
import { overrideFromEffective, describeMemberPermissions } from "../team";

const API = path.resolve(__dirname, "../../../app/api/barber");
const ruta = (rel: string) => import(path.join(API, rel, "route.ts")) as Promise<Record<string, Parameters<typeof llamar>[0]>>;

// ── 0. La regla, pura ───────────────────────────────────────────────────

test("G1 · «ningún permiso» se guarda como nada, no como «hereda el rol»", () => {
  for (const role of ["MANAGER", "RECEPTION", "BARBER"] as const) {
    const guardado = overrideFromEffective(role, []);
    assert.deepEqual(guardado, [BARBER_NO_PERMISSIONS], role);
    assert.equal(resolveBarberPermissions(role, guardado).size, 0, `${role}: nada es nada`);
    const d = describeMemberPermissions(role, guardado);
    assert.equal(d.hasOverride, true, "la matriz dice que hay excepciones");
    assert.deepEqual(d.effective, []);
    assert.deepEqual(d.removed.sort(), [...resolveBarberPermissions(role, [])].sort(), "todo lo del rol, quitado");
  }
  // Lo de siempre no cambia: [] sigue siendo «hereda el rol» y un override
  // con claves sigue reemplazando.
  assert.deepEqual([...resolveBarberPermissions("RECEPTION", [])].sort(), [...resolveBarberPermissions("RECEPTION", null)].sort());
  assert.ok(resolveBarberPermissions("RECEPTION", []).has("cash.manage"));
  assert.deepEqual([...resolveBarberPermissions("BARBER", ["agenda.view"])], ["agenda.view"]);
  // La marca no es un permiso: junto a claves de verdad no estorba.
  assert.deepEqual([...resolveBarberPermissions("BARBER", [BARBER_NO_PERMISSIONS, "agenda.view"])], ["agenda.view"]);
});

test("M2 · volver a dejar todo como el rol vuelve a HEREDAR (lo incluido no cuenta como excepción)", () => {
  // Lo que manda la matriz: el conjunto efectivo, con lo incluido
  // («sus propios bloqueos» viene con «bloqueos de cualquiera»).
  for (const role of ["MANAGER", "RECEPTION", "BARBER"] as const) {
    const efectivo = [...resolveBarberPermissions(role, [])];
    assert.deepEqual(overrideFromEffective(role, efectivo), [], `${role}: el efectivo del rol es «hereda»`);
    assert.deepEqual(overrideFromEffective(role, BARBER_ROLE_DEFAULT_PERMISSIONS[role]), [], `${role}: los defaults a secas también`);
    const d = describeMemberPermissions(role, []);
    assert.deepEqual(d.added, [], `${role}: nada sale como «Añadido» sin que nadie lo añadiera`);
    assert.equal(d.hasOverride, false);
  }
  // Quitar SOLO lo incluido no se puede (viene con el otro), y no deja excepción fija.
  const sinPropios = resolveBarberPermissions("RECEPTION", []);
  sinPropios.delete("timeoff.own");
  assert.deepEqual(overrideFromEffective("RECEPTION", sinPropios), []);
  // Una excepción de verdad sigue guardándose entera.
  const conComisiones = [...resolveBarberPermissions("RECEPTION", []), "commissions.view"];
  assert.ok(overrideFromEffective("RECEPTION", conComisiones).includes("commissions.view"));
});

// ── Integración ─────────────────────────────────────────────────────────

const RUN = `quitar${Date.now().toString(36)}`;
let prisma: typeof import("@/lib/prisma")["prisma"];
const sb: Record<string, string> = {};
const uid: Record<string, string> = {};
let shopId: string;
let otraId: string;
let barberoId: string;
let clienteId: string;
let citaId: string;

async function persona(tag: string, role: "OWNER" | "MANAGER" | "RECEPTION" | "BARBER", extra: Partial<Prisma.BarberUserUncheckedCreateInput> = {}) {
  const supabaseId = `${RUN}-${tag}`;
  const u = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId, email: `${supabaseId}@test.local`, firstName: tag, lastName: "Prueba", role, ...extra },
  });
  sb[tag] = supabaseId;
  uid[tag] = u.id;
  return u.id;
}

/** Llama una ruta como `tag` (null = sin sesión). Las escrituras llevan la sede de la pantalla. */
async function como(
  tag: string | null,
  rel: string,
  metodo: string,
  opts: { body?: unknown; params?: Record<string, string>; query?: string } = {},
): Promise<Resp> {
  sesion.supabaseId = tag ? sb[tag] : null;
  sesion.pinSede = metodo === "GET" ? null : shopId;
  const mod = await ruta(rel);
  return llamar(mod[metodo], {
    method: metodo,
    url: `http://localhost/api/barber/${rel}${opts.query ? `?${opts.query}` : ""}`,
    body: opts.body,
    params: opts.params,
  });
}

/** El dueño deja a `tag` con exactamente este conjunto efectivo (como la matriz). */
async function dejarCon(tag: string, efectivos: Iterable<string>): Promise<void> {
  const r = await como("dueno", "team/members/[id]/permissions", "PUT", {
    params: { id: uid[tag] },
    body: { permissions: [...new Set(efectivos)] },
  });
  assert.equal(r.status, 200, `el dueño guarda los permisos de ${tag}: ${JSON.stringify(r.body)}`);
}

const pasa = (r: Resp) => r.status !== 401 && r.status !== 403;

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  shopId = (await prisma.barbershop.create({
    data: { name: "Barbería Quitar", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active" },
  })).id;
  otraId = (await prisma.barbershop.create({
    data: { name: "Otra", slug: `${RUN}-b`, plan: "PROFESIONAL", subscriptionStatus: "active" },
  })).id;
  barberoId = (await prisma.barber.create({
    data: { barbershopId: shopId, name: "Beto", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) },
  })).id;
  clienteId = (await prisma.barberClient.create({
    data: { barbershopId: shopId, name: "Cliente Quitar", phone: `55${1000_0000 + Math.floor(Math.random() * 8e7)}` },
  })).id;
  const ini = new Date(Date.UTC(2026, 10, 18, 16));
  citaId = (await prisma.barberAppointment.create({
    data: { barbershopId: shopId, clientId: clienteId, barberId: barberoId, startAt: ini, endAt: new Date(ini.getTime() + 30 * 60_000) },
  })).id;
  await persona("dueno", "OWNER");
  await persona("rita", "RECEPTION"); // la de mostrador a la que se le dan y quitan permisos
  await persona("gerente", "MANAGER");
  await persona("recepcion", "RECEPTION");
  await persona("recepcionEquipo", "RECEPTION");
  await persona("barbero", "BARBER", { barberId: barberoId });
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: RUN } } }).catch(() => undefined);
  await prisma.$disconnect();
});

/**
 * Cada caso: el permiso y la llamada que lo exige. `crea` deja la base lista
 * para que la llamada «puede» sea un éxito de verdad (no un 409).
 */
interface Caso {
  permiso: BarberPermissionKey;
  rel: string;
  metodo: string;
  body?: () => unknown;
  params?: () => Record<string, string>;
  query?: () => string;
  antesDePoder?: () => Promise<void>;
}

const CASOS: Caso[] = [
  {
    permiso: "cash.manage",
    rel: "cash-sessions/open",
    metodo: "POST",
    body: () => ({ openingAmount: 0 }),
    // Cada «puede» abre un turno: se cierra antes del siguiente intento.
    antesDePoder: async () => {
      await prisma.barberCashSession.updateMany({ where: { barbershopId: shopId, closedAt: null }, data: { closedAt: new Date() } });
    },
  },
  { permiso: "cash.view", rel: "sales", metodo: "GET" },
  { permiso: "agenda.edit", rel: "appointments/[id]", metodo: "PATCH", params: () => ({ id: citaId }), body: () => ({ notes: "editada" }) },
  { permiso: "agenda.view", rel: "appointments", metodo: "GET", query: () => "date=2026-11-18" },
  { permiso: "clients.edit", rel: "clients/[id]", metodo: "PATCH", params: () => ({ id: clienteId }), body: () => ({ notes: "nota" }) },
  { permiso: "clients.view", rel: "clients", metodo: "GET" },
  { permiso: "commissions.view", rel: "commissions", metodo: "GET", query: () => "period=2026-11" },
  { permiso: "commissions.manage", rel: "commissions/pay", metodo: "POST", body: () => ({ barberId: barberoId, periodKey: "2026-11" }) },
  { permiso: "barbers.manage", rel: "team/barbers", metodo: "GET" },
  { permiso: "billing.manage", rel: "billing/status", metodo: "GET" },
  { permiso: "whatsapp.view", rel: "whatsapp/threads", metodo: "GET" },
  { permiso: "whatsapp.send", rel: "whatsapp/archive", metodo: "POST", body: () => ({ phone: "5512345678", archived: true }) },
  { permiso: "team.manage", rel: "team/members", metodo: "GET" },
  { permiso: "settings.edit", rel: "settings", metodo: "GET" },
  { permiso: "services.manage", rel: "services", metodo: "GET" },
  { permiso: "products.manage", rel: "products", metodo: "POST", body: () => ({ name: `Cera ${Math.random()}`, price: 100, stock: 1 }) },
];

const RECEPCION = BARBER_ROLE_DEFAULT_PERMISSIONS.RECEPTION;
// Lo que el permiso trae incluido (IMPLIES) también se apaga al quitarlo de la matriz.
const incluidos: Partial<Record<BarberPermissionKey, BarberPermissionKey[]>> = {
  "products.manage": ["products.view"],
};

for (const c of CASOS) {
  test(`dar → puede; quitar → la SIGUIENTE llamada ya no: ${c.permiso} (${c.metodo} ${c.rel})`, { skip }, async () => {
    const sin = RECEPCION.filter((k) => k !== c.permiso && !(incluidos[c.permiso] ?? []).includes(k));
    // Dar
    await dejarCon("rita", [...sin, c.permiso]);
    await c.antesDePoder?.();
    const conPermiso = await como("rita", c.rel, c.metodo, { body: c.body?.(), params: c.params?.(), query: c.query?.() });
    assert.ok(pasa(conPermiso), `con ${c.permiso} pasa: ${conPermiso.status} ${JSON.stringify(conPermiso.body).slice(0, 200)}`);
    // Quitar — y la siguiente petición, sin cerrar sesión ni esperar.
    await dejarCon("rita", sin);
    await c.antesDePoder?.();
    const sinPermiso = await como("rita", c.rel, c.metodo, { body: c.body?.(), params: c.params?.(), query: c.query?.() });
    assert.equal(sinPermiso.status, 403, `sin ${c.permiso}: ${JSON.stringify(sinPermiso.body).slice(0, 200)}`);
    // Y volver a dar lo devuelve (no queda «pegado» en ningún lado).
    await dejarCon("rita", [...sin, c.permiso]);
    await c.antesDePoder?.();
    const otraVez = await como("rita", c.rel, c.metodo, { body: c.body?.(), params: c.params?.(), query: c.query?.() });
    assert.ok(pasa(otraVez), `devuelto ${c.permiso} vuelve a pasar: ${otraVez.status}`);
  });
}

test("M2 · apagar «Cobrar» y volver a encenderlo (como en panel.108) deja a la persona HEREDANDO el rol", { skip }, async () => {
  const efectivo = [...resolveBarberPermissions("RECEPTION", [])]; // lo que pinta y manda la matriz
  await dejarCon("rita", efectivo.filter((k) => k !== "cash.manage"));
  await dejarCon("rita", efectivo);
  const fila = await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.rita } });
  assert.deepEqual(fila.permissionsOverride, [], "sin excepciones fijas (en la base quedaban las 15 claves)");
  const lista = await como("dueno", "team/members", "GET");
  const m = (lista.body as { members: { id: string; permissions: { hasOverride: boolean; added: string[] } }[] }).members.find((x) => x.id === uid.rita)!;
  assert.equal(m.permissions.hasOverride, false, "la tarjeta dice «Hereda los permisos de Recepción»");
  assert.deepEqual(m.permissions.added, []);
});

test("G1 · el dueño le apaga TODO → la siguiente llamada ya no pasa (antes: recuperaba TODO lo del rol)", { skip }, async () => {
  await dejarCon("rita", RECEPCION);
  assert.equal((await como("rita", "appointments", "GET", { query: "date=2026-11-18" })).status, 200);
  await dejarCon("rita", []);
  for (const [rel, metodo, query] of [
    ["appointments", "GET", "date=2026-11-18"],
    ["clients", "GET", ""],
    ["sales", "GET", ""],
    ["cash-sessions/current", "GET", ""],
    ["whatsapp/threads", "GET", ""],
  ] as const) {
    const r = await como("rita", rel, metodo, { query });
    assert.equal(r.status, 403, `${metodo} ${rel} con TODO apagado`);
  }
  const fila = await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.rita }, select: { permissionsOverride: true } });
  assert.deepEqual(fila.permissionsOverride, [BARBER_NO_PERMISSIONS], "se guarda «nada», no []");
  // La matriz se lo enseña así al dueño: nada encendido, todo «quitado».
  const lista = await como("dueno", "team/members", "GET");
  const ritaFila = (lista.body as { members: { id: string; permissions: { effective: string[]; hasOverride: boolean } }[] }).members.find((m) => m.id === uid.rita)!;
  assert.deepEqual(ritaFila.permissions.effective, []);
  assert.equal(ritaFila.permissions.hasOverride, true);
  // «Restablecer a los del rol» la devuelve.
  await dejarCon("rita", RECEPCION);
  assert.equal((await como("rita", "appointments", "GET", { query: "date=2026-11-18" })).status, 200);
  assert.deepEqual((await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.rita } })).permissionsOverride, []);
});

test("M1 · «Administrar comisiones» trae «Ver comisiones»: pagar no responde 403 después de haber pagado", { skip }, async () => {
  // Una venta con comisión pendiente para Beto en el periodo.
  const venta = await prisma.barberSale.create({
    data: { barbershopId: shopId, soldByUserId: uid.dueno, barberId: barberoId, subtotal: new Prisma.Decimal(200), total: new Prisma.Decimal(200), createdAt: new Date(Date.UTC(2026, 10, 10, 18)) },
  });
  await prisma.barberCommissionEntry.create({
    data: { barbershopId: shopId, barberId: barberoId, saleId: venta.id, base: new Prisma.Decimal(200), pct: new Prisma.Decimal(50), amount: new Prisma.Decimal(100), periodKey: "2026-11" },
  });
  await dejarCon("rita", [...RECEPCION, "commissions.manage"]);
  const r = await como("rita", "commissions/pay", "POST", { body: { barberId: barberoId, periodKey: "2026-11" } });
  const pagadas = await prisma.barberCommissionEntry.count({ where: { barberId: barberoId, periodKey: "2026-11", paidAt: { not: null } } });
  // Lo que importa: la respuesta dice la verdad sobre lo que pasó en la base.
  assert.equal(r.status === 200, pagadas > 0, `respuesta ${r.status} y ${pagadas} comisiones pagadas: ${JSON.stringify(r.body).slice(0, 200)}`);
  assert.equal(r.status, 200);
  assert.ok(resolveBarberPermissions("RECEPTION", ["commissions.manage"]).has("commissions.view"));
  await dejarCon("rita", RECEPCION);
});

test("G2 · Inicio: quitar «Ver caja» quita el dinero del día en la siguiente carga (y al Barbero, «Ver comisiones»)", { skip }, async () => {
  await prisma.barberSale.create({
    data: { barbershopId: shopId, soldByUserId: uid.dueno, barberId: barberoId, subtotal: new Prisma.Decimal(300), total: new Prisma.Decimal(320), tip: new Prisma.Decimal(20) },
  });
  type Inicio = { can: { money: boolean }; today: { revenue: number; produced: number; total: number; tips: number; tickets: number; avgTicket: number | null }; compare: { vsYesterdayPct: number | null } };
  const inicio = async (tag: string) => {
    const r = await como(tag, "stats/inicio", "GET");
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    return r.body as Inicio;
  };
  await dejarCon("rita", RECEPCION);
  const con = await inicio("rita");
  assert.equal(con.can.money, true);
  assert.ok(con.today.revenue >= 300, `con «Ver caja» ve el ingreso: ${con.today.revenue}`);
  await dejarCon("rita", RECEPCION.filter((k) => k !== "cash.view"));
  const sin = await inicio("rita");
  assert.equal(sin.can.money, false);
  assert.deepEqual(
    [sin.today.revenue, sin.today.total, sin.today.tips, sin.today.tickets, sin.today.avgTicket, sin.compare.vsYesterdayPct],
    [0, 0, 0, 0, null, null],
    "sin «Ver caja» no viaja nada del dinero",
  );
  await dejarCon("rita", RECEPCION);
  // Barbero: su producción, con «Ver comisiones» (de fábrica); sin ella, nada.
  const b = await inicio("barbero");
  assert.equal(b.can.money, true);
  assert.ok(b.today.produced > 0, "el Barbero ve lo que produjo");
  await dejarCon("barbero", BARBER_ROLE_DEFAULT_PERMISSIONS.BARBER.filter((k) => k !== "commissions.view"));
  const b2 = await inicio("barbero");
  assert.equal(b2.can.money, false);
  assert.equal(b2.today.produced, 0);
  await dejarCon("barbero", BARBER_ROLE_DEFAULT_PERMISSIONS.BARBER);
});

test("cambiar el ROL tiene efecto en la siguiente llamada (Recepción → Barbero → Recepción)", { skip }, async () => {
  await dejarCon("rita", RECEPCION);
  assert.equal((await como("rita", "sales", "GET")).status, 200);
  const bajar = await como("dueno", "team/members/[id]", "PATCH", { params: { id: uid.rita }, body: { role: "BARBER" } });
  assert.equal(bajar.status, 200, JSON.stringify(bajar.body));
  assert.equal((await como("rita", "sales", "GET")).status, 403, "Barbero no ve la caja");
  assert.equal((await como("rita", "cash-sessions/open", "POST", { body: { openingAmount: 0 } })).status, 403, "ni cobra");
  const subir = await como("dueno", "team/members/[id]", "PATCH", { params: { id: uid.rita }, body: { role: "RECEPTION" } });
  assert.equal(subir.status, 200);
  assert.equal((await como("rita", "sales", "GET")).status, 200);
});

test("DAR DE BAJA: con la sesión abierta, la siguiente llamada ya es 401 en todo; reactivar la devuelve", { skip }, async () => {
  assert.equal((await como("rita", "appointments", "GET", { query: "date=2026-11-18" })).status, 200);
  const baja = await como("dueno", "team/members/[id]", "DELETE", { params: { id: uid.rita } });
  assert.equal(baja.status, 200, JSON.stringify(baja.body));
  for (const [rel, metodo] of [["appointments", "GET"], ["sales", "GET"], ["branches/current", "GET"], ["cash-sessions/open", "POST"]] as const) {
    const r = await como("rita", rel, metodo, { body: metodo === "POST" ? { openingAmount: 0 } : undefined });
    assert.equal(r.status, 401, `${metodo} ${rel} con la cuenta de baja`);
  }
  // El layout del panel usa el mismo getBarberContext: sin contexto → /barber/entrar.
  const { getBarberContext } = await import("@/lib/barber-auth");
  sesion.supabaseId = sb.rita;
  assert.equal(await getBarberContext(), null);
  const alta = await como("dueno", "team/members/[id]", "PATCH", { params: { id: uid.rita }, body: { isActive: true } });
  assert.equal(alta.status, 200);
  assert.equal((await como("rita", "appointments", "GET", { query: "date=2026-11-18" })).status, 200);
});

test("SEDE: quitarle el acceso a una sucursal → en la siguiente petición ya no la opera (aunque su cookie la pida)", { skip }, async () => {
  const suc = (await prisma.barbershop.create({
    data: { name: "Barbería Quitar", branchName: "Norte", slug: `${RUN}-n`, plan: "PROFESIONAL", subscriptionStatus: "active", parentId: shopId, isMainBranch: false },
  })).id;
  await prisma.barberClient.create({ data: { barbershopId: suc, name: "Cliente de Norte", phone: `55${1000_0000 + Math.floor(Math.random() * 8e7)}` } });
  await dejarCon("rita", RECEPCION);
  const dar = await como("dueno", "team/members/[id]/branches", "PUT", { params: { id: uid.rita }, body: { branchIds: [suc] } });
  assert.equal(dar.status, 200, JSON.stringify(dar.body));
  sesion.cookieSede = suc;
  try {
    assert.deepEqual((await como("rita", "branches/current", "GET")).body, { branchId: suc }, "con acceso opera Norte");
    assert.ok(JSON.stringify((await como("rita", "clients", "GET")).body).includes("Cliente de Norte"));
    sesion.cookieSede = null; // el dueño, desde SU pantalla (sede propia)
    const quitar = await como("dueno", "team/members/[id]/branches", "PUT", { params: { id: uid.rita }, body: { branchIds: [] } });
    assert.equal(quitar.status, 200, JSON.stringify(quitar.body));
    sesion.cookieSede = suc; // la cookie de Rita sigue pidiendo Norte
    assert.deepEqual((await como("rita", "branches/current", "GET")).body, { branchId: shopId }, "sin acceso vuelve a su sede");
    assert.ok(!JSON.stringify((await como("rita", "clients", "GET")).body).includes("Cliente de Norte"), "y ya no ve los clientes de Norte");
    // Una escritura hecha desde la pantalla de Norte (pestaña vieja) no se atiende en ninguna sede.
    sesion.supabaseId = sb.rita;
    sesion.pinSede = suc;
    const vieja = await llamar((await ruta("clients"))["POST"], {
      method: "POST",
      url: "http://localhost/api/barber/clients",
      body: { name: "Desde pestaña vieja", phone: "5599990000" },
    });
    assert.equal(vieja.status, 401, "la pantalla vieja de Norte ya no escribe");
    assert.equal(await prisma.barberClient.count({ where: { name: "Desde pestaña vieja" } }), 0);
  } finally {
    sesion.cookieSede = null;
  }
});

// ── ESCALADA ────────────────────────────────────────────────────────────

test("ESCALADA · el Encargado no se da lo que no tiene, no sube su rol, no toca al dueño ni crea dueños", { skip }, async () => {
  const yo = { id: uid.gerente };
  const mios = [...resolveBarberPermissions("MANAGER", [])];
  // Darse la suscripción (no la tiene).
  const darse = await como("gerente", "team/members/[id]/permissions", "PUT", { params: yo, body: { permissions: [...mios, "billing.manage"] } });
  assert.equal(darse.status, 403, JSON.stringify(darse.body));
  // Subirse a dueño.
  const subirse = await como("gerente", "team/members/[id]", "PATCH", { params: yo, body: { role: "OWNER" } });
  assert.ok([403, 409].includes(subirse.status), `subirse a dueño: ${subirse.status}`);
  // Tocar al dueño: datos, rol, permisos, baja.
  const d = { id: uid.dueno };
  assert.equal((await como("gerente", "team/members/[id]", "PATCH", { params: d, body: { firstName: "Otro" } })).status, 403);
  assert.equal((await como("gerente", "team/members/[id]", "PATCH", { params: d, body: { role: "RECEPTION" } })).status, 403);
  assert.equal((await como("gerente", "team/members/[id]/permissions", "PUT", { params: d, body: { permissions: ["agenda.view"] } })).status, 403);
  assert.equal((await como("gerente", "team/members/[id]", "DELETE", { params: d })).status, 403);
  // Crear un dueño.
  const nuevo = await como("gerente", "team/members", "POST", { body: { email: `${RUN}-x@test.local`, firstName: "X", lastName: "Y", role: "OWNER" } });
  assert.equal(nuevo.status, 403, JSON.stringify(nuevo.body));
  // Dar de alta en OTRA barbería.
  const fuera = await como("gerente", "team/members", "POST", { body: { email: `${RUN}-y@test.local`, firstName: "X", lastName: "Y", role: "BARBER", barbershopId: otraId } });
  assert.notEqual(fuera.status, 201, "no da de alta en una barbería ajena");
  assert.equal(await prisma.barberUser.count({ where: { barbershopId: otraId } }), 0);
  // La suscripción: ni verla ni tocarla.
  for (const [rel, metodo] of [["billing/status", "GET"], ["billing/checkout", "POST"], ["billing/cancel", "POST"], ["billing/portal", "POST"], ["affiliates/summary", "GET"]] as const) {
    assert.equal((await como("gerente", rel, metodo, { body: metodo === "POST" ? {} : undefined })).status, 403, `Encargado: ${metodo} ${rel}`);
  }
  // Nada de eso cambió la base.
  const g = await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.gerente } });
  assert.equal(g.role, "MANAGER");
  assert.deepEqual(g.permissionsOverride, []);
  const o = await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.dueno } });
  assert.equal(o.role, "OWNER");
  assert.equal(o.firstName, "dueno");
  assert.equal(o.isActive, true);
});

test("D1 · solo el Dueño nombra o sube Encargados (el Encargado ya no, aunque tenga todos sus permisos)", { skip }, async () => {
  const alta = await como("gerente", "team/members", "POST", { body: { email: `${RUN}-ge@test.local`, firstName: "Otro", lastName: "Encargado", role: "MANAGER" } });
  assert.equal(alta.status, 403, JSON.stringify(alta.body));
  assert.match(String((alta.body as { error: string }).error), /Solo el dueño puede nombrar Encargados/);
  assert.equal(await prisma.barberUser.count({ where: { email: `${RUN}-ge@test.local` } }), 0);
  const subir = await como("gerente", "team/members/[id]", "PATCH", { params: { id: uid.recepcion }, body: { role: "MANAGER" } });
  assert.equal(subir.status, 403, JSON.stringify(subir.body));
  assert.equal((await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.recepcion } })).role, "RECEPTION");
  // Lo que un Encargado SÍ sigue haciendo: dar de alta Recepción/Barbero.
  const recep = await como("gerente", "team/members", "POST", { body: { email: `${RUN}-gr@test.local`, firstName: "Nueva", lastName: "Recepción", role: "RECEPTION" } });
  assert.equal(recep.status, 201, JSON.stringify(recep.body));
  // El dueño sí sube a Encargado (y lo deja como estaba).
  const dueno = await como("dueno", "team/members/[id]", "PATCH", { params: { id: uid.recepcion }, body: { role: "MANAGER" } });
  assert.equal(dueno.status, 200, JSON.stringify(dueno.body));
  assert.equal((await como("dueno", "team/members/[id]", "PATCH", { params: { id: uid.recepcion }, body: { role: "RECEPTION" } })).status, 200);
  // La pantalla no le ofrece «Encargado» a quien no es dueño.
  const ctxGerente = (await como("gerente", "team/members", "GET")).body as { team: { canAssignOwner: boolean } };
  assert.equal(ctxGerente.team.canAssignOwner, false);
});

test("D2 · el rol Barbero nunca marca pagos de comisiones, ni con «Administrar comisiones» dado a mano", { skip }, async () => {
  const { canMarkCommissionsPaid } = await import("../permissions");
  assert.equal(canMarkCommissionsPaid({ role: "BARBER", permissionsOverride: ["commissions.view", "commissions.manage"] }), false);
  assert.equal(canMarkCommissionsPaid({ role: "RECEPTION", permissionsOverride: ["commissions.manage"] }), true);
  assert.equal(canMarkCommissionsPaid({ role: "MANAGER", permissionsOverride: [] }), true);

  const otra = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Otra D2", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(40) } })).id;
  for (const b of [barberoId, otra]) {
    const v = await prisma.barberSale.create({
      data: { barbershopId: shopId, soldByUserId: uid.dueno, barberId: b, subtotal: new Prisma.Decimal(100), total: new Prisma.Decimal(100), createdAt: new Date(Date.UTC(2026, 10, 9, 18)) },
    });
    await prisma.barberCommissionEntry.create({
      data: { barbershopId: shopId, barberId: b, saleId: v.id, base: new Prisma.Decimal(100), pct: new Prisma.Decimal(50), amount: new Prisma.Decimal(50), periodKey: "2026-11" },
    });
  }
  await dejarCon("barbero", [...BARBER_ROLE_DEFAULT_PERMISSIONS.BARBER, "commissions.manage"]);
  const pagadas = () => prisma.barberCommissionEntry.count({ where: { barberId: { in: [barberoId, otra] }, paidAt: { not: null } } });
  const antes = await pagadas();
  for (const b of [barberoId, otra]) {
    const r = await como("barbero", "commissions/pay", "POST", { body: { barberId: b, periodKey: "2026-11" } });
    assert.equal(r.status, 403, `Barbero con el permiso, pagando ${b === barberoId ? "lo suyo" : "a otra"}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(await pagadas(), antes, "no se marcó nada");
  // Quien sí paga: el dueño.
  const r = await como("dueno", "commissions/pay", "POST", { body: { barberId: otra, periodKey: "2026-11" } });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.ok((await pagadas()) > antes);
  await dejarCon("barbero", BARBER_ROLE_DEFAULT_PERMISSIONS.BARBER);
});

test("ESCALADA · Recepción con «Administrar el equipo» no reparte lo que no tiene ni sube a nadie a Encargado", { skip }, async () => {
  await dejarCon("recepcionEquipo", [...RECEPCION, "team.manage"]);
  const mios = [...RECEPCION, "team.manage"];
  // Darse comisiones.
  const darse = await como("recepcionEquipo", "team/members/[id]/permissions", "PUT", { params: { id: uid.recepcionEquipo }, body: { permissions: [...mios, "commissions.view"] } });
  assert.equal(darse.status, 403);
  // Dárselas a otra persona.
  const darOtra = await como("recepcionEquipo", "team/members/[id]/permissions", "PUT", { params: { id: uid.recepcion }, body: { permissions: [...RECEPCION, "commissions.manage"] } });
  assert.equal(darOtra.status, 403);
  // Subir a otra a Encargado (trae todo lo que ella no tiene).
  const subirOtra = await como("recepcionEquipo", "team/members/[id]", "PATCH", { params: { id: uid.recepcion }, body: { role: "MANAGER" } });
  assert.equal(subirOtra.status, 403, JSON.stringify(subirOtra.body));
  // Dar de alta a un Encargado.
  const alta = await como("recepcionEquipo", "team/members", "POST", { body: { email: `${RUN}-z@test.local`, firstName: "Z", lastName: "Z", role: "MANAGER" } });
  assert.equal(alta.status, 403);
  // Cambiarse el rol a sí misma.
  const yo = await como("recepcionEquipo", "team/members/[id]", "PATCH", { params: { id: uid.recepcionEquipo }, body: { role: "MANAGER" } });
  assert.ok([403, 409].includes(yo.status));
  assert.equal((await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.recepcion } })).role, "RECEPTION");
  assert.deepEqual((await prisma.barberUser.findUniqueOrThrow({ where: { id: uid.recepcion } })).permissionsOverride, []);
});

test("ESCALADA · Recepción (de fábrica) no ve ni cambia sueldos ni comisiones de nadie", { skip }, async () => {
  for (const [rel, metodo, extra] of [
    ["commissions", "GET", { query: "period=2026-11" }],
    ["commissions/entries", "GET", { query: `period=2026-11&barberId=${barberoId}` }],
    ["commissions/pay", "POST", { body: { barberId: barberoId, periodKey: "2026-11" } }],
    ["team/barbers", "GET", {}],
    ["team/barbers/[id]", "PATCH", { params: { id: barberoId }, body: { commissionPct: 90, salaryAmount: 99999, salaryPeriod: "WEEKLY" } }],
  ] as const) {
    const r = await como("recepcion", rel, metodo, extra as { query?: string; body?: unknown; params?: Record<string, string> });
    assert.equal(r.status, 403, `Recepción: ${metodo} ${rel}`);
  }
  const b = await prisma.barber.findUniqueOrThrow({ where: { id: barberoId } });
  assert.equal(Number(b.commissionPct), 50, "la comisión de Beto no cambió");
});

test("ESCALADA · el Barbero no ve las comisiones de otro ni se pone bloqueos ajenos", { skip }, async () => {
  const ana = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Ana", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(40) } })).id;
  const otro = await como("barbero", "commissions/entries", "GET", { query: `period=2026-11&barberId=${ana}` });
  assert.equal(otro.status, 403);
  const suyo = await como("barbero", "commissions/entries", "GET", { query: `period=2026-11&barberId=${barberoId}` });
  assert.equal(suyo.status, 200);
  const bloqueoAjeno = await como("barbero", "schedules/timeoff", "POST", {
    body: { barberId: ana, startAt: "2026-11-25T15:00:00.000Z", endAt: "2026-11-25T16:00:00.000Z", reason: "x" },
  });
  assert.equal(bloqueoAjeno.status, 403, JSON.stringify(bloqueoAjeno.body));
  assert.equal(await prisma.barberTimeOff.count({ where: { barberId: ana } }), 0);
  const pagarse = await como("barbero", "commissions/pay", "POST", { body: { barberId: barberoId, periodKey: "2026-11" } });
  assert.equal(pagarse.status, 403, "ni marcarse sus comisiones como pagadas");
});
