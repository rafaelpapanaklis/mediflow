/**
 * ws1-t4 · «Clave de la sede» (Configuración → Seguridad).
 *
 * Run: npm run test:sede-clave
 *
 * Con los handlers y gates REALES (getAuthContext, getCurrentUser,
 * /api/switch-clinic, /api/sede-clave, /api/sede-clave/desbloquear,
 * /api/clinics/archivar, /api/admin/clinics/[id]/sede-clave y el reporte de
 * sedes) sobre una base de mentira en memoria que entiende el SQL crudo de
 * src/lib/sede-clave/estado.server.ts. ⛔ Sin base ni red.
 *
 * Todos los dobles van por `Module._load` (no `mock.module`): los módulos del
 * repo entran por el require de tsx, y `import "server-only"` no se deja pisar
 * con mock.module (ver src/app/api/clinics/__tests__/herencia-agenda-flexible.test.ts).
 *
 * Cada «navegador» es un tarro de cookies por persona: lo que una respuesta
 * pone en cookies se copia al tarro de quien hizo la petición.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ══════════════════ La «base» ══════════════════

const SB_DUENO = "sb-dueno";
const SB_ADMIN3 = "sb-admin3";
const SB_OTRO = "sb-otro";
const CLI_1 = "cli_principal";
const CLI_3 = "QA Sede 3:importada#1"; // ids importados: no son uuid ni cuid
const CLI_OTRA = "cli_otra";

interface Ficha {
  id: string;
  supabaseId: string;
  clinicId: string;
  role: string;
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: Date;
  permissionsOverride: string[];
  clinic: { id: string; name: string; category: string; require2fa: boolean; archivedAt: null; createdAt: Date };
}

const clinica = (id: string, name: string, n: number) => ({
  id, name, category: "DENTAL", require2fa: false, archivedAt: null, createdAt: new Date(2025, 0, n),
  timezone: "America/Mexico_City", plan: "CLINIC", trialEndsAt: new Date(2030, 0, 1), subscriptionStatus: "active",
});
const CLINICAS: Record<string, any> = {
  [CLI_1]: clinica(CLI_1, "Altabrisa", 1),
  [CLI_3]: clinica(CLI_3, "QA Sede 3 aislada", 3),
  [CLI_OTRA]: clinica(CLI_OTRA, "Clínica ajena", 5),
};

let fichas: Ficha[] = [];
function ficha(id: string, supabaseId: string, clinicId: string, role: string, permissionsOverride: string[] = []): Ficha {
  return {
    id, supabaseId, clinicId, role, isActive: true, totpEnabled: false, createdAt: new Date(2025, 0, fichas.length + 1),
    permissionsOverride, clinic: CLINICAS[clinicId],
  };
}

interface FilaClave { claveHash: string | null; version: number; actualizadaPor: string | null }
interface FilaIntento { clinicId: string; supabaseId: string; version: number; ok: boolean; createdAt: Date }

const db = {
  tablas: true,
  falloLista: false,
  claves: new Map<string, FilaClave>(),
  intentos: [] as FilaIntento[],
  consultas: [] as string[],
};

const prismaFalso: any = {
  $queryRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ");
    db.consultas.push(sql);
    if (sql.includes("to_regclass")) return [{ existe: db.tablas }];
    if (!db.tablas) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    if (sql.includes(`FROM "sede_claves" WHERE "claveHash" IS NOT NULL`)) {
      if (db.falloLista) throw new Error("pooler caído");
      return Array.from(db.claves.entries()).filter(([, f]) => f.claveHash).map(([clinicId, f]) => ({ clinicId, version: f.version }));
    }
    if (sql.includes(`SELECT "claveHash", "version" FROM "sede_claves"`)) {
      const f = db.claves.get(v[0]);
      return f ? [{ claveHash: f.claveHash, version: f.version }] : [];
    }
    if (sql.includes(`INSERT INTO "sede_claves"`)) {
      const [clinicId, claveHash, por] = v;
      const f = db.claves.get(clinicId);
      if (f && f.claveHash) return [];
      const version = f ? f.version + 1 : 1;
      db.claves.set(clinicId, { claveHash, version, actualizadaPor: por });
      return [{ version }];
    }
    if (sql.includes(`UPDATE "sede_claves"`) && sql.includes(`SET "claveHash" = ?`)) {
      const [claveHash, por, clinicId, versionLeida] = v;
      const f = db.claves.get(clinicId);
      if (!f || !f.claveHash || f.version !== versionLeida) return [];
      db.claves.set(clinicId, { claveHash, version: f.version + 1, actualizadaPor: por });
      return [{ version: f.version + 1 }];
    }
    if (sql.includes(`UPDATE "sede_claves"`) && sql.includes(`SET "claveHash" = NULL`)) {
      const [por, clinicId, versionLeida] = v;
      const f = db.claves.get(clinicId);
      if (!f || !f.claveHash) return [];
      if (versionLeida !== undefined && f.version !== versionLeida) return [];
      db.claves.set(clinicId, { claveHash: null, version: f.version + 1, actualizadaPor: por });
      return [{ version: f.version + 1 }];
    }
    if (sql.includes(`FROM "sede_clave_intentos"`)) {
      const [clinicId, supabaseId, version, desde] = v;
      return db.intentos
        .filter((i) => i.clinicId === clinicId && i.supabaseId === supabaseId && i.version === version && i.createdAt >= desde)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((i) => ({ ok: i.ok, createdAt: i.createdAt }));
    }
    throw new Error(`SQL no previsto en la prueba: ${sql}`);
  },
  $executeRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ");
    db.consultas.push(sql);
    if (sql.includes(`INSERT INTO "sede_clave_intentos"`)) {
      const [, clinicId, supabaseId, version, ok] = v;
      db.intentos.push({ clinicId, supabaseId, version, ok, createdAt: new Date() });
      return 1;
    }
    throw new Error(`SQL no previsto en la prueba: ${sql}`);
  },
  user: {
    findFirst: async ({ where }: any) => {
      const f = fichas.find((x) =>
        x.supabaseId === where.supabaseId && x.clinicId === where.clinicId && (where.isActive === undefined || x.isActive === where.isActive),
      );
      return f ? { id: f.id, clinicId: f.clinicId } : null;
    },
    findMany: async ({ where }: any) =>
      fichas
        .filter((x) => x.supabaseId === where.supabaseId && (!where.role || x.role === where.role) && x.isActive)
        .map((x) => ({ clinic: { id: x.clinic.id, createdAt: x.clinic.createdAt, archivedAt: null } })),
  },
  clinic: {
    findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => CLINICAS[id]).filter(Boolean),
    findUnique: async ({ where }: any) => (CLINICAS[where.id] ? { id: where.id } : null),
    update: async ({ where }: any) => { archivadas.push(where.id); return { id: where.id }; },
  },
  appointment: { count: async () => 0 },
  patient: { count: async () => 0 },
};

// ══════════════════ La sesión, las cookies, la bitácora ══════════════════

/** Quién está sentado en el navegador (supabaseId) y su cookie de sede activa. */
let sesion: string | null = SB_DUENO;
let activa: string | null = CLI_1;
/** Un tarro de cookies por persona = un navegador por persona. */
const navegadores = new Map<string, Map<string, string>>();
const tarro = () => {
  const k = sesion ?? "anon";
  if (!navegadores.has(k)) navegadores.set(k, new Map());
  return navegadores.get(k)!;
};
let ruta: string | null = null;
let accion: string | null = null;
let verComo: string | null = null;
let adminSesion: any = null;
let bitacora: any[] = [];
let bitacoraAdmin: any[] = [];
let respuestas: string[] = [];
let archivadas: string[] = [];
let consultadasReporte: string[] = [];
let activasEscritas: string[] = [];

