/**
 * Auditoría de seguridad ola 3 (run-3), ALTA: pre-secuestro de la cuenta del
 * portal del paciente.
 *
 * Run: npm run test:seg-portal-pre-secuestro
 *   (--experimental-test-module-mocks: se ejecutan de verdad register, verify,
 *    verify/resend, login, password/forgot, password/reset y el PATCH de profile,
 *    con bcrypt, sesiones, auto-link y correos reales del repo; solo Prisma
 *    (memoria), las cookies, el envío de correo y los frenos de abuso son dobles.)
 *
 * Con d5e69b807 (y en producción): quien sabía el correo V de un paciente con
 * la cuenta SIN verificar volvía a registrarla con SU contraseña; la víctima
 * tecleaba el código más reciente (o pulsaba «Reenviar código») y la cuenta
 * quedaba verificada, ligada a todos sus expedientes y con la contraseña del
 * atacante, que entraba 30 días. Cambiar la contraseña desde el perfil no lo
 * sacaba.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const V = "victima@correo.test";
const PV = "ContraseñaDeLaVictima1";
const PA = "ContraseñaDelAtacante1";

let cuentas: any[] = [];
let sesiones: Array<{ accountId: string; tokenHash: string; expiresAt: Date }> = [];
let enlaces: Array<{ accountId: string; patientId: string; clinicId: string }> = [];
let correos: Array<{ to: string; subject: string; text: string }> = [];
let cookieDelNavegador: string | null = null;
const pacientes = [
  { id: "pacA", clinicId: "cliA", email: V, deletedAt: null },
  { id: "pacB", clinicId: "cliB", email: V, deletedAt: null },
];

beforeEach(() => {
  cuentas = [];
  sesiones = [];
  enlaces = [];
  correos = [];
  cookieDelNavegador = null;
});

let n = 0;
function aplica(c: any, data: any) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as any)) c[k] = (c[k] ?? 0) + (v as any).increment;
    else c[k] = v;
  }
  return c;
}
const cuentaPor = (where: any) =>
  cuentas.find((c) =>
    (where.email === undefined || c.email === where.email) &&
    (where.id === undefined || c.id === where.id) &&
    (where.resetTokenHash === undefined || c.resetTokenHash === where.resetTokenHash) &&
    (where.resetTokenExpiry?.gt === undefined || (c.resetTokenExpiry && c.resetTokenExpiry > where.resetTokenExpiry.gt)),
  ) ?? null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patientAccount: {
        findUnique: async ({ where }: any) => (cuentaPor(where) ? { ...cuentaPor(where) } : null),
        findFirst: async ({ where }: any) => (cuentaPor(where) ? { ...cuentaPor(where) } : null),
        create: async ({ data }: any) => {
          const c = { id: `acc${++n}`, emailVerified: false, verifyAttempts: 0, passwordHash: null, name: "", ...data };
          cuentas.push(c);
          return { ...c };
        },
        update: async ({ where, data }: any) => ({ ...aplica(cuentaPor(where), data) }),
      },
      patientAccountSession: {
        create: async ({ data }: any) => { sesiones.push(data); return data; },
        deleteMany: async ({ where }: any) => {
          const antes = sesiones.length;
          sesiones = sesiones.filter((s) => !((where.accountId && s.accountId === where.accountId) || (where.tokenHash && s.tokenHash === where.tokenHash)));
          return { count: antes - sesiones.length };
        },
        findUnique: async ({ where }: any) => {
          const s = sesiones.find((x) => x.tokenHash === where.tokenHash);
          if (!s) return null;
          const c = cuentas.find((x) => x.id === s.accountId);
          return {
            expiresAt: s.expiresAt,
            account: {
              id: c.id, name: c.name, email: c.email, phone: c.phone ?? null,
              links: enlaces.filter((l) => l.accountId === c.id).map((l) => ({ patientId: l.patientId, clinicId: l.clinicId, patient: { email: V } })),
            },
          };
        },
      },
      patient: {
        findMany: async ({ where }: any) =>
          pacientes.filter((p) => p.email.toLowerCase() === String(where.email.equals).toLowerCase()).map((p) => ({ id: p.id, clinicId: p.clinicId })),
      },
      patientAccountLink: {
        createMany: async ({ data }: any) => {
          let k = 0;
          for (const d of data) if (!enlaces.some((l) => l.accountId === d.accountId && l.patientId === d.patientId)) { enlaces.push(d); k++; }
          return { count: k };
        },
        findMany: async () => [],
      },
    },
  },
});
mock.module("@/lib/failban", {
  namedExports: {
    persistentRateLimit: async () => null,
    failbanGuard: async () => null,
    recordAuthFailure: async () => undefined,
    recordAuthSuccess: async () => undefined,
    AUTH_FLOOD_RATE_LIMIT: { limit: 15, windowSec: 60 },
  },
});
mock.module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
mock.module("@/lib/email", { namedExports: { sendEmail: async (m: any) => { correos.push(m); } } });
mock.module("next/headers", {
  namedExports: { cookies: async () => ({ get: () => (cookieDelNavegador ? { value: cookieDelNavegador } : undefined) }) },
});
mock.module("@/lib/movimientos-paciente/registrar", { namedExports: { registrarMovimientoExterno: async () => undefined } });

async function post(ruta: string, body: unknown, metodo = "POST") {
  const { NextRequest } = await import("next/server");
  const mod: any = await import(`@/app/api/paciente/${ruta}/route`);
  const req = new NextRequest(`https://dalecontrol.test/api/paciente/${ruta}`, {
    method: metodo, body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
  } as any);
  const res = await mod[metodo](req);
  const cookie = res.cookies.get("patient_session")?.value ?? null;
  return { status: res.status, body: await res.json().catch(() => ({})), cookie };
}
const registrar = (password: string) => post("register", { name: "Valeria Ruiz", email: V, phone: "5512345678", password });
const ultimoCodigo = () => {
  const m = [...correos].reverse().find((c) => /\b\d{6}\b/.test(c.text));
  return m!.text.match(/\b(\d{6})\b/)![1];
};
const ultimoEnlace = () => {
  const m = [...correos].reverse().find((c) => /token=/.test(c.text));
  return m!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
};

test("ALTA · registro pendiente: el atacante vuelve a registrar el correo, la víctima verifica y el atacante NO entra", async () => {
  assert.equal((await registrar(PV)).status, 200);
  // El atacante, sin cookie ni código: misma respuesta uniforme.
  const ataque = await registrar(PA);
  assert.deepEqual(ataque.body, { ok: true, email: V });
  // La víctima pide otro código (el botón «Reenviar código») y verifica con SU contraseña.
  await post("verify/resend", { email: V });
  const ok = await post("verify", { email: V, code: ultimoCodigo(), password: PV });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(cuentas[0].emailVerified, true);
  assert.deepEqual(enlaces.map((l) => l.clinicId).sort(), ["cliA", "cliB"]);
  // El atacante no entra; la víctima sí.
  assert.equal((await post("login", { email: V, password: PA })).status, 401, "la contraseña del atacante no vale");
  assert.equal((await post("login", { email: V, password: PV })).status, 200);
});

test("ALTA · verify exige la contraseña de la cuenta: el código solo no basta", async () => {
  await registrar(PV);
  const codigo = ultimoCodigo();
  const sinPassword = await post("verify", { email: V, code: codigo });
  assert.equal(sinPassword.status, 400);
  const otraPassword = await post("verify", { email: V, code: codigo, password: PA });
  assert.equal(otraPassword.status, 400);
  assert.equal(cuentas[0].emailVerified, false, "nadie verificó la cuenta");
  assert.equal(otraPassword.cookie, null, "ni se abrió sesión");
});

test("ALTA · si el atacante registró ANTES, la víctima no se queda con su contraseña: «Olvidé mi contraseña» verifica y lo echa", async () => {
  await registrar(PA); // el atacante se adelanta
  await registrar(PV); // la víctima se registra: la credencial pendiente no cambia
  const v = await post("verify", { email: V, code: ultimoCodigo(), password: PV });
  assert.equal(v.status, 400, "con la contraseña del atacante en la fila, la víctima no verifica");
  assert.equal(cuentas[0].emailVerified, false, "y el atacante tampoco: no tiene el código");
  // La salida: el enlace de recuperación (solo llega al buzón).
  await post("password/forgot", { email: V });
  const r = await post("password/reset", { token: ultimoEnlace(), password: PV });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(cuentas[0].emailVerified, true, "el enlace del correo verifica la cuenta");
  assert.equal((await post("login", { email: V, password: PA })).status, 401);
  assert.equal((await post("login", { email: V, password: PV })).status, 200);
});

test("ALTA · cuenta invitada por la clínica: el registro del atacante no le da la cuenta; el enlace de la invitación sí a la víctima", async () => {
  // La invitación de portal-invite: sin contraseña, con token en resetToken*.
  const { sha256 } = await import("@/lib/patient-portal/crypto");
  cuentas.push({ id: "accInv", email: V, name: "Valeria", emailVerified: false, passwordHash: null, verifyAttempts: 0,
    invitedAt: new Date(), resetTokenHash: sha256("token-de-invitacion"), resetTokenExpiry: new Date(Date.now() + 86_400_000) });
  await registrar(PA); // el atacante fija su contraseña en la invitada
  const sinCodigo = await post("verify", { email: V, code: "000000", password: PA });
  assert.equal(sinCodigo.status, 400, "sin el código del buzón no verifica");
  // La víctima usa el enlace de la invitación.
  const r = await post("password/reset", { token: "token-de-invitacion", password: PV });
  assert.equal(r.status, 200);
  assert.equal(cuentas[0].emailVerified, true);
  assert.equal((await post("login", { email: V, password: PA })).status, 401);
  assert.equal((await post("login", { email: V, password: PV })).status, 200);
});

test("ALTA · cambiar la contraseña desde el perfil cierra las demás sesiones (y deja abierta la propia)", async () => {
  await registrar(PV);
  await post("verify", { email: V, code: ultimoCodigo(), password: PV });
  const otraSesion = await post("login", { email: V, password: PV }); // p. ej. la del atacante
  const estaSesion = await post("login", { email: V, password: PV });
  cookieDelNavegador = estaSesion.cookie;
  const r = await post("profile", { currentPassword: PV, newPassword: "NuevaContraseña123" }, "PATCH");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { sha256 } = await import("@/lib/patient-portal/crypto");
  assert.ok(!sesiones.some((s) => s.tokenHash === sha256(otraSesion.cookie!)), "la otra sesión ya no existe");
  assert.ok(!sesiones.some((s) => s.tokenHash === sha256(estaSesion.cookie!)), "la vieja de esta pestaña tampoco");
  assert.ok(r.cookie && sesiones.some((s) => s.tokenHash === sha256(r.cookie!)), "esta pestaña sigue dentro con una sesión nueva");
});

test("el registro normal sigue igual: alta, código + contraseña, sesión y expedientes ligados", async () => {
  const r = await registrar(PV);
  assert.deepEqual(r.body, { ok: true, email: V });
  const v = await post("verify", { email: V, code: ultimoCodigo(), password: PV });
  assert.equal(v.status, 200);
  assert.ok(v.cookie, "auto-login");
  assert.equal(enlaces.length, 2);
});
