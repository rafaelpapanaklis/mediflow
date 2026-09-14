/**
 * Sabina en Equipo — las rutas.
 *
 * `npm run test:sabina-permisos-equipo`
 *
 *  · GET/PATCH /api/team/[id]/sabina-permissions con las cuatro defensas de
 *    PATCH /api/team/[id]/permissions: solo SUPER_ADMIN, objetivo de la clínica
 *    de la sesión, nunca otro SUPER_ADMIN, audit log en cada cambio. Y lo que
 *    pasa si el .sql todavía no se aplicó.
 *  · POST /api/sabina con Sabina apagada: 403 con la frase, sin llamar al modelo
 *    y sin tocar el monedero.
 *
 * Dobles: la sesión, Prisma (usuarios + la tabla nueva), la bitácora, el
 * monedero y el historial. Los handlers son los de verdad.
 */
import "../engine-sin-server-only"; // PRIMERO: la ruta de Sabina arrastra "server-only"
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/auth/permissions";
import { FRASE_SABINA_APAGADA } from "../permisos-sabina";

const CL = "cl-mia";
const CL_OTRA = "cl-otra";

interface FilaUsuario {
  id: string;
  clinicId: string;
  role: string;
  permissionsOverride: string[];
}
interface FilaSabina {
  userId: string;
  clinicId: string;
  enabled: boolean;
  permissions: string[];
  updatedById?: string | null;
}

const estado = {
  sesion: null as any,
  usuarios: [] as FilaUsuario[],
  sabina: [] as FilaSabina[],
  sinTabla: false,
  bitacora: [] as any[],
  upserts: [] as any[],
  consultasUsuario: [] as any[],
  lecturasSabina: [] as any[],
  alModelo: 0,
  alMonedero: 0,
};

function tablaAusente() {
  return Object.assign(new Error("The table `public.sabina_user_permissions` does not exist in the current database."), {
    code: "P2021",
  });
}

const prismaDoble: any = {
  user: {
    findFirst: async ({ where }: any) => {
      estado.consultasUsuario.push(where);
      const u = estado.usuarios.find((x) => x.id === where.id && x.clinicId === where.clinicId);
      return u ? { ...u } : null;
    },
  },
  sabinaUserPermission: {
    findFirst: async ({ where }: any) => {
      estado.lecturasSabina.push(where);
      if (estado.sinTabla) throw tablaAusente();
      const f = estado.sabina.find((x) => x.userId === where.userId && x.clinicId === where.clinicId);
      return f ? { enabled: f.enabled, permissions: [...f.permissions] } : null;
    },
    upsert: async (args: any) => {
      if (estado.sinTabla) throw tablaAusente();
      estado.upserts.push(args);
      const i = estado.sabina.findIndex((x) => x.userId === args.where.userId);
      if (i >= 0) estado.sabina[i] = { ...estado.sabina[i], ...args.update };
      else estado.sabina.push({ ...args.create });
      return {};
    },
  },
};

function sesion(role: string, over: Record<string, unknown> = {}) {
  return {
    userId: "us-dueno",
    clinicId: CL,
    role,
    permissionsOverride: [],
    clinic: { timezone: "America/Mexico_City", category: "DENTAL" },
    isSuperAdmin: role === "SUPER_ADMIN",
    isAdmin: role === "SUPER_ADMIN" || role === "ADMIN",
    ...over,
  };
}

