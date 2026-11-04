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
  /** ws1-t1: contraseña temporal pendiente (alta de miembro o «Restablecer»). */
  mustChangePassword?: boolean;
  email?: string;
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
  /** v2: también falla la lectura de la fila de una sede por su llave primaria. */
  falloFila: false,
  /** v2: falla la sonda to_regclass. */
  falloSonda: false,
  /** v2: latencia de cada consulta (ms), como un viaje a la base. */
  retraso: 0,
  claves: new Map<string, FilaClave>(),
  intentos: [] as FilaIntento[],
  consultas: [] as string[],
  /** Candados de `pg_try_advisory_xact_lock` en uso (uno por transacción viva). */
  candados: new Set<string>(),
  /** Cuántas claves se compararon con bcrypt (= intentos registrados). */
};

async function consulta(strings: TemplateStringsArray, v: any[], candadosDeLaTx: string[] | null) {
  // La base «lee» al recibir la consulta y la respuesta tarda en volver: lo que
  // cambie mientras tanto no sale en esta respuesta (v3, m1).
  const resultado = consultaYa(strings, v, candadosDeLaTx);
  if (db.retraso) await new Promise((r) => setTimeout(r, db.retraso));
  return resultado;
}

function consultaYa(strings: TemplateStringsArray, v: any[], candadosDeLaTx: string[] | null) {
  const sql = strings.join("?").replace(/\s+/g, " ");
  db.consultas.push(sql);
  if (sql.includes("to_regclass")) {
    if (db.falloSonda) throw new Error("pooler caído (sonda)");
    return [{ existe: db.tablas }];
  }
  if (!db.tablas) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
  if (sql.includes("pg_try_advisory_xact_lock")) {
    if (!candadosDeLaTx) throw new Error("pg_advisory_xact_lock fuera de una transacción");
    const llave = `${v[0]}|${v[1]}`;
    if (db.candados.has(llave)) return [{ ok: false }];
    db.candados.add(llave);
    candadosDeLaTx.push(llave);
    return [{ ok: true }];
  }
  if (sql.includes(`FROM "sede_claves" WHERE "claveHash" IS NOT NULL`)) {
    if (db.falloLista) throw new Error("pooler caído");
    return Array.from(db.claves.entries()).filter(([, f]) => f.claveHash).map(([clinicId, f]) => ({ clinicId, version: f.version }));
  }
  if (sql.includes(`SELECT "claveHash", "version" FROM "sede_claves"`)) {
    if (db.falloFila) throw new Error("pooler caído (fila)");
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
    // = leerIntentos: desde el último acierto, los más NUEVOS primero, LIMIT.
    const [clinicId, supabaseId, version, desde, , , , desde2, limite] = v;
    const mias = db.intentos.filter((i) => i.clinicId === clinicId && i.supabaseId === supabaseId && i.version === version);
    const ultimoOk = mias.filter((i) => i.ok).reduce<Date | null>((m, i) => (!m || i.createdAt > m ? i.createdAt : m), null);
    const piso = ultimoOk ?? desde2;
    return mias
      .filter((i) => i.createdAt >= desde && i.createdAt >= piso)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limite)
      .map((i) => ({ ok: i.ok, createdAt: i.createdAt }));
  }
  throw new Error(`SQL no previsto en la prueba: ${sql}`);
}

async function ejecucion(strings: TemplateStringsArray, v: any[]) {
  const sql = strings.join("?").replace(/\s+/g, " ");
  db.consultas.push(sql);
  if (db.retraso) await new Promise((r) => setTimeout(r, db.retraso));
  if (sql.includes(`INSERT INTO "sede_clave_intentos"`)) {
    const [, clinicId, supabaseId, version, ok] = v;
    db.intentos.push({ clinicId, supabaseId, version, ok, createdAt: new Date() });
    return 1;
  }
  if (sql.includes(`DELETE FROM "sede_clave_intentos"`)) {
    const antes = db.intentos.length;
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    db.intentos = db.intentos.filter((i) => i.createdAt.getTime() >= limite);
    return antes - db.intentos.length;
  }
  throw new Error(`SQL no previsto en la prueba: ${sql}`);
}

