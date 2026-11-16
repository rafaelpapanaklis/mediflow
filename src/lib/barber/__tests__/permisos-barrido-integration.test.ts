// ═══════════════════════════════════════════════════════════════════════
// Auditoría de PERMISOS (ws6-t8, 16-nov-2026) — BARRIDO de TODAS las rutas.
//
// Rafael: «que no vaya a ser que le quites un acceso y esta persona lo siga
// teniendo». Esconder un botón no es un permiso: el freno tiene que estar en
// el SERVIDOR. Esta suite descubre CADA route.ts de src/app/api/barber/**
// (las rutas que se agreguen mañana entran solas) y llama CADA método:
//
//   1. «nada»: una persona del equipo a la que el dueño le apagó TODO. Ninguna
//      ruta le contesta 2xx, salvo una lista corta y razonada (cerrar sesión,
//      cambiar su contraseña, cambiar entre SUS sedes…). Sin sesión, ninguna.
//   2. ALCANCE: el Barbero (permisos de fábrica, ligado a «Beto») con el id de
//      la cita / cliente / ticket / foto de OTRO barbero («Ana») en la URL:
//      ninguna le contesta 2xx salvo lo que es de todos (fila virtual).
//   3. TENANT: el DUEÑO de la barbería A con ids de la barbería B en la URL:
//      ninguna le contesta 2xx.
//
// Con el getBarberContext REAL (arnés _permisos-arnes.ts): los permisos se
// leen de barber_users en cada petición.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/permisos-barrido-integration.test.ts
//
// BARRIDO_SALIDA=<archivo> escribe la tabla completa para el reporte.
// ═══════════════════════════════════════════════════════════════════════
import { sesion, llamar, type Resp } from "./_permisos-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";
import { BARBER_NO_PERMISSIONS } from "../permissions";

const API = path.resolve(__dirname, "../../../app/api/barber");

/** Rutas que NO llevan sesión de panel (públicas, webhooks, portal del cliente, alta). */
const PUBLICAS = [
  /^affiliates\/r\//,
  /^auth\/(confirmar|recuperar|register|logout)$/,
  /^mercadopago\/webhook$/,
  /^mercadopago\/oauth\/callback$/,
  /^payments\/webhook$/,
  /^stripe\/webhook$/,
  /^portal\//,
  /^public\//,
  /^walkins\/public$/,
];

/**
 * Lo único que una persona SIN permisos puede hacer con éxito, y por qué.
 * Cualquier otra ruta que conteste 2xx a «nada» rompe la suite.
 */
const SIN_PERMISO_A_PROPOSITO: Record<string, string> = {
  "GET branches/current": "saber en qué sede está (barra de arriba)",
  "POST branches/switch": "cambiar de sede entre las que YA le dieron (lo valida getAccessibleBranchIds)",
  "GET mercadopago/status": "¿la tienda cobra en línea? (la cuenta enmascarada viaja a todo el panel: decisión D4 del reporte)",
  "GET stats/inicio": "su Inicio: avisos y sede, SIN dinero si no tiene «Ver caja» (G2, se comprueba abajo)",
};

/** Lo que el Barbero SÍ puede tocar aunque sea de otro: la fila es de todos. */
const DE_TODOS: Record<string, string> = {
  "POST walkins/[id]": "la fila virtual es de todos (decisión ronda 4)",
  "GET walkins": "la fila virtual es de todos: ve a quién le toca con cada barbero",
};

interface Ruta {
  rel: string;
  file: string;
  metodos: string[];
}

