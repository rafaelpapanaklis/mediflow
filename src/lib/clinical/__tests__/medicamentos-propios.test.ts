/**
 * ws1-t10 · «Agregar medicamento que no está»: la lista propia de la clínica.
 *
 * Run: npm run test:recetas-propios
 *   (--experimental-test-module-mocks: se ejecutan de verdad los route
 *    handlers POST /api/catalogs/cums/propios, GET /api/catalogs/cums y
 *    POST /api/prescriptions, con Prisma, la auth y la auditoría sustituidos.)
 *
 * Lo que se fija aquí:
 *   · SIN el SQL (no existe cums_items.clinicId) todo sigue como hoy: el
 *     buscador usa el cliente de Prisma, `puedeAgregar` es false y el alta
 *     responde 503 sin tocar la tabla;
 *   · CON el SQL: el alta inserta con el clinicId DE LA SESIÓN, es idempotente,
 *     y la búsqueda devuelve lo global + lo propio y NUNCA lo de otra clínica;
 *   · el CANDADO: un controlado → 422 y ninguna consulta a la base, aunque
 *     venga con acento, en una marca o escondido en la presentación;
 *   · una clave propia de OTRA clínica no se puede recetar (cums_not_found);
 *     una propia sí, y la receta sale sin grupo COFEPRIS (180 días).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── El doble de Prisma ─────────────────────────────────────────────────────

/** ¿Existe la columna? Lo controla cada prueba. */
let columna = false;
/** Las filas de cums_items (globales con clinicId null). */
let tabla: Array<Record<string, any>> = [];
/** Cada consulta cruda, para contar y para ver que no se toca la tabla sin columna. */
let consultas: string[] = [];

function reset() {
  columna = false;
  consultas = [];
  tabla = [
    { clave: "MX-0004", descripcion: "Ibuprofeno", presentacion: "400 mg, caja c/30 tabletas", formaFarmaceutica: "Tableta", grupoTerapeutico: "Analgésicos y antiinflamatorios", cofeprisGroup: "IV", clinicId: null },
    { clave: "MX-0017", descripcion: "Tramadol", presentacion: "50 mg, caja c/10 cápsulas", formaFarmaceutica: "Cápsula", grupoTerapeutico: "Analgésicos y antiinflamatorios", cofeprisGroup: "III", clinicId: null },
    { clave: "CL-otraclinica", descripcion: "Ibuprofeno", presentacion: "600 mg, vía oral", formaFarmaceutica: "Tableta", grupoTerapeutico: "Propio de la clínica", cofeprisGroup: null, clinicId: "cli_OTRA" },
  ];
}

/** Interpreta las consultas crudas del módulo sobre `tabla` (un Postgres de juguete). */
function ejecutar(strings: TemplateStringsArray, values: any[]): any {
  const sql = strings.join("?").replace(/\s+/g, " ").trim();
  consultas.push(sql);
  if (sql.includes("information_schema.columns")) return [{ existe: columna }];
  if (!columna) throw new Error(`consulta a una columna que no existe: ${sql}`);
  // Los Prisma.sql anidados llegan como valores con .strings/.values: aplanar.
  const planos: any[] = [];
  const aplanar = (v: any) => {
    if (v && typeof v === "object" && Array.isArray(v.values) && Array.isArray(v.strings)) v.values.forEach(aplanar);
    else planos.push(v);
  };
  values.forEach(aplanar);

  if (sql.startsWith("INSERT INTO")) {
    const [clave, descripcion, presentacion, formaFarmaceutica, grupoTerapeutico, clinicId, createdBy] = planos;
    if (tabla.some((f) => f.clave === clave)) return 0;
    tabla.push({ clave, descripcion, presentacion, formaFarmaceutica, grupoTerapeutico, cofeprisGroup: null, clinicId, createdBy });
    return 1;
  }
  if (sql.includes('lower("descripcion") = lower(')) {
    const [clinicId, descripcion, presentacion] = planos;
    return tabla
      .filter((f) => f.clinicId === clinicId && f.descripcion.toLowerCase() === descripcion.toLowerCase() && f.presentacion.toLowerCase() === presentacion.toLowerCase())
      .map(sinClinic);
  }
  if (sql.includes('"clave" IN (')) {
    const clinicId = planos[planos.length - 1];
    const claves = planos.slice(0, -1);
    return tabla.filter((f) => claves.includes(f.clave) && (f.clinicId === null || f.clinicId === clinicId)).map((f) => ({ clave: f.clave, cofeprisGroup: f.cofeprisGroup }));
  }
  if (sql.includes('FROM "cums_items" WHERE')) {
    const clinicId = planos[0];
    const patron = planos.find((v) => typeof v === "string" && v.startsWith("%"));
    const q = patron ? patron.slice(1, -1).toLowerCase() : "";
    return tabla
      .filter((f) => (f.clinicId === null || f.clinicId === clinicId) && (!q || f.descripcion.toLowerCase().includes(q) || f.clave.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.clinicId !== null) - Number(a.clinicId !== null) || a.descripcion.localeCompare(b.descripcion))
      .map((f) => ({ ...sinClinic(f), propio: f.clinicId !== null }));
  }
  throw new Error(`consulta no prevista: ${sql}`);
}
function sinClinic(f: Record<string, any>) {
  const { clinicId: _c, createdBy: _b, ...resto } = f;
  return resto;
}