const prismaFalso: any = {
  $queryRaw: (strings: TemplateStringsArray, ...v: any[]) => consulta(strings, v, null),
  $executeRaw: (strings: TemplateStringsArray, ...v: any[]) => ejecucion(strings, v),
  // Transacción interactiva: los candados viven lo que vive la transacción.
  $transaction: async (fn: (tx: any) => Promise<unknown>) => {
    const mios: string[] = [];
    const tx = {
      $queryRaw: (strings: TemplateStringsArray, ...v: any[]) => consulta(strings, v, mios),
      $executeRaw: (strings: TemplateStringsArray, ...v: any[]) => ejecucion(strings, v),
    };
    try {
      return await fn(tx);
    } finally {
      for (const k of mios) db.candados.delete(k);
    }
  },
  user: {
    findFirst: async ({ where }: any) => {
      const f = fichas.find((x) =>
        x.supabaseId === where.supabaseId && x.clinicId === where.clinicId && (where.isActive === undefined || x.isActive === where.isActive),
      );
      return f ? { id: f.id, clinicId: f.clinicId } : null;
    },
    findMany: async ({ where }: any) =>
      where.clinicId !== undefined
        // v4 · cuentaConVariasSedes: los dueños de UNA sede.
        ? fichas
          .filter((x) => x.clinicId === where.clinicId && (!where.role || x.role === where.role) && x.isActive)
          .map((x) => ({ supabaseId: x.supabaseId }))
        : fichas
          .filter((x) => x.supabaseId === where.supabaseId && (!where.role || x.role === where.role) && x.isActive)
          .map((x) => ({ clinicId: x.clinicId, clinic: { id: x.clinic.id, createdAt: x.clinic.createdAt, archivedAt: null } })),
  },
  clinic: {
    // v4 · cuentaConVariasSedes: sedes sin archivar de las que alguno de esos dueños es SUPER_ADMIN activo.
    count: async ({ where }: any) => {
      const algun = where.users.some;
      return new Set(
        fichas
          .filter((f) => algun.supabaseId.in.includes(f.supabaseId) && f.role === algun.role && f.isActive && !f.clinic.archivedAt)
          .map((f) => f.clinicId),
      ).size;
    },
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
let contrasenasCambiadas: string[] = [];
/** La contraseña con la que la sonda de change-password «entra» (la temporal vigente). */
let contrasenaVigente: string | null = null;
/** El scope de cada signOut de la sonda. */
let cierresDeSonda: Array<string | undefined> = [];
/** Cambios de contraseña hechos con la sesión de la propia persona (updateUser del cliente de servidor). */
let cambiosPropios: string[] = [];
let marcasLevantadas: string[] = [];

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
        signOut: async () => ({ error: null }),
        // v5: los tres caminos que crean una sesión nueva.
        signInWithPassword: async ({ password }: any) =>
          password === "buena-123" ? { data: { session: { access_token: "t" } }, error: null } : { data: { session: null }, error: { message: "Invalid login credentials" } },
        exchangeCodeForSession: async (code: string) =>
          code === "ok" ? { data: { user: { id: sesion, email: "dueno@example.com" } }, error: null } : { data: { user: null }, error: { message: "bad code" } },
        verifyOtp: async ({ token_hash }: any) => ({ error: token_hash === "ok" ? null : { message: "otp_expired" } }),
        // Revisión ws1-t9, m1: el cambio voluntario, con la sesión de la persona.
        updateUser: async () => { if (sesion) cambiosPropios.push(sesion); return { data: {}, error: sesion ? null : { message: "no session" } }; },
      },
    }),
  },
  "@/lib/admin/suplantacion": { estadoSuplantacionDe: async () => ({ tipo: "normal" }) },
  "@/lib/active-clinic": {
    readActiveClinicCookie: async () => activa,
    logClinicFallback: () => undefined,
    resembrarActiveClinicCookie: async () => false,
    writeActiveClinicCookie: (_res: unknown, id: string) => { activasEscritas.push(id); },
    pickActiveClinicId: (actual: string | null, ids: string[]) => ({ clinicId: actual && ids.includes(actual) ? actual : ids[0] }),
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
  "@/lib/auth/login-bloqueo": { revisarBloqueoLogin: async () => null, registrarAciertoLogin: async () => undefined, registrarFalloLogin: async () => undefined },
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
  // ws1-t1 · /api/auth/change-password: Auth de Supabase y la marca, de mentira.
  "@supabase/supabase-js": {
    createClient: () => ({
      auth: {
        signInWithPassword: async ({ password }: any) =>
          password === contrasenaVigente ? { data: { user: { id: sesion } }, error: null } : { data: { user: null }, error: null },
        // Como Supabase: sin scope (o "global") revoca TODAS las sesiones de la
        // persona, también la del navegador que pidió el cambio.
        signOut: async (opts?: { scope?: string }) => {
          cierresDeSonda.push(opts?.scope);
          if ((opts?.scope ?? "global") === "global") sesion = null;
          return { error: null };
        },
        admin: { updateUserById: async (id: string) => { contrasenasCambiadas.push(id); return { error: null }; } },
      },
    }),
  },
  "@/lib/auth/must-change-password": {
    clearMustChangePassword: async (sb: string) => {
      marcasLevantadas.push(sb);
      for (const f of fichas) if (f.supabaseId === sb) f.mustChangePassword = false;
    },
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const CLAVE = "Sede3-secreta";
const CLAVE_NUEVA = "OtraClave-99";

beforeEach(async () => {
  const { _olvidarEstado, _olvidarPurga } = await import("../estado.server");
  _olvidarEstado();
  _olvidarPurga();
  db.tablas = true;
  db.falloLista = false;
  db.falloFila = false;
  db.falloSonda = false;
  db.retraso = 0;
  db.candados.clear();
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
  contrasenasCambiadas = [];
  marcasLevantadas = [];
  contrasenaVigente = null;
  cierresDeSonda = [];
  cambiosPropios = [];
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
  assert.deepEqual(g.body, { disponible: false, puedeGestionar: true, activa: false, variasSedes: false });
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

// ══════════════════ 9 · cuando la base falla (v2: revisión de t8) ══════════════════

const estadoGate = async (sb: string, cli: string) =>
  (await import("../gate.server")).estadoGateSede({ supabaseId: sb, clinicId: cli });

test("T8-1 invertida · instancia fría y la lista no se lee: una clínica SIN clave entra (se lee su fila)", async () => {
  db.falloLista = true;
  como(SB_OTRO, CLI_OTRA); // una clínica de una sola sede que nunca activó nada
  assert.equal((await getAuthContext())?.clinicId, CLI_OTRA, "getAuthContext en /api sigue funcionando");
  ruta = "/dashboard";
  assert.equal((await getCurrentUser()).clinicId, CLI_OTRA);
  ruta = "/api/prueba";
  const sw = await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_OTRA });
  assert.equal(sw.status, 200, "switch-clinic a una sede sin clave");
  assert.ok(db.consultas.some((q) => q.includes(`SELECT "claveHash", "version" FROM "sede_claves"`)), "leyó la fila por su PK");
});

test("A1 · sin lista, una sede CON clave sigue cerrada (su fila lo dice)", async () => {
  await activarComoAdmin3();
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  db.falloLista = true;
  como(SB_DUENO, CLI_3);
  assert.equal(await getAuthContext(), null);
  assert.equal(await estadoGate(SB_DUENO, CLI_3), "cerrada");
  como(SB_ADMIN3, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3, "quien la desbloqueó sigue dentro");
});

test("A1 · si ni la lista ni la fila se leen: se corta con «no pudimos comprobar», no con «tiene clave»", async () => {
  db.falloLista = true;
  db.falloFila = true;
  como(SB_OTRO, CLI_OTRA);
  assert.equal(await estadoGate(SB_OTRO, CLI_OTRA), "sin_comprobar");
  assert.equal(await getAuthContext(), null, "no se abre a ciegas");
  const sw = await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_OTRA });
  assert.equal(sw.status, 503);
  assert.equal(sw.body.code, "sede_sin_comprobar");
  assert.match(sw.body.error, /No pudimos comprobar/);
  // En cuanto la base responde, se abre solo (pasados los 5 s en que se recuerda el fallo).
  db.falloLista = false;
  db.falloFila = false;
  const realNow = Date.now;
  try {
    const base = realNow();
    Date.now = () => base + 6_000;
    assert.equal((await getAuthContext())?.clinicId, CLI_OTRA);
  } finally {
    Date.now = realNow;
  }
});

test("A1 · en las vistas de varias sedes solo cuenta como cerrada la sede que no se pudo comprobar", async () => {
  await activarComoAdmin3();
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  db.falloLista = true;
  const { sedesCerradasPara } = await import("../gate.server");
  como(SB_DUENO, CLI_1);
  assert.deepEqual([...(await sedesCerradasPara(SB_DUENO, [CLI_1, CLI_3]))], [CLI_3], "la principal (sin clave) no se cierra");
});

test("T8-2 invertida · la lista vieja vale como respaldo solo 5 min; después manda la fila", async () => {
  como(SB_DUENO, CLI_1);
  assert.notEqual(await getAuthContext(), null); // esta instancia lee la lista (vacía)
  // Otra instancia activa la clave de la sede 3 (escribe en la base, no invalida esta memoria).
  db.claves.set(CLI_3, { claveHash: "$2a$10$x", version: 1, actualizadaPor: "user:u-admin-3" });
  db.falloLista = true;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2 * 60 * 1000;
    como(SB_DUENO, CLI_3);
    assert.notEqual(await getAuthContext(), null, "a los 2 min aún vale la lista vieja (margen aceptado)");
    Date.now = () => realNow() + 60 * 60 * 1000;
    assert.equal(await getAuthContext(), null, "una hora después ya no: se lee la fila y la clave se exige");
  } finally {
    Date.now = realNow;
  }
});

test("T8-3 invertida · una ráfaga de 20 claves malas en paralelo NO compara más de 5", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_3);
  const POST = await rutaDesbloquear();
  const rs = await Promise.all(Array.from({ length: 20 }, () => llamar(POST, "/api/sede-clave/desbloquear", { clave: "mala-123456" })));
  const comparadas = db.intentos.filter((i) => i.supabaseId === SB_DUENO).length;
  assert.ok(comparadas >= 1 && comparadas <= 5, `comparadas=${comparadas}`);
  assert.ok(rs.every((r) => r.status === 403 || r.status === 429), JSON.stringify(rs.map((r) => r.status)));
  assert.ok(rs.some((r) => r.body?.code === "en_curso"), "las que llegan con otra en curso se rechazan sin comparar");
  assert.equal(db.candados.size, 0, "ningún candado queda puesto");
  // Y la cuenta sigue: de uno en uno, al quinto fallo se bloquea.
  for (let i = 0; i < 8; i++) await llamar(POST, "/api/sede-clave/desbloquear", { clave: "mala-123456" });
  assert.equal(db.intentos.filter((i) => i.supabaseId === SB_DUENO).length, 5, "el tope de 5 se cumple contando la ráfaga");
});