function descubrir(): Ruta[] {
  const out: Ruta[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") {
        const rel = path.relative(API, d).split(path.sep).join("/");
        const src = fs.readFileSync(p, "utf8");
        const metodos = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) =>
          new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`).test(src),
        );
        out.push({ rel, file: p, metodos });
      }
    }
  };
  walk(API);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const RUN = `perm${Date.now().toString(36)}`;
let prisma: typeof import("@/lib/prisma")["prisma"];
type Juego = Record<string, string>;
const A: Juego = {}; // barbería A, lo de Beto
const ANA: Juego = {}; // barbería A, lo de Ana
const B: Juego = {}; // barbería B (otra cadena)
const sb: Record<string, string> = {};

async function persona(shop: string, tag: string, role: "OWNER" | "MANAGER" | "RECEPTION" | "BARBER", extra: Partial<Prisma.BarberUserUncheckedCreateInput> = {}) {
  const supabaseId = `${RUN}-${tag}`;
  const u = await prisma.barberUser.create({
    data: { barbershopId: shop, supabaseId, email: `${supabaseId}@test.local`, firstName: tag, lastName: "Prueba", role, ...extra },
  });
  sb[tag] = supabaseId;
  return u.id;
}

/** Siembra una cita, cliente, foto, ticket de venta, bloqueo y fila de un barbero. */
async function sembrarDe(j: Juego, shop: string, barberId: string, ownerUserId: string, n: number) {
  j.shop = shop;
  j.nombreCliente = `Cliente ${n}`; // marcas de texto: si salen en una respuesta, se vio
  j.nombreFila = `Fila ${n}`;
  j.barbero = barberId;
  j.cliente = (await prisma.barberClient.create({
    data: { barbershopId: shop, name: `Cliente ${n}`, phone: `55${1000_0000 + n * 7919 + Math.floor(Math.random() * 1000)}` },
  })).id;
  const ini = new Date(Date.UTC(2026, 10, 16, 14 + n, 0));
  j.cita = (await prisma.barberAppointment.create({
    data: { barbershopId: shop, clientId: j.cliente, barberId, startAt: ini, endAt: new Date(ini.getTime() + 30 * 60_000) },
  })).id;
  j.foto = (await prisma.barberVisitPhoto.create({
    data: { barbershopId: shop, clientId: j.cliente, appointmentId: j.cita, url: `x/${n}.webp`, kind: "AFTER", uploadedByUserId: ownerUserId },
  })).id;
  j.venta = (await prisma.barberSale.create({
    data: { barbershopId: shop, soldByUserId: ownerUserId, clientId: j.cliente, barberId, appointmentId: j.cita, subtotal: new Prisma.Decimal(150), total: new Prisma.Decimal(150) },
  })).id;
  j.bloqueo = (await prisma.barberTimeOff.create({
    data: { barbershopId: shop, barberId, startAt: new Date(Date.UTC(2026, 10, 20, 15)), endAt: new Date(Date.UTC(2026, 10, 20, 16)), createdByUserId: ownerUserId },
  })).id;
  j.fila = (await prisma.barberWalkIn.create({ data: { barbershopId: shop, clientName: `Fila ${n}`, barberId, position: n } })).id;
}

/** Valor de cada segmento dinámico con los ids del juego indicado. */
function paramsDe(rel: string, j: Juego): Record<string, string> {
  const p: Record<string, string> = {};
  const base = rel.split("/")[0];
  for (const m of rel.matchAll(/\[(\w+)\]/g)) {
    const k = m[1];
    if (k === "photoId") p[k] = j.foto ?? "no-existe";
    else if (k === "messageId") p[k] = "no-existe";
    else if (k === "id") {
      const porBase: Record<string, string | undefined> = {
        appointments: j.cita,
        "booking-requests": j.cita,
        branches: j.shop,
        "cash-sessions": j.turno,
        clients: j.cliente,
        products: j.producto,
        sales: j.venta,
        services: j.servicio,
        support: j.ticket,
        team: rel.startsWith("team/barbers") ? j.barbero : j.usuario,
        walkins: j.fila,
        schedules: j.bloqueo,
        "product-orders": "no-existe",
      };
      p[k] = porBase[base] ?? "no-existe";
    }
  }
  return p;
}

async function como(tag: string | null, r: Ruta, metodo: string, j: Juego): Promise<Resp> {
  sesion.supabaseId = tag ? sb[tag] : null;
  sesion.pinSede = metodo === "GET" ? null : null;
  const mod = (await import(r.file)) as Record<string, unknown>;
  const h = mod[metodo] as Parameters<typeof llamar>[0];
  const q = new URLSearchParams({
    from: "2026-11-01", to: "2026-11-30", date: "2026-11-16", q: "a", period: "2026-11",
    barberId: j.barbero, clientId: j.cliente, appointmentId: j.cita,
  });
  try {
    return await llamar(h, {
      method: metodo,
      url: `http://localhost/api/barber/${r.rel}?${q}`,
      body: metodo === "GET" ? undefined : {
        barberId: j.barbero, clientId: j.cliente, appointmentId: j.cita, periodKey: "2026-11",
        ids: [j.barbero], action: ACCION[r.rel] ?? "cancel", closed: true, to: "IN_PROGRESS",
        delta: 1, reason: "prueba de permisos", name: "Nombre", type: "IN", qty: 1, notes: "x",
      },
      params: paramsDe(r.rel, j),
    });
  } catch (e) {
    return { status: -1, body: e instanceof Error ? e.message : String(e) };
  }
}