let findManyTipado = 0;
let creada: any = null;
const prescriptionDelegate = {
  create: async ({ data }: any) => { creada = { id: "rx_1", ...data }; return creada; },
  update: async ({ data }: any) => { creada = { ...creada, ...data, items: [] }; return creada; },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async (s: TemplateStringsArray, ...v: any[]) => ejecutar(s, v),
      $executeRaw: async (s: TemplateStringsArray, ...v: any[]) => ejecutar(s, v),
      cumsItem: {
        findMany: async ({ where, take }: any) => {
          findManyTipado++;
          // El cliente de Prisma NO conoce clinicId: devuelve todo lo que casa (como hoy).
          let filas = tabla;
          if (where?.clave?.in) filas = filas.filter((f) => where.clave.in.includes(f.clave));
          if (where?.OR) {
            const q = String(where.OR[1].descripcion.contains).toLowerCase();
            filas = filas.filter((f) => f.descripcion.toLowerCase().includes(q) || f.clave.toLowerCase().includes(q));
          }
          return filas.slice(0, take ?? 50).map(sinClinic);
        },
      },
      user: { findUnique: async () => ({ cedulaProfesional: "12345678" }) },
      medicalRecord: { findFirst: async () => ({ id: "rec_1" }) },
      prescription: prescriptionDelegate,
      prescriptionItem: { createMany: async () => ({ count: 1 }) },
      $transaction: async (fn: any) => fn({ prescription: prescriptionDelegate, prescriptionItem: { createMany: async () => ({ count: 1 }) } }),
    },
  },
});

