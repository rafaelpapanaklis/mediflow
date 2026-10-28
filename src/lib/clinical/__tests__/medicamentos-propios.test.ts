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
  if (sql.includes("count(*)")) {
    const clinicId = planos[0];
    const patron = planos.find((v) => typeof v === "string" && v.startsWith("%"));
    const q = patron ? patron.slice(1, -1).toLowerCase() : "";
    const n = tabla.filter((f) => (f.clinicId === null || f.clinicId === clinicId) && (!q || f.descripcion.toLowerCase().includes(q) || f.clave.toLowerCase().includes(q))).length;
    return [{ n }];
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
        count: async ({ where }: any) => {
          findManyTipado++;
          const q = String(where?.OR?.[1]?.descripcion?.contains ?? "").toLowerCase();
          return tabla.filter((f) => !q || f.descripcion.toLowerCase().includes(q) || f.clave.toLowerCase().includes(q)).length;
        },
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

test("faltan datos → 400 con el campo y el motivo", async () => {
  columna = true;
  assert.deepEqual((await alta({ ...ALTA_OK, nombre: "" })).body, { error: "datos_invalidos", campo: "nombre", motivo: "vacio" });
  assert.deepEqual((await alta({ ...ALTA_OK, concentracion: " " })).body, { error: "datos_invalidos", campo: "concentracion", motivo: "vacio" });
  assert.deepEqual((await alta({ ...ALTA_OK, forma: undefined })).body, { error: "datos_invalidos", campo: "forma", motivo: "vacio" });
  assert.deepEqual((await alta({ ...ALTA_OK, via: "" })).body, { error: "datos_invalidos", campo: "via", motivo: "vacio" });
  assert.equal(tabla.length, 3);
});

// ── v2 · M-1 de t8: caracteres permitidos y vía de la lista ───────────────

test("v2 · letras que se ven iguales pero no son latinas → 400 caracteres, con y sin columna (la base no se toca)", async () => {
  for (const conColumna of [false, true]) {
    columna = conColumna;
    const { olvidarSondaDeMedicamentos } = await import("@/lib/clinical/medicamentos-propios.server");
    olvidarSondaDeMedicamentos();
    for (const nombre of ["Tramad\u043El", "Tr\u0430madol", "\uFF34\uFF52\uFF41\uFF4D\uFF41\uFF44\uFF4F\uFF4C", "Ibupr\u00F8feno", "Tramad\u03BFl", "Ibuprofeno<script>", "Ibuprofeno; drop", "Ibuprofeno \u00AB600\u00BB"]) {
      consultas = [];
      const r = await alta({ ...ALTA_OK, nombre });
      assert.equal(r.status, 400, JSON.stringify(nombre));
      assert.deepEqual(r.body, { error: "datos_invalidos", campo: "nombre", motivo: "caracteres" });
      assert.equal(consultas.length, 0, "no debe tocar la base");
    }
    // Lo mismo en concentración y presentación.
    assert.equal((await alta({ ...ALTA_OK, concentracion: "50 mg (tramad\u043El)" })).body.motivo, "caracteres");
    assert.equal((await alta({ ...ALTA_OK, presentacion: "caja \u2014 10" })).body.motivo, "caracteres");
  }
  assert.equal(tabla.length, 3);
});

test("v3 · m-4: µg (µ o μ griega), °, ª, ×, ½, ; y la tilde combinante pasan en concentración y presentación; en el nombre no", async () => {
  columna = true;
  const ok = async (campo: "concentracion" | "presentacion", valor: string) => {
    const r = await alta({ ...ALTA_OK, nombre: `Prueba ${tabla.length}`, [campo]: valor });
    assert.equal(r.status, 201, `${campo}=${JSON.stringify(valor)}: ${JSON.stringify(r.body)}`);
    return r.body.medicamento.presentacion as string;
  };
  assert.match(await ok("concentracion", "50 \u00B5g"), /^50 \u00B5g,/);
  assert.match(await ok("concentracion", "50 \u03BCg"), /^50 \u00B5g,/, "la μ griega se guarda como el signo micro µ");
  await ok("concentracion", "37 \u00B0C");
  await ok("presentacion", "N\u00B0 2, 1\u00AA dosis, 2\u00D710");
  await ok("concentracion", "\u00BD tableta");
  await ok("concentracion", "100 mg; 200 mg");
  // «á» como a + acento combinante (teclados y el pegar de macOS): se normaliza a NFC.
  const r = await alta({ ...ALTA_OK, nombre: "A\u0301cido mefena\u0301mico" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.medicamento.descripcion, "\u00C1cido mefen\u00E1mico");
  // En el NOMBRE siguen fuera.
  assert.deepEqual((await alta({ ...ALTA_OK, nombre: "Ibuprofeno \u00B5" })).body, { error: "datos_invalidos", campo: "nombre", motivo: "caracteres" });
  assert.deepEqual((await alta({ ...ALTA_OK, nombre: "Ibuprofeno \u00BD" })).body, { error: "datos_invalidos", campo: "nombre", motivo: "caracteres" });
  // Un NBSP se vuelve espacio normal.
  assert.equal((await alta({ ...ALTA_OK, nombre: "Ibuprofeno\u00A0forte" })).status, 201);
});

test("v2 · lo normal sigue pasando: acentos, ñ, ü, %, /, +, paréntesis", async () => {
  columna = true;
  const r = await alta({ nombre: "Ácido mefenámico (señalado) + ü", concentracion: "500 mg/5 mL, 2.5 %", forma: "Suspensión", via: "Oral", presentacion: "frasco: 60 mL (c/vaso)" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test("v2 · la vía y la forma solo de sus listas: «oral (tramadol)» o un texto libre → 400 lista", async () => {
  columna = true;
  assert.deepEqual((await alta({ ...ALTA_OK, via: "oral (tramadol)" })).body, { error: "datos_invalidos", campo: "via", motivo: "lista" });
  assert.deepEqual((await alta({ ...ALTA_OK, via: "Oral tramadol" })).body, { error: "datos_invalidos", campo: "via", motivo: "lista" });
  assert.deepEqual((await alta({ ...ALTA_OK, forma: "Tableta de tramadol" })).body, { error: "datos_invalidos", campo: "forma", motivo: "lista" });
  // Las de la lista pasan tal cual (valor en español).
  assert.equal((await alta({ ...ALTA_OK, via: "Sublingual", forma: "Gotas" })).status, 201);
  assert.equal(tabla.length, 4);
});

test("v2 · la tabla de t8 en el servidor: marcas, barbitúricos, dígitos y una letra cambiada → 422", async () => {
  columna = true;
  for (const nombre of ["Xanax", "Tradol", "Ultram", "Klonopin", "Rohypnol", "Dilaudid", "Demerol", "Vicodin", "Percocet", "Palexia", "Graten",
    "Fenobarbital", "Phenobarbital", "Barbital", "Butalbital", "Tiopental", "Tramad0l", "Tr4madol", "M0rfina", "Fentan1lo", "Diazep4m", "Alpraz0lam", "Tramadool", "Clonazepan"]) {
    const r = await alta({ ...ALTA_OK, nombre });
    assert.equal(r.status, 422, nombre);
    assert.equal(r.body.error, "medicamento_controlado", nombre);
  }
  assert.equal(tabla.length, 3);
});

// ── v2 · M-2 de t8: Sabina no ve los propios de otra clínica ─────────────

async function sabinaBusca(clinicId: string, texto: string) {
  const { recetas } = await import("@/lib/sabina/tools/recetas");
  const ctx: any = {
    clinicId, userId: "doc_1", role: "DOCTOR", permissionsOverride: [], timezone: "America/Mexico_City",
    clinicCategory: "DENTAL", clinicaNombre: "Clínica", clinicaLugar: "CDMX",
  };
  const r = await recetas.ejecutar(ctx, { buscarMedicamento: texto } as any);
  return r.medicamentos!;
}

test("v2 · Sabina busca en el catálogo con la clínica de la sesión: lo global + lo propio, nunca lo de otra", async () => {
  columna = true;
  const propia = (await alta(ALTA_OK)).body.medicamento.clave;
  const mia = await sabinaBusca("cli_1", "ibu");
  const claves = mia.filas.map((f: any) => f.clave);
  assert.ok(claves.includes("MX-0004"));
  assert.ok(claves.includes(propia), "la propia sí");
  assert.ok(!claves.includes("CL-otraclinica"), "fuga: Sabina enseña el propio de otra clínica");
  assert.equal(mia.total, 2);
  assert.equal(findManyTipado, 0, "con columna no se usa el cliente tipado");

  const otra = await sabinaBusca("cli_OTRA", "ibu");
  const clavesOtra = otra.filas.map((f: any) => f.clave);
  assert.ok(clavesOtra.includes("CL-otraclinica"));
  assert.ok(!clavesOtra.includes(propia));
  assert.equal(otra.total, 2);
});

test("v2 · Sabina sin la columna: el catálogo global por Prisma, como siempre, con su total", async () => {
  columna = false;
  const r = await sabinaBusca("cli_1", "tramad");
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].clave, "MX-0017");
  assert.equal(r.filas[0].controlado, true);
  assert.equal(r.total, 1);
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