class Redireccion extends Error {
  constructor(public destino: string) { super(`NEXT_REDIRECT ${destino}`); }
}

function resolverSesion(sb: string, cookieClinic: string | null) {
  const filas = fichas.filter((f) => f.supabaseId === sb && f.isActive).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const deLaCookie = cookieClinic ? filas.find((f) => f.clinicId === cookieClinic) ?? null : null;
  return { filas, deLaCookie, elegida: deLaCookie ?? filas[0] ?? null };
}

const dobles: Record<string, unknown> = {
  "server-only": {},
  react: { cache: <T>(f: T) => f },
  "next/headers": {
    headers: async () => ({ get: (k: string) => (k === "x-pathname" ? ruta : k === "next-action" ? accion : null) }),
    cookies: async () => ({ get: (n: string) => (tarro().has(n) ? { name: n, value: tarro().get(n)! } : undefined) }),
  },
  "next/navigation": { redirect: (d: string) => { throw new Redireccion(d); } },
  "@/lib/prisma": { prisma: prismaFalso },
  "@/lib/supabase/server": {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: sesion ? { id: sesion } : null } }),
        getSession: async () => ({ data: { session: null } }),
      },
    }),
  },
  "@/lib/admin/suplantacion": { estadoSuplantacionDe: async () => ({ tipo: "normal" }) },
  "@/lib/active-clinic": {
    readActiveClinicCookie: async () => activa,
    logClinicFallback: () => undefined,
    resembrarActiveClinicCookie: async () => false,
    writeActiveClinicCookie: (_res: unknown, id: string) => { activasEscritas.push(id); },
  },
  "@/lib/auth/sesion-en-cache": { resolverSesion: async (sb: string, c: string | null) => resolverSesion(sb, c) },
  "@/lib/auth/two-factor-decision": { decidirDosPasos: async () => ({ decision: null }) },
  "@/lib/auth/two-factor-cookie": {
    hasValidVerComoCookie: async (sb: string, cli: string) => verComo === `${sb}|${cli}`,
    applyTwoFactorLoginCookies: async () => undefined,
  },
  "@/lib/plan-status": { isPlanExpired: () => false, isApiPathBlockedForExpiredPlan: () => false },
  "@/lib/audit": { logMutation: async (o: any) => { bitacora.push({ ...o, req: undefined }); } },
  "@/lib/admin-audit": { logAdminClinicMutation: async (o: any) => { bitacoraAdmin.push({ ...o, req: undefined }); } },
  "@/lib/admin-auth": { getAdminSession: async () => adminSesion },
  "@/lib/failban": { persistentRateLimit: async () => null },
  // El reporte de sedes: las cifras de cada sede salen de aquí, y se apunta qué sede se consultó.
  "@/lib/branches": { getOwnedClinicIds: async (sb: string) => fichas.filter((f) => f.supabaseId === sb && f.role === "SUPER_ADMIN").map((f) => f.clinicId) },
  "@/lib/dinero/ingresos.server": {
    ingresosDelPeriodo: async (cid: string) => { consultadasReporte.push(cid); return { neto: 987654, cobrado: 987654, reembolsos: 0 }; },
    movimientosDelPeriodo: async (cid: string) => { consultadasReporte.push(cid); return { cobros: [] }; },
  },
  "@/lib/dinero/abono-core": { contarCobros: () => 3 },
  "@/lib/agenda/ocupacion-del-periodo.server": {
    cargarOcupacionDelPeriodo: async (cid: string) => { consultadasReporte.push(cid); return { porcentaje: 40, minutosOcupados: 40, minutosDisponibles: 100 }; },
  },
  "@/lib/plans": { getPlanLimitsForClinic: async () => ({ maxClinics: 6 }) },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const CLAVE = "Sede3-secreta";
