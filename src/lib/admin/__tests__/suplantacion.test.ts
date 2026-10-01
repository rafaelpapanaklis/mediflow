/**
 * M5 (auditoría 30-sep-2026) — «Ver como clínica» con sesión de suplantación propia,
 * y decisión A de Rafael (1-oct): lo que hace el admin NO va a la bitácora de la clínica.
 *
 * Run: npm run test:suplantacion
 *
 * Reproduce el fallo de partida: GET /api/admin/impersonate abría la sesión del dueño
 * (generateLink) sin nota y sin registro; ahora el GET no genera nada.
 * Fija:
 *   · POST: sin nota → 400 y no se genera el enlace; sin tablas → 503 y no se genera;
 *     si la nota de AdminClinicNote no se pudo escribir → 503 y no se genera.
 *   · La regla de vida de la sesión (2 h, cierre) y la lectura del session_id del token.
 *   · Una sesión vencida vale como «terminada» (getSession/getAuthContext la tratan como sin sesión).
 *   · El desvío: con suplantación activa, insertarFilaBitacora NO escribe en audit_logs y sí en
 *     admin_impersonation_actions; sin suplantación, todo sigue igual.
 *
 * Base y Supabase simulados (mock.module). Sin .env.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// ── estado de los dobles ──
let filaSuplantacion: Record<string, unknown> | null = null;
let tablasExisten = true;
let notaFalla = false;
const sqlEjecutado: string[] = [];
const auditLogCreates: unknown[] = [];
let generateLinkLlamadas = 0;
let tokenDeSesion: string | null = null;

function jwt(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(claims)}.firma`;
}

const consultasATabla: string[] = [];
let preguntasPorTablas = 0;
const prismaFalso = {
  $queryRaw: async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("to_regclass")) { preguntasPorTablas++; return [{ ok: tablasExisten }]; }
    consultasATabla.push(sql);
    if (!tablasExisten) throw Object.assign(new Error('relation "admin_impersonation_sessions" does not exist'), { code: "P2010", meta: { code: "42P01" } });
    if (/FROM "admin_impersonation_sessions"\s+WHERE/.test(sql)) return filaSuplantacion ? [filaSuplantacion] : [];
    return [];
  },
  $executeRaw: async (strings: TemplateStringsArray) => { sqlEjecutado.push(strings.join("?")); return 1; },
  auditLog: { create: async (a: unknown) => { auditLogCreates.push(a); return { id: "x" }; } },
  adminClinicNote: { create: async () => { if (notaFalla) throw new Error("db caída"); return { id: "n" }; } },
  user: { findFirst: async () => ({ id: "u-dueno", supabaseId: "sb-dueno", email: "dueno@example.com", firstName: "D", lastName: "Ueño" }) },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: tokenDeSesion ? { access_token: tokenDeSesion } : null } }),
        signOut: async () => ({ error: null }),
        verifyOtp: async () => ({ data: { session: { access_token: jwt({ session_id: "ses-nueva" }) } }, error: null }),
      },
    }),
  },
});
mock.module("@/lib/admin/supabase-admin", {
  namedExports: {
    clienteAdminSupabase: () => ({
      auth: { admin: {
        generateLink: async () => { generateLinkLlamadas++; return { data: { properties: { hashed_token: "h" } }, error: null }; },
        signOut: async () => ({ error: null }),
      } },
    }),
  },
});
mock.module("@/lib/admin-auth", {
  namedExports: { getAdminSession: async () => ({ user: { id: "adm-1", email: "admin@dalecontrol.com", role: "ADMIN" } }) },
});

const core = () => import("../suplantacion-core");
const lib = () => import("../suplantacion");
const ruta = () => import("../../../app/api/admin/impersonate/route");
const fila = () => import("../../movimientos-paciente/fila");

beforeEach(async () => {
  filaSuplantacion = null; tablasExisten = true; notaFalla = false; tokenDeSesion = null;
  sqlEjecutado.length = 0; auditLogCreates.length = 0; generateLinkLlamadas = 0;
  consultasATabla.length = 0; preguntasPorTablas = 0;
  (await lib())._reiniciarCacheSuplantacion();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srk";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
});

function post(body: Record<string, string>) {
  const f = new URLSearchParams(body);
  return new NextRequest("http://dev.local/api/admin/impersonate", {
    method: "POST", body: f.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", host: "dev.local", origin: "http://dev.local" },
  });
}

// ── la ruta ──

test("GET ya no abre la sesión del dueño (antes: magic link sin nota ni registro)", async () => {
  const r = await (await ruta()).GET(new NextRequest("http://dev.local/api/admin/impersonate?clinicId=c1"));
  assert.equal(r.status, 405);
  assert.equal(generateLinkLlamadas, 0);
});

test("POST sin motivo (o muy corto) → 400 y no se genera nada", async () => {
  for (const nota of ["", "corta"]) {
    const r = await (await ruta()).POST(post({ clinicId: "c1", nota }));
    assert.equal(r.status, 400);
  }
  assert.equal(generateLinkLlamadas, 0);
});

test("POST sin las tablas (SQL sin pegar) → 503 y no se abre sesión", async () => {
  tablasExisten = false;
  const r = await (await ruta()).POST(post({ clinicId: "c1", nota: "el dueño pidió ayuda con la agenda" }));
  assert.equal(r.status, 503);
  assert.match(await r.text(), /ws1-t4-suplantacion-admin\.sql/);
  assert.equal(generateLinkLlamadas, 0);
});

test("POST: si la nota de auditoría no se escribe, no se entra", async () => {
  notaFalla = true;
  const r = await (await ruta()).POST(post({ clinicId: "c1", nota: "el dueño pidió ayuda con la agenda" }));
  assert.equal(r.status, 503);
  assert.equal(generateLinkLlamadas, 0);
});

test("POST completo: registra la sesión por su session_id (2 h) y redirige 303 conservando df_2fa_admin", async () => {
  const r = await (await ruta()).POST(post({ clinicId: "c1", nota: "el dueño pidió ayuda con la agenda" }));
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location") ?? "", /\/dashboard$/);
  const insert = sqlEjecutado.find((s) => s.includes('INSERT INTO "admin_impersonation_sessions"'));
  assert.ok(insert, "la sesión quedó registrada");
  const cookies = r.headers.get("set-cookie") ?? "";
  assert.match(cookies, /df_2fa_admin=/, "se conserva la prueba firmada de ws1-t8");
});

// ── la regla ──

test("núcleo: nota obligatoria y acotada; session_id del token; vida de 2 h", async () => {
  const c = await core();
  assert.equal(c.limpiarNota("   "), null);
  assert.equal(c.limpiarNota("  ayuda   con  agenda "), "ayuda con agenda");
  assert.equal(c.limpiarNota("x".repeat(900))!.length, c.NOTA_MAX);
  assert.equal(c.sessionIdDelToken(jwt({ session_id: "abc" })), "abc");
  assert.equal(c.sessionIdDelToken("no-es-jwt"), null);
  assert.equal(c.DURACION_SUPLANTACION_MS, 2 * 60 * 60 * 1000);
  const base = { id: "i", adminUserId: "a", adminEmail: "e", clinicId: "c", targetUserId: "t", endedAt: null };
  assert.equal(c.estadoDe(null).tipo, "normal");
  assert.equal(c.estadoDe({ ...base, expiresAt: new Date(Date.now() + 60_000) }).tipo, "activa");
  assert.equal(c.estadoDe({ ...base, expiresAt: new Date(Date.now() - 1) }).tipo, "terminada");
  assert.equal(c.estadoDe({ ...base, expiresAt: new Date(Date.now() + 60_000), endedAt: new Date() }).tipo, "terminada");
});

test("una sesión de suplantación vencida vale como «terminada» y se cierra", async () => {
  tokenDeSesion = jwt({ session_id: "ses-vieja" });
  filaSuplantacion = { id: "i1", adminUserId: "adm-1", adminEmail: "admin@dalecontrol.com", clinicId: "c1", targetUserId: "u", expiresAt: new Date(Date.now() - 1000), endedAt: null };
  const { estadoSuplantacionDe } = await lib();
  const { createClient } = await import("@/lib/supabase/server");
  const e = await estadoSuplantacionDe(createClient() as never);
  assert.equal(e.tipo, "terminada");
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(sqlEjecutado.some((s) => s.includes('SET "endedAt" = now()')), "se marca cerrada");
});

test("getSession y getAuthContext cortan la sesión terminada (cableado)", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
  assert.match(src("auth.ts"), /estadoSuplantacionDe\(supabase\)\)\.tipo === "terminada"\) return null/);
  assert.match(src("auth-context.ts"), /if \(suplantacion\.tipo === "terminada"\) return null;/);
});

test("sin el SQL pegado, la base no recibe NINGUNA consulta que falle (42P01) y se pregunta una sola vez", async () => {
  tablasExisten = false;
  tokenDeSesion = jwt({ session_id: "ses-x" });
  const { estadoSuplantacionDe, desviarSiSuplantacion } = await lib();
  const { createClient } = await import("@/lib/supabase/server");
  for (let i = 0; i < 25; i++) {
    tokenDeSesion = jwt({ session_id: `ses-${i}` }); // sesiones distintas: sin caché por sesión
    assert.equal((await estadoSuplantacionDe(createClient() as never)).tipo, "normal");
    assert.equal(await desviarSiSuplantacion({ clinicId: "c1", userId: "u", entityType: "x", entityId: "y", action: "z", changes: null }), false);
  }
  assert.equal(consultasATabla.length, 0, "ninguna consulta contra admin_impersonation_*");
  assert.equal(preguntasPorTablas, 1, "to_regclass una vez y se recuerda");
});

// ── decisión A: el desvío ──

test("con suplantación ACTIVA, la bitácora de la clínica no se escribe y va a la de admin", async () => {
  tokenDeSesion = jwt({ session_id: "ses-activa" });
  filaSuplantacion = { id: "i2", adminUserId: "adm-1", adminEmail: "admin@dalecontrol.com", clinicId: "c1", targetUserId: "u-dueno", expiresAt: new Date(Date.now() + 3600_000), endedAt: null };
  const { insertarFilaBitacora } = await fila();
  await insertarFilaBitacora({
    clinicId: "c1", userId: "u-dueno", entityType: "invoice", entityId: "inv-1", action: "create",
    changes: { total: { before: null, after: 100 } }, patientId: "p1",
  });
  assert.equal(auditLogCreates.length, 0, "nada a audit_logs (ni Movimientos)");
  assert.ok(!sqlEjecutado.some((s) => s.includes('INSERT INTO "audit_logs"')), "tampoco por SQL crudo");
  assert.ok(sqlEjecutado.some((s) => s.includes('INSERT INTO "admin_impersonation_actions"')), "sí a la bitácora de admin");
});

test("sin suplantación, la bitácora de la clínica se escribe como siempre", async () => {
  tokenDeSesion = jwt({ session_id: "ses-normal" });
  filaSuplantacion = null;
  const { insertarFilaBitacora } = await fila();
  await insertarFilaBitacora({
    clinicId: "c1", userId: "u-dueno", entityType: "invoice", entityId: "inv-1", action: "create", changes: null,
  });
  assert.equal(auditLogCreates.length + sqlEjecutado.filter((s) => s.includes('INSERT INTO "audit_logs"')).length, 1);
  assert.ok(!sqlEjecutado.some((s) => s.includes("admin_impersonation_actions")));
});

test("actores externos (paciente, bot) no se desvían aunque haya cookies de suplantación", async () => {
  tokenDeSesion = jwt({ session_id: "ses-activa" });
  filaSuplantacion = { id: "i2", adminUserId: "adm-1", adminEmail: "a", clinicId: "c1", targetUserId: "u", expiresAt: new Date(Date.now() + 3600_000), endedAt: null };
  const { desviarSiSuplantacion } = await lib();
  assert.equal(await desviarSiSuplantacion({ clinicId: "c1", userId: null, entityType: "x", entityId: "y", action: "z", changes: null, actorType: "bot" }), false);
  assert.equal(await desviarSiSuplantacion({ clinicId: "c1", userId: "u", entityType: "x", entityId: "y", action: "z", changes: null, actorType: "admin" }), false);
});
