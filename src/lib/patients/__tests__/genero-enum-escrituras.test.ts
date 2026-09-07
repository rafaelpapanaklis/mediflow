/**
 * WS1-T3 · hallazgo 31 (los dos cabos que quedaron) — el enum `Gender` es
 * `M | F | OTHER` (prisma/schema.prisma:1500-1504) y quedaban DOS sitios
 * comparando contra `"MALE"` / `"FEMALE"`, que no existen.
 *
 * Run: npm run test:genero-enum
 *   (--experimental-test-module-mocks: se ejecutan el route handler y la
 *   server action DE VERDAD; sólo se sustituyen Prisma, la auth y el audit.)
 *
 * LOS DOS CABOS, y por qué duelen distinto:
 *
 *   a) PATCH /api/patients/[id] validaba con `["MALE","FEMALE","OTHER"]`.
 *      Es el reverso exacto de lo que hace falta: rechazaba con 400 los ÚNICOS
 *      valores que la base guarda —editar un paciente mandándole su propio
 *      género fallaba— y dejaba pasar `"MALE"`, que llegaba intacto al
 *      `patient.update`. Ese update vive FUERA del try/catch del parseo, así
 *      que la PrismaClientValidationError salía como 500 pelado.
 *
 *   b) exportImplantFullReport pintaba el sexo con un `switch` sobre
 *      `"MALE"`/`"FEMALE"`. Como `gender` es NOT NULL con default OTHER, el
 *      switch caía SIEMPRE en el `default` y el informe de implantes imprimía
 *      "Otro" para todos los pacientes, hombres y mujeres incluidos.
 *
 * EL CRITERIO, uno solo: `parsePatientGender` (patient-search-core), que es la
 * misma función detrás de `parseGenderFilter` con la que se arregló el filtro
 * de la lista. Acepta los alias históricos y NORMALIZA al valor del enum; lo
 * que no reconoce devuelve `null`, que aquí es un 400 y no un valor inventado.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePatientGender } from "../patient-search-core";

const SRC_ROOT = join(__dirname, "..", "..", "..");            // src/
const PACIENTE = "pat_1";

/** Lo último que le pasó el handler a `patient.update`. */
let ultimoUpdate: any = null;
/** El género que devuelve el paciente falso del informe de implantes. */
let generoDelImplante = "M";

const pacienteFila = {
  id: PACIENTE,
  clinicId: "cli_1",
  firstName: "Ana",
  lastName: "García",
  phone: null,
  gender: "F",
};

const prismaFalso: any = {
  patient: {
    findFirst: async () => pacienteFila,
  },
  $transaction: async (cb: any) =>
    cb({
      patient: {
        update: async ({ data }: any) => {
          ultimoUpdate = data;
          return { ...pacienteFila, ...data };
        },
      },
    }),
  // Para el informe de implantes.
  implant: {
    findUnique: async () => ({
      id: "imp_1",
      patientId: PACIENTE,
      toothFdi: 46,
      brand: "STRAUMANN",
      brandCustomName: null,
      modelName: "BLT",
      diameterMm: 4.1,
      lengthMm: 10,
      connectionType: null,
      surfaceTreatment: null,
      lotNumber: "L-1",
      manufactureDate: null,
      expiryDate: null,
      placedAt: null,
      protocol: null,
      currentStatus: "PLACED",
      patient: { firstName: "Ana", lastName: "García", dob: new Date("1990-01-01"), gender: generoDelImplante },
      placedByDoctor: { firstName: "Luis", lastName: "Pérez", cedulaProfesional: "123" },
      clinic: { name: "Clínica", phone: null, address: null },
      surgicalRecord: null,
      healingPhase: null,
      secondStage: null,
      prostheticPhase: null,
      followUps: [],
      complications: [],
    }),
  },
  clinicalPhoto: { findMany: async () => [] },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({
      userId: "user_1",
      clinicId: "cli_1",
      role: "ADMIN",
      isAdmin: true,
      permissionsOverride: [],
    }),
    buildPatientWhere: () => ({}),
  },
});
mock.module("@/lib/patient-visibility", {
  namedExports: {
    patientVisibilityAnd: () => [],
    normalizeVisibleUserIds: async () => [],
    ensureUserCanSeePatient: async () => null,
    canSeePatient: async () => true,
  },
});
// `@/lib/branches` importa "server-only", un paquete que sólo existe dentro del
// bundle de Next: sin sustituirlo el route handler ni siquiera carga. Ninguno de
// sus caminos entra en juego en un PATCH (son del GET de la ficha).
mock.module("@/lib/branches", {
  namedExports: {
    getPatientVisibility: async () => ({ clinicIds: ["cli_1"] }),
    sharedRecordScope: () => ({}),
    ownPrivateRecordsOnly: () => ({}),
  },
});
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
mock.module("@/lib/whatsapp/inbox-log", {
  namedExports: { linkOrphanThreadsToPatient: async () => {} },
});
// El informe de implantes: su contexto (auth + módulo + tenant) no es lo que
// se prueba aquí, y arrastra supabase/next-cache al cargarse.
mock.module("@/app/actions/implants/_helpers", {
  namedExports: {
    getImplantActionContext: async () => ({
      ok: true,
      data: { ctx: { userId: "user_1", clinicId: "cli_1", role: "ADMIN", permissionsOverride: [] } },
    }),
    loadImplantForCtx: async () => ({ ok: true, data: {} }),
    auditImplant: async () => {},
  },
});

