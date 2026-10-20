/**
 * Google Calendar → agenda (WS1-T9), cuarta vuelta de la revisión t8, N4-G1:
 * al reconectar Google, el aviso viejo («Google no deja leer…») se va sin
 * recargar. Se EJECUTAN el callback de OAuth (`GET /api/google/callback`) y
 * la ruta que alimenta el aviso (`POST /api/google/agenda/sincronizar`), con
 * la base de mentira, una Google falsa en los puertos de la entrada y dobles
 * de la sesión y del intercambio de tokens.
 *
 * `npm run test:google-entrante`
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { firmaEquipo } from "../entrante-core";
import {
  activos, bandera, CAL, clinica, conGoogle, db, deGoogle, enGoogle, hace, prisma, reiniciar, type Fila,
} from "./base-de-mentira";

const m = mock as any;
m.module("@/lib/prisma", { namedExports: { prisma } });
// La sesión de quien vuelve de Google: el admin de la clínica c1.
m.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "sb-admin" } } }) } }) },
});
m.module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => ({ user: { id: "u-admin", role: "ADMIN" }, clinic: { id: "c1" } }) },
});
m.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
m.module("@/lib/google-calendar-estado", {
  namedExports: { limpiarGoogleCaido: async () => undefined, marcarGoogleCaido: async () => undefined },
});
/** Si Google deja crear o encontrar el calendario de la clínica al reconectar. */
let calendarioAlReconectar: "ok" | "falla" = "ok";
// El intercambio de tokens con Google, con el permiso de Calendar concedido.
const idToken = `x.${Buffer.from(JSON.stringify({ email: "clinica.salamanca@gmail.com" })).toString("base64")}.y`;
m.module("@/lib/google-calendar", {
  namedExports: {
    TIMEOUT_GOOGLE_MS: 10_000,
    getOAuthClient: () => ({
      getToken: async () => ({ tokens: { access_token: "at-nuevo", refresh_token: "rt-nuevo", scope: "calendar", id_token: idToken } }),
      setCredentials: () => undefined,
      on: () => undefined,
    }),
    verifyState: (s: string) => (s === "firmado" ? "u-admin" : null),
    permisoDeCalendarConcedido: () => true,
    crearClienteCalendar: () => ({}),
    asegurarCalendarioDeClinica: async () => {
      if (calendarioAlReconectar === "falla") throw new Error("calendarList: 403");
      return { id: CAL };
    },
  },
});

// El callback busca al usuario con su clínica (relación): la base de mentira no tiene findUnique de users.
prisma.user = {
  ...prisma.user,
  findUnique: async (a: Fila) => {
    const u = db.usuarios.find((x) => x.id === a.where.id);
    if (!u) return null;
    const c = db.clinics.get(u.clinicId)!;
    return { id: u.id, role: u.role, clinicId: u.clinicId, clinic: { ...c, name: "Centro Dental" } };
  },
};

async function volverDeGoogle() {
  // (`conGoogle` la quita para que el canal de avisos no llame a la Google real.)
  process.env.NEXT_PUBLIC_APP_URL = "https://app.dalecontrol.mx";
  process.env.GOOGLE_REDIRECT_URI = "https://app.dalecontrol.mx/api/google/callback";
  const { GET } = await import("@/app/api/google/callback/route");
  const req = new NextRequest("https://app.dalecontrol.mx/api/google/callback?code=c0d1g0&state=firmado", {
    headers: { host: "app.dalecontrol.mx", cookie: "sb-proyecto-auth-token=1" },
  });
  return GET(req);
}
async function abrirConfiguracion(): Promise<Fila> {
  const { POST } = await import("@/app/api/google/agenda/sincronizar/route");
  return (await POST()).json();
}

/** Más de un día con «permisos»: el cron ya retiró, y acaba de fallar otra vez (hace 10 s). */
function escenario(rol = "ADMIN") {
  reiniciar();
  calendarioAlReconectar = "ok";
  clinica("c1", { googleCalendarEmail: "clinica.salamanca@gmail.com" });
  bandera("c1", {
    syncToken: null, lastFullSyncAt: null, lastSyncAt: hace(30), lastError: "permisos",
    lastErrorAt: new Date(Date.now() - 10_000), equipoFirma: firmaEquipo([]),
  });
  const b1 = deGoogle("b1", "e1");
  b1.deletedAt = hace(5);
  db.usuarios.push({ id: "u-admin", clinicId: "c1", supabaseId: "sb-admin", isActive: true, role: rol, email: "admin@clinica.mx" });
  return b1;
}

