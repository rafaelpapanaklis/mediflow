/**
 * Google Calendar — rutas de la conexión DE LA CLÍNICA (auditoría ws1-t2: #4, #6, #7, #9).
 * Se ejecutan los route handlers de verdad; dobles: sesión, Prisma y Google.
 *
 * `npx tsx --test --experimental-test-module-mocks src/app/api/google/__tests__/conexion-clinica.test.ts`
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const CL = "cl-1";

const estado = {
  sesion: null as any,
  usuario: { googleRefreshToken: "rt-usuario" as string | null },
  clinica: { googleCalendarEnabled: true, googleRefreshToken: "rt-clinica" as string | null, googleCalendarEmail: "c@x.mx" },
  revocados: [] as string[],
  revocarFalla: false,
  userUpdates: [] as any[],
  clinicUpdates: [] as any[],
  sqlEjecutado: [] as string[],
  tablaExiste: true,
  fila: null as any,
  consultas: [] as any[],
};

const errTabla = () => Object.assign(new Error('relation "clinic_google_status" does not exist'), { code: "P2010", meta: { code: "42P01" } });

const prismaDoble: any = {
  user: {
    findUnique: async () => ({ ...estado.usuario }),
    update: async (a: any) => { estado.userUpdates.push(a); return {}; },
  },
  clinic: {
    findUnique: async (a: any) => { estado.consultas.push(a.where); return { ...estado.clinica }; },
    update: async (a: any) => { estado.clinicUpdates.push(a); return {}; },
    updateMany: async () => ({ count: 1 }),
  },
  $executeRaw: async (q: TemplateStringsArray, ...v: unknown[]) => {
    estado.sqlEjecutado.push(q.join("?"));
    if (!estado.tablaExiste) throw errTabla();
    return 1;
  },
  $queryRaw: async () => {
    if (!estado.tablaExiste) throw errTabla();
    return estado.fila ? [estado.fila] : [];
  },
};

const sesion = (over: any = {}) => ({ userId: "us-1", clinicId: CL, role: "ADMIN", isAdmin: true, ...over });

let DELETE: () => Promise<Response>;
let ESTADO: () => Promise<Response>;
let AJUSTES: (body: unknown) => Promise<Response>;
let SINCRONIZAR: () => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => estado.sesion } });
  // Google falso: solo lo que usa revocarTokensGoogle.
  const gcReal = await import("@/lib/google-calendar");
  mock.module("@/lib/google-calendar", {
    namedExports: {
      ...gcReal,
      getOAuthClient: () => ({
        revokeToken: async (t: string) => {
          if (estado.revocarFalla) throw new Error("ECONNRESET");
          estado.revocados.push(t);
        },
      }),
    },
  });

  const { NextRequest } = await import("next/server");
  const raiz = await import("@/app/api/google/route");
  const est = await import("@/app/api/google/estado/route");
  const aj = await import("@/app/api/google/ajustes/route");
  const sy = await import("@/app/api/google/sincronizar-futuras/route");
  DELETE = () => raiz.DELETE(new NextRequest("http://app.test/api/google", { method: "DELETE" }));
  ESTADO = () => est.GET();
  AJUSTES = (body) => aj.PATCH(new NextRequest("http://app.test/api/google/ajustes", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  SINCRONIZAR = () => sy.POST();
});

beforeEach(() => {
  estado.sesion = sesion();
  estado.usuario = { googleRefreshToken: "rt-usuario" };
  estado.clinica = { googleCalendarEnabled: true, googleRefreshToken: "rt-clinica", googleCalendarEmail: "c@x.mx" };
  estado.revocados = [];
  estado.revocarFalla = false;
  estado.userUpdates = [];
  estado.clinicUpdates = [];
  estado.sqlEjecutado = [];
  estado.tablaExiste = true;
  estado.fila = null;
  estado.consultas = [];
});

/* ── #9 · desconectar ─────────────────────────────────────────────── */

test("desconectar (admin) revoca el permiso en Google, limpia la clínica y dice que los eventos se quedan", async () => {
  const res = await DELETE();
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(estado.revocados.sort(), ["rt-clinica", "rt-usuario"]);
  assert.equal(j.permisoRevocado, true);
  assert.equal(j.eventosSeQuedan, true);
  assert.equal(estado.clinicUpdates[0].where.id, CL);
  assert.equal(estado.clinicUpdates[0].data.googleRefreshToken, null);
  assert.equal(estado.clinicUpdates[0].data.googleCalendarEnabled, false);
  // El id del calendario se conserva: con el permiso estrecho no se puede buscar por nombre al reconectar.
  assert.ok(!("googleClinicCalendarId" in estado.clinicUpdates[0].data));
  assert.ok(estado.sqlEjecutado.some((s) => /UPDATE clinic_google_status/.test(s)), "desconectar a propósito limpia la marca de caída");
});