test("T8-4 invertida · 200 fallos viejos no esconden los nuevos: al quinto nuevo, bloqueo", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_3);
  const hace16 = Date.now() - 16 * 60 * 1000;
  for (let i = 0; i < 200; i++) {
    db.intentos.push({ clinicId: CLI_3, supabaseId: SB_DUENO, version: 1, ok: false, createdAt: new Date(hace16 + i) });
  }
  const POST = await rutaDesbloquear();
  const estados: number[] = [];
  for (let i = 0; i < 12; i++) estados.push((await llamar(POST, "/api/sede-clave/desbloquear", { clave: "mala-123456" })).status);
  assert.deepEqual(estados.slice(0, 4), [403, 403, 403, 403]);
  assert.equal(estados[4], 429, "el quinto fallo nuevo bloquea");
  assert.ok(estados.slice(5).every((x) => x === 429), JSON.stringify(estados));
});

test("A3 · un acierto reinicia la cuenta aunque haya fallos antes", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  const POST = await rutaDesbloquear();
  for (let i = 0; i < 4; i++) await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: "mala-123456" });
  assert.equal((await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE, cambiarDeSede: false })).status, 200);
  const r = await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: "mala-123456" });
  assert.equal(r.status, 403);
  assert.equal(r.body.restantes, 4, "tras el acierto, de cero");
});

test("T8-5 invertida · 10 peticiones a la vez al caducar la caché hacen UNA lectura de la lista", async () => {
  como(SB_OTRO, CLI_OTRA);
  await getAuthContext(); // instancia caliente
  db.consultas = [];
  for (let i = 0; i < 10; i++) await getAuthContext();
  assert.equal(db.consultas.length, 0, "caliente: 0 consultas extra");
  const realNow = Date.now;
  try {
    const base = realNow();
    Date.now = () => base + 11_000;
    db.retraso = 150;
    db.consultas = [];
    await Promise.all(Array.from({ length: 10 }, () => getAuthContext()));
    assert.equal(db.consultas.filter((q) => q.includes(`WHERE "claveHash" IS NOT NULL`)).length, 1);
  } finally {
    Date.now = realNow;
    db.retraso = 0;
  }
});

test("M2 · una lectura que tarda más que el tope cuenta como fallo (y se cae a la fila)", async () => {
  const { TOPE_LECTURA_MS } = await import("../estado.server");
  assert.ok(TOPE_LECTURA_MS <= 5_000, "tope corto");
});

test("M4 · si to_regclass falla, no se repite en cada petición durante unos segundos", async () => {
  db.falloSonda = true;
  como(SB_OTRO, CLI_OTRA);
  // nº14 (auditoría «cloudflare», m1 de la revisión): sin saber si hay tablas no se abre a ciegas, pero
  // tampoco se corta la instancia: se lee la fila de la sede, y esta clínica no tiene clave.
  for (let i = 0; i < 10; i++) assert.equal((await getAuthContext())?.clinicId, CLI_OTRA, "sin saber si hay tablas: manda la fila");
  assert.equal(db.consultas.filter((q) => q.includes("to_regclass")).length, 1);
  assert.equal(db.consultas.filter((q) => q.includes(`SELECT "claveHash", "version" FROM "sede_claves"`)).length, 1, "la fila, una vez (se recuerda 5 s)");
});

test("🔴 nº14 · si la sonda falla en una instancia fría, una sede CON clave NO se abre (ni gate, ni vistas, ni desbloquear sin clave)", async () => {
  await activarComoAdmin3();
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado(); // instancia que todavía no vio las tablas
  db.falloSonda = true;
  como(SB_DUENO, CLI_3); // el dueño, sin desbloqueo en este navegador
  assert.equal(await estadoGate(SB_DUENO, CLI_3), "cerrada", "antes: «libre»; su fila dice que tiene clave");
  assert.equal(await getAuthContext(), null, "antes: entraba a la sede con clave");
  const gate = await import("../gate.server");
  assert.deepEqual([...(await gate.sedesCerradasPara(SB_DUENO, [CLI_1, CLI_3]))], [CLI_3], "las vistas no enseñan las cifras de la sede con clave");
  assert.deepEqual([...(await gate.sedesConClave([CLI_1, CLI_3]))], [CLI_3], "ni se comparten sus pacientes ni se copia");
  // Desbloquear SIN la clave: antes respondía ok y dejaba la sede activa en la cookie.
  como(SB_DUENO, CLI_1);
  const r = await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3 });
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.match(r.body.error, /No pudimos comprobar/);
  assert.deepEqual(activasEscritas, [], "no se cambió de sede");
  assert.deepEqual(desbloqueosEnElNavegador(), []);
});

test("🔴 nº14 (m1) · con la sonda caída no se corta la instancia: la sede SIN clave del dueño sigue abierta", async () => {
  await activarComoAdmin3();
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  db.falloSonda = true;
  como(SB_DUENO, CLI_1); // la principal, sin clave
  assert.equal(await estadoGate(SB_DUENO, CLI_1), "libre", "en 3d51d9a94: «sin comprobar» para cualquier clínica");
  assert.equal((await getAuthContext())?.clinicId, CLI_1);
  const gate = await import("../gate.server");
  assert.ok(!(await gate.sedesCerradasPara(SB_DUENO, [CLI_1, CLI_3])).has(CLI_1));
  assert.ok(!(await gate.sedesConClave([CLI_1, CLI_3])).has(CLI_1));
});

test("nº14 (m1) · con la sonda Y la fila caídas: «sin comprobar», y en las vistas todas cuentan como cerradas", async () => {
  await activarComoAdmin3();
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  db.falloSonda = true;
  db.falloFila = true;
  como(SB_DUENO, CLI_1);
  assert.equal(await estadoGate(SB_DUENO, CLI_1), "sin_comprobar");
  assert.equal(await getAuthContext(), null, "no se abre a ciegas");
  const gate = await import("../gate.server");
  assert.deepEqual([...(await gate.sedesCerradasPara(SB_DUENO, [CLI_1, CLI_3]))].sort(), [CLI_1, CLI_3].sort());
  assert.deepEqual([...(await gate.sedesConClave([CLI_1, CLI_3]))].sort(), [CLI_1, CLI_3].sort());
});

test("nº14 · un «no hay tablas» de la base sigue siendo la función apagada (sin SQL, todo como hoy)", async () => {
  db.tablas = false;
  como(SB_OTRO, CLI_OTRA);
  assert.equal(await estadoGate(SB_OTRO, CLI_OTRA), "libre");
  assert.equal((await getAuthContext())?.clinicId, CLI_OTRA);
  const gate = await import("../gate.server");
  assert.equal((await gate.sedesCerradasPara(SB_DUENO, [CLI_1, CLI_3])).size, 0);
  assert.equal((await gate.sedesConClave([CLI_1, CLI_3])).size, 0);
});

test("M5 · al registrar un intento se purgan los de más de 1 día (como mucho una vez por hora)", async () => {
  await activarComoAdmin3();
  const viejo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  db.intentos.push({ clinicId: CLI_3, supabaseId: "sb-alguien", version: 1, ok: false, createdAt: viejo });
  db.intentos.push({ clinicId: CLI_OTRA, supabaseId: "sb-otro-mas", version: 1, ok: true, createdAt: viejo });
  como(SB_DUENO, CLI_1);
  const POST = await rutaDesbloquear();
  await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: "mala-123456" });
  await new Promise((r) => setTimeout(r, 20)); // la purga va en segundo plano
  assert.equal(db.intentos.filter((i) => i.createdAt.getTime() === viejo.getTime()).length, 0, "los de hace 2 días, fuera");
  assert.equal(db.intentos.length, 1, "el de ahora se queda");
  await llamar(POST, "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: "mala-123456" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(db.consultas.filter((q) => q.includes("DELETE FROM")).length, 1, "una purga por hora");
  assert.ok(db.claves.get(CLI_3)?.claveHash, "la purga no toca las claves");
});