const CLAVE_NUEVA = "OtraClave-99";

beforeEach(async () => {
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  db.tablas = true;
  db.falloLista = false;
  db.claves.clear();
  db.intentos = [];
  db.consultas = [];
  fichas = [
    ficha("u-dueno-1", SB_DUENO, CLI_1, "SUPER_ADMIN"),
    ficha("u-dueno-3", SB_DUENO, CLI_3, "SUPER_ADMIN"),
    ficha("u-admin-3", SB_ADMIN3, CLI_3, "ADMIN", ["settings.view", "sede.clave"]),
    ficha("u-otro", SB_OTRO, CLI_OTRA, "SUPER_ADMIN"),
  ];
  navegadores.clear();
  sesion = SB_DUENO;
  activa = CLI_1;
  // Por defecto, una petición a /api (las páginas y actions se prueban aparte).
  ruta = "/api/prueba";
  accion = null;
  verComo = null;
  adminSesion = null;
  bitacora = [];
  bitacoraAdmin = [];
  respuestas = [];
  archivadas = [];
  consultadasReporte = [];
  activasEscritas = [];
});

// ══════════════════ Utilería ══════════════════

async function llamar(handler: (req: any, extra?: any) => Promise<Response>, url: string, body?: unknown, extra?: unknown) {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res: any = await handler(req, extra);
  // El navegador de quien pidió guarda lo que la respuesta puso en cookies.
  for (const c of res.cookies?.getAll?.() ?? []) {
    if (!c.value || c.maxAge === 0) tarro().delete(c.name);
    else tarro().set(c.name, c.value);
  }
  const texto = await res.text();
  respuestas.push(texto);
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* CSV o vacío */ }
  return { status: res.status as number, body: json, texto };
}

const rutaClave = async () => (await import("@/app/api/sede-clave/route"));
const rutaDesbloquear = async () => (await import("@/app/api/sede-clave/desbloquear/route")).POST;
const rutaSwitch = async () => (await import("@/app/api/switch-clinic/route")).POST;
const rutaArchivar = async () => (await import("@/app/api/clinics/archivar/route")).POST;
const rutaAdmin = async () => (await import("@/app/api/admin/clinics/[id]/sede-clave/route"));
const getAuthContext = async () => (await import("@/lib/auth-context")).getAuthContext();
const getCurrentUser = async (): Promise<any> => (await import("@/lib/auth")).getCurrentUser();

/** La persona `sb` sentada en su navegador con `cli` como sede activa. */
function como(sb: string, cli: string) {
  sesion = sb;
  activa = cli;
}

/** El admin de la sede 3 activa la clave (desde dentro de su sede, sin clave aún). */
async function activarComoAdmin3(clave = CLAVE) {
  como(SB_ADMIN3, CLI_3);
  const { POST } = await rutaClave();
  const r = await llamar(POST, "/api/sede-clave", { accion: "activar", clave, confirmacion: clave });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}

const redirigeA = (destino: string) => (e: unknown) => e instanceof Redireccion && e.destino === destino;

// ══════════════════ 1 · reglas puras ══════════════════

test("la clave nueva: mínimo 6, las dos iguales, máximo 72 bytes", async () => {
  const { validarClaveNueva } = await import("../core");
  assert.deepEqual(validarClaveNueva("", ""), { ok: false, error: "vacia" });
  assert.deepEqual(validarClaveNueva("12345", "12345"), { ok: false, error: "corta" });
  assert.deepEqual(validarClaveNueva("123456", "123457"), { ok: false, error: "distintas" });
  assert.deepEqual(validarClaveNueva("x".repeat(73), "x".repeat(73)), { ok: false, error: "larga" });
  assert.deepEqual(validarClaveNueva("123456", "123456"), { ok: true });
});