let sesion = { userId: "doc_1", clinicId: "cli_1", role: "DOCTOR" };
mock.module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesion } });
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
const bitacora: any[] = [];
mock.module("@/lib/audit", { namedExports: { logMutation: async (o: any) => { bitacora.push(o); } } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

function req(body?: any, url = "https://www.dalecontrol.com/api/x"): any {
  return {
    json: async () => body,
    headers: new Headers({ host: "www.dalecontrol.com", "x-forwarded-proto": "https" }),
    nextUrl: new URL(url),
  };
}

async function alta(body: any) {
  const { POST } = await import("@/app/api/catalogs/cums/propios/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}
async function buscar(q: string) {
  const { GET } = await import("@/app/api/catalogs/cums/route");
  const res = await GET(req(undefined, `https://www.dalecontrol.com/api/catalogs/cums?q=${encodeURIComponent(q)}&limit=20`));
  return { status: res.status, body: await res.json() };
}
async function recetar(cumsKey: string) {
  const { POST } = await import("@/app/api/prescriptions/route");
  const res = await POST(req({ patientId: "pat_1", items: [{ cumsKey, dosage: "1 cada 8 h" }] }));
  return { status: res.status, body: await res.json() };
}

const ALTA_OK = { nombre: "Ibuprofeno", concentracion: "600 mg", forma: "Tableta", via: "Oral", presentacion: "caja c/20 tabletas" };

beforeEach(async () => {
  reset();
  findManyTipado = 0;
  bitacora.length = 0;
  creada = null;
  sesion = { userId: "doc_1", clinicId: "cli_1", role: "DOCTOR" };
  const { olvidarSondaDeMedicamentos } = await import("@/lib/clinical/medicamentos-propios.server");
  olvidarSondaDeMedicamentos();
});

// ── Sin el SQL: todo como hoy ──────────────────────────────────────────────

test("sin la columna: el buscador usa Prisma de siempre, puedeAgregar=false y no se consulta la columna", async () => {
  const r = await buscar("ibu");
  assert.equal(r.status, 200);
  assert.equal(r.body.puedeAgregar, false);
  assert.ok(r.body.items.some((i: any) => i.clave === "MX-0004"));
  assert.equal(findManyTipado, 1);
  assert.ok(consultas.every((c) => c.includes("information_schema")), "ninguna consulta cruda a la tabla");
});

test("sin la columna: el alta responde 503 sin_sql y no inserta nada", async () => {
  const r = await alta(ALTA_OK);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "sin_sql");
  assert.equal(tabla.length, 3);
  assert.equal(bitacora.length, 0);
});

test("sin la columna: recetar sigue validando contra el catálogo con Prisma", async () => {
  const r = await recetar("MX-0004");
  assert.equal(r.status, 201);
  assert.equal(findManyTipado, 1);
});

// ── El candado ─────────────────────────────────────────────────────────────

test("un controlado se rechaza con 422 ANTES de mirar la base, con y sin columna", async () => {
  for (const conColumna of [false, true]) {
    columna = conColumna;
    const { olvidarSondaDeMedicamentos } = await import("@/lib/clinical/medicamentos-propios.server");
    olvidarSondaDeMedicamentos();
    for (const nombre of ["Tramadol", "tramadol clorhidrato", "Clonazepam", "Rivotril", "Codeína con paracetamol", "FENTANILO"]) {
      consultas = [];
      const r = await alta({ ...ALTA_OK, nombre });
      assert.equal(r.status, 422, nombre);
      assert.equal(r.body.error, "medicamento_controlado");
      assert.ok(["I", "II", "III"].includes(r.body.controlado.grupo), nombre);
      assert.ok(/controlado/.test(r.body.detail) && /catálogo/.test(r.body.detail));
      assert.equal(consultas.length, 0, `${nombre}: no debe tocar la base`);
    }
  }
  assert.equal(tabla.length, 3);
});

test("el controlado escondido en la concentración o la presentación también se rechaza", async () => {
  columna = true;
  let r = await alta({ ...ALTA_OK, nombre: "Analgésico", concentracion: "tramadol 50 mg" });
  assert.equal(r.status, 422);
  r = await alta({ ...ALTA_OK, nombre: "Gotas", presentacion: "clonazepam 2.5 mg/mL" });
  assert.equal(r.status, 422);
});

// ── Con el SQL ─────────────────────────────────────────────────────────────

test("con la columna: el alta inserta con el clinicId DE LA SESIÓN (no del cuerpo) y deja bitácora", async () => {
  columna = true;
  const r = await alta({ ...ALTA_OK, clinicId: "cli_HACK" });
  assert.equal(r.status, 201);
  const m = r.body.medicamento;
  assert.match(m.clave, /^CL-[A-Za-z0-9_-]{11}$/);
  assert.equal(m.descripcion, "Ibuprofeno");
  assert.equal(m.presentacion, "600 mg, caja c/20 tabletas, vía oral");
  assert.equal(m.formaFarmaceutica, "Tableta");
  assert.equal(m.cofeprisGroup, null);
  assert.equal(m.propio, true);
  const fila = tabla.find((f) => f.clave === m.clave)!;
  assert.equal(fila.clinicId, "cli_1");
  assert.equal(fila.createdBy, "doc_1");
  assert.equal(bitacora.length, 1);
  assert.equal(bitacora[0].entityType, "clinic-medication");
  assert.equal(bitacora[0].clinicId, "cli_1");
  assert.match(bitacora[0].texto, /Ibuprofeno/);
});

test("el alta es idempotente: el mismo nombre + presentación devuelve el existente (200, existia)", async () => {
  columna = true;
  const a = await alta(ALTA_OK);
  const b = await alta({ ...ALTA_OK, nombre: "ibuprofeno" });
  assert.equal(b.status, 200);
  assert.equal(b.body.existia, true);
  assert.equal(b.body.medicamento.clave, a.body.medicamento.clave);
  assert.equal(tabla.length, 4);
  assert.equal(bitacora.length, 1, "la repetida no deja segunda fila en bitácora");
});

test("faltan datos → 400 con el campo", async () => {
  columna = true;
  assert.deepEqual((await alta({ ...ALTA_OK, nombre: "" })).body, { error: "datos_invalidos", campo: "nombre" });
  assert.deepEqual((await alta({ ...ALTA_OK, concentracion: " " })).body, { error: "datos_invalidos", campo: "concentracion" });
  assert.deepEqual((await alta({ ...ALTA_OK, forma: undefined })).body, { error: "datos_invalidos", campo: "forma" });
  assert.deepEqual((await alta({ ...ALTA_OK, via: "" })).body, { error: "datos_invalidos", campo: "via" });
  assert.equal(tabla.length, 3);
});

test("con la columna: la búsqueda devuelve lo global + lo propio (propio primero) y NUNCA lo de otra clínica", async () => {
  columna = true;
  await alta(ALTA_OK);
  const r = await buscar("ibu");
  assert.equal(r.body.puedeAgregar, true);
  const claves = r.body.items.map((i: any) => i.clave);
  assert.ok(claves.includes("MX-0004"));
  assert.ok(claves.some((c: string) => c.startsWith("CL-")));
  assert.ok(!claves.includes("CL-otraclinica"), "fuga entre clínicas");
  assert.equal(r.body.items[0].propio, true, "lo propio va primero");
  assert.equal(findManyTipado, 0, "con columna no se usa el cliente tipado (vería lo de otras clínicas)");

  sesion = { userId: "doc_2", clinicId: "cli_OTRA", role: "DOCTOR" };
  const otra = await buscar("ibu");
  const clavesOtra = otra.body.items.map((i: any) => i.clave);
  assert.ok(clavesOtra.includes("CL-otraclinica"));
  assert.ok(!clavesOtra.some((c: string) => c !== "CL-otraclinica" && c.startsWith("CL-")));
});

test("recetar: una clave propia de OTRA clínica es cums_not_found; una propia sí, sin grupo COFEPRIS", async () => {
  columna = true;
  const ajena = await recetar("CL-otraclinica");
  assert.equal(ajena.status, 404);
  assert.deepEqual(ajena.body.missing, ["CL-otraclinica"]);

  const propia = (await alta(ALTA_OK)).body.medicamento.clave;
  const r = await recetar(propia);
  assert.equal(r.status, 201);
  assert.equal(creada.cofeprisGroup, null);
  assert.equal(creada.clinicId, "cli_1");
  assert.equal(findManyTipado, 0);
});

test("recetar un controlado del catálogo sigue aplicando su grupo real (tramadol III: tope de 90 días)", async () => {
  columna = true;
  const r = await recetar("MX-0017");
  assert.equal(r.status, 201);
  assert.equal(creada.cofeprisGroup, "III");
  const dias = (creada.expiresAt.getTime() - creada.issuedAt.getTime()) / 86_400_000;
  assert.ok(dias > 89 && dias < 91, `vence en ${dias} días`);
  assert.equal(findManyTipado, 0);
});

test("la sonda recuerda que la columna existe: dos búsquedas, una sola pregunta a information_schema", async () => {
  columna = true;
  await buscar("ibu");
  await buscar("tra");
  assert.equal(consultas.filter((c) => c.includes("information_schema")).length, 1);
});