/** Acción válida por ruta, para que la petición llegue al freno y no a «acción inválida». */
const ACCION: Record<string, string> = {
  "clients/[id]/stars": "adjust",
  "walkins/[id]": "call",
  "product-orders/[id]": "ready",
  "booking-requests/[id]": "confirm",
};

const ok = (r: Resp) => r.status >= 200 && r.status < 300;

/**
 * Huella en la base de lo que es de OTRO (barbero o barbería): si una ruta lo
 * tocó, cambia. `toda` = además, conteos de toda la barbería (tenant).
 */
async function huella(j: Juego, toda: boolean) {
  const cita = await prisma.barberAppointment.findUnique({ where: { id: j.cita }, select: { status: true, notes: true, updatedAt: true, barberId: true, clientId: true } });
  const cliente = await prisma.barberClient.findUnique({ where: { id: j.cliente }, select: { updatedAt: true, name: true, phone: true } });
  const foto = await prisma.barberVisitPhoto.findUnique({ where: { id: j.foto }, select: { visibleToClient: true } });
  const venta = await prisma.barberSale.findUnique({ where: { id: j.venta }, select: { updatedAt: true, notes: true, paymentMethod: true } });
  const bloqueos = await prisma.barberTimeOff.findMany({ where: { barberId: j.barbero }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } });
  const barbero = await prisma.barber.findUnique({ where: { id: j.barbero }, select: { updatedAt: true } });
  const usuario = await prisma.barberUser.findUnique({ where: { id: j.usuario }, select: { updatedAt: true, role: true, permissionsOverride: true, isActive: true, barberId: true } });
  const comisiones = await prisma.barberCommissionEntry.count({ where: { barberId: j.barbero } });
  const ventasDelBarbero = await prisma.barberSale.count({ where: { barberId: j.barbero } });
  const citasDelBarbero = await prisma.barberAppointment.count({ where: { barberId: j.barbero } });
  const base = { cita, cliente, foto, venta, bloqueos, barbero, usuario, comisiones, ventasDelBarbero, citasDelBarbero };
  if (!toda) return base;
  const shop = j.shop;
  const [citas, clientes, ventas, servicios, productos, barberos, usuarios] = await Promise.all([
    prisma.barberAppointment.count({ where: { barbershopId: shop } }),
    prisma.barberClient.count({ where: { barbershopId: shop } }),
    prisma.barberSale.count({ where: { barbershopId: shop } }),
    prisma.barberService.findMany({ where: { barbershopId: shop }, select: { id: true, updatedAt: true } }),
    prisma.barberProduct.findMany({ where: { barbershopId: shop }, select: { id: true, updatedAt: true, stock: true } }),
    prisma.barber.count({ where: { barbershopId: shop } }),
    prisma.barberUser.count({ where: { barbershopId: shop } }),
  ]);
  const tienda = await prisma.barbershop.findUnique({ where: { id: shop }, select: { updatedAt: true } });
  return { ...base, citas, clientes, ventas, servicios, productos, barberos, usuarios, tienda };
}

/**
 * ¿La respuesta deja ver o tocar algo del juego ajeno? Una escritura con 2xx
 * siempre cuenta; una lectura con 2xx cuenta si trae algún dato de ese juego
 * (un 200 con la lista vacía es un recorte bien hecho, no una fuga).
 */
