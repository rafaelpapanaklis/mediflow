/**
 * Seguridad (auditoría «cloudflare», nº7): el acceso al portal del paciente se
 * corta cuando la clínica cambia o corrige el email del paciente.
 *
 * Run: npm run test:seg-portal-enlaces
 *   (--experimental-test-module-mocks: se ejecutan de verdad PATCH y PUT de
 *    /api/patients/[id], POST /api/arco-request (rectificación) y
 *    getPatientPortalContext, con Prisma, la sesión y las cookies sustituidas.)
 *
 * Con el código de 0f61a7e0d el enlace cuenta↔expediente no se revocaba nunca:
 * quien tuvo acceso con un email equivocado seguía viendo recetas, documentos
 * e historial del paciente después de la corrección, incluso tras una
 * rectificación ARCO.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cli_1";
const PACIENTE = "pac_1";

let paciente: any;
let cuentas: Array<{ id: string; email: string }> = [];
let enlaces: Array<{ id: string; accountId: string; patientId: string; clinicId: string }> = [];
let sesionDelPortal: string | null = null;

beforeEach(() => {
  paciente = { id: PACIENTE, clinicId: CLINICA, firstName: "Ana", lastName: "García", email: "viejo@correo.test", phone: null, deletedAt: null };
  cuentas = [
    { id: "acc_viejo", email: "viejo@correo.test" },
    { id: "acc_nuevo", email: "nuevo@correo.test" },
  ];
  enlaces = [{ id: "l1", accountId: "acc_viejo", patientId: PACIENTE, clinicId: CLINICA }];
  sesionDelPortal = null;
});

const delegados = () => ({
  patient: {
    findFirst: async ({ where }: any) => (where.id === PACIENTE && where.clinicId === CLINICA ? { ...paciente } : null),
    findUnique: async () => ({ ...paciente }),
    update: async ({ data }: any) => {
      Object.assign(paciente, data);
      return { ...paciente };
    },
  },
  patientAccountLink: {
    findMany: async ({ where }: any) =>
      enlaces
        .filter((l) => l.patientId === where.patientId && l.clinicId === where.clinicId)
        .map((l) => ({ id: l.id, account: { email: cuentas.find((c) => c.id === l.accountId)!.email } })),
    deleteMany: async ({ where }: any) => {
      const antes = enlaces.length;
      enlaces = enlaces.filter((l) => !(where.id.in.includes(l.id) && l.patientId === where.patientId && l.clinicId === where.clinicId));
      return { count: antes - enlaces.length };
    },
  },
});

const prismaFalso: any = {
  ...delegados(),
  arcoRequest: {
    create: async () => ({ id: "arco_1" }),
    update: async () => ({ id: "arco_1" }),
  },
  patientAccountSession: {
    findUnique: async () => {
      if (!sesionDelPortal) return null;
      const cuenta = cuentas.find((c) => c.id === sesionDelPortal)!;
      return {
        expiresAt: new Date(Date.now() + 3_600_000),
        account: {
          id: cuenta.id, name: "Ana", email: cuenta.email, phone: null,
          links: enlaces
            .filter((l) => l.accountId === cuenta.id)
            .map((l) => ({ patientId: l.patientId, clinicId: l.clinicId, patient: { email: paciente.email } })),
        },
      };
    },
    deleteMany: async () => ({ count: 0 }),
  },
  $transaction: async (fn: any) => fn(delegados()),
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("next/headers", {
  namedExports: { cookies: async () => ({ get: () => (sesionDelPortal ? { value: "token" } : undefined) }) },
});
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ userId: "user_1", clinicId: CLINICA, role: "ADMIN", isAdmin: true, permissionsOverride: [] }),
    buildPatientWhere: () => ({}),
  },
});
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/patient-visibility", {
  namedExports: {
    patientVisibilityAnd: () => [],
    normalizeVisibleUserIds: async () => [],
    ensureUserCanSeePatient: async () => null,
    canSeePatient: async () => true,
    assertPatientVisible: async () => null,
  },
});
mock.module("@/lib/branches", {
  namedExports: { getPatientVisibility: async () => ({ clinicIds: [CLINICA] }), sharedRecordScope: () => ({}), ownPrivateRecordsOnly: () => ({}) },
});
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {}, logAudit: async () => {} } });
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
mock.module("@/lib/whatsapp/inbox-log", { namedExports: { linkOrphanThreadsToPatient: async () => {} } });
mock.module("@/app/actions/implants/_helpers", {
  namedExports: { getImplantActionContext: async () => ({ ok: false }), loadImplantForCtx: async () => ({ ok: false }), auditImplant: async () => {} },
});

async function llamar(metodo: "PATCH" | "PUT", body: unknown) {
  const { NextRequest } = await import("next/server");
  const mod: any = await import("@/app/api/patients/[id]/route");
  const req = new NextRequest(`https://dalecontrol.test/api/patients/${PACIENTE}`, {
    method: metodo, body: JSON.stringify(body), headers: { "content-type": "application/json" },
  } as any);
  const res = await mod[metodo](req, { params: Promise.resolve({ id: PACIENTE }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function arco(payload: Record<string, unknown>) {
  const { NextRequest } = await import("next/server");
  const mod: any = await import("@/app/api/arco-request/route");
  const req = new NextRequest("https://dalecontrol.test/api/arco-request", {
    method: "POST",
    body: JSON.stringify({ patientId: PACIENTE, action: "rectification", payload, reason: "El paciente pidió corregir su correo" }),
    headers: { "content-type": "application/json" },
  } as any);
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function portalDe(cuenta: string) {
  sesionDelPortal = cuenta;
  const { getPatientPortalContext } = await import("@/lib/patient-portal/guard");
  return getPatientPortalContext();
}

test("nº7 · PATCH: cambiar el email del paciente borra el enlace de la cuenta del email viejo", async () => {
  const r = await llamar("PATCH", { email: "nuevo@correo.test" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(enlaces, [], "el enlace de acc_viejo ya no existe");
  assert.deepEqual((await portalDe("acc_viejo"))?.links, [], "y el portal ya no le da el expediente");
});

test("nº7 · PATCH: borrar el email (null) también corta el enlace", async () => {
  const r = await llamar("PATCH", { email: null });
  assert.equal(r.status, 200);
  assert.deepEqual(enlaces, []);
});

test("nº7 · PATCH: el enlace de la cuenta con el MISMO email se queda (también con otras mayúsculas)", async () => {
  enlaces.push({ id: "l2", accountId: "acc_nuevo", patientId: PACIENTE, clinicId: CLINICA });
  const r = await llamar("PATCH", { email: "Nuevo@Correo.test" });
  assert.equal(r.status, 200);
  assert.deepEqual(enlaces.map((l) => l.id), ["l2"]);
  assert.deepEqual((await portalDe("acc_nuevo"))?.links, [{ patientId: PACIENTE, clinicId: CLINICA }]);
});

test("nº7 · PATCH sin tocar el email no borra nada (el toggle de VIP, el doctor, el teléfono…)", async () => {
  const r = await llamar("PATCH", { phone: "5512345678" });
  assert.equal(r.status, 200);
  assert.deepEqual(enlaces.map((l) => l.id), ["l1"]);
});

test("nº7 · PUT (el formulario de la ficha): el email nuevo corta el enlace viejo", async () => {
  const r = await llamar("PUT", { firstName: "Ana", lastName: "García", email: "nuevo@correo.test" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(enlaces, []);
});

test("nº7 · rectificación ARCO del email: corta el enlace de la cuenta del email anterior", async () => {
  const r = await arco({ email: "nuevo@correo.test" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(enlaces, []);
});

test("nº7 · el guard del portal no da un expediente cuyo email ya no es el de la cuenta (aunque la fila del enlace siga)", async () => {
  // El estado que dejaba el código viejo: email cambiado, enlace intacto.
  paciente.email = "nuevo@correo.test";
  const ctx = await portalDe("acc_viejo");
  assert.ok(ctx, "la sesión sigue siendo válida");
  assert.deepEqual(ctx!.links, [], "pero sin el expediente");
  // Con el email que sí coincide, el expediente se ve como siempre.
  paciente.email = "VIEJO@correo.test";
  assert.deepEqual((await portalDe("acc_viejo"))!.links, [{ patientId: PACIENTE, clinicId: CLINICA }]);
});