test("quién la gestiona: SUPER_ADMIN sí; ADMIN solo con «sede.clave»; DOCTOR/RECEPCIÓN/READONLY nunca", async () => {
  const { puedeGestionarClave } = await import("../core");
  const { ROLE_DEFAULT_PERMISSIONS, ALL_PERMISSIONS } = await import("@/lib/auth/permissions");
  assert.equal(puedeGestionarClave({ role: "SUPER_ADMIN", permissionsOverride: [] }), true);
  assert.equal(puedeGestionarClave({ role: "ADMIN", permissionsOverride: [] }), false, "el default de ADMIN no la trae");
  assert.equal(puedeGestionarClave({ role: "ADMIN", permissionsOverride: ["settings.view", "sede.clave"] }), true);
  for (const role of ["DOCTOR", "RECEPTIONIST", "READONLY"]) {
    assert.equal(puedeGestionarClave({ role, permissionsOverride: ["sede.clave"] }), false, `${role} con la llave en su override`);
  }
  assert.ok("sede.clave" in ALL_PERMISSIONS);
  for (const [rol, keys] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    assert.equal(keys.includes("sede.clave" as any), rol === "SUPER_ADMIN", `default de ${rol}`);
  }
});

test("la cookie del desbloqueo: persona, sede, versión y 72 h; firmada", async () => {
  const { empacarDesbloqueo, desbloqueoVigente, VIGENCIA_DESBLOQUEO_MS } = await import("../core");
  const ahora = Date.now();
  const esperado = { supabaseId: SB_DUENO, clinicId: CLI_3, version: 2 };
  const c = empacarDesbloqueo({ ...esperado, emitidoMs: ahora });
  assert.equal(desbloqueoVigente(c, esperado, ahora), true);
  assert.equal(desbloqueoVigente(c, esperado, ahora + VIGENCIA_DESBLOQUEO_MS - 60_000), true, "a las 71 h 59 min");
  assert.equal(desbloqueoVigente(c, esperado, ahora + VIGENCIA_DESBLOQUEO_MS + 60_000), false, "a las 72 h + 1 min");
  assert.equal(desbloqueoVigente(c, { ...esperado, version: 3 }, ahora), false, "otra versión de la clave");
  assert.equal(desbloqueoVigente(c, { ...esperado, supabaseId: SB_ADMIN3 }, ahora), false, "otra persona");
  assert.equal(desbloqueoVigente(c, { ...esperado, clinicId: CLI_1 }, ahora), false, "otra sede");
  assert.equal(desbloqueoVigente(c.slice(0, -1) + (c.endsWith("a") ? "b" : "a"), esperado, ahora), false, "firma tocada");
  assert.equal(desbloqueoVigente(empacarDesbloqueo({ ...esperado, emitidoMs: ahora }, "otro-secreto"), esperado, ahora), false);
});

test("intentos: 5 fallos en 15 min bloquean 15 min; un acierto o fallos espaciados no", async () => {
  const { estadoDeIntentos, MAX_FALLOS } = await import("../core");
  const t0 = Date.UTC(2026, 9, 25, 12, 0, 0);
  const min = 60_000;
  const f = (m: number) => ({ ok: false, en: t0 + m * min });
  assert.deepEqual(estadoDeIntentos([f(0), f(1), f(2), f(3)], t0 + 4 * min), { bloqueadoHasta: null, restantes: 1 });
  const cinco = [f(0), f(1), f(2), f(3), f(4)];
  assert.equal(estadoDeIntentos(cinco, t0 + 5 * min).bloqueadoHasta, t0 + 19 * min, "15 min desde el quinto");
  assert.equal(estadoDeIntentos(cinco, t0 + 18 * min).restantes, 0);
  assert.deepEqual(estadoDeIntentos(cinco, t0 + 19 * min + 1000), { bloqueadoHasta: null, restantes: MAX_FALLOS }, "al acabar, de cero");
  assert.equal(estadoDeIntentos([f(0), f(1), f(2), f(3), { ok: true, en: t0 + 3.5 * min }, f(4)], t0 + 5 * min).bloqueadoHasta, null, "el acierto reinicia");
  assert.equal(estadoDeIntentos([f(0), f(5), f(10), f(16), f(20)], t0 + 21 * min).bloqueadoHasta, null, "cinco en 20 min no son cinco en 15");
});

test("el destino tras desbloquear solo puede ser una pantalla del panel", async () => {
  const { destinoSeguro } = await import("../core");
  assert.equal(destinoSeguro("/dashboard/agenda"), "/dashboard/agenda");
  assert.equal(destinoSeguro("https://malo.example"), "/dashboard");
  assert.equal(destinoSeguro("//malo.example/dashboard"), "/dashboard");
  assert.equal(destinoSeguro("/dashboard/sede-con-clave"), "/dashboard");
  assert.equal(destinoSeguro(undefined), "/dashboard");
});

// ══════════════════ 2 · sin SQL, todo igual ══════════════════