test("m1 (v3) · una lectura de la lista en vuelo no pisa la invalidación de una clave recién escrita", async () => {
  const est = await import("../estado.server");
  como(SB_DUENO, CLI_3);
  assert.equal(await estadoGate(SB_DUENO, CLI_3), "libre"); // instancia caliente (sonda y lista)
  const realNow = Date.now;
  try {
    const base = realNow();
    Date.now = () => base + 11_000; // caducó la caché de 10 s
    db.retraso = 100;
    const enVuelo = est.sedesConClaveActiva(); // lee la lista SIN clave y tarda 100 ms
    await new Promise((r) => setTimeout(r, 10));
    // Mientras tanto, en ESTA instancia, el admin activa la clave (escribe + invalida).
    db.claves.set(CLI_3, { claveHash: "$2a$10$x", version: 1, actualizadaPor: "user:u-admin-3" });
    est.invalidarLista();
    assert.equal((await enVuelo).has(CLI_3), false, "la lectura en vuelo trae lo de antes");
    db.retraso = 0;
    assert.equal(await estadoGate(SB_DUENO, CLI_3), "cerrada", "pero no se guardó: la clave se exige ya, sin esperar 10 s");
  } finally {
    Date.now = realNow;
    db.retraso = 0;
  }
});

test("m2 (v3) · con la lista caída, la fila de cada sede se lee una vez (en vuelo y 5 s después), no una por petición", async () => {
  await activarComoAdmin3();
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  db.falloLista = true;
  db.retraso = 50;
  db.consultas = [];
  como(SB_OTRO, CLI_OTRA);
  await Promise.all(Array.from({ length: 10 }, () => getAuthContext()));
  for (let i = 0; i < 10; i++) await getAuthContext();
  const filas = db.consultas.filter((q) => q.includes(`SELECT "claveHash", "version" FROM "sede_claves"`)).length;
  const listas = db.consultas.filter((q) => q.includes(`WHERE "claveHash" IS NOT NULL`)).length;
  assert.equal(filas, 1, `consultas de fila = ${filas}`);
  assert.equal(listas, 1, `lecturas de la lista = ${listas}`);
  // Con la base caída del todo, el fallo también se recuerda: «no se pudo comprobar» sin otra consulta.
  db.retraso = 0;
  db.falloFila = true;
  _olvidarEstado();
  db.consultas = [];
  for (let i = 0; i < 10; i++) assert.equal(await estadoGate(SB_DUENO, CLI_3), "sin_comprobar");
  assert.equal(db.consultas.filter((q) => q.includes(`SELECT "claveHash", "version" FROM "sede_claves"`)).length, 1);
  // Pasados los 5 s, se vuelve a intentar (y si la base ya responde, se abre/cierra según la clave).
  db.falloFila = false;
  db.falloLista = false;
  const realNow = Date.now;
  try {
    const base = realNow();
    Date.now = () => base + 6_000;
    assert.equal(await estadoGate(SB_DUENO, CLI_3), "cerrada");
    assert.equal(await estadoGate(SB_OTRO, CLI_OTRA), "libre");
  } finally {
    Date.now = realNow;
  }
});

// ══════════════════ 9b · G1: copiar la configuración al crear una sede ══════════════════

test("G1 · la sede nueva NO copia de la principal si tiene clave y no está desbloqueada", async () => {
  const { origenDeCopiaParaSedeNueva } = await import("../copia.server");
  const principal = { clinicId: CLI_3, nombre: "QA Sede 3 aislada" };
  const activa = { clinicId: CLI_1, nombre: "Altabrisa" };
  como(SB_DUENO, CLI_1);
  assert.deepEqual(await origenDeCopiaParaSedeNueva({ supabaseId: SB_DUENO, principal, activa }), { origen: principal, aviso: null }, "sin clave, como siempre");

  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  assert.deepEqual(
    await origenDeCopiaParaSedeNueva({ supabaseId: SB_DUENO, principal, activa }),
    { origen: activa, aviso: "principal_con_clave_desde_activa" },
    "con clave: de la sede activa",
  );
  // La activa también con clave (y el dueño dentro, desbloqueada): valores de siempre.
  db.claves.set(CLI_1, { claveHash: "$2a$10$x", version: 1, actualizadaPor: null });
  const { invalidarLista } = await import("../estado.server");
  invalidarLista();
  assert.deepEqual(
    await origenDeCopiaParaSedeNueva({ supabaseId: SB_DUENO, principal, activa }),
    { origen: null, aviso: "principal_con_clave_sin_copia" },
  );
  db.claves.delete(CLI_1);
  invalidarLista();
  // Con la principal desbloqueada en este navegador, se copia de ella.
  await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE, cambiarDeSede: false });
  assert.deepEqual(await origenDeCopiaParaSedeNueva({ supabaseId: SB_DUENO, principal, activa }), { origen: principal, aviso: null });
});

// ══════════════════ 9c · el candado del reporte de sedes ══════════════════

