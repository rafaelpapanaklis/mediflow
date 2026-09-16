/**
 * WS1-T1 · rojo 1 — LA VIGENCIA Y EL FOLIO DE LOS CONTROLADOS.
 *
 * Run: npm run test:receta-controlados
 *   (--experimental-test-module-mocks: se ejecuta el route handler DE VERDAD,
 *    `POST /api/prescriptions`, con Prisma, la auth, la visibilidad, la
 *    auditoría y el revalidate sustituidos.)
 *
 * El fallo, en una línea: un doctor elegía fentanilo (grupo COFEPRIS I, 24 h
 * por ley), escribía "31-dic-2028" en el campo Vigencia, dejaba el folio vacío,
 * y la página pública del QR publicaba «✓ Receta válida y vigente» con el
 * nombre de la clínica. El servidor cogía el grupo y la fecha DEL CUERPO DE LA
 * PETICIÓN y los guardaba tal cual.
 *
 * Lo que se fija aquí:
 *   · una fecha por encima del tope legal de un I/II/III se RECHAZA (422);
 *   · sin fecha, un grupo I vence en 24 h, no en 180 días;
 *   · el `cofeprisGroup` que manda el navegador NO decide nada: manda el
 *     catálogo CUMS, y es el que queda guardado;
 *   · el folio es obligatorio para I y II… salvo que el interruptor
 *     RECETAS_FOLIO_OBLIGATORIO esté apagado;
 *   · los grupos IV-VI (las recetas comunes) siguen aceptando la fecha que
 *     pida el médico: este arreglo no rompe a nadie que no estuviera saltándose
 *     la ley.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** El catálogo CUMS del doble: lo único en lo que el servidor debe confiar. */
const CATALOGO: Record<string, string | null> = {
  "MX-0022": "I",    // Fentanilo parche
  "MX-0019": "II",   // Codeína + paracetamol
  "MX-0017": "III",  // Tramadol
  "MX-0030": "IV",   // Amoxicilina
  "MX-0001": "V",    // Paracetamol
  "MX-9999": null,   // clave sin grupo en el catálogo
};

/** Lo último que se escribió en la tabla `prescriptions`. */
let creada: any = null;

const prescriptionDelegate = {
  create: async ({ data }: any) => {
    creada = { id: "rx_nueva", ...data };
    return creada;
  },
  update: async ({ data }: any) => {
    creada = { ...creada, ...data, items: [] };
    return creada;
  },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cumsItem: {
        findMany: async ({ where }: any) => {
          const claves: string[] = where?.clave?.in ?? [];
          return claves
            .filter((c) => c in CATALOGO)
            .map((c) => ({ clave: c, cofeprisGroup: CATALOGO[c] }));
        },
      },
      user: { findUnique: async () => ({ cedulaProfesional: "12345678" }) },
      medicalRecord: { findFirst: async () => ({ id: "rec_1" }) },
      prescription: prescriptionDelegate,
      prescriptionItem: { createMany: async () => ({ count: 1 }) },
      $transaction: async (fn: any) =>
        fn({ prescription: prescriptionDelegate, prescriptionItem: { createMany: async () => ({ count: 1 }) } }),
    },
  },
});

mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ userId: "doc_1", clinicId: "cli_1", role: "DOCTOR" }),
  },
});
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

function request(body: any): any {
  return {
    json: async () => body,
    headers: new Headers({ host: "www.dalecontrol.com", "x-forwarded-proto": "https" }),
  };
}

/** POST /api/prescriptions con un solo medicamento. */
async function crear(cumsKey: string, extra: Record<string, any> = {}) {
  const { POST } = await import("@/app/api/prescriptions/route");
  const res = await POST(
    request({
      patientId: "pat_1",
      items: [{ cumsKey, dosage: "1 cada 8 h" }],
      ...extra,
    }),
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  creada = null;
  delete process.env.RECETAS_FOLIO_OBLIGATORIO;
});

// ── El caso del informe, tal cual ──────────────────────────────────────────

test("fentanilo con vigencia a 2028 se RECHAZA (antes salía «válida y vigente» hasta 2028)", async () => {
  const { status, body } = await crear("MX-0022", {
    expiresAt: "2028-12-31T23:59:59.000Z",
    cofeprisFolio: "F-0001",
  });

  assert.equal(status, 422);
  assert.equal(body.error, "expiresAt_over_legal_cap");
  assert.equal(body.cofeprisGroup, "I");
  // El modal enseña `rx.detail`: tiene que decir cuál es el tope.
  assert.match(body.detail, /24 horas/);
  assert.ok(body.maxExpiresAt, "el 422 dice hasta cuándo se puede");
  assert.equal(creada, null, "no se guardó nada");
});

test("fentanilo SIN vigencia vence en 24 h, no en 180 días", async () => {
  const antes = Date.now();
  const { status } = await crear("MX-0022", { cofeprisFolio: "F-0001" });
  assert.equal(status, 201);

  const vence = new Date(creada.expiresAt).getTime();
  const emitida = new Date(creada.issuedAt).getTime();
  assert.ok(Math.abs(vence - emitida - DIA) < 60_000, `vence ${new Date(vence).toISOString()}`);
  assert.ok(vence - antes < 2 * DIA, "ni de lejos los 180 días de antes");
});