test("sin sql/sede-clave.sql: nadie queda bloqueado, nada se consulta y la tarjeta no aparece", async () => {
  db.tablas = false;
  db.claves.set(CLI_3, { claveHash: "$2a$10$noseusa", version: 1, actualizadaPor: null });
  como(SB_DUENO, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3);
  assert.equal((await getCurrentUser()).clinicId, CLI_3);
  como(SB_DUENO, CLI_1);
  const sw = await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 });
  assert.equal(sw.status, 200);
  const { GET } = await rutaClave();
  const g = await llamar(GET, "/api/sede-clave");
  assert.deepEqual(g.body, { disponible: false, puedeGestionar: true, activa: false });
  assert.deepEqual(
    db.consultas.filter((q) => !q.includes("to_regclass")),
    [],
    "sin las tablas solo se pregunta si existen",
  );
});

// ══════════════════ 3 · activar exige permiso ══════════════════

test("activar: SUPER_ADMIN sí, ADMIN con permiso sí, ADMIN sin permiso no, DOCTOR/RECEPCIÓN no", async () => {
  const { POST } = await rutaClave();
  fichas.push(
    ficha("u-admin-sin", "sb-admin-sin", CLI_3, "ADMIN"),
    ficha("u-doc", "sb-doc", CLI_3, "DOCTOR", ["sede.clave"]),
    ficha("u-rec", "sb-rec", CLI_3, "RECEPTIONIST", ["sede.clave"]),
  );
  for (const sb of ["sb-admin-sin", "sb-doc", "sb-rec"]) {
    como(sb, CLI_3);
    const r = await llamar(POST, "/api/sede-clave", { accion: "activar", clave: CLAVE, confirmacion: CLAVE });
    assert.equal(r.status, 403, sb);
    assert.equal(r.body.permiso, "sede.clave");
    const g = await llamar((await rutaClave()).GET, "/api/sede-clave");
    assert.equal(g.body.puedeGestionar, false, `${sb} no ve la tarjeta`);
  }
  assert.equal(db.claves.size, 0, "nadie sin permiso la activó");

  await activarComoAdmin3();
  assert.equal(db.claves.get(CLI_3)?.version, 1);
  // Desactivar y volver a activar como el dueño (SUPER_ADMIN), desde la sede ya desbloqueada.
  como(SB_ADMIN3, CLI_3);
  const off = await llamar(POST, "/api/sede-clave", { accion: "desactivar", claveActual: CLAVE });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  como(SB_DUENO, CLI_3);
  const on = await llamar(POST, "/api/sede-clave", { accion: "activar", clave: CLAVE, confirmacion: CLAVE });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(db.claves.get(CLI_3)?.version, 3);
});

test("activar valida la clave nueva y no deja activar dos veces", async () => {
  como(SB_ADMIN3, CLI_3);
  const { POST } = await rutaClave();
  assert.equal((await llamar(POST, "/api/sede-clave", { accion: "activar", clave: "12345", confirmacion: "12345" })).status, 400);
  assert.equal((await llamar(POST, "/api/sede-clave", { accion: "activar", clave: CLAVE, confirmacion: CLAVE + "x" })).status, 400);
  await activarComoAdmin3();
  const otra = await llamar(POST, "/api/sede-clave", { accion: "activar", clave: CLAVE_NUEVA, confirmacion: CLAVE_NUEVA });
  assert.equal(otra.status, 409);
  assert.equal(otra.body.code, "ya_activa");
});

// ══════════════════ 4 · el gate del servidor ══════════════════

test("sin desbloqueo: switch-clinic 423 sin cambiar de sede; getAuthContext null; una API 401; páginas y actions a la pantalla", async () => {
  await activarComoAdmin3();

  // El dueño, en SU navegador, está en la principal y pide cambiar a la sede 3.
  como(SB_DUENO, CLI_1);
  activasEscritas = [];
  const sw = await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 });
  assert.equal(sw.status, 423);
  assert.equal(sw.body.code, "sede_con_clave");
  assert.deepEqual(activasEscritas, [], "la sede activa no cambió");

  // Y si la cookie de sede activa ya apunta a la 3 (por ejemplo, tras el login):
  como(SB_DUENO, CLI_3);
  ruta = "/api/patients";
  assert.equal(await getAuthContext(), null);
  const api = await llamar((await rutaClave()).GET, "/api/sede-clave");
  assert.equal(api.status, 401, "una API cualquiera con esa sede activa");
  await assert.rejects(() => getCurrentUser(), redirigeA("/dashboard/sede-con-clave"));
  ruta = "/dashboard/patients";
  await assert.rejects(() => getAuthContext(), redirigeA("/dashboard/sede-con-clave"), "una página → a la pantalla, no al login");
  accion = "action-id";
  await assert.rejects(() => getAuthContext(), redirigeA("/dashboard/sede-con-clave"), "server action → a la pantalla");

  // La principal sigue funcionando igual.
  accion = null;
  como(SB_DUENO, CLI_1);
  assert.equal((await getAuthContext())?.clinicId, CLI_1);
});

