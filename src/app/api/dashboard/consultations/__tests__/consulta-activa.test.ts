/**
 * LA RUTA DE "INICIAR CONSULTA" — hallazgo 26 (WS1-T5).
 *
 * Run: npm run test:consulta-activa
 *
 * El fallo, en una línea: `active-consult-provider.tsx` llamaba a
 * `/api/dashboard/consultations/active` en sus tres verbos, y esa ruta NO
 * existía — bajo `src/app/api/dashboard/` solo había activity, chat-unread,
 * home/*, route.ts, search y sidebar-counts. O sea que "Iniciar consulta" hacía
 * 404 SIEMPRE, y con él la barra de contexto del paciente, el aviso del
 * sidebar, el de la topbar, la paleta de comandos y el modal de cierre.
 *
 * Con el código de hoy este archivo entero está en rojo: el `import` de la ruta
 * revienta porque el módulo no existe.
 *
 * Lo que se fija aquí, además de que exista:
 *   · el `clinicId` sale de la SESIÓN y el paciente se resuelve contra él
 *     (un paciente de otra clínica no abre consulta: 404);
 *   · sin permiso `patients.view` no se entra — la ruta devuelve alergias y
 *     medicación, que es PHI;
 *   · 409 cuando ya hay otra consulta abierta, DEVOLVIENDO la consulta viva,
 *     que es lo que el provider necesita para repintar la barra;
 *   · volver a pulsar con el MISMO paciente no reinicia el cronómetro;
 *   · la cookie que lee el navegador no lleva PHI: solo un id.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Estado de la "base" y de las cookies ────────────────────────────────────
const db: { patients: any[] } = { patients: [] };
/** Lo que el navegador manda de vuelta en la siguiente petición. */
let jar: Record<string, string> = {};

const prismaStub: any = {
  patient: {
    findFirst: async ({ where }: any = {}) =>
      db.patients.find(
        (p) => p.id === where?.id && (!where?.clinicId || p.clinicId === where.clinicId),
      ) ?? null,
  },
};

const authCtx: any = {
  user: { id: "u1", role: "DOCTOR", clinicId: "c1", permissionsOverride: null },
};
/** Se cambia en el test de permisos. */
let permisoDenegado: any = null;

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => authCtx },
});
(mock as any).module("@/lib/auth/require-permission", {
  namedExports: { denyIfMissingPermission: () => permisoDenegado },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async (patientId: string) =>
      db.patients.some((p) => p.id === patientId)
        ? null
        : new Response(JSON.stringify({ error: "patient_not_found" }), { status: 404 }),
  },
});
(mock as any).module("next/headers", {
  namedExports: { cookies: () => ({ get: (n: string) => (jar[n] ? { value: jar[n] } : undefined) }) },
});

/** Copia a `jar` lo que el handler puso en Set-Cookie, como haría el navegador. */
function aplicarCookies(res: any) {
  for (const c of res.cookies.getAll()) {
    if (c.value === "") delete jar[c.name];
    else jar[c.name] = c.value;
  }
  return res;
}

function req(body?: any): any {
  return {
    json: async () => (body ?? {}),
    headers: new Headers(),
    url: "http://localhost/api/dashboard/consultations/active",
  };
}

beforeEach(() => {
  jar = {};
  permisoDenegado = null;
  authCtx.user = { id: "u1", role: "DOCTOR", clinicId: "c1", permissionsOverride: null };
  db.patients = [
    {
      id: "p1", clinicId: "c1", firstName: "Ana", lastName: "Ruiz",
      dob: new Date("1990-05-02T00:00:00Z"), gender: "F",
      allergies: ["Penicilina", "  "], currentMedications: [], chronicConditions: null,
    },
    {
      id: "p2", clinicId: "c1", firstName: "Beto", lastName: "Sosa",
      dob: null, gender: "M", allergies: null, currentMedications: null, chronicConditions: null,
    },
    // Paciente de OTRA clínica: nunca debe poder abrirse.
    {
      id: "px", clinicId: "c2", firstName: "Otra", lastName: "Clínica",
      dob: null, gender: null, allergies: null, currentMedications: null, chronicConditions: null,
    },
  ];
});

async function ruta() {
  return import("@/app/api/dashboard/consultations/active/route");
}

test("hallazgo 26 · la ruta existe y responde a GET, POST y DELETE", async () => {
  const r = await ruta();
  for (const verbo of ["GET", "POST", "DELETE"] as const) {
    assert.equal(typeof (r as any)[verbo], "function", `falta ${verbo}`);
  }
});

test("sin consulta abierta, GET devuelve consult: null", async () => {
  const { GET } = await ruta();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { consult: null });
});

