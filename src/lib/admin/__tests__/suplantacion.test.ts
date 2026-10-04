/**
 * M5 (auditoría 30-sep-2026) — «Ver como clínica» con sesión de suplantación propia,
 * y decisión A de Rafael (1-oct): lo que hace el admin NO va a la bitácora de la clínica.
 *
 * Run: npm run test:suplantacion
 *
 * Reproduce el fallo de partida: GET /api/admin/impersonate abría la sesión del dueño
 * (generateLink) sin nota y sin registro; ahora el GET no genera nada.
 * Fija:
 *   · POST: sin tablas → 503 y no se genera el enlace.
 *   · ws1-t11 (2-oct): un clic, sin motivo («Entrada de soporte»), y la nota de
 *     AdminClinicNote ya NO bloquea — en producción fallaba SIEMPRE (authorId es
 *     NOT NULL en la base y se insertaba null) y «Ver como clínica» daba 503.
 *   · signOut siempre con scope "local" (el "global" echaría al dueño real), y
 *     «Salir y volver a /admin» / «Cerrar sesión» cierran solo la suplantación.
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
const signOuts: unknown[] = [];
const notasCreadas: string[] = [];
// ws1-t11 (revisión 2-oct): la sesión previa del navegador y su canje al salir.
let refreshDeSesion: string | null = null;
let usuarioDelCanje: string | null = "sb-rafael";
const canjes: string[] = [];
const revocadasPorAdmin: string[] = [];

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
  adminClinicNote: {
    create: async (a: { data: { content: string } }) => {
      // Como en producción: admin_clinic_notes.authorId es NOT NULL y la ruta manda null.
      if (notaFalla) throw new Error('Null constraint violation on the fields: (`authorId`)');
      notasCreadas.push(a.data.content);
      return { id: "n" };
    },
  },
  clinic: { findUnique: async () => ({ name: "Clínica QA" }) },
  user: { findFirst: async () => ({ id: "u-dueno", supabaseId: "sb-dueno", email: "dueno@example.com", firstName: "D", lastName: "Ueño" }) },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: tokenDeSesion ? { access_token: tokenDeSesion, refresh_token: refreshDeSesion ?? undefined } : null } }),
        getUser: async () => ({ data: { user: tokenDeSesion ? { id: "sb-x" } : null } }),
        signOut: async (o?: unknown) => { signOuts.push(o ?? "global"); return { error: null }; },
        refreshSession: async (s: { refresh_token: string }) => {
          canjes.push(s.refresh_token);
          return usuarioDelCanje
            ? { data: { user: { id: usuarioDelCanje }, session: {} }, error: null }
            : { data: { user: null, session: null }, error: new Error("refresh token revocado") };
        },
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
        signOut: async (t: string) => { revocadasPorAdmin.push(t); return { error: null }; },
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
  signOuts.length = 0; notasCreadas.length = 0;
  refreshDeSesion = null; usuarioDelCanje = "sb-rafael"; canjes.length = 0; revocadasPorAdmin.length = 0;
  consultasATabla.length = 0; preguntasPorTablas = 0;
  (await lib())._reiniciarCacheSuplantacion();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srk";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
});

function post(body: Record<string, string>, ruta = "/api/admin/impersonate", cookie?: string) {
  const f = new URLSearchParams(body);
  return new NextRequest(`http://dev.local${ruta}`, {
    method: "POST", body: f.toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded", host: "dev.local", origin: "http://dev.local",
      ...(cookie ? { cookie } : {}),
    },
  });
}

// ── la ruta ──

test("GET ya no abre la sesión del dueño (antes: magic link sin nota ni registro)", async () => {
  const r = await (await ruta()).GET(new NextRequest("http://dev.local/api/admin/impersonate?clinicId=c1"));
  assert.equal(r.status, 405);
  assert.equal(generateLinkLlamadas, 0);
});

test("ws1-t11: un clic — sin motivo entra igual (303) y registra «Entrada de soporte»", async () => {
  const r = await (await ruta()).POST(post({ clinicId: "c1" }));
  assert.equal(r.status, 303);
  const insert = sqlEjecutado.find((s) => s.includes('INSERT INTO "admin_impersonation_sessions"'));
  assert.ok(insert, "la entrada queda en la bitácora de admin");
  assert.match(notasCreadas[0] ?? "", /motivo: Entrada de soporte/);
});

test("POST sin las tablas (SQL sin pegar) → 503 y no se abre sesión", async () => {
  tablasExisten = false;
  const r = await (await ruta()).POST(post({ clinicId: "c1", nota: "el dueño pidió ayuda con la agenda" }));
  assert.equal(r.status, 503);
  assert.match(await r.text(), /ws1-t4-suplantacion-admin\.sql/);
  assert.equal(generateLinkLlamadas, 0);
});

test("ws1-t11 (la causa): si admin_clinic_notes rechaza la nota (authorId NOT NULL), se entra igual", async () => {
  notaFalla = true;
  const r = await (await ruta()).POST(post({ clinicId: "c1" }));
  assert.equal(r.status, 303, "antes: 503 «No se pudo registrar la entrada»");
  assert.ok(sqlEjecutado.some((s) => s.includes('INSERT INTO "admin_impersonation_sessions"')));
});

test("ws1-t11: entrar nunca hace un signOut global (echaría al dueño real de sus dispositivos)", async () => {
  tokenDeSesion = jwt({ session_id: "ses-otra-supl" });
  filaSuplantacion = { id: "i0", adminUserId: "adm-1", adminEmail: "a", clinicId: "c0", targetUserId: "u", expiresAt: new Date(Date.now() + 3600_000), endedAt: null };
  await (await ruta()).POST(post({ clinicId: "c1" }));
  assert.deepEqual(signOuts, [{ scope: "local" }], "la suplantación anterior se cierra, solo ella");
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

test("núcleo: nota opcional y acotada; session_id del token; vida de 2 h", async () => {
  const c = await core();
  assert.equal(c.limpiarNota("   "), "Entrada de soporte");
  assert.equal(c.limpiarNota(undefined), "Entrada de soporte");
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

// ── ws1-t11: salir ──

const filaActiva = () => ({ id: "i3", adminUserId: "adm-1", adminEmail: "a", clinicId: "c1", targetUserId: "u", expiresAt: new Date(Date.now() + 3600_000), endedAt: null });

test("«Salir y volver a /admin»: cierra la suplantación (local) y vuelve a la ficha de la clínica", async () => {
  tokenDeSesion = jwt({ session_id: "ses-salir" });
  filaSuplantacion = filaActiva();
  const salir = await import("../../../app/api/admin/impersonate/salir/route");
  const r = await salir.POST(post({}, "/api/admin/impersonate/salir"));
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location") ?? "", /\/admin\/clinics\/c1$/);
  assert.ok(sqlEjecutado.some((s) => s.includes('"endedReason" = ?')), "queda marcada cerrada");
  assert.deepEqual(signOuts, [{ scope: "local" }]);
});

test("«Salir» con una sesión normal (no suplantación) no cierra nada", async () => {
  tokenDeSesion = jwt({ session_id: "ses-normal-2" });
  filaSuplantacion = null;
  const salir = await import("../../../app/api/admin/impersonate/salir/route");
  const r = await salir.POST(post({}, "/api/admin/impersonate/salir"));
  assert.equal(r.status, 303);
  assert.equal(signOuts.length, 0);
});

test("«Cerrar sesión» del panel durante la suplantación: solo local; fuera de ella, como siempre", async () => {
  const logout = await import("../../../app/api/auth/logout/route");
  tokenDeSesion = jwt({ session_id: "ses-logout" });
  filaSuplantacion = filaActiva();
  await logout.POST(new Request("http://dev.local/api/auth/logout", { method: "POST" }));
  assert.deepEqual(signOuts, [{ scope: "local" }]);
  signOuts.length = 0;
  (await lib())._reiniciarCacheSuplantacion();
  tokenDeSesion = jwt({ session_id: "ses-logout-normal" });
  filaSuplantacion = null;
  await logout.POST(new Request("http://dev.local/api/auth/logout", { method: "POST" }));
  assert.deepEqual(signOuts, ["global"]);
});

// ── ws1-t11, revisión del 2-oct ──
//
// Punto 1: Rafael es admin Y dueño de su clínica en el mismo navegador. Entrar hacía
// signOut de SU sesión (revocándola) y salir dejaba el navegador sin sesión:
// /dashboard/settings → /login. Punto 2: las pestañas pintadas antes notan el cambio.
// Punto 3: el botón también en la lista de /admin/clinics.

const cookiesDe = (r: Response) => r.headers.getSetCookie?.() ?? [(r.headers.get("set-cookie") ?? "")];
const cookie = (r: Response, nombre: string) => cookiesDe(r).find((c) => c.startsWith(`${nombre}=`)) ?? null;

test("punto 1: entrar con la sesión propia del admin NO la cierra y la guarda para volver", async () => {
  const c = await core();
  tokenDeSesion = jwt({ session_id: "ses-de-rafael", sub: "sb-rafael" });
  refreshDeSesion = "rt-de-rafael";
  const { packClinicCookie } = await import("../../active-clinic-core");
  const r = await (await ruta()).POST(post({ clinicId: "c1" }, "/api/admin/impersonate", `activeClinicId=${packClinicCookie("clinica-de-rafael")}`));
  assert.equal(r.status, 303);
  assert.deepEqual(signOuts, [], "antes: signOut local, que revocaba la sesión de Rafael en Supabase");
  const guardada = cookie(r, c.COOKIE_SESION_PREVIA);
  assert.ok(guardada, "queda la copia de la sesión previa");
  assert.match(guardada!, /HttpOnly/i);
  assert.match(guardada!, /Path=\/api/);
  const valor = guardada!.split(";")[0].slice(c.COOKIE_SESION_PREVIA.length + 1);
  assert.deepEqual(c.desempacarSesionPrevia(valor), { rt: "rt-de-rafael", sub: "sb-rafael", clinica: "clinica-de-rafael" });
  const marca = cookie(r, c.COOKIE_PESTANA_VER_COMO);
  assert.match(marca ?? "", /^df_ver_como=[0-9a-f-]{36};/, "marca de pestaña con el id del registro");
  assert.doesNotMatch(marca!, /HttpOnly/i, "la marca la lee el vigía del navegador");
});

test("punto 1: entrar desde otra suplantación conserva la copia de antes (no guarda la de soporte)", async () => {
  const c = await core();
  tokenDeSesion = jwt({ session_id: "ses-supl-a", sub: "sb-dueno" });
  refreshDeSesion = "rt-de-soporte";
  filaSuplantacion = { id: "iA", adminUserId: "adm-1", adminEmail: "a", clinicId: "cA", targetUserId: "u", expiresAt: new Date(Date.now() + 3600_000), endedAt: null };
  const r = await (await ruta()).POST(post({ clinicId: "c1" }));
  assert.equal(r.status, 303);
  assert.equal(cookie(r, c.COOKIE_SESION_PREVIA), null, "ni se pisa ni se borra la copia que ya había");
});

test("punto 1: «Salir y volver a /admin» devuelve el navegador a la sesión de antes, con su clínica", async () => {
  const c = await core();
  tokenDeSesion = jwt({ session_id: "ses-salir-2" });
  filaSuplantacion = filaActiva();
  const previa = c.empacarSesionPrevia({ rt: "rt-de-rafael", sub: "sb-rafael", clinica: "clinica-de-rafael" });
  const salir = await import("../../../app/api/admin/impersonate/salir/route");
  const r = await salir.POST(post({}, "/api/admin/impersonate/salir", `${c.COOKIE_SESION_PREVIA}=${previa}`));
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location") ?? "", /\/admin\/clinics\/c1$/);
  assert.deepEqual(canjes, ["rt-de-rafael"], "antes: nada se canjeaba y /dashboard mandaba a /login");
  assert.deepEqual(revocadasPorAdmin, [], "la revocación en Supabase se aplaza (gracia): si no, las peticiones en vuelo borran la cookie devuelta");
  assert.deepEqual(signOuts, [], "sin signOut que borre las cookies recién canjeadas");
  assert.match(cookie(r, "activeClinicId") ?? "", /^activeClinicId=clinica-de-rafael\./, "vuelve su clínica activa");
  assert.match(cookie(r, c.COOKIE_SESION_PREVIA) ?? "", /Max-Age=0/);
  assert.match(cookie(r, c.COOKIE_PESTANA_VER_COMO) ?? "", /Max-Age=0/);
  assert.match(cookie(r, "df_2fa_admin") ?? "", /Max-Age=0/);
});

test("punto 1: si la sesión previa ya no sirve (o es de otra persona), se sale sin sesión como antes", async () => {
  const c = await core();
  const salir = await import("../../../app/api/admin/impersonate/salir/route");
  for (const caso of [null, "sb-otra-persona"]) {
    (await lib())._reiniciarCacheSuplantacion();
    signOuts.length = 0;
    usuarioDelCanje = caso;
    tokenDeSesion = jwt({ session_id: `ses-falla-${caso}` });
    filaSuplantacion = filaActiva();
    const previa = c.empacarSesionPrevia({ rt: "rt-viejo", sub: "sb-rafael", clinica: "x" });
    const r = await salir.POST(post({}, "/api/admin/impersonate/salir", `${c.COOKIE_SESION_PREVIA}=${previa}`));
    assert.equal(r.status, 303);
    assert.deepEqual(signOuts, [{ scope: "local" }], `caso ${caso}: queda sin sesión, nunca con la de otro`);
    assert.equal(revocadasPorAdmin.length, 1, `caso ${caso}: sin vuelta, la de suplantación se revoca ya`);
    revocadasPorAdmin.length = 0;
    assert.match(cookie(r, "activeClinicId") ?? "", /Max-Age=0/);
  }
});

test("punto 1: «Cerrar sesión» del panel en la suplantación también vuelve a la sesión de antes", async () => {
  const c = await core();
  tokenDeSesion = jwt({ session_id: "ses-logout-previa" });
  filaSuplantacion = filaActiva();
  const previa = c.empacarSesionPrevia({ rt: "rt-de-rafael", sub: "sb-rafael", clinica: null });
  const logout = await import("../../../app/api/auth/logout/route");
  const r = await logout.POST(new Request("http://dev.local/api/auth/logout", {
    method: "POST", headers: { cookie: `otra=1; ${c.COOKIE_SESION_PREVIA}=${previa}` },
  }));
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location") ?? "", /\/admin\/clinics\/c1$/);
  assert.deepEqual(canjes, ["rt-de-rafael"]);
  assert.deepEqual(signOuts, []);
  assert.equal(cookie(r, "df_2fa"), null, "no toca la prueba de 2FA de la sesión propia");
  // Y el navegador no hace después un signOut global que revocaría la sesión devuelta.
  const { volvioDeVerComo } = await import("../../auth/cerrar-sesion-panel");
  assert.equal(volvioDeVerComo({ redirected: true, url: "http://dev.local/admin/clinics/c1" }), true);
  assert.equal(volvioDeVerComo({ redirected: true, url: "http://dev.local/login" }), false);
  assert.equal(volvioDeVerComo(null), false);
  const pie = readFileSync(join(__dirname, "..", "..", "..", "components", "dashboard", "sidebar.tsx"), "utf8");
  assert.match(pie, /return cerrarSesionDelPanel\("Sidebar"\)/);
});

test("punto 1, núcleo: copia de la sesión previa, sub del token y qué hacer al entrar", async () => {
  const c = await core();
  const s = { rt: "r", sub: "u", clinica: null };
  assert.deepEqual(c.desempacarSesionPrevia(c.empacarSesionPrevia(s)), s);
  assert.equal(c.desempacarSesionPrevia("basura"), null);
  assert.equal(c.desempacarSesionPrevia(Buffer.from(JSON.stringify({ rt: "", sub: "u" })).toString("base64url")), null);
  assert.equal(c.desempacarSesionPrevia(undefined), null);
  assert.equal(c.subDelToken(jwt({ sub: "abc" })), "abc");
  assert.equal(c.subDelToken("x.y"), null);
  assert.equal(c.queHacerConLaPrevia("normal", true), "guardar");
  assert.equal(c.queHacerConLaPrevia("normal", false), "borrar");
  assert.equal(c.queHacerConLaPrevia("activa", true), "conservar");
  assert.equal(c.queHacerConLaPrevia("terminada", true), "conservar");
});

test("punto 2: una pestaña pintada con otra sesión queda desfasada", async () => {
  const c = await core();
  assert.equal(c.pestanaDesfasada("", null), false, "usuario normal: nunca");
  assert.equal(c.pestanaDesfasada("", "id-1"), true, "pintada antes de entrar");
  assert.equal(c.pestanaDesfasada("id-1", ""), true, "pintada antes de salir (o venció)");
  assert.equal(c.pestanaDesfasada("id-1", "id-2"), true, "entró a otra clínica en otra pestaña");
  assert.equal(c.pestanaDesfasada("id-1", "id-1"), false);
  const t = await import("../ver-como-pestana-textos");
  assert.match(t.textosPestanaVerComo("es").tituloAhora("Clínica QA"), /viendo como «Clínica QA»/);
  assert.match(t.textosPestanaVerComo("en-US").recargar, /Reload/);
});

test("punto 2: GET /api/admin/impersonate/estado dice la verdad del servidor", async () => {
  const estado = await import("../../../app/api/admin/impersonate/estado/route");
  tokenDeSesion = null;
  assert.deepEqual(await (await estado.GET()).json(), { activa: false });
  tokenDeSesion = jwt({ session_id: "ses-normal-estado" });
  filaSuplantacion = null;
  assert.deepEqual(await (await estado.GET()).json(), { activa: false });
  (await lib())._reiniciarCacheSuplantacion();
  tokenDeSesion = jwt({ session_id: "ses-activa-estado" });
  filaSuplantacion = filaActiva();
  const j = await (await estado.GET()).json();
  assert.equal(j.activa, true);
  assert.equal(j.id, "i3");
  assert.equal(j.clinica, "Clínica QA");
});

test("punto 2: el vigía va en TODA pestaña del panel, con o sin suplantación (cableado)", () => {
  const aviso = readFileSync(join(__dirname, "..", "..", "..", "components", "dashboard", "aviso-suplantacion.tsx"), "utf8");
  assert.match(aviso, /if \(!s\) return <VigiaVerComo clave="" \/>;/);
  assert.match(aviso, /<VigiaVerComo clave=\{s\.id\} \/>/);
  const vigia = readFileSync(join(__dirname, "..", "..", "..", "components", "dashboard", "vigia-ver-como.tsx"), "utf8");
  assert.match(vigia, /^"use client";/);
  assert.match(vigia, /visibilitychange/);
  assert.match(vigia, /\/api\/admin\/impersonate\/estado/);
});

test("punto 3: «Ver como clínica» también en la lista de /admin/clinics", () => {
  const lista = readFileSync(join(__dirname, "..", "..", "..", "app", "admin", "clinics", "clinics-client.tsx"), "utf8");
  assert.match(lista, /<BotonVerComoClinica clinicId=\{clinic\.id\} size="sm" \/>/);
});

test("punto 1: gracia — una suplantación recién cerrada con «Salir» no se revoca en Supabase por una petición en vuelo", async () => {
  const c = await core();
  const base = { id: "i", adminUserId: "a", adminEmail: "e", clinicId: "c", targetUserId: "t", expiresAt: new Date(Date.now() + 3600_000) };
  assert.equal(c.revocarYa({ ...base, endedAt: null }), true, "vencida por tiempo: se revoca");
  assert.equal(c.revocarYa({ ...base, endedAt: new Date() }), false, "recién cerrada: espera");
  assert.equal(c.revocarYa({ ...base, endedAt: new Date(Date.now() - c.GRACIA_REVOCACION_MS) }), true);
  // Cableado: una petición en vuelo con el token de la recién cerrada no la revoca ni la marca.
  tokenDeSesion = jwt({ session_id: "ses-en-vuelo" });
  filaSuplantacion = { ...base, id: "i9", endedAt: new Date() };
  const { estadoSuplantacionDe } = await lib();
  const { createClient } = await import("@/lib/supabase/server");
  assert.equal((await estadoSuplantacionDe(createClient() as never)).tipo, "terminada", "el panel la corta igual");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(revocadasPorAdmin, []);
});