test("desconectar con la misma cuenta en usuario y clínica revoca una sola vez", async () => {
  estado.usuario.googleRefreshToken = "rt-igual";
  estado.clinica.googleRefreshToken = "rt-igual";
  await DELETE();
  assert.deepEqual(estado.revocados, ["rt-igual"]);
});

test("desconectar se completa aunque Google falle (y no afirma que revocó)", async () => {
  estado.revocarFalla = true;
  const res = await DELETE();
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.success, true);
  assert.equal(j.permisoRevocado, false);
  assert.equal(estado.clinicUpdates[0].data.googleCalendarEnabled, false, "los datos se limpian igual");
});

test("desconectar sin tabla nueva sigue funcionando", async () => {
  estado.tablaExiste = false;
  const res = await DELETE();
  assert.equal(res.status, 200);
});

test("un NO admin que «desconecta» solo toca lo suyo: ni la clínica ni su token", async () => {
  estado.sesion = sesion({ role: "DOCTOR", isAdmin: false });
  await DELETE();
  assert.equal(estado.clinicUpdates.length, 0);
  assert.deepEqual(estado.revocados, ["rt-usuario"]);
});

test("sin sesión: 401 y nada se toca", async () => {
  estado.sesion = null;
  assert.equal((await DELETE()).status, 401);
  assert.equal(estado.userUpdates.length, 0);
});

/* ── #4/#6 · estado de la clínica ──────────────────────────────────── */

test("GET estado: la clínica conectada sale «conectado» y se consulta por la clínica de la SESIÓN", async () => {
  const j = await (await ESTADO()).json();
  assert.equal(j.estado, "conectado");
  assert.deepEqual(estado.consultas, [{ id: CL }]);
});

test("GET estado: sync apagado con token guardado = «caido» aun sin la tabla nueva", async () => {
  estado.tablaExiste = false;
  estado.clinica = { googleCalendarEnabled: false, googleRefreshToken: "rt-clinica", googleCalendarEmail: "c@x.mx" };
  assert.equal((await (await ESTADO()).json()).estado, "caido");
});

test("GET estado: con marca de caída devuelve fecha y motivo", async () => {
  estado.clinica = { googleCalendarEnabled: false, googleRefreshToken: "rt", googleCalendarEmail: null };
  estado.fila = { lostAt: new Date("2026-09-30T10:00:00Z"), lostReason: "autorizacion", invitePatient: true };
  const j = await (await ESTADO()).json();
  assert.equal(j.estado, "caido");
  assert.equal(j.motivo, "autorizacion");
  assert.ok(j.caidoDesde);
});

test("GET estado: no-admin recibe 403 (no ve el aviso ni datos de la conexión)", async () => {
  estado.sesion = sesion({ role: "DOCTOR", isAdmin: false });
  assert.equal((await ESTADO()).status, 403);
});

/* ── #5 · interruptor de invitación ────────────────────────────────── */

test("PATCH ajustes: admin guarda; valor que no es booleano = 400; no-admin = 403", async () => {
  const ok = await AJUSTES({ invitarPaciente: false });
  assert.equal(ok.status, 200);
  assert.ok(estado.sqlEjecutado.some((s) => /INSERT INTO clinic_google_status \("clinicId", "invitePatient"/.test(s)));
  assert.equal((await AJUSTES({ invitarPaciente: "no" })).status, 400);
  assert.equal((await AJUSTES(null)).status, 400);
  estado.sesion = sesion({ role: "DOCTOR", isAdmin: false });
  assert.equal((await AJUSTES({ invitarPaciente: true })).status, 403);
});

test("PATCH ajustes sin la tabla nueva: 503 con el motivo, no finge que guardó", async () => {
  estado.tablaExiste = false;
  const res = await AJUSTES({ invitarPaciente: false });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).codigo, "tabla_ausente");
});

/* ── #7 · sincronizar citas futuras ────────────────────────────────── */

test("POST sincronizar-futuras: solo admin; sin sesión 401", async () => {
  estado.sesion = null;
  assert.equal((await SINCRONIZAR()).status, 401);
  estado.sesion = sesion({ role: "DOCTOR", isAdmin: false });
  assert.equal((await SINCRONIZAR()).status, 403);
});

test("POST sincronizar-futuras: llama a la función de google-sync con la clínica de la sesión", async () => {
  const llamadas: string[] = [];
  const syncReal = await import("@/lib/agenda/google-sync");
  mock.module("@/lib/agenda/google-sync", {
    namedExports: {
      ...syncReal,
      sincronizarCitasFuturasAGoogle: async (clinicId: string) => { llamadas.push(clinicId); return { creadas: 3, omitidas: 1, fallidas: 0, restantes: 2 }; },
    },
  });
  const res = await SINCRONIZAR();
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(llamadas, [CL]);
  assert.equal(j.creadas, 3);
  assert.equal(j.restantes, 2);
});