test("con la clave correcta: desbloquea, cambia de sede y pasa; otro navegador la vuelve a pedir", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  activasEscritas = [];
  const r = await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.destino, "/dashboard");
  assert.deepEqual(activasEscritas, [CLI_3], "además cambia la sede activa");

  como(SB_DUENO, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3);
  assert.equal((await getCurrentUser()).clinicId, CLI_3);
  como(SB_DUENO, CLI_1);
  assert.equal((await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 })).status, 200);

  // El mismo dueño en otro navegador (tarro vacío): se le pide otra vez.
  navegadores.set(SB_DUENO, new Map());
  como(SB_DUENO, CLI_3);
  assert.equal(await getAuthContext(), null);
});

test("a las 72 h + 1 min el desbloqueo ya no vale", async () => {
  await activarComoAdmin3();
  const { empacarDesbloqueo, nombreCookieDesbloqueo, VIGENCIA_DESBLOQUEO_MS } = await import("../core");
  como(SB_DUENO, CLI_3);
  const nombre = nombreCookieDesbloqueo(SB_DUENO, CLI_3);
  const version = db.claves.get(CLI_3)!.version;
  tarro().set(nombre, empacarDesbloqueo({ supabaseId: SB_DUENO, clinicId: CLI_3, version, emitidoMs: Date.now() - VIGENCIA_DESBLOQUEO_MS + 60_000 }));
  assert.equal((await getAuthContext())?.clinicId, CLI_3, "a las 71 h 59 min pasa");
  tarro().set(nombre, empacarDesbloqueo({ supabaseId: SB_DUENO, clinicId: CLI_3, version, emitidoMs: Date.now() - VIGENCIA_DESBLOQUEO_MS - 60_000 }));
  assert.equal(await getAuthContext(), null, "a las 72 h + 1 min no");
});

test("cambiar, desactivar+reactivar y restablecer desde /admin invalidan los desbloqueos anteriores", async () => {
  await activarComoAdmin3();
  const desbloquearDueno = async (clave: string) => {
    como(SB_DUENO, CLI_1);
    const r = await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    como(SB_DUENO, CLI_3);
    assert.equal((await getAuthContext())?.clinicId, CLI_3);
  };
  const { POST } = await rutaClave();

  // 1) Cambiar.
  await desbloquearDueno(CLAVE);
  como(SB_ADMIN3, CLI_3);
  assert.equal((await llamar(POST, "/api/sede-clave", { accion: "cambiar", claveActual: CLAVE, clave: CLAVE_NUEVA, confirmacion: CLAVE_NUEVA })).status, 200);
  assert.equal((await getAuthContext())?.clinicId, CLI_3, "quien la cambió sigue dentro");
  como(SB_DUENO, CLI_3);
  assert.equal(await getAuthContext(), null, "el desbloqueo del dueño caducó al cambiarla");

  // 2) Desactivar y volver a activar.
  await desbloquearDueno(CLAVE_NUEVA);
  como(SB_ADMIN3, CLI_3);
  assert.equal((await llamar(POST, "/api/sede-clave", { accion: "desactivar", claveActual: CLAVE_NUEVA })).status, 200);
  como(SB_DUENO, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3, "sin clave entra cualquiera con ficha");
  await activarComoAdmin3(CLAVE_NUEVA);
  como(SB_DUENO, CLI_3);
  assert.equal(await getAuthContext(), null, "la cookie vieja era de otra versión");

  // 3) Restablecer desde /admin y volver a activar.
  await desbloquearDueno(CLAVE_NUEVA);
  adminSesion = { user: { id: "adm-1", email: "soporte@dalecontrol.example" } };
  const adm = await rutaAdmin();
  const r = await llamar(adm.POST, `/api/admin/clinics/x/sede-clave`, { motivo: "La administradora la olvidó" }, { params: Promise.resolve({ id: CLI_3 }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await activarComoAdmin3(CLAVE);
  como(SB_DUENO, CLI_3);
  assert.equal(await getAuthContext(), null, "tras restablecer, los desbloqueos anteriores no valen");
});

test("cambiar y desactivar piden la clave actual", async () => {
  await activarComoAdmin3();
  como(SB_ADMIN3, CLI_3);
  const { POST } = await rutaClave();
  const mal = await llamar(POST, "/api/sede-clave", { accion: "desactivar", claveActual: "no-es" });
  assert.equal(mal.status, 403);
  assert.equal(mal.body.code, "clave_incorrecta");
  const sin = await llamar(POST, "/api/sede-clave", { accion: "cambiar", clave: CLAVE_NUEVA, confirmacion: CLAVE_NUEVA });
  assert.equal(sin.status, 403);
  assert.ok(db.claves.get(CLI_3)?.claveHash, "sigue activa");
  assert.equal(db.claves.get(CLI_3)?.version, 1, "y en la misma versión");
});

// ══════════════════ 5 · intentos ══════════════════

test("5 claves mal → 15 min de bloqueo (ni la buena entra) y todo queda en la bitácora, sin la clave", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  bitacora = [];
  const POST = await rutaDesbloquear();
  for (let i = 1; i <= 4; i++) {
    const r = await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: `mala-${i}` });
    assert.equal(r.status, 403);
    assert.equal(r.body.restantes, 5 - i);
  }
  const quinto = await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: "mala-5" });
  assert.equal(quinto.status, 429);
  assert.equal(quinto.body.code, "bloqueo");
  assert.equal(quinto.body.minutos, 15);
  const buena = await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE });
  assert.equal(buena.status, 429, "bloqueada, ni con la buena");
  assert.equal(db.intentos.length, 5, "durante el bloqueo no se compara ni se registra");

  const eventos = bitacora.map((b) => b.after.evento);
  assert.deepEqual(eventos, ["intento_fallido", "intento_fallido", "intento_fallido", "intento_fallido", "intento_fallido", "bloqueo"]);
  assert.ok(bitacora.every((b) => b.clinicId === CLI_3 && b.userId === "u-dueno-3"), "en la bitácora de la sede 3, con la ficha de ahí");

  // Pasados los 15 min, la buena entra (y queda «desbloqueo»).
  for (const i of db.intentos) i.createdAt = new Date(i.createdAt.getTime() - 16 * 60_000);
  const luego = await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE });
  assert.equal(luego.status, 200, JSON.stringify(luego.body));
  assert.equal(bitacora.at(-1).after.evento, "desbloqueo");

  // El bloqueo es por persona: el admin de la sede no se vio afectado.
  como(SB_ADMIN3, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3);
});

