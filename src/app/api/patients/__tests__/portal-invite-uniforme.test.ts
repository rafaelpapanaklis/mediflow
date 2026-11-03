/**
 * Seguridad (auditoría «cloudflare», nº8): «Invitar al portal» exige
 * `patients.edit` y contesta lo MISMO tenga o no tenga ya portal ese email.
 *
 * Run: npm run test:seg-portal-invite
 *   (--experimental-test-module-mocks: se ejecuta de verdad
 *    POST /api/patients/[id]/portal-invite con Prisma, la sesión, el correo, la
 *    bitácora y el freno de abuso sustituidos. Los PERMISOS son los reales.)
 *
 * Con el código de 0f61a7e0d:
 *   · un usuario de SOLO LECTURA podía invitar (no había permiso);
 *   · la respuesta decía «already_active» / «resent» / «invited» según el
 *     estado de la cuenta GLOBAL del portal: cualquier clínica sabía si un
 *     email ya es paciente con portal en DaleControl.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let rol = "RECEPTIONIST";
let cuenta: any = null;
let enlaces: any[] = [];
let correos: any[] = [];
let bitacora: any[] = [];

beforeEach(() => {
  rol = "RECEPTIONIST";
  cuenta = null;
  enlaces = [];
  correos = [];
  bitacora = [];
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patient: {
        findFirst: async () => ({ id: "pac_1", firstName: "Ana", lastName: "García", email: "ana@correo.test", phone: null }),
      },
      patientAccount: {
        findUnique: async () => cuenta,
        create: async ({ data }: any) => (cuenta = { id: "acc_1", ...data }),
        update: async ({ data }: any) => (cuenta = { ...cuenta, ...data }),
      },
      patientAccountLink: { create: async ({ data }: any) => { enlaces.push(data); return data; } },
    },
  },
});
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({
      userId: "u1", clinicId: "cli_B", role: rol, permissionsOverride: [], isAdmin: false, clinic: { name: "Clínica B" },
    }),
  },
});
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
mock.module("@/lib/email", { namedExports: { sendEmail: async (m: any) => { correos.push(m); } } });
mock.module("@/lib/patient-portal/emails", {
  namedExports: {
    buildInviteEmail: () => ({ subject: "Invitación", html: "<p>x</p>", text: "x" }),
    buildInviteExistingAccountEmail: () => ({ subject: "Ya tienes cuenta", html: "<p>y</p>", text: "y" }),
  },
});
mock.module("@/lib/audit", {
  namedExports: { logAudit: async (o: any) => { bitacora.push(o); }, extractAuditMeta: () => ({}) },
});

async function invitar() {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/patients/[id]/portal-invite/route");
  const res = await POST(new NextRequest("https://dalecontrol.test/api/patients/pac_1/portal-invite", { method: "POST" }), {
    params: Promise.resolve({ id: "pac_1" }),
  });
  return { status: res.status, body: await res.json() };
}

test("nº8 · un usuario de SOLO LECTURA ya no invita: 403, sin cuenta, sin enlace ni correo", async () => {
  rol = "READONLY";
  const r = await invitar();
  assert.equal(r.status, 403);
  assert.equal(cuenta, null);
  assert.equal(enlaces.length, 0);
  assert.equal(correos.length, 0);
});

test("nº8 · la respuesta es la MISMA con cuenta nueva, invitada pendiente o ya activa (no revela si hay portal)", async () => {
  const nueva = await invitar();

  cuenta = { id: "acc_1", email: "ana@correo.test", name: "Ana", passwordHash: null };
  const pendiente = await invitar();

  cuenta = { id: "acc_1", email: "ana@correo.test", name: "Ana", passwordHash: "hash-de-otra-clinica" };
  const activa = await invitar();

  for (const r of [nueva, pendiente, activa]) assert.equal(r.status, 200);
  assert.deepEqual(nueva.body, { ok: true, status: "invited" });
  assert.deepEqual(pendiente.body, nueva.body);
  assert.deepEqual(activa.body, nueva.body);
  // El estado real sigue en la bitácora interna.
  assert.deepEqual(bitacora.map((b) => b.changes.portalInvite.after), ["invited", "resent", "already_active"]);
});

test("nº8 · el flujo legítimo sigue: recepción invita, se crea la cuenta, se liga y sale el correo", async () => {
  const r = await invitar();
  assert.equal(r.status, 200);
  assert.equal(cuenta.email, "ana@correo.test");
  assert.equal(enlaces[0].clinicId, "cli_B");
  assert.equal(correos.length, 1);
  assert.equal(correos[0].to, "ana@correo.test");
});

// ── Revisión t12 (M2), decisión de Rafael ──────────────────────────────────
// La respuesta uniforme no bastaba: la ficha derivaba «activa» del enlace que
// se creaba igual con la cuenta ya activa, y el correo solo se esperaba cuando
// no lo estaba (el tiempo de respuesta la delataba).

test("M2 · con la cuenta YA activa no se liga el expediente (lo liga ella al entrar) y sí sale el correo «ya tienes cuenta»", async () => {
  cuenta = { id: "acc_1", email: "ana@correo.test", name: "Ana", passwordHash: "hash-de-otra-clinica" };
  const r = await invitar();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, status: "invited" });
  assert.equal(enlaces.length, 0, "sin enlace: la ficha no puede decir «activa»");
  assert.equal(correos.length, 1, "también hay correo (mismo trabajo, mismo tiempo)");
  assert.equal(correos[0].to, "ana@correo.test");
  assert.equal(correos[0].subject, "Ya tienes cuenta");
  assert.equal(cuenta.passwordHash, "hash-de-otra-clinica", "la cuenta no cambia");
});

test("M2 · sale un correo en los tres casos (nueva, pendiente y activa)", async () => {
  await invitar();
  cuenta = { id: "acc_1", email: "ana@correo.test", name: "Ana", passwordHash: null };
  await invitar();
  cuenta = { id: "acc_1", email: "ana@correo.test", name: "Ana", passwordHash: "hash" };
  await invitar();
  assert.equal(correos.length, 3);
});

test("M2 · la ficha dice «invitada» igual con una cuenta nueva que con una ya activa en otra clínica", async () => {
  const { estadoPortalEnFicha } = await import("@/lib/patient-portal/estado-en-ficha");
  // Cuenta nueva: enlace con cuenta sin contraseña.
  const nueva = estadoPortalEnFicha({ passwordHash: null }, true);
  // Cuenta ya activa: sin enlace, pero la invitación está en la bitácora de la clínica.
  const activaEnOtroLado = estadoPortalEnFicha(null, true);
  assert.equal(nueva, "invited");
  assert.equal(activaEnOtroLado, nueva);
  // Sin invitar y sin enlace: «sin cuenta». Ligada y con contraseña: «activa».
  assert.equal(estadoPortalEnFicha(null, false), "none");
  assert.equal(estadoPortalEnFicha({ passwordHash: "h" }, true), "active");
});