/** Un PATCH real contra el handler real. Devuelve status + lo que se escribió. */
async function patchGenero(gender: unknown) {
  ultimoUpdate = null;
  const { NextRequest } = await import("next/server");
  const mod: any = await import("@/app/api/patients/[id]/route");
  const req = new NextRequest(`https://dalecontrol.test/api/patients/${PACIENTE}`, {
    method: "PATCH",
    body: JSON.stringify({ gender }),
    headers: { "content-type": "application/json" },
  } as any);
  const res = await mod.PATCH(req, { params: { id: PACIENTE } });
  return { status: res.status, body: await res.json().catch(() => ({})), escrito: ultimoUpdate?.gender };
}

// ─────────────────────────────────────────────────────────────────────
// a · PATCH /api/patients/[id] — la validación que rechazaba lo válido
// ─────────────────────────────────────────────────────────────────────

for (const g of ["M", "F", "OTHER"] as const) {
  test(`31a · PATCH acepta "${g}", que es lo que la propia base guarda`, async () => {
    // Con el código de hoy esto es 400 "gender inválido": editar a un paciente
    // mandando su género real fallaba.
    const { status, body, escrito } = await patchGenero(g);
    assert.equal(status, 200, `PATCH gender="${g}" respondió ${status}: ${JSON.stringify(body)}`);
    assert.equal(escrito, g, `se escribió ${JSON.stringify(escrito)} en vez de "${g}"`);
  });
}

for (const [alias, esperado] of [["MALE", "M"], ["FEMALE", "F"], ["Masculino", "M"], ["mujer", "F"]] as const) {
  test(`31a · PATCH normaliza el alias "${alias}" a "${esperado}" antes de escribir`, async () => {
    // Con el código de hoy "MALE" pasaba la validación y llegaba TAL CUAL a
    // Prisma, que no lo admite → 500. Los alias se aceptan (siguen vivos en
    // clientes viejos) pero se traducen al enum.
    const { status, escrito } = await patchGenero(alias);
    assert.equal(status, 200, `PATCH gender="${alias}" respondió ${status}`);
    assert.equal(escrito, esperado, `"${alias}" se escribió como ${JSON.stringify(escrito)}`);
    assert.notEqual(escrito, alias, `"${alias}" llegó sin normalizar a Prisma: eso es el 500`);
  });
}

for (const basura of ["", "XYZ", "male ish", 7, null, true]) {
  test(`31a · PATCH sigue rechazando ${JSON.stringify(basura)} con 400`, async () => {
    // La otra mitad: aflojar la validación no puede convertirla en un colador.
    const { status } = await patchGenero(basura);
    assert.equal(status, 400, `${JSON.stringify(basura)} entró como género`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// b · exportImplantFullReport — el sexo del informe de implantes
// ─────────────────────────────────────────────────────────────────────

async function sexoDelInforme(gender: string) {
  generoDelImplante = gender;
  const mod: any = await import("@/app/actions/implants/exportImplantFullReport");
  const res = await mod.exportImplantFullReport({ implantId: "imp_1" });
  assert.equal(res.ok, true, `la action falló: ${JSON.stringify(res)}`);
  return res.data.patient.sex;
}

test('31b · el informe de implantes imprime "M" para un paciente M', async () => {
  // Con el código de hoy sale "Otro": el switch comparaba contra "MALE".
  assert.equal(await sexoDelInforme("M"), "M");
});

test('31b · el informe de implantes imprime "F" para una paciente F', async () => {
  assert.equal(await sexoDelInforme("F"), "F");
});

test('31b · OTHER sigue saliendo como "Otro"', async () => {
  assert.equal(await sexoDelInforme("OTHER"), "Otro");
});

// ─────────────────────────────────────────────────────────────────────
// c · Que no vuelva a colarse la constante muerta
// ─────────────────────────────────────────────────────────────────────

const ARREGLADOS = [
  "app/api/patients/[id]/route.ts",
  "app/actions/implants/exportImplantFullReport.ts",
];

for (const rel of ARREGLADOS) {
  test(`31 · ${rel} ya no compara contra "MALE"/"FEMALE"`, () => {
    const src = readFileSync(join(SRC_ROOT, ...rel.split("/")), "utf8");
    // Sólo el código: los comentarios de este arreglo citan los literales
    // muertos a propósito, para que se entienda qué pasó.
    const codigo = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(
      !/"MALE"|"FEMALE"/.test(codigo),
      `sigue habiendo un literal "MALE"/"FEMALE" en el código de ${rel}`,
    );
    assert.ok(
      codigo.includes("parsePatientGender"),
      `${rel} debería normalizar con parsePatientGender, el criterio ya existente`,
    );
  });
}

test("31 · el criterio compartido sigue siendo el del enum", () => {
  // El candado de arriba sólo vale si la función a la que delegan hace esto.
  assert.equal(parsePatientGender("M"), "M");
  assert.equal(parsePatientGender("MALE"), "M");
  assert.equal(parsePatientGender("F"), "F");
  assert.equal(parsePatientGender("FEMALE"), "F");
  assert.equal(parsePatientGender("OTHER"), "OTHER");
  assert.equal(parsePatientGender("XYZ"), null);
});
