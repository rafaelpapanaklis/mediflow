/**
 * «¿RECEPCIÓN PUEDE AGENDAR SOBRE UN DÍA BLOQUEADO?» — la ruta del ajuste. WS1-T5.
 *
 * Run: npm run test:agenda-bloqueos-politica
 *
 * El fallo, en una línea: la tarjeta de Configuración → Horarios y bloqueos
 * pedía `/api/settings/bloqueos/politica`, esa ruta no existía y «politica»
 * caía en `[id]`, que la tomaba por el id de un bloqueo. En producción salía
 * «No se pudo leer este ajuste» y el «Reintentar» tampoco servía.
 *
 * Cómo prueba: llama al HANDLER REAL (GET y PUT) con dobles por ruta resuelta
 * de prisma y de la sesión. El doble de prisma aplica el `where` de verdad
 * (por `clinicId`), así que el aislamiento entre clínicas se ejercita y no se
 * supone.
 *
 * Sin `--experimental-test-module-mocks`: `ruta.server.ts` lleva
 * `import "server-only"`, y con ese flag el paquete no se deja pisar. Se
 * parchea `Module._load` y las rutas se cargan en `before()`.
 */
import Module from "node:module";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");

/* ── el doble de la base ───────────────────────────────────────────────── */

let politicas: { clinicId: string; recepcionPuedeAgendar: boolean; updatedById: string | null }[];
let auditoria: any[];
/** Simula `sql/agenda-bloqueos-politica.sql` sin aplicar. */
let tablaAusente: boolean;

function sinTabla() {
  return Object.assign(new Error('relation "agenda_block_policies" does not exist'), { code: "P2021" });
}

function soloClinica(where: any): string {
  // Un `where` sin clínica devolvería las filas de todas: el doble se niega.
  if (!where || typeof where.clinicId !== "string" || !where.clinicId) {
    throw new Error(`consulta sin clinicId: ${JSON.stringify(where)}`);
  }
  return where.clinicId;
}

const prismaDoble = {
  agendaBlockPolicy: {
    findUnique: async ({ where }: any) => {
      if (tablaAusente) throw sinTabla();
      const id = soloClinica(where);
      const f = politicas.find((p) => p.clinicId === id);
      return f ? { recepcionPuedeAgendar: f.recepcionPuedeAgendar } : null;
    },
    upsert: async ({ where, create, update }: any) => {
      if (tablaAusente) throw sinTabla();
      const id = soloClinica(where);
      assert.equal(create.clinicId, id, "el create va a otra clínica que el where");
      let f = politicas.find((p) => p.clinicId === id);
      if (f) Object.assign(f, update);
      else politicas.push((f = { ...create }));
      return { recepcionPuedeAgendar: f!.recepcionPuedeAgendar };
    },
  },
  auditLog: {
    create: async ({ data }: any) => {
      auditoria.push(data);
      return data;
    },
  },
};

/* ── la sesión ─────────────────────────────────────────────────────────── */

let sesion: any;
function como(role: string, permissionsOverride: string[] = [], clinicId = "c1") {
  sesion = {
    user: { id: `u-${role.toLowerCase()}`, role, clinicId, displayName: role, permissionsOverride },
    clinic: { id: clinicId, timezone: "America/Mexico_City" },
  };
}

let NextResponse: typeof import("next/server").NextResponse;
const dobles = new Map<string, unknown>();

type M = typeof Module & {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const Mod = Module as M;
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

type Ruta = typeof import("@/app/api/settings/bloqueos/politica/route");
let GET: Ruta["GET"];
let PUT: Ruta["PUT"];
let mensajeDeError: typeof import("@/components/dashboard/bloqueos/tipos")["mensajeDeError"];
let parsePolitica: typeof import("@/components/dashboard/bloqueos/politica")["parsePolitica"];
let RUTA_POLITICA: string;

before(async () => {
  ({ NextResponse } = await import("next/server"));
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/agenda/api-helpers.ts"), {
    loadClinicSession: async () =>
      sesion ?? NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  });
  ({ GET, PUT } = await import("@/app/api/settings/bloqueos/politica/route"));
  ({ mensajeDeError } = await import("@/components/dashboard/bloqueos/tipos"));
  ({ parsePolitica, RUTA_POLITICA } = await import("@/components/dashboard/bloqueos/politica"));
});