test("el grupo que manda el navegador se IGNORA: manda el catálogo", async () => {
  // Fentanilo (I en el catálogo) disfrazado de grupo VI por el cliente.
  const { status, body } = await crear("MX-0022", {
    cofeprisGroup: "VI",
    expiresAt: "2028-12-31T23:59:59.000Z",
    cofeprisFolio: "F-0001",
  });
  assert.equal(status, 422, "el disfraz no sirve");
  assert.equal(body.cofeprisGroup, "I");

  // Y el grupo que queda guardado es el del catálogo, no el del cliente: es el
  // que acaba impreso en el PDF y en la página pública.
  const ok = await crear("MX-0022", { cofeprisGroup: "VI", cofeprisFolio: "F-0001" });
  assert.equal(ok.status, 201);
  assert.equal(creada.cofeprisGroup, "I");
});

test("el grupo de la receta es el MÁS RESTRICTIVO de sus medicamentos", async () => {
  const { POST } = await import("@/app/api/prescriptions/route");
  const res = await POST(
    request({
      patientId: "pat_1",
      items: [
        { cumsKey: "MX-0001", dosage: "1 cada 8 h" }, // V
        { cumsKey: "MX-0017", dosage: "1 cada 12 h" }, // III
        { cumsKey: "MX-0030", dosage: "1 cada 8 h" }, // IV
      ],
    }),
  );
  assert.equal(res.status, 201);
  assert.equal(creada.cofeprisGroup, "III");
  // III → 90 días, no 180.
  const dias = (new Date(creada.expiresAt).getTime() - new Date(creada.issuedAt).getTime()) / DIA;
  assert.ok(Math.abs(dias - 90) < 1, `salieron ${dias} días`);
});

test("una fecha que no es fecha da 400, no una receta con vigencia inválida", async () => {
  const { status, body } = await crear("MX-0030", { expiresAt: "la semana que viene" });
  assert.equal(status, 400);
  assert.equal(body.error, "expiresAt_invalid");
  assert.equal(creada, null);
});

// ── Lo que NO se rompe: las recetas comunes ────────────────────────────────

test("un antibiótico (grupo IV) sigue aceptando la fecha que pida el médico", async () => {
  const { status } = await crear("MX-0030", { expiresAt: "2027-06-30T23:59:59.000Z" });
  assert.equal(status, 201, "los grupos IV-VI no tienen tope duro");
  assert.equal(new Date(creada.expiresAt).toISOString(), "2027-06-30T23:59:59.000Z");
});

test("un medicamento sin grupo en el catálogo se comporta como hoy: 180 días", async () => {
  const { status } = await crear("MX-9999");
  assert.equal(status, 201);
  assert.equal(creada.cofeprisGroup, null);
  const dias = (new Date(creada.expiresAt).getTime() - new Date(creada.issuedAt).getTime()) / DIA;
  assert.ok(Math.abs(dias - 180) < 1, `salieron ${dias} días`);
});

test("una fecha por debajo del tope legal sí se respeta", async () => {
  const dentro = new Date(Date.now() + 6 * HORA).toISOString();
  const { status } = await crear("MX-0022", { expiresAt: dentro, cofeprisFolio: "F-0001" });
  assert.equal(status, 201);
  assert.equal(new Date(creada.expiresAt).toISOString(), dentro);
});

// ── El folio, y su interruptor ─────────────────────────────────────────────

test("grupo I sin folio: rechazado", async () => {
  const { status, body } = await crear("MX-0022");
  assert.equal(status, 422);
  assert.equal(body.error, "cofeprisFolio_required");
  assert.equal(creada, null);
});

test("grupo II sin folio: rechazado; con folio: pasa", async () => {
  const sin = await crear("MX-0019");
  assert.equal(sin.status, 422);
  assert.equal(sin.body.error, "cofeprisFolio_required");

  const con = await crear("MX-0019", { cofeprisFolio: "  F-778899  " });
  assert.equal(con.status, 201);
  assert.equal(creada.cofeprisFolio, "F-778899", "el folio se guarda sin espacios");
});

test("grupo III no necesita folio (solo I y II lo llevan)", async () => {
  const { status } = await crear("MX-0017");
  assert.equal(status, 201);
});

test("un folio en blanco no cuenta como folio", async () => {
  const { status, body } = await crear("MX-0022", { cofeprisFolio: "   " });
  assert.equal(status, 422);
  assert.equal(body.error, "cofeprisFolio_required");
});

test("RECETAS_FOLIO_OBLIGATORIO=off apaga la exigencia sin desplegar", async () => {
  process.env.RECETAS_FOLIO_OBLIGATORIO = "off";
  const { status } = await crear("MX-0022");
  assert.equal(status, 201, "apagado, el grupo I pasa sin folio");
  // Pero el tope de vigencia NO depende del interruptor.
  const dentro24h = new Date(creada.expiresAt).getTime() - new Date(creada.issuedAt).getTime();
  assert.ok(Math.abs(dentro24h - DIA) < 60_000);

  const conFecha = await crear("MX-0022", { expiresAt: "2028-12-31T23:59:59.000Z" });
  assert.equal(conFecha.status, 422, "el interruptor es solo del folio");
});

test("el default es EXIGIR: una variable con basura no apaga nada", async () => {
  process.env.RECETAS_FOLIO_OBLIGATORIO = "quizá";
  const { status, body } = await crear("MX-0022");
  assert.equal(status, 422);
  assert.equal(body.error, "cofeprisFolio_required");
});