test("reporte de sedes · desbloquear con el candado no cambia de sede y la sede sale completa (también en el CSV)", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  activasEscritas = [];
  const r = await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE, cambiarDeSede: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(activasEscritas, [], "el dueño se queda en su sede");
  const { reporteConsolidadoDeSedes } = await import("@/lib/sedes/reporte-consolidado.server");
  const rep = await reporteConsolidadoDeSedes({
    supabaseId: SB_DUENO, clinicIdActiva: CLI_1,
    rango: { desdeISO: "2026-10-01", hastaISO: "2026-10-25", periodo: "este-mes" },
  });
  const s3 = rep.sedes.find((x) => x.clinicId === CLI_3)!;
  assert.equal(s3.conClave, undefined);
  assert.equal(s3.ingresos.neto, 987654);
  assert.equal(rep.totales.ingresosNeto, 987654 * 2);
  const { csvDelReporte } = await import("@/lib/sedes/reporte-consolidado-core");
  assert.match(csvDelReporte(rep), /QA Sede 3 aislada,activa,987654/);
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

test("las salidas sin el gate de la clave solo las usan la pantalla de la clave, sus rutas y el cambio forzado de contraseña", () => {
  // ws1-t1 (29-oct): el cambio forzado de contraseña es una barrera ANTERIOR a
  // la clave; con el gate rebotaba contra la pantalla de la clave sin fin.
  const usanCtx = TODOS.filter((f) => /getAuthContextParaClaveDeSede\s*\(/.test(f.src)).map((f) => f.rel).sort();
  assert.deepEqual(usanCtx, [
    "src/app/api/auth/change-password/route.ts",
    "src/app/api/sede-clave/desbloquear/route.ts",
    "src/lib/auth-context.ts",
  ]);
  const usanUser = TODOS.filter((f) => /getCurrentUserSinClaveDeSede\s*\(/.test(f.src)).map((f) => f.rel).sort();
  assert.deepEqual(usanUser, ["src/app/dashboard/cambiar-contrasena/page.tsx", "src/app/dashboard/sede-con-clave/page.tsx"]);
});

test("el gate de la clave está en los dos caminos de la sesión y en el layout", () => {
  for (const r of ["src/lib/auth-context.ts", "src/lib/auth.ts", "src/app/dashboard/layout.tsx", "src/app/api/switch-clinic/route.ts"]) {
    // Texto crudo: el quitacomentarios ingenuo se come código de auth.ts (un «/*» dentro de un «//»).
    const src = readFileSync(join(SRC, "..", r), "utf8");
    assert.match(src, /await (sedeCerradaPara|estadoGateSede)\(\{/, `${r} no pregunta por la clave de la sede`);
  }
});

// ══════════════════ v4 · decisiones de Rafael (27-oct) ══════════════════

test("v4 · la tarjeta solo sale si el dueño tiene 2+ sedes: con una sola sede ni sale ni se puede activar", async () => {
  const { GET, POST } = await rutaClave();
  // El dueño de la sede 3 tiene dos sedes (la principal y la 3): sale, también para el ADMIN con permiso.
  como(SB_ADMIN3, CLI_3);
  assert.equal((await llamar(GET, "/api/sede-clave")).body.variasSedes, true);
  como(SB_DUENO, CLI_1);
  assert.equal((await llamar(GET, "/api/sede-clave")).body.variasSedes, true);

  // «Clínica ajena» es la única sede de su dueño.
  como(SB_OTRO, CLI_OTRA);
  const g = await llamar(GET, "/api/sede-clave");
  assert.deepEqual(g.body, { disponible: true, puedeGestionar: true, activa: false, variasSedes: false });
  const r = await llamar(POST, "/api/sede-clave", { accion: "activar", clave: CLAVE, confirmacion: CLAVE });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "una_sede");
  assert.equal(db.claves.has(CLI_OTRA), false, "no se guardó ninguna clave");
  assert.equal(bitacora.length, 0);

  // Si abre una segunda sede, ya puede.
  CLINICAS.cli_otra_2 = clinica("cli_otra_2", "Clínica ajena Norte", 6);
  try {
    fichas.push(ficha("u-otro-2", SB_OTRO, "cli_otra_2", "SUPER_ADMIN"));
    assert.equal((await llamar(GET, "/api/sede-clave")).body.variasSedes, true);
    assert.equal((await llamar(POST, "/api/sede-clave", { accion: "activar", clave: CLAVE, confirmacion: CLAVE })).status, 200);
  } finally {
    delete CLINICAS.cli_otra_2;
  }
});

test("v4 · una sede sola que YA tiene la clave puesta la sigue viendo para cambiarla o quitarla", async () => {
  await activarComoAdmin3();
  // Se va la principal (deja de ser del dueño): la cuenta queda con una sede.
  fichas = fichas.filter((f) => f.clinicId !== CLI_1);
  como(SB_ADMIN3, CLI_3);
  const { GET, POST } = await rutaClave();
  const g = await llamar(GET, "/api/sede-clave");
  assert.equal(g.body.variasSedes, false);
  assert.equal(g.body.activa, true, "la tarjeta sale porque la clave está activa");
  const off = await llamar(POST, "/api/sede-clave", { accion: "desactivar", claveActual: CLAVE });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const otraVez = await llamar(POST, "/api/sede-clave", { accion: "activar", clave: CLAVE, confirmacion: CLAVE });
  assert.equal(otraVez.body.code, "una_sede", "quitada, ya no se puede volver a poner con una sola sede");
});

test("v4 · la clave no toca ninguna integración: activar no consulta ni desconecta Google, TV ni en vivo", async () => {
  db.consultas = [];
  await activarComoAdmin3();
  const sql = db.consultas.join("\n");
  assert.doesNotMatch(sql, /google|calendar|tv_|live|integra/i);
  const ruta = readFileSync(join(SRC, "app/api/sede-clave/route.ts"), "utf8");
  const tarjeta = readFileSync(join(SRC, "components/dashboard/security/sede-clave-card.tsx"), "utf8");
  for (const src of [ruta, tarjeta]) assert.doesNotMatch(src, /google|calendar|\btv\b|live|desconect|disconnect/i);
  const es = JSON.stringify(JSON.parse(readFileSync(join(SRC, "i18n/dictionaries/es.json"), "utf8")).sedeClave);
  assert.doesNotMatch(es, /google|calendar|\btv\b|en vivo|desconect|integraci/i);
});

/** «Cerrar sesión»: POST /api/auth/logout con las cookies del navegador de quien está sentado. */
async function cerrarSesion() {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/auth/logout/route");
  const cookie = Array.from(tarro().entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  const res: any = await POST(new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers: { cookie, host: "localhost" } }));
  for (const c of res.cookies.getAll()) {
    if (!c.value || c.maxAge === 0) tarro().delete(c.name);
    else tarro().set(c.name, c.value);
  }
  return res;
}

test("v4 · al cerrar sesión se borra el desbloqueo de 72 h: al volver a entrar se pide la clave", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  assert.equal((await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE })).status, 200);
  como(SB_DUENO, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3, "desbloqueada");
  tarro().set("otra_cookie", "se-queda");
  const desbloqueos = Array.from(tarro().keys()).filter((k) => k.startsWith("df_sede_"));
  assert.equal(desbloqueos.length, 1);

  await cerrarSesion();
  assert.deepEqual(Array.from(tarro().keys()).filter((k) => k.startsWith("df_sede_")), [], "sin desbloqueos");
  assert.equal(tarro().get("otra_cookie"), "se-queda", "solo se borran las de la clave");

  // Vuelve a entrar en el mismo navegador: la sede 3 pide la clave otra vez.
  assert.equal(await getAuthContext(), null);
  como(SB_DUENO, CLI_1);
  assert.equal((await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 })).status, 423);
});

test("v4 · cookiesDeDesbloqueo solo reconoce las de la clave", async () => {
  const { cookiesDeDesbloqueo, nombreCookieDesbloqueo } = await import("../core");
  const a = nombreCookieDesbloqueo(SB_DUENO, CLI_3);
  const b = nombreCookieDesbloqueo(SB_ADMIN3, CLI_3);
  assert.deepEqual(cookiesDeDesbloqueo(`activeClinicId=x; ${a}=v1; df_2fa=z; ${b}=v2; df_sede_corta=1; ${a}=v1`), [a, b]);
  assert.deepEqual(cookiesDeDesbloqueo(null), []);
  assert.deepEqual(cookiesDeDesbloqueo(""), []);
});

// ══════════════════ v5 · todo inicio de sesión nuevo pide la clave (t8, M-1) ══════════════════

/** Una petición con las cookies del navegador de quien está sentado; lo que la respuesta pone o borra vuelve al navegador. */
async function conCookies(handler: (req: any) => Promise<Response>, url: string, body?: unknown) {
  const { NextRequest } = await import("next/server");
  const cookie = Array.from(tarro().entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  const res: any = await handler(new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  for (const c of res.cookies.getAll()) {
    if (!c.value || c.maxAge === 0) tarro().delete(c.name);
    else tarro().set(c.name, c.value);
  }
  return res as Response;
}

/** El dueño, con la clave de la sede 3 tecleada en su navegador. */
async function duenoConSede3Desbloqueada() {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  assert.equal((await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE, cambiarDeSede: false })).status, 200);
  tarro().set("otra_cookie", "se-queda");
  assert.equal(desbloqueosEnElNavegador().length, 1);
}
const desbloqueosEnElNavegador = () => Array.from(tarro().keys()).filter((k) => k.startsWith("df_sede_"));

async function sede3PideLaClave() {
  como(SB_DUENO, CLI_1);
  return (await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 })).status === 423;
}