beforeEach(() => {
  politicas = [];
  auditoria = [];
  tablaAusente = false;
  como("ADMIN");
});

async function leer() {
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

async function guardar(body: unknown) {
  const req: any = {
    json: async () => body,
    headers: new Headers({ "x-forwarded-for": "10.0.0.1", "user-agent": "prueba" }),
  };
  const res = await PUT(req);
  return { status: res.status, body: await res.json() };
}

/** Un error se pinta con su FRASE. Con el código crudo, la tarjeta diría «SIN_PERMISO». */
function assertFrase(r: { status: number; body: any }, status: number, codigo: string) {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.error, codigo);
  assert.equal(typeof r.body.mensaje, "string");
  assert.ok(r.body.mensaje.length > 15, "la frase no está vacía");
  const pintado = mensajeDeError(r.body, "RESPALDO");
  assert.equal(pintado, r.body.mensaje, "la tarjeta pinta la frase del servidor");
  assert.notEqual(pintado, codigo);
}

/* ── la ruta existe donde la pide la pantalla ─────────────────────────── */

test("la ruta que pide la tarjeta EXISTE, y no cae en [id]", () => {
  assert.equal(RUTA_POLITICA, "/api/settings/bloqueos/politica");
  const archivo = path.join(RAIZ, "src/app", RUTA_POLITICA, "route.ts");
  assert.ok(existsSync(archivo), `falta ${archivo}: «politica» caería en [id]`);
  const fuente = readFileSync(archivo, "utf8");
  assert.match(fuente, /export async function GET/);
  assert.match(fuente, /export async function PUT/);
  // Y la tarjeta guarda con PUT: el verbo tiene que coincidir.
  const tarjeta = readFileSync(path.join(RAIZ, "src/components/dashboard/bloqueos/politica-card.tsx"), "utf8");
  assert.match(tarjeta, /method:\s*"PUT"/);
});

/* ── leer ─────────────────────────────────────────────────────────────── */

test("leer · sin fila en la base: «Sí» de fábrica, y la tarjeta lo entiende", async () => {
  const r = await leer();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { recepcionPuedeAgendar: true, puedoAgendarEncima: true });
  assert.deepEqual(parsePolitica(r.body), r.body, "la forma es la que parsea la tarjeta");
});

test("leer · recepción también lo lee (lo pide la ventana de confirmar), y con «Sí» puede", async () => {
  como("RECEPTIONIST");
  const r = await leer();
  assert.deepEqual(r.body, { recepcionPuedeAgendar: true, puedoAgendarEncima: true });
});

test("leer · con el SQL sin aplicar la tabla no existe: sigue siendo «Sí», no un error", async () => {
  tablaAusente = true;
  const r = await leer();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { recepcionPuedeAgendar: true, puedoAgendarEncima: true });
});

/* ── cambiarlo ────────────────────────────────────────────────────────── */

test("cambiar · ADMIN pone «No»: se guarda en SU clínica, deja rastro y se lee de vuelta", async () => {
  const r = await guardar({ recepcionPuedeAgendar: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { recepcionPuedeAgendar: false, puedoAgendarEncima: true });
  assert.deepEqual(politicas, [{ clinicId: "c1", recepcionPuedeAgendar: false, updatedById: "u-admin" }]);

  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].clinicId, "c1");
  assert.equal(auditoria[0].userId, "u-admin");
  assert.deepEqual(auditoria[0].changes["agendaBlockPolicy.recepcionPuedeAgendar"], { before: true, after: false });
  assert.equal(auditoria[0].ipAddress, "10.0.0.1");

  // El ADMIN lo sigue pudiendo; recepción ya no.
  assert.deepEqual((await leer()).body, { recepcionPuedeAgendar: false, puedoAgendarEncima: true });
  como("RECEPTIONIST");
  assert.deepEqual((await leer()).body, { recepcionPuedeAgendar: false, puedoAgendarEncima: false });
  como("DOCTOR");
  assert.deepEqual((await leer()).body, { recepcionPuedeAgendar: false, puedoAgendarEncima: false });
});