// ══════════════════ 6 · la clave nunca sale ══════════════════

test("la clave (ni su hash) no sale en ninguna respuesta ni en la bitácora", async () => {
  await activarComoAdmin3();
  const { POST, GET } = await rutaClave();
  como(SB_ADMIN3, CLI_3);
  await llamar(GET, "/api/sede-clave");
  await llamar(POST, "/api/sede-clave", { accion: "cambiar", claveActual: "equivocada", clave: CLAVE_NUEVA, confirmacion: CLAVE_NUEVA });
  await llamar(POST, "/api/sede-clave", { accion: "cambiar", claveActual: CLAVE, clave: CLAVE_NUEVA, confirmacion: CLAVE_NUEVA });
  como(SB_DUENO, CLI_1);
  await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: "equivocada" });
  await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE_NUEVA });
  await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 });
  adminSesion = { user: { id: "adm-1", email: "soporte@dalecontrol.example" } };
  const adm = await rutaAdmin();
  await llamar(adm.GET, `/api/admin/clinics/x/sede-clave`, undefined, { params: Promise.resolve({ id: CLI_3 }) });

  const hash = db.claves.get(CLI_3)!.claveHash!;
  assert.match(hash, /^\$2[aby]\$/, "se guarda con bcrypt");
  const todo = JSON.stringify([respuestas, bitacora, bitacoraAdmin]);
  for (const prohibido of [CLAVE, CLAVE_NUEVA, "equivocada", hash, "$2a$", "$2b$", "claveHash"]) {
    assert.equal(todo.includes(prohibido), false, `se coló «${prohibido}»`);
  }
});

// ══════════════════ 7 · desde fuera de la sede ══════════════════

test("el dueño sin desbloqueo no puede cerrar la sede con clave ni ver sus cifras en el reporte", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  const ar = await llamar(await rutaArchivar(), "/api/clinics/archivar", { clinicId: CLI_3 });
  assert.equal(ar.status, 403);
  assert.equal(ar.body.code, "SEDE_CON_CLAVE");
  assert.deepEqual(archivadas, []);

  const { reporteConsolidadoDeSedes } = await import("@/lib/sedes/reporte-consolidado.server");
  const rango = { desdeISO: "2026-10-01", hastaISO: "2026-10-25", periodo: "este-mes" as const };
  const rep = await reporteConsolidadoDeSedes({ supabaseId: SB_DUENO, clinicIdActiva: CLI_1, rango });
  const s3 = rep.sedes.find((s) => s.clinicId === CLI_3)!;
  assert.equal(s3.conClave, true);
  assert.equal(s3.ingresos.neto, 0);
  assert.equal(consultadasReporte.includes(CLI_3), false, "de la sede con clave no se consulta nada");
  assert.equal(rep.totales.ingresosNeto, 987654, "los totales solo llevan la principal");
  const { csvDelReporte } = await import("@/lib/sedes/reporte-consolidado-core");
  assert.match(csvDelReporte(rep), /QA Sede 3 aislada,sede con clave,,/);

  // Con el desbloqueo vigente, la ve completa.
  await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE });
  consultadasReporte = [];
  const rep2 = await reporteConsolidadoDeSedes({ supabaseId: SB_DUENO, clinicIdActiva: CLI_1, rango });
  assert.equal(rep2.sedes.find((s) => s.clinicId === CLI_3)!.conClave, undefined);
  assert.ok(consultadasReporte.includes(CLI_3));
  assert.equal(rep2.totales.ingresosNeto, 987654 * 2);
});