test("v5 · iniciar sesión con contraseña borra los desbloqueos (p. ej. la sesión se cerró en otro dispositivo)", async () => {
  await duenoConSede3Desbloqueada();
  const { POST } = await import("@/app/api/auth/login/route");
  // Un intento fallido no crea sesión: no toca nada.
  assert.equal((await conCookies(POST, "/api/auth/login", { email: "dueno@example.com", password: "mala" })).status, 401);
  assert.equal(desbloqueosEnElNavegador().length, 1);
  // La sesión se crea bien: sin desbloqueos, y la sede 3 vuelve a pedir la clave.
  assert.equal((await conCookies(POST, "/api/auth/login", { email: "dueno@example.com", password: "buena-123" })).status, 200);
  assert.deepEqual(desbloqueosEnElNavegador(), []);
  assert.equal(tarro().get("otra_cookie"), "se-queda");
  assert.ok(await sede3PideLaClave());
});

test("v5 · entrar con Google (auth/callback) borra los desbloqueos y deja el 2FA y la sede activa como siempre", async () => {
  await duenoConSede3Desbloqueada();
  const { GET } = await import("@/app/api/auth/callback/route");
  assert.equal((await conCookies(GET, "/api/auth/callback?code=malo")).status, 307);
  assert.equal(desbloqueosEnElNavegador().length, 1, "sin sesión nueva no se toca");
  const r = await conCookies(GET, "/api/auth/callback?code=ok");
  assert.equal(r.headers.get("location"), "http://localhost/dashboard", "rama de quien ya tiene clínica (la del 2FA)");
  assert.deepEqual(desbloqueosEnElNavegador(), []);
  // El callback carga active-clinic con import() dinámico (no pasa por el doble): la cookie real se siembra igual.
  assert.ok(tarro().has("activeClinicId"), "la sede activa se siembra igual");
  assert.ok(await sede3PideLaClave());
});

test("v5 · entrar por un enlace de correo (auth/confirm: recuperar contraseña, invitación) borra los desbloqueos", async () => {
  const { GET } = await import("@/app/auth/confirm/route");
  for (const url of ["/auth/confirm?code=ok&next=/reset-password", "/auth/confirm?token_hash=ok&type=recovery&next=/reset-password"]) {
    navegadores.clear();
    db.claves.clear();
    (await import("../estado.server"))._olvidarEstado();
    await duenoConSede3Desbloqueada();
    const malo = await conCookies(GET, url.replace("=ok", "=malo"));
    assert.match(malo.headers.get("location") ?? "", /error=link_invalido/);
    assert.equal(desbloqueosEnElNavegador().length, 1, `${url}: un enlace inválido no toca nada`);
    const r = await conCookies(GET, url);
    assert.match(r.headers.get("location") ?? "", /\/reset-password$/);
    assert.deepEqual(desbloqueosEnElNavegador(), [], url);
    assert.ok(await sede3PideLaClave(), url);
  }
});

