/**
 * Revisión t12 (m3) de la auditoría «cloudflare», nº7: las rutas del portal del
 * paciente usan los MISMOS expedientes que el guard (`ctx.links`), no otro
 * criterio de email repetido en SQL.
 *
 * Run: npm run test:seg-portal-enlaces-rutas
 *   (--experimental-test-module-mocks: se ejecutan de verdad los GET de summary,
 *    appointments, history, documentos, payments, profile y booking/options, con
 *    Prisma, las cookies y la sesión sustituidas. El `findMany` de los enlaces
 *    aplica el `where` que recibe: email con `equals` + `insensitive` SIN trim,
 *    como Postgres, o `patientId in`.)
 *
 * Con d5e69b807 un paciente importado con «ana@correo.test » (espacio al final)
 * pasaba el guard (que compara con trim) pero las rutas lo descartaban: el
 * portal mostraba la clínica sin datos.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CUENTA = { id: "acc_1", name: "Ana", email: "ana@correo.test", phone: null, createdAt: new Date("2026-01-01T00:00:00Z") };
const PACIENTE = {
  id: "pac_1", patientNumber: "P0001", firstName: "Ana", lastName: "García",
  email: "ana@correo.test ", // importado con un espacio al final
  phone: null, deletedAt: null, clinicId: "cli_1",
  clinic: { id: "cli_1", name: "Clínica Uno", slug: "clinica-uno", logoUrl: null, phone: null, address: null, city: null, specialty: null, timezone: "America/Mexico_City" },
};
const enlaces = [{ accountId: CUENTA.id, patientId: PACIENTE.id, clinicId: "cli_1", createdAt: new Date("2026-01-02T00:00:00Z"), patient: PACIENTE }];

function aplicaWhere(where: any) {
  return enlaces.filter((l) => {
    if (where?.accountId && l.accountId !== where.accountId) return false;
    if (where?.patientId?.in && !where.patientId.in.includes(l.patientId)) return false;
    const e = where?.patient?.email;
    if (e && (l.patient.email ?? "").toLowerCase() !== String(e.equals).toLowerCase()) return false;
    return true;
  });
}

const vacio: any = new Proxy({}, {
  get: (_t, metodo) => async () => (String(metodo) === "count" ? 0 : String(metodo).startsWith("findMany") || metodo === "groupBy" ? [] : null),
});
const prismaFalso: any = new Proxy({
  patientAccountSession: {
    findUnique: async () => ({
      expiresAt: new Date(Date.now() + 3_600_000),
      account: { ...CUENTA, links: enlaces.map((l) => ({ patientId: l.patientId, clinicId: l.clinicId, patient: { email: l.patient.email } })) },
    }),
    deleteMany: async () => ({ count: 0 }),
  },
  patientAccount: { findUnique: async () => ({ ...CUENTA }) },
  // Solo booking/options lee las clínicas aparte; los pacientes salen de los enlaces.
  clinic: {
    findMany: async () => [{ id: "cli_1", name: "Clínica Uno", timezone: "America/Mexico_City", users: [] }],
    findFirst: async () => null,
    findUnique: async () => null,
  },
  patientAccountLink: {
    findMany: async ({ where }: any) => aplicaWhere(where),
    findFirst: async ({ where }: any) => aplicaWhere(where)[0] ?? null,
  },
  $queryRaw: async () => [],
  $transaction: async (x: any) => (Array.isArray(x) ? Promise.all(x) : x(prismaFalso)),
}, { get: (t: any, k) => (k in t ? t[k] : typeof k === "string" && !k.startsWith("$") ? vacio : undefined) });

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("next/headers", {
  namedExports: { cookies: async () => ({ get: () => ({ value: "token" }) }), headers: async () => new Headers() },
});

// Qué tiene que salir en cada respuesta: la clínica del expediente (que solo
// sale de los enlaces) o, en booking/options, el expediente para agendar.
const RUTAS: Record<string, string> = {
  summary: "Clínica Uno", appointments: "Clínica Uno", history: "Clínica Uno", documentos: "Clínica Uno",
  payments: "Clínica Uno", profile: "Clínica Uno", "booking/options": "pac_1",
};

for (const [ruta, esperado] of Object.entries(RUTAS)) {
  test(`m3 · /api/paciente/${ruta}: el expediente que deja pasar el guard sale (${esperado})`, async () => {
    const mod: any = await import(`@/app/api/paciente/${ruta}/route`);
    const { NextRequest } = await import("next/server");
    const res = await mod.GET(new NextRequest(`https://dalecontrol.test/api/paciente/${ruta}`));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.ok(JSON.stringify(body).includes(esperado), `no salió ${esperado}: ${JSON.stringify(body).slice(0, 300)}`);
  });
}

test("m3 · y un expediente cuyo email ya no es el de la cuenta no sale en ninguna ruta (el guard lo quita)", async () => {
  const antes = PACIENTE.email;
  PACIENTE.email = "otra@correo.test";
  try {
    const { NextRequest } = await import("next/server");
    for (const [ruta, esperado] of Object.entries(RUTAS)) {
      const mod: any = await import(`@/app/api/paciente/${ruta}/route`);
      const res = await mod.GET(new NextRequest(`https://dalecontrol.test/api/paciente/${ruta}`));
      const texto = JSON.stringify(await res.json());
      assert.ok(!texto.includes(esperado), `${ruta}: ${texto.slice(0, 200)}`);
    }
  } finally {
    PACIENTE.email = antes;
  }
});