test("otra clínica no puede tocar ni desbloquear la clave de esta (la sede sale de la sesión)", async () => {
  await activarComoAdmin3();
  como(SB_OTRO, CLI_OTRA);
  const { POST } = await rutaClave();
  const r = await llamar(POST, "/api/sede-clave", { accion: "desactivar", claveActual: CLAVE, clinicId: CLI_3 });
  assert.equal(r.status, 409, "actúa sobre SU sede (sin clave), nunca sobre la del body");
  assert.equal(r.body.code, "sin_clave");
  assert.ok(db.claves.get(CLI_3)?.claveHash, "la de la sede 3 sigue puesta");
  const d = await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE });
  assert.equal(d.status, 403, "sin ficha en esa sede no hay nada que desbloquear");
  const sw = await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 });
  assert.equal(sw.status, 403);
});

// ══════════════════ 8 · DaleControl ══════════════════

test("restablecer desde /admin: solo con sesión de plataforma, con motivo, y queda registrado", async () => {
  await activarComoAdmin3();
  const adm = await rutaAdmin();
  const params = { params: Promise.resolve({ id: CLI_3 }) };
  adminSesion = null;
  assert.equal((await llamar(adm.POST, `/api/admin/clinics/x/sede-clave`, { motivo: "lo pidió el dueño" }, params)).status, 401);
  // Una sesión de la CLÍNICA (el dueño) no es sesión de plataforma.
  como(SB_DUENO, CLI_3);
  assert.equal((await llamar(adm.POST, `/api/admin/clinics/x/sede-clave`, { motivo: "lo pidió el dueño" }, params)).status, 401);
  assert.ok(db.claves.get(CLI_3)?.claveHash);

  adminSesion = { user: { id: "adm-1", email: "soporte@dalecontrol.example" } };
  assert.equal((await llamar(adm.POST, `/api/admin/clinics/x/sede-clave`, { motivo: "" }, params)).status, 400, "sin motivo no");
  const r = await llamar(adm.POST, `/api/admin/clinics/x/sede-clave`, { motivo: "La administradora la olvidó" }, params);
  assert.equal(r.status, 200);
  assert.equal(db.claves.get(CLI_3)?.claveHash, null, "queda SIN clave");
  assert.equal(db.claves.get(CLI_3)?.actualizadaPor, "admin:adm-1");
  assert.equal(bitacoraAdmin.length, 1);
  assert.equal(bitacoraAdmin[0].after.evento, "restablecer");
  assert.equal(bitacoraAdmin[0].after.motivo, "La administradora la olvidó");
  assert.equal(bitacoraAdmin[0].admin.id, "adm-1");
  // Y la sede vuelve a ser de quien tenga ficha: el dueño entra, y puede poner una nueva.
  como(SB_DUENO, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3);
});

test("«Ver como clínica» de /admin entra sin la clave", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_3);
  assert.equal(await getAuthContext(), null);
  verComo = `${SB_DUENO}|${CLI_3}`;
  assert.equal((await getAuthContext())?.clinicId, CLI_3);
  assert.equal((await getCurrentUser()).clinicId, CLI_3);
  // Pero solo para la sede que se abrió desde /admin.
  verComo = `${SB_DUENO}|${CLI_1}`;
  assert.equal(await getAuthContext(), null);
});

// ══════════════════ 9 · falla cerrado ══════════════════

test("si las tablas existen pero la lista de claves no se puede leer, la sede se trata como cerrada", async () => {
  await activarComoAdmin3();
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  db.falloLista = true;
  como(SB_ADMIN3, CLI_3);
  assert.equal(await getAuthContext(), null);
});

// ══════════════════ 10 · quién usa las salidas sin el gate ══════════════════

const SRC = join(__dirname, "../../..");
function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "node_modules" || n === "__tests__" || n.startsWith(".")) continue;
    if (statSync(p).isDirectory()) archivos(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const TODOS = archivos(SRC).map((p) => ({ rel: relative(join(SRC, ".."), p).replace(/\\/g, "/"), src: sinComentarios(readFileSync(p, "utf8")) }));

test("las salidas sin el gate de la clave solo las usan la pantalla de la clave y sus rutas", () => {
  const usanCtx = TODOS.filter((f) => /getAuthContextParaClaveDeSede\s*\(/.test(f.src)).map((f) => f.rel).sort();
  assert.deepEqual(usanCtx, ["src/app/api/sede-clave/desbloquear/route.ts", "src/lib/auth-context.ts"]);
  const usanUser = TODOS.filter((f) => /getCurrentUserSinClaveDeSede\s*\(/.test(f.src)).map((f) => f.rel).sort();
  assert.deepEqual(usanUser, ["src/app/dashboard/sede-con-clave/page.tsx"]);
});

test("el gate de la clave está en los dos caminos de la sesión y en el layout", () => {
  for (const r of ["src/lib/auth-context.ts", "src/lib/auth.ts", "src/app/dashboard/layout.tsx", "src/app/api/switch-clinic/route.ts"]) {
    // Texto crudo: el quitacomentarios ingenuo se come código de auth.ts (un «/*» dentro de un «//»).
    const src = readFileSync(join(SRC, "..", r), "utf8");
    assert.match(src, /await sedeCerradaPara\(\{/, `${r} no pregunta por la clave de la sede`);
  }
});