test("POST abre la consulta y GET la devuelve hidratada", async () => {
  const { POST, GET } = await ruta();

  const abrir = aplicarCookies(await POST(req({ patientId: "p1" })));
  assert.equal(abrir.status, 200);
  const { consult } = await abrir.json();
  assert.equal(consult.patientId, "p1");
  assert.equal(consult.patientName, "Ana Ruiz");
  assert.equal(consult.patientGender, "F");
  // Las alertas se limpian igual que en el home del doctor: los vacíos fuera.
  assert.deepEqual(consult.patientAlerts.allergies, ["Penicilina"]);
  assert.equal(consult.patientAlerts.medications, undefined);
  assert.ok(!Number.isNaN(Date.parse(consult.startedAt)));

  const leer = await GET();
  const leido = (await leer.json()).consult;
  assert.equal(leido.id, consult.id);
  assert.equal(leido.patientId, "p1");
});

test("la cookie que el navegador puede leer NO lleva PHI: solo un id", async () => {
  const { POST } = await ruta();
  aplicarCookies(await POST(req({ patientId: "p1" })));

  const visible = jar["activeConsultId"];
  assert.ok(visible, "el provider mira activeConsultId antes de pedir nada");
  // Es el gancho del provider, no un almacén: ni id de paciente, ni nombre.
  assert.ok(!visible.includes("p1"), "no debe llevar el id del paciente");
  assert.ok(!/ana|ruiz/i.test(visible), "no debe llevar el nombre del paciente");
});

test("un paciente de OTRA clínica no abre consulta (aislamiento por clinicId)", async () => {
  const { POST } = await ruta();
  const res = aplicarCookies(await POST(req({ patientId: "px" })));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "patient_not_found");
  assert.equal(jar["activeConsultState"], undefined, "no se escribe cookie de un rechazo");
});

test("ya hay otra consulta abierta → 409 CON la consulta viva (lo que espera el provider)", async () => {
  const { POST } = await ruta();
  aplicarCookies(await POST(req({ patientId: "p1" })));

  const choque = await POST(req({ patientId: "p2" }));
  assert.equal(choque.status, 409);
  const body = await choque.json();
  assert.equal(body.consult.patientId, "p1", "devuelve la que YA estaba abierta");
});

test("volver a pulsar con el mismo paciente no reinicia el cronómetro", async () => {
  const { POST } = await ruta();
  const uno = aplicarCookies(await POST(req({ patientId: "p1" })));
  const primero = (await uno.json()).consult;

  const dos = aplicarCookies(await POST(req({ patientId: "p1" })));
  const segundo = (await dos.json()).consult;

  assert.equal(dos.status, 200, "el mismo paciente no es un choque");
  assert.equal(segundo.startedAt, primero.startedAt, "el cronómetro sigue donde iba");
  assert.equal(segundo.id, primero.id);
});

test("DELETE cierra la consulta y limpia las dos cookies", async () => {
  const { POST, DELETE, GET } = await ruta();
  aplicarCookies(await POST(req({ patientId: "p1" })));

  const cerrar = aplicarCookies(await DELETE());
  assert.equal(cerrar.status, 200);
  assert.equal(jar["activeConsultId"], undefined);
  assert.equal(jar["activeConsultState"], undefined);
  assert.deepEqual(await (await GET()).json(), { consult: null });
});

test("cookie huérfana (cambio de sede, paciente sin acceso) → null y se limpia sola", async () => {
  const { POST, GET } = await ruta();
  aplicarCookies(await POST(req({ patientId: "p1" })));

  // El usuario cambia a otra sede: el paciente de la cookie ya no es de su clínica.
  authCtx.user = { ...authCtx.user, clinicId: "c2" };

  const res = aplicarCookies(await GET());
  assert.deepEqual(await res.json(), { consult: null });
  assert.equal(jar["activeConsultState"], undefined, "la cookie vieja no se queda dando vueltas");
});

test("sin permiso patients.view no se entra (la ruta devuelve alergias y medicación)", async () => {
  const { GET, POST, DELETE } = await ruta();
  permisoDenegado = new Response(JSON.stringify({ error: "Permiso requerido: patients.view" }), { status: 403 });

  assert.equal((await GET()).status, 403);
  assert.equal((await POST(req({ patientId: "p1" }))).status, 403);
  assert.equal((await DELETE()).status, 403);
});

test("POST sin patientId → 400, no 500", async () => {
  const { POST } = await ruta();
  assert.equal((await POST(req({}))).status, 400);
  assert.equal((await POST(req({ patientId: "   " }))).status, 400);
});