test("cambiar · y de vuelta a «Sí»: una sola fila, dos rastros", async () => {
  await guardar({ recepcionPuedeAgendar: false });
  const r = await guardar({ recepcionPuedeAgendar: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { recepcionPuedeAgendar: true, puedoAgendarEncima: true });
  assert.equal(politicas.length, 1);
  assert.equal(politicas[0].recepcionPuedeAgendar, true);
  assert.equal(auditoria.length, 2);
  como("RECEPTIONIST");
  assert.deepEqual((await leer()).body, { recepcionPuedeAgendar: true, puedoAgendarEncima: true });
});

test("cambiar · guardar lo mismo que ya había no ensucia la auditoría", async () => {
  await guardar({ recepcionPuedeAgendar: true });
  assert.equal(auditoria.length, 0);
});

test("cambiar · un valor que no es sí/no → 400 con su frase, y no se guarda nada", async () => {
  for (const cuerpo of [{}, { recepcionPuedeAgendar: "no" }, { recepcionPuedeAgendar: 0 }, { recepcionPuedeAgendar: null }]) {
    assertFrase(await guardar(cuerpo), 400, "VALOR_INVALIDO");
  }
  assert.equal(politicas.length, 0);
});

test("cambiar · con el SQL sin aplicar: 503 que dice qué falta, no finge haber guardado", async () => {
  tablaAusente = true;
  const r = await guardar({ recepcionPuedeAgendar: false });
  assertFrase(r, 503, "SQL_PENDIENTE");
  assert.match(r.body.mensaje, /agenda-bloqueos-politica\.sql/);
  assert.equal(auditoria.length, 0);
});

/* ── permisos ─────────────────────────────────────────────────────────── */

for (const rol of ["RECEPTIONIST", "DOCTOR"]) {
  test(`permisos · ${rol} (sin settings.edit) intenta cambiarlo → 403 con su frase, y no cambia nada`, async () => {
    como(rol);
    const r = await guardar({ recepcionPuedeAgendar: false });
    assertFrase(r, 403, "SIN_PERMISO");
    assert.equal(politicas.length, 0);
    assert.equal(auditoria.length, 0);
    // Y sigue en «Sí» para todos.
    como("ADMIN");
    assert.equal((await leer()).body.recepcionPuedeAgendar, true);
  });
}

test("permisos · manda el PERMISO, no el rol: recepción con settings.edit concedido sí puede", async () => {
  como("RECEPTIONIST", ["agenda.view", "settings.view", "settings.edit"]);
  const r = await guardar({ recepcionPuedeAgendar: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(politicas[0].recepcionPuedeAgendar, false);
});

test("permisos · ADMIN al que le quitaron settings.edit → 403", async () => {
  como("ADMIN", ["agenda.view", "settings.view"]);
  assertFrase(await guardar({ recepcionPuedeAgendar: false }), 403, "SIN_PERMISO");
  assert.equal(politicas.length, 0);
});

test("permisos · sin sesión → 401 y no se toca la base", async () => {
  sesion = null;
  assert.equal((await leer()).status, 401);
  assert.equal((await guardar({ recepcionPuedeAgendar: false })).status, 401);
  assert.equal(politicas.length, 0);
});

/* ── aislamiento por clínica ──────────────────────────────────────────── */

test("aislamiento · el «No» de la clínica c2 no se ve ni se aplica en c1", async () => {
  politicas.push({ clinicId: "c2", recepcionPuedeAgendar: false, updatedById: "otro" });
  como("RECEPTIONIST", [], "c1");
  assert.deepEqual((await leer()).body, { recepcionPuedeAgendar: true, puedoAgendarEncima: true });
});

test("aislamiento · un `clinicId` en el cuerpo se ignora: se guarda en la clínica de la SESIÓN", async () => {
  como("ADMIN", [], "c1");
  const r = await guardar({ recepcionPuedeAgendar: false, clinicId: "c2" });
  assert.equal(r.status, 200);
  assert.deepEqual(politicas.map((p) => p.clinicId), ["c1"]);
  como("ADMIN", [], "c2");
  assert.equal((await leer()).body.recepcionPuedeAgendar, true);
});