function alcanza(res: Resp, metodo: string, ajeno: Juego, rel: string): boolean {
  if (!ok(res)) return false;
  // Escritura sobre un id ajeno en la URL: un 2xx ya es tocarlo.
  if (metodo !== "GET" && /\[/.test(rel)) return true;
  // Escrituras sin id en la URL (crear, cambiar de sede…) pueden ser legítimas
  // sobre lo propio: lo que cuenta es que no devuelvan nada ajeno, y la HUELLA
  // de lo ajeno en la base (abajo) dice si tocaron algo.
  // Reportes repite en `scope.barberIds` el filtro que se le PIDIÓ (sin datos:
  // sus sumas salen de la barbería de la sesión). El eco no es una fuga.
  const { scope: _eco, ...resto } = (res.body && typeof res.body === "object" ? res.body : { v: res.body }) as Record<string, unknown>;
  const txt = JSON.stringify(resto);
  const compartidos = new Set(["shop", "servicio", "producto", "turno", "ticket"]); // de la barbería, no del barbero
  return Object.entries(ajeno).some(([k, v]) => !compartidos.has(k) && v && txt.includes(v));
}
const permiso = (b: unknown) =>
  b && typeof b === "object" && "permission" in b ? String((b as { permission: unknown }).permission) : "";
const err = (b: unknown) =>
  b && typeof b === "object" && "error" in b ? String((b as { error: unknown }).error).slice(0, 70) : typeof b === "string" ? b.slice(0, 70) : "";

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  const shopA = (await prisma.barbershop.create({
    data: { name: "Barbería Permisos", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active" },
  })).id;
  const shopB = (await prisma.barbershop.create({
    data: { name: "Otra Cadena", slug: `${RUN}-b`, plan: "PROFESIONAL", subscriptionStatus: "active" },
  })).id;
  const beto = (await prisma.barber.create({ data: { barbershopId: shopA, name: "Beto", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  const ana = (await prisma.barber.create({ data: { barbershopId: shopA, name: "Ana", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  const zeta = (await prisma.barber.create({ data: { barbershopId: shopB, name: "Zeta", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  const duenoA = await persona(shopA, "dueno", "OWNER");
  const duenoB = await persona(shopB, "duenoB", "OWNER");
  const recepA = await persona(shopA, "recepcion", "RECEPTION");
  await persona(shopA, "barbero", "BARBER", { barberId: beto });
  const anaUser = await persona(shopA, "ana", "BARBER", { barberId: ana });
  const recepB = await persona(shopB, "recepcionB", "RECEPTION");
  // «Nada»: el dueño le apagó TODO (override vacío explícito, ver G1).
  await persona(shopA, "nada", "RECEPTION", { permissionsOverride: [BARBER_NO_PERMISSIONS] });

  await sembrarDe(A, shopA, beto, duenoA, 1);
  await sembrarDe(ANA, shopA, ana, duenoA, 2);
  await sembrarDe(B, shopB, zeta, duenoB, 3);
  A.usuario = recepA;
  ANA.usuario = anaUser;
  B.usuario = recepB;
  for (const [j, shop, owner] of [[A, shopA, duenoA], [B, shopB, duenoB]] as const) {
    j.servicio = (await prisma.barberService.create({ data: { barbershopId: shop, name: "Corte", durationMin: 30, price: new Prisma.Decimal(150) } })).id;
    j.producto = (await prisma.barberProduct.create({ data: { barbershopId: shop, name: "Cera", price: new Prisma.Decimal(120), stock: 5 } })).id;
    j.turno = (await prisma.barberCashSession.create({ data: { barbershopId: shop, openedByUserId: owner, openingAmount: new Prisma.Decimal(0) } })).id;
    j.ticket = (await prisma.barberSupportTicket.create({ data: { barbershopId: shop, createdByUserId: owner, subject: "Duda" } })).id;
  }
  ANA.servicio = A.servicio;
  ANA.producto = A.producto;
  ANA.turno = A.turno;
  ANA.ticket = A.ticket;
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: RUN } } }).catch(() => undefined);
  await prisma.$disconnect();
});

const filas: string[] = [];

test("1 · con TODO apagado (o sin sesión), ninguna ruta del panel contesta 2xx (salvo las razonadas)", { skip }, async () => {
  const rutas = descubrir().filter((r) => !PUBLICAS.some((re) => re.test(r.rel)));
  assert.ok(rutas.length > 100, `descubrió ${rutas.length} rutas`);
  const fugas: string[] = [];
  for (const r of rutas) {
    for (const m of r.metodos) {
      const clave = `${m} ${r.rel}`;
      const nada = await como("nada", r, m, A);
      const anon = await como(null, r, m, A);
      const barbero = await como("barbero", r, m, A);
      const recepcion = await como("recepcion", r, m, A);
      filas.push([clave, anon.status, nada.status, permiso(nada.body) || err(nada.body), barbero.status, recepcion.status].join("\t"));
      if (ok(nada) && !(clave in SIN_PERMISO_A_PROPOSITO)) fugas.push(`${clave} → ${nada.status}`);
      // mercadopago/status es también la consulta PÚBLICA de la tienda (sin
      // sesión solo dice connected:false/true por slug, nunca la cuenta).
      if (ok(anon) && clave !== "GET mercadopago/status") fugas.push(`${clave} SIN SESIÓN → ${anon.status}`);
      if (clave === "GET mercadopago/status") {
        assert.equal((anon.body as { account?: unknown }).account, null, "sin sesión no viaja la cuenta");
      }
      // G2: el Inicio de «nada» no trae el dinero del día (hay un ticket de $150 hoy).
      if (clave === "GET stats/inicio") {
        const b = nada.body as { can: { money: boolean }; today: { revenue: number; total: number; tickets: number } };
        assert.equal(b.can.money, false, "Inicio de «nada»: sin dinero");
        assert.deepEqual([b.today.revenue, b.today.total, b.today.tickets], [0, 0, 0], "Inicio de «nada»: today en ceros");
        const r = recepcion.body as { can: { money: boolean }; today: { total: number } };
        assert.equal(r.can.money, true, "Recepción (con «Ver caja») sí ve el dinero");
        assert.ok(r.today.total > 0, "y el ticket de hoy cuenta");
      }
    }
  }
  if (process.env.BARRIDO_SALIDA) {
    fs.writeFileSync(process.env.BARRIDO_SALIDA, ["clave\tanon\tnada\tmotivo\tbarbero\trecepcion", ...filas].join("\n") + "\n");
  }
  assert.deepEqual(fugas, [], `rutas que dejan pasar a quien no tiene permiso:\n${fugas.join("\n")}`);
});

test("2 · ALCANCE: el Barbero con ids de OTRO barbero (URL, query o cuerpo) no ve ni toca nada de él", { skip }, async () => {
  const rutas = descubrir().filter((r) => !PUBLICAS.some((re) => re.test(r.rel)));
  const fugas: string[] = [];
  const tabla: string[] = [];
  const antes = await huella(ANA, false);
  for (const r of rutas) {
    for (const m of r.metodos) {
      const clave = `${m} ${r.rel}`;
      const res = await como("barbero", r, m, ANA);
      tabla.push(`${clave}\t${res.status}\t${permiso(res.body) || err(res.body)}`);
      if (alcanza(res, m, ANA, r.rel) && !(clave in DE_TODOS)) fugas.push(`${clave} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    }
  }
  if (process.env.BARRIDO_SALIDA) fs.writeFileSync(`${process.env.BARRIDO_SALIDA}.alcance.tsv`, tabla.join("\n") + "\n");
  assert.deepEqual(fugas, [], `el Barbero alcanza lo de otro barbero:\n${fugas.join("\n")}`);
  assert.deepEqual(await huella(ANA, false), antes, "nada de lo de Ana cambió en la base");
});

test("3 · TENANT: el dueño de A con ids de la barbería B (URL, query o cuerpo) no ve ni toca nada de B", { skip }, async () => {
  const rutas = descubrir().filter((r) => !PUBLICAS.some((re) => re.test(r.rel)));
  const fugas: string[] = [];
  const tabla: string[] = [];
  const antes = await huella(B, true);
  for (const r of rutas) {
    for (const m of r.metodos) {
      const clave = `${m} ${r.rel}`;
      const res = await como("dueno", r, m, B);
      tabla.push(`${clave}\t${res.status}\t${permiso(res.body) || err(res.body)}`);
      if (alcanza(res, m, B, r.rel)) fugas.push(`${clave} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    }
  }
  if (process.env.BARRIDO_SALIDA) fs.writeFileSync(`${process.env.BARRIDO_SALIDA}.tenant.tsv`, tabla.join("\n") + "\n");
  assert.deepEqual(fugas, [], `el dueño de A alcanza datos de B:\n${fugas.join("\n")}`);
  assert.deepEqual(await huella(B, true), antes, "nada de la barbería B cambió en la base");
});