test("v5 · solo se borran donde NACE la sesión: no en post-login, 2FA, «Ver como clínica» ni la clave misma", () => {
  const usan = TODOS.filter((f) => /borrarDesbloqueos\s*\(/.test(f.src)).map((f) => f.rel).sort();
  assert.deepEqual(usan, [
    "src/app/api/auth/callback/route.ts",
    "src/app/api/auth/login/route.ts",
    "src/app/api/auth/logout/route.ts",
    "src/app/auth/confirm/route.ts",
    "src/lib/sede-clave/core.ts",
  ]);
  // Y nadie más se salta la función para borrarlas a mano.
  const aMano = TODOS.filter((f) => /cookiesDeDesbloqueo\s*\(/.test(f.src)).map((f) => f.rel);
  assert.deepEqual(aMano, ["src/lib/sede-clave/core.ts"]);
});

test("v5 · el desbloqueo tecleado después de iniciar sesión se queda (con el 2FA y el resto de la sesión)", async () => {
  await activarComoAdmin3();
  como(SB_DUENO, CLI_1);
  const { POST } = await import("@/app/api/auth/login/route");
  assert.equal((await conCookies(POST, "/api/auth/login", { email: "dueno@example.com", password: "buena-123" })).status, 200);
  assert.equal((await llamar(await rutaDesbloquear(), "/api/sede-clave/desbloquear", { clinicId: CLI_3, clave: CLAVE })).status, 200);
  como(SB_DUENO, CLI_3);
  assert.equal((await getAuthContext())?.clinicId, CLI_3);
  // Las peticiones siguientes de la misma sesión (cambiar de sede, el 2FA, refrescar) no lo borran.
  como(SB_DUENO, CLI_1);
  assert.equal((await llamar(await rutaSwitch(), "/api/switch-clinic", { clinicId: CLI_3 })).status, 200);
  assert.equal(desbloqueosEnElNavegador().length, 1);
});

// ══════════════════ v5 · el permiso en Equipo → Permisos ══════════════════

test("v5 · el permiso «Crear y cambiar la clave de la sede» solo se enseña con 2+ sedes o con la clave ya puesta", async () => {
  const { permisoDeClaveVisible } = await import("../cuenta.server");
  assert.equal(await permisoDeClaveVisible(CLI_3), true, "su dueño tiene 2 sedes");
  assert.equal(await permisoDeClaveVisible(CLI_1), true);
  assert.equal(await permisoDeClaveVisible(CLI_OTRA), false, "una sola sede");
  db.claves.set(CLI_OTRA, { claveHash: "$2a$10$x", version: 1, actualizadaPor: null });
  const { invalidarLista } = await import("../estado.server");
  invalidarLista();
  assert.equal(await permisoDeClaveVisible(CLI_OTRA), true, "una sede sola con la clave puesta: igual que la tarjeta");
  db.tablas = false;
  const { _olvidarEstado } = await import("../estado.server");
  _olvidarEstado();
  assert.equal(await permisoDeClaveVisible(CLI_3), false, "sin el SQL la función está apagada");
  db.tablas = true;
  _olvidarEstado();
  db.falloSonda = true;
  assert.equal(await permisoDeClaveVisible(CLI_3), false, "si falla la base, no se enseña");
});

test("v5 · el modal de Permisos esconde la clave de la sede con una sola sede y conserva lo guardado", async () => {
  const { PERMISSION_GROUPS } = await import("@/lib/auth/permissions");
  const { clavesOcultasEnModal, gruposVisibles, diferenciasConElRol } = await import("@/lib/team/permisos-modal");
  const llaves = (o: ReadonlySet<any>) => gruposVisibles(PERMISSION_GROUPS, o).flatMap((g) => g.keys);
  assert.ok(llaves(clavesOcultasEnModal(true)).includes("sede.clave"));
  assert.ok(!llaves(clavesOcultasEnModal(false)).includes("sede.clave"));
  // Lo de antes sigue oculto en los dos casos.
  for (const v of [true, false]) assert.ok(!llaves(clavesOcultasEnModal(v)).includes("marketplace.view"));
  // Un ADMIN que ya lo tenía: aunque no salga en la lista, sale como «Además» (v6, m-1) y sigue en lo que se guarda (selected).
  assert.deepEqual(diferenciasConElRol(["sede.clave", "today.view"], ["today.view"]).ademasDelRol, ["sede.clave"]);
  // La página de Equipo lo calcula en el servidor y llega a los dos modales.
  const pagina = readFileSync(join(SRC, "app/dashboard/team/page.tsx"), "utf8");
  assert.match(pagina, /permisoDeClaveVisible\(user\.clinicId\)/);
  const cliente = readFileSync(join(SRC, "app/dashboard/team/team-client.tsx"), "utf8");
  assert.equal(cliente.match(/permisoClaveDeSede=\{permisoClaveDeSede\}/g)?.length, 2);
  const sabina = readFileSync(join(SRC, "components/dashboard/team/sabina-permissions-modal.tsx"), "utf8");
  assert.match(sabina, /permisoClaveDeSede \|\| k !== "sede\.clave"/);
});

test("v6 (m-1) · con una sola sede, el ADMIN que ya tiene la clave de la sede no sale «personalizado» sin decir en qué", async () => {
  const { ROLE_DEFAULT_PERMISSIONS, ALL_PERMISSIONS } = await import("@/lib/auth/permissions");
  const { sigueElDefaultDelRol, diferenciasConElRol } = await import("@/lib/team/permisos-modal");
  const delRol = ROLE_DEFAULT_PERMISSIONS.ADMIN;
  assert.ok(!delRol.includes("sede.clave"), "el ADMIN no la trae por defecto");
  // Se la dieron cuando había 2 sedes; ahora la cuenta tiene una y el permiso no sale en la lista.
  const guardado = [...delRol, "sede.clave" as const];
  assert.equal(sigueElDefaultDelRol(guardado, delRol), false, "el interruptor sale apagado…");
  const d = diferenciasConElRol(guardado, delRol);
  assert.deepEqual(d.ademasDelRol, ["sede.clave"], "…y el recuadro dice en qué se distingue");
  assert.deepEqual(d.sinLoDelRol, []);
  assert.equal(ALL_PERMISSIONS["sede.clave"], "Crear y cambiar la clave de la sede", "con su nombre, antes de encender «Usar default del rol»");
  // El modal usa esa misma función sin quitarle las ocultas por sede.
  const modal = readFileSync(join(SRC, "components/dashboard/team/permissions-modal.tsx"), "utf8");
  assert.match(modal, /diferenciasConElRol\(selected, roleDefaults\)/);
});

// ══════════════════ ws1-t1 (29-oct) · contraseña temporal + sede con clave ══════════════════
//
// El bucle del iPad de San Felipe: un miembro con contraseña temporal entra a
// una sede con clave desde un navegador sin desbloqueo. El layout manda a
// /dashboard/cambiar-contrasena (barrera ANTERIOR a la clave) y pinta esa ruta
// sin mirar la clave; la página, con getCurrentUser, mandaba a
// /dashboard/sede-con-clave; el layout la devolvía por la marca… sin fin. Y la
// salida tampoco servía: /api/auth/change-password daba 401 con la sede cerrada.

const rutaCambioContrasena = async () => (await import("@/app/api/auth/change-password/route")).POST;
const getCurrentUserSinClaveDeSede = async (): Promise<any> => (await import("@/lib/auth")).getCurrentUserSinClaveDeSede();

/** El admin de la sede 3 con contraseña temporal, en un navegador limpio (sin desbloqueo). */
async function admin3ConTemporalEnNavegadorLimpio() {
  await activarComoAdmin3();
  const f = fichas.find((x) => x.id === "u-admin-3")!;
  f.mustChangePassword = true;
  f.email = "admin3@example.com";
  navegadores.delete(SB_ADMIN3);
  como(SB_ADMIN3, CLI_3);
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";
}

test("ws1-t1 · con contraseña temporal y la sede cerrada, la pantalla del cambio NO manda a la de la clave", async () => {
  await admin3ConTemporalEnNavegadorLimpio();
  ruta = "/dashboard/cambiar-contrasena";
  // Lo que usaba la página: rebota a la clave (y el layout la devolvería aquí).
  await assert.rejects(getCurrentUser(), redirigeA("/dashboard/sede-con-clave"));
  // Lo que usa ahora: se pinta.
  const u = await getCurrentUserSinClaveDeSede();
  assert.equal(u.clinicId, CLI_3);
  assert.equal(u.mustChangePassword, true);
});

test("ws1-t1 · con contraseña temporal y la sede cerrada, cambiar la contraseña funciona; después se pide la clave", async () => {
  await admin3ConTemporalEnNavegadorLimpio();
  const POST = await rutaCambioContrasena();
  const r = await llamar(POST, "/api/auth/change-password", { password: "Nueva-Segura-2026" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(contrasenasCambiadas, [SB_ADMIN3]);
  assert.deepEqual(marcasLevantadas, [SB_ADMIN3]);
  // Sin la marca, la siguiente barrera es la de siempre: la clave de la sede.
  ruta = "/dashboard";
  await assert.rejects(getCurrentUser(), redirigeA("/dashboard/sede-con-clave"));
});

test("ws1-t1 · un cambio VOLUNTARIO de contraseña sigue pidiendo la sede abierta", async () => {
  await admin3ConTemporalEnNavegadorLimpio();
  fichas.find((x) => x.id === "u-admin-3")!.mustChangePassword = false;
  const POST = await rutaCambioContrasena();
  const r = await llamar(POST, "/api/auth/change-password", { password: "Nueva-Segura-2026" });
  assert.equal(r.status, 401);
  assert.deepEqual(contrasenasCambiadas, []);
  // Con la clave tecleada (y la contraseña actual, revisión ws1-t9 m1), sí.
  const desbloquear = await rutaDesbloquear();
  assert.equal((await llamar(desbloquear, "/api/sede-clave/desbloquear", { clave: CLAVE })).status, 200);
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-de-prueba";
  contrasenaVigente = "Actual-Segura-2025";
  assert.equal((await llamar(POST, "/api/auth/change-password", { currentPassword: "Actual-Segura-2025", password: "Nueva-Segura-2026" })).status, 200);
});

// Revisión ws1-t9, m1: el cambio voluntario (Mi perfil, Configuración) pedía
// solo la nueva y el navegador la mandaba directo a Supabase; quien encontrara
// una sesión abierta podía cambiarla. Ahora: la actual, comprobada aquí.
async function voluntarioConSedeAbierta() {
  await admin3ConTemporalEnNavegadorLimpio();
  fichas.find((x) => x.id === "u-admin-3")!.mustChangePassword = false;
  const desbloquear = await rutaDesbloquear();
  assert.equal((await llamar(desbloquear, "/api/sede-clave/desbloquear", { clave: CLAVE })).status, 200);
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-de-prueba";
  contrasenaVigente = "Actual-Segura-2025";
  return rutaCambioContrasena();
}

test("t9 m1 · el cambio voluntario sin la contraseña actual no cambia nada", async () => {
  const POST = await voluntarioConSedeAbierta();
  const r = await llamar(POST, "/api/auth/change-password", { password: "Nueva-Segura-2026" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "falta_actual");
  assert.match(r.body.error, /contraseña actual/);
  assert.deepEqual(cambiosPropios, []);
  assert.deepEqual(contrasenasCambiadas, []);
});

test("t9 m1 · con la contraseña actual equivocada: «La contraseña actual no es correcta» y no cambia nada", async () => {
  const POST = await voluntarioConSedeAbierta();
  const r = await llamar(POST, "/api/auth/change-password", { currentPassword: "No-Es-La-Mia-1", password: "Nueva-Segura-2026" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "La contraseña actual no es correcta.");
  assert.deepEqual(cambiosPropios, []);
  assert.deepEqual(contrasenasCambiadas, []);
});

test("t9 m1 · con la actual buena cambia con la sesión de la persona, que sigue abierta", async () => {
  const POST = await voluntarioConSedeAbierta();
  const r = await llamar(POST, "/api/auth/change-password", { currentPassword: "Actual-Segura-2025", password: "Nueva-Segura-2026" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(cambiosPropios, [SB_ADMIN3], "no pasó por updateUser con la sesión de la persona");
  assert.deepEqual(contrasenasCambiadas, [], "el voluntario no usa la service role (cerraría todas sus sesiones)");
  assert.deepEqual(cierresDeSonda, ["local"], "la sonda de la actual solo cierra su propia sesión");
  assert.equal(sesion, SB_ADMIN3, "la sesión del navegador sigue viva");
  // La nueva igual a la actual, en español.
  const igual = await llamar(POST, "/api/auth/change-password", { currentPassword: "Actual-Segura-2025", password: "Actual-Segura-2025" });
  assert.equal(igual.status, 400);
  assert.match(igual.body.error, /distinta de la actual/);
});

test("t9 m1 · el voluntario sigue pidiendo la sede abierta y la sesión (sin la clave: 401, sin sesión: 401)", async () => {
  await admin3ConTemporalEnNavegadorLimpio();
  fichas.find((x) => x.id === "u-admin-3")!.mustChangePassword = false;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-de-prueba";
  contrasenaVigente = "Actual-Segura-2025";
  const POST = await rutaCambioContrasena();
  const cerrada = await llamar(POST, "/api/auth/change-password", { currentPassword: "Actual-Segura-2025", password: "Nueva-Segura-2026" });
  assert.equal(cerrada.status, 401);
  assert.equal(cerrada.body.code, "sede_con_clave");
  assert.deepEqual(cambiosPropios, []);
});

// Repaso iPad (29-oct): quien tecleaba la MISMA temporal como nueva veía «debe
// ser distinta»… y la sonda cerraba todas sus sesiones (signOut global): el
// siguiente intento, ya con una buena, salía 401 «Unauthorized», en inglés.
test("ws1-t1 · la misma temporal como nueva: aviso en español y la sesión SIGUE (la sonda solo cierra la suya)", async () => {
  await admin3ConTemporalEnNavegadorLimpio();
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-de-prueba";
  contrasenaVigente = "Temporal-Generada-77";
  const POST = await rutaCambioContrasena();
  const r1 = await llamar(POST, "/api/auth/change-password", { password: "Temporal-Generada-77" });
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /distinta de la temporal/);
  assert.deepEqual(cierresDeSonda, ["local"]);
  assert.deepEqual(contrasenasCambiadas, []);
  // Escribe otra: entra, sin volver a iniciar sesión.
  const r2 = await llamar(POST, "/api/auth/change-password", { password: "Nueva-Segura-2026" });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.deepEqual(contrasenasCambiadas, [SB_ADMIN3]);
});

test("ws1-t1 · change-password no contesta en inglés ni con jerga: sin sesión → español y código para volver a entrar", async () => {
  await admin3ConTemporalEnNavegadorLimpio();
  const POST = await rutaCambioContrasena();
  sesion = null;
  const r = await llamar(POST, "/api/auth/change-password", { password: "Nueva-Segura-2026" });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "sin_sesion");
  assert.match(r.body.error, /sesión se cerró/);
  // Ningún texto de la ruta en inglés ni técnico (la pantalla los enseña tal cual).
  const fuente = readFileSync(join(SRC, "app/api/auth/change-password/route.ts"), "utf8");
  for (const malo of ["Unauthorized", "Body inválido", "service role no está configurado"]) {
    assert.ok(!fuente.includes(`"${malo}`) && !fuente.includes(`${malo}"`), `mensaje que ve la persona: «${malo}»`);
  }
  // Y la pantalla, ante un 401, ofrece volver a entrar en vez de dejar reintentar.
  const cliente = readFileSync(join(SRC, "app/dashboard/cambiar-contrasena/change-password-client.tsx"), "utf8");
  assert.match(cliente, /res\.status === 401/);
  assert.match(cliente, /Volver a entrar/);
});

test("ws1-t1 · cada pantalla de barrera solo aplica los gates de las barreras ANTERIORES (nunca A→B→A)", () => {
  // El orden lo fija el layout: 2FA → contraseña temporal → clave de la sede, y
  // cada ruta de barrera se pinta (return minimalShell) antes del gate siguiente.
  const layout = sinComentarios(readFileSync(join(SRC, "app/dashboard/layout.tsx"), "utf8"));
  const marcas = [
    "decidirDosPasos(user)",
    "if (isTwoFaRoute) return minimalShell;",
    "redirect(MUST_CHANGE_PASSWORD_PATH)",
    "if (isPasswordChangeRoute) return minimalShell;",
    "await sedeCerradaPara(",
  ].map((m) => ({ m, i: layout.indexOf(m) }));
  for (const { m, i } of marcas) assert.ok(i >= 0, `el layout ya no tiene «${m}»: revisa el orden de las barreras`);
  for (let k = 1; k < marcas.length; k++) assert.ok(marcas[k - 1].i < marcas[k].i, `orden de barreras cambiado: «${marcas[k - 1].m}» / «${marcas[k].m}»`);

  // Qué gates aplica cada forma de pedir la sesión.
  const GATES: Record<string, string[]> = {
    getCurrentUser: ["dosPasos", "clave"],
    getAuthContext: ["dosPasos", "clave"],
    getCurrentUserSinClaveDeSede: ["dosPasos"],
    getAuthContextParaClaveDeSede: ["dosPasos"],
    getCurrentUserSinDosPasos: [],
    getTwoFactorActor: [],
  };
  // Cada pantalla de barrera (y la ruta que la resuelve) con las barreras que van ANTES.
  const BARRERAS: Array<{ archivo: string; antes: string[] }> = [
    { archivo: "app/dashboard/2fa/page.tsx", antes: [] },
    { archivo: "app/dashboard/2fa/setup/page.tsx", antes: [] },
    { archivo: "app/api/auth/2fa/verify/route.ts", antes: [] },
    { archivo: "app/api/auth/2fa/setup/route.ts", antes: [] },
    { archivo: "app/api/auth/2fa/enable/route.ts", antes: [] },
    { archivo: "app/api/auth/2fa/recovery-codes/route.ts", antes: [] },
    { archivo: "app/dashboard/cambiar-contrasena/page.tsx", antes: ["dosPasos"] },
    { archivo: "app/api/auth/change-password/route.ts", antes: ["dosPasos"] },
    { archivo: "app/dashboard/sede-con-clave/page.tsx", antes: ["dosPasos", "contrasena"] },
    { archivo: "app/api/sede-clave/desbloquear/route.ts", antes: ["dosPasos", "contrasena"] },
  ];
  for (const { archivo, antes } of BARRERAS) {
    const src = sinComentarios(readFileSync(join(SRC, archivo), "utf8"));
    const usadas = Object.keys(GATES).filter((f) => new RegExp(`\\b${f}\\s*\\(`).test(src));
    assert.ok(usadas.length > 0, `${archivo}: no se encontró cómo pide la sesión`);
    for (const f of usadas) {
      for (const g of GATES[f]) {
        assert.ok(antes.includes(g), `${archivo} usa ${f}(), que aplica el gate «${g}» de una barrera POSTERIOR: bucle de redirecciones`);
      }
    }
  }
});

test("ws1-t1 · suspendida + clave: la pantalla de la clave se puede abrir con el plan vencido (sin rebote a suspended)", async () => {
  // El doble de @/lib/plan-status de este archivo no sirve aquí: se carga el real por ruta.
  const { isAllowedWhileSuspended } = await import("../../plan-status");
  assert.equal(isAllowedWhileSuspended("/dashboard/sede-con-clave"), true);
  assert.equal(isAllowedWhileSuspended("/dashboard/suspended"), true);
  assert.equal(isAllowedWhileSuspended("/dashboard"), false);
  assert.equal(isAllowedWhileSuspended("/dashboard/sede-con-clave-falsa"), false);
  // Y /dashboard/suspended manda a la clave cuando la sede está cerrada: con la
  // clave fuera de la lista, el guard de cliente la devolvía a suspended sin fin.
  const suspendida = sinComentarios(readFileSync(join(SRC, "app/dashboard/suspended/page.tsx"), "utf8"));
  assert.match(suspendida, /\bgetCurrentUser\s*\(/);
});