test("N4-G1: sin reconectar, Configuración enseña el aviso (y el freno de 60 s no repite la pasada)", async () => {
  escenario();
  const g = await conGoogle(async () => { throw new Error("no debería llamar a Google"); });
  try {
    const e = await abrirConfiguracion();
    assert.equal(e.retiro?.causa, "permisos");
    assert.equal(g.pedidas.length, 0, "hubo un intento hace 10 s: no se repite");
  } finally {
    g.restaurar();
  }
});

test("N4-G1: el admin reconecta Google → al volver a Configuración ya NO sale el aviso viejo (antes: «Google no deja leer…» junto a «Cuenta conectada» hasta recargar)", async () => {
  const b1 = escenario();
  const g = await conGoogle(async () => ({ data: { items: [enGoogle("e1", b1)], nextSyncToken: "tok-nuevo" } }));
  try {
    const res = await volverDeGoogle();
    assert.equal(res.headers.get("location"), "https://app.dalecontrol.mx/dashboard/settings?tab=integraciones&gcal=success");
    const f = db.imports.get("c1")!;
    assert.equal(f.lastError, null, "el error era de la conexión vieja");
    assert.equal(f.lastErrorAt, null, "y su hora ya no frena la pasada");
    assert.equal(db.clinics.get("c1")!.googleRefreshToken, "rt-nuevo");

    const e = await abrirConfiguracion();
    assert.equal(g.pedidas.length, 1, "Configuración sincronizó al volver");
    assert.ok(g.pedidas[0].timeMin, "completa (tras el retiro)");
    assert.equal(e.retiro, null, "sin aviso viejo");
    assert.equal(e.conectada, true);
    assert.deepEqual(activos(), ["b1"], "e1 sigue ocupado en Google: vuelve a cerrar");
  } finally {
    g.restaurar();
  }
});

test("N4-G1: si tras reconectar Google sigue sin dejar leer, el aviso vuelve con la causa de AHORA (no se esconde)", async () => {
  escenario();
  const g = await conGoogle(async () => { throw { response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } }; });
  try {
    await volverDeGoogle();
    const e = await abrirConfiguracion();
    assert.equal(g.pedidas.length, 1);
    assert.equal(e.retiro?.causa, "permisos");
  } finally {
    g.restaurar();
  }
});

test("N4-G1 (refutador): una pasada que empezó con el token VIEJO y falla después de reconectar no vuelve a dejar el aviso viejo", async () => {
  escenario();
  const { sincronizarCalendarioEntrante } = await import("../entrante.server");
  db.imports.get("c1")!.lastErrorAt = hace(1); // sin freno: el cron corre una pasada
  let vez = 0;
  const g = await conGoogle(async () => {
    vez++;
    if (vez === 1) {
      // Mientras esta pasada espera a Google, el admin reconecta…
      await volverDeGoogle();
      // …y la respuesta, para el token viejo, es el mismo 403.
      throw { response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } };
    }
    return { data: { items: [], nextSyncToken: "tok-nuevo" } };
  });
  try {
    const r = await sincronizarCalendarioEntrante("c1");
    assert.equal(r.estado, "fallo");
    assert.equal(db.imports.get("c1")!.lastError, null, "el fallo era de la conexión vieja");
    assert.equal(db.imports.get("c1")!.lastErrorAt, null);
    const e = await abrirConfiguracion();
    assert.equal(vez, 2, "Configuración sincroniza con la conexión nueva");
    assert.equal(e.retiro, null);
  } finally {
    g.restaurar();
  }
});

test("N4-G1 (refutador): reconecta pero Google no deja crear el calendario de la clínica → el aviso dice «calendario», no el error viejo", async () => {
  escenario();
  calendarioAlReconectar = "falla";
  const g = await conGoogle(async () => { throw new Error("sin calendario no se llama a Google"); });
  try {
    const res = await volverDeGoogle();
    assert.equal(res.headers.get("location"), "https://app.dalecontrol.mx/dashboard/settings?tab=integraciones&gcal=error&motivo=calendario");
    const e = await abrirConfiguracion();
    assert.equal(g.pedidas.length, 0);
    assert.equal(e.retiro?.causa, "calendario");
  } finally {
    g.restaurar();
  }
});

test("N4-G1 (refutador): quien NO es admin conecta su Google personal → el error de la conexión de la clínica no se toca", async () => {
  escenario("DOCTOR");
  const res = await volverDeGoogle();
  assert.equal(res.headers.get("location"), "https://app.dalecontrol.mx/dashboard/settings?tab=integraciones&gcal=success");
  assert.equal(db.imports.get("c1")!.lastError, "permisos");
  assert.ok(db.imports.get("c1")!.lastErrorAt instanceof Date);
});