let GET: (id: string) => Promise<Response>;
let PATCH: (id: string, body: unknown) => Promise<Response>;
let preguntar: (texto: string) => Promise<Response>;

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
  globalThis.fetch = (async () => {
    estado.alModelo += 1;
    throw new Error("con Sabina apagada no se llama a nadie");
  }) as typeof fetch;

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => estado.sesion } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", {
    namedExports: {
      ...auditReal,
      logMutation: async (opts: any) => {
        estado.bitacora.push(opts);
      },
    },
  });
  mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
  mock.module("@/lib/ai-billing/wallet", {
    namedExports: {
      canSpend: async () => {
        estado.alMonedero += 1;
        return true;
      },
      chargeUsage: async () => {
        estado.alMonedero += 1;
        return { billedCents: 0, balanceAfterCents: 0, eventId: "ev" };
      },
    },
  });
  mock.module("@/lib/ai-assistant/conversations", { namedExports: { isAiHistoryStorageMissing: () => false } });
  mock.module("@/lib/sabina/engine-historial", {
    namedExports: {
      leerConversacionSabina: async () => null,
      crearConversacionSabina: async () => "conv_1",
      anexarTurnosSabina: async () => true,
      listarConversacionesSabina: async () => [],
    },
  });

  const { NextRequest } = await import("next/server");
  const equipo = await import("@/app/api/team/[id]/sabina-permissions/route");
  const sabina = await import("@/app/api/sabina/route");
  GET = (id) => equipo.GET(new NextRequest(`http://app.test/api/team/${id}/sabina-permissions`), { params: { id } });
  PATCH = (id, body) =>
    equipo.PATCH(
      new NextRequest(`http://app.test/api/team/${id}/sabina-permissions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: { id } },
    );
  preguntar = (texto) =>
    sabina.POST(
      new NextRequest("http://app.test/api/sabina", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta: texto }),
      }),
    );
});

beforeEach(() => {
  Object.assign(estado, {
    sesion: sesion("SUPER_ADMIN"),
    usuarios: [
      { id: "us-doc", clinicId: CL, role: "DOCTOR", permissionsOverride: [] },
      { id: "us-dueno", clinicId: CL, role: "SUPER_ADMIN", permissionsOverride: [] },
      { id: "us-otro-super", clinicId: CL, role: "SUPER_ADMIN", permissionsOverride: [] },
      { id: "us-ajeno", clinicId: CL_OTRA, role: "DOCTOR", permissionsOverride: [] },
    ],
    sabina: [],
    sinTabla: false,
    bitacora: [],
    upserts: [],
    consultasUsuario: [],
    lecturasSabina: [],
    alModelo: 0,
    alMonedero: 0,
  });
});

/* ── las cuatro defensas ────────────────────────────────────────────── */

test("🔴 defensa 1: solo SUPER_ADMIN — un ADMIN no lee ni guarda, y no se toca la base", async () => {
  for (const role of ["ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"]) {
    estado.sesion = sesion(role);
    assert.equal((await GET("us-doc")).status, 403, role);
    assert.equal((await PATCH("us-doc", { sabinaEnabled: false, sabinaPermissions: null })).status, 403, role);
  }
  assert.equal(estado.upserts.length, 0);
  assert.equal(estado.consultasUsuario.length, 0);
  estado.sesion = null;
  assert.equal((await PATCH("us-doc", { sabinaEnabled: false, sabinaPermissions: null })).status, 401);
});

test("🔴 defensa 2: el usuario de OTRA clínica no existe para esta sesión (404), y el filtro es el clinicId de la sesión", async () => {
  assert.equal((await GET("us-ajeno")).status, 404);
  assert.equal((await PATCH("us-ajeno", { sabinaEnabled: false, sabinaPermissions: null })).status, 404);
  assert.ok(estado.consultasUsuario.every((w) => w.clinicId === CL), JSON.stringify(estado.consultasUsuario));
  assert.equal(estado.upserts.length, 0);
});

test("🔴 defensa 3: no se tocan los permisos de Sabina de otro SUPER_ADMIN", async () => {
  assert.equal((await GET("us-otro-super")).status, 400);
  assert.equal((await PATCH("us-otro-super", { sabinaEnabled: false, sabinaPermissions: null })).status, 400);
  assert.equal(estado.upserts.length, 0);
});

test("🔴 defensa 4: cada cambio queda en el audit log, con antes y después; la clínica sale de la sesión", async () => {
  const r = await PATCH("us-doc", { sabinaEnabled: true, sabinaPermissions: ["agenda.view", "billing.view", "inventado.key"] });
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.deepEqual(cuerpo.sabinaPermissions, ["agenda.view", "billing.view"], "sanitizePermissionKeys descarta lo inventado");
  assert.deepEqual(cuerpo.permisosDeSabina, ["agenda.view", "billing.view"]);

  assert.equal(estado.upserts.length, 1);
  const up = estado.upserts[0];
  assert.equal(up.where.userId, "us-doc");
  assert.equal(up.create.clinicId, CL);
  assert.equal(up.update.clinicId, CL);
  assert.equal(up.update.updatedById, "us-dueno");

  assert.equal(estado.bitacora.length, 1);
  const b = estado.bitacora[0];
  assert.equal(b.clinicId, CL);
  assert.equal(b.userId, "us-dueno");
  assert.equal(b.entityType, "user");
  assert.equal(b.entityId, "us-doc");
  assert.equal(b.action, "update");
  assert.deepEqual(b.before, { sabinaEnabled: true, sabinaPermissions: [] });
  assert.deepEqual(b.after, { sabinaEnabled: true, sabinaPermissions: ["agenda.view", "billing.view"], sabinaSameAsUser: false });

  // Apagarla también deja rastro, con el antes que se acaba de guardar.
  await PATCH("us-doc", { sabinaEnabled: false, sabinaPermissions: ["agenda.view", "billing.view"] });
  assert.equal(estado.bitacora.length, 2);
  assert.deepEqual(estado.bitacora[1].before, { sabinaEnabled: true, sabinaPermissions: ["agenda.view", "billing.view"] });
  assert.equal(estado.bitacora[1].after.sabinaEnabled, false);
});

/* ── el cuerpo ──────────────────────────────────────────────────────── */

test("🔴 una lista vacía se rechaza: desmarcarlo todo NO puede significar «todo lo del usuario»", async () => {
  const vacia = await PATCH("us-doc", { sabinaEnabled: true, sabinaPermissions: [] });
  assert.equal(vacia.status, 400);
  assert.match((await vacia.json()).error, /apágala/);
  const soloInventadas = await PATCH("us-doc", { sabinaEnabled: true, sabinaPermissions: ["billing.read"] });
  assert.equal(soloInventadas.status, 400);
  // `in` deja pasar las del prototipo; aquí no.
  const prototipo = await PATCH("us-doc", { sabinaEnabled: true, sabinaPermissions: ["constructor", "toString"] });
  assert.equal(prototipo.status, 400);
  assert.equal((await PATCH("us-doc", { sabinaEnabled: "no", sabinaPermissions: null })).status, 400);
  assert.equal((await PATCH("us-doc", { sabinaEnabled: true, sabinaPermissions: "agenda.view" })).status, 400);
  assert.equal(estado.upserts.length, 0);

  // null = «lo mismo que el usuario».
  const mismo = await PATCH("us-doc", { sabinaEnabled: true, sabinaPermissions: null });
  assert.equal(mismo.status, 200);
  assert.deepEqual(estado.upserts[0].update.permissions, []);
});

test("GET: lo que el usuario puede lo calcula el servidor con la función del candado", async () => {
  estado.sabina.push({ userId: "us-doc", clinicId: CL, enabled: true, permissions: ["agenda.view", "billing.refund"] });
  const r = await GET("us-doc");
  assert.equal(r.status, 200);
  const c = await r.json();
  assert.equal(c.disponible, true);
  assert.equal(c.sabinaEnabled, true);
  assert.deepEqual(c.permisosDelUsuario, ROLE_DEFAULT_PERMISSIONS.DOCTOR);
  // billing.refund está marcada, pero el doctor no reembolsa: Sabina tampoco.
  assert.deepEqual(c.permisosDeSabina, ["agenda.view"]);
  assert.deepEqual(estado.lecturasSabina.at(-1), { userId: "us-doc", clinicId: CL });
  assert.equal(c.sabinaSameAsUser, false);
});

test("🔴 GET: una lista guardada de keys retiradas del catálogo NO se pinta como «lo mismo que el usuario»", async () => {
  // Si se pintara así, un Guardar sin tocar nada mandaría null y Sabina, que hoy
  // no puede nada, recuperaría todo.
  estado.sabina.push({ userId: "us-doc", clinicId: CL, enabled: true, permissions: ["billing.read", "arco.read"] });
  const c = await (await GET("us-doc")).json();
  assert.deepEqual(c.sabinaPermissions, []);
  assert.equal(c.sabinaSameAsUser, false);
  assert.deepEqual(c.permisosDeSabina, []);

  estado.sabina = [];
  assert.equal((await (await GET("us-doc")).json()).sabinaSameAsUser, true, "sin fila, sí es «lo mismo»");
});

test("🔴 sin el .sql aplicado: GET avisa (disponible: false) y PATCH no finge que guardó (503)", async () => {
  estado.sinTabla = true;
  const g = await GET("us-doc");
  assert.equal(g.status, 200);
  const c = await g.json();
  assert.equal(c.disponible, false);
  assert.match(c.aviso, /sql\/sabina-permisos\.sql/);
  assert.deepEqual(c.permisosDeSabina, ROLE_DEFAULT_PERMISSIONS.DOCTOR, "sin tabla, lo de siempre");

  const p = await PATCH("us-doc", { sabinaEnabled: false, sabinaPermissions: null });
  assert.equal(p.status, 503);
  assert.equal((await p.json()).disponible, false);
  assert.equal(estado.bitacora.length, 0, "no se registró un cambio que no ocurrió");
});

/* ── la pantalla de Sabina ──────────────────────────────────────────── */

test("🔴 POST /api/sabina con Sabina apagada: 403 con la frase, sin modelo y sin monedero", async () => {
  estado.sesion = sesion("DOCTOR", { userId: "us-doc", isSuperAdmin: false, isAdmin: false });
  estado.sabina.push({ userId: "us-doc", clinicId: CL, enabled: false, permissions: [] });
  const r = await preguntar("¿cuántas citas tengo hoy?");
  assert.equal(r.status, 403);
  const c = await r.json();
  assert.equal(c.sabinaApagada, true);
  assert.equal(c.error, FRASE_SABINA_APAGADA);
  assert.equal(estado.alModelo, 0);
  assert.equal(estado.alMonedero, 0);
});

test("POST /api/sabina: si no se pueden leer los ajustes, 503 «no disponible» y no se pregunta al modelo", async () => {
  estado.sesion = sesion("DOCTOR", { userId: "us-doc", isSuperAdmin: false, isAdmin: false });
  const original = prismaDoble.sabinaUserPermission.findFirst;
  prismaDoble.sabinaUserPermission.findFirst = async () => {
    throw Object.assign(new Error("Timed out fetching a new connection"), { code: "P2024" });
  };
  try {
    const r = await preguntar("¿cuántas citas tengo hoy?");
    assert.equal(r.status, 503);
    assert.equal(estado.alModelo, 0);
    assert.equal(estado.alMonedero, 0);
  } finally {
    prismaDoble.sabinaUserPermission.findFirst = original;
  }
});
