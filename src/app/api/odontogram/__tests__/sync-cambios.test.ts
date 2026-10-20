/**
 * ws1-t11 · revisión t4 O4 — «Guardar consulta» no pisa un autoguardado.
 *
 * Run: npm run test:odontograma-sync-cambios
 *   (--experimental-test-module-mocks: se ejecuta el POST /api/odontogram/sync
 *   y el GET /api/odontogram DE VERDAD. Se sustituyen Prisma, la sesión, la
 *   auditoría y la suplantación; la lógica de la ruta es la real.)
 *
 * Caso del revisor: el doctor abre «Nueva consulta», quita la caries del 16 y
 * le pone una restauración. Mientras, en la otra pestaña (Odontograma, con
 * autoguardado) alguien añade una corona al 16 y una caries al 26. Al «Guardar
 * consulta», el modo viejo (`records`) reemplazaba TODO con la foto de la
 * consulta y se perdían la corona y la caries del 26. El modo `cambios` aplica
 * solo lo que el doctor añadió y quitó, sobre lo que hay en la base.
 *
 * El Prisma falso evalúa los `where` de verdad sobre una tabla en memoria y
 * lanza si una consulta llega sin `patientId`.
 *
 * Cuarta vuelta (t8): N4-O2 con la cadena completa —cola real, adaptador real
 * y rutas reales—: lo que la Dra. A marca o deja pendiente nunca sale firmado
 * por el Dr. B (la cabecera `x-odontograma-sesion` y el 409 del servidor),
 * tampoco por keepalive. N4-O5 / N4-O6 en el modo viejo de /sync.
 *
 * Verificación final (t8), con la misma cadena: V-O1 (un «Limpiar todo» viejo
 * no borra lo guardado después) y V-O3 (con la sesión vencida, el 401 real de
 * `?quien=1` aparta con «Tu sesión venció», no «sin conexión»).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cli_1";
const PACIENTE = "pat_1";

interface Fila { id: string; patientId: string; toothNumber: number; surface: string | null; conditionId: string; notes: string | null }
let FILAS: Fila[] = [];
let AUDIT: any[] = [];
let CANDADOS: string[] = [];
let TX_OPTS: ({ timeout?: number } | undefined)[] = [];
/** quién tiene la cookie (la sesión del navegador) */
const DR_DE_LA_COOKIE = { id: "u_dr", role: "DOCTOR", clinicId: CLINICA };
let COOKIE: { id: string; role: string; clinicId: string } | null = DR_DE_LA_COOKIE;
let seq = 0;

const coincide = (f: Fila, w: any): boolean => {
  if (typeof w?.patientId !== "string" || !w.patientId) throw new Error("consulta de odontograma SIN patientId");
  if (f.patientId !== w.patientId) return false;
  if (w.toothNumber !== undefined) {
    if (typeof w.toothNumber === "object" && w.toothNumber?.in) { if (!w.toothNumber.in.includes(f.toothNumber)) return false; }
    else if (f.toothNumber !== w.toothNumber) return false;
  }
  if ("surface" in w && f.surface !== w.surface) return false;
  if (w.conditionId !== undefined) {
    if (typeof w.conditionId === "string") { if (f.conditionId !== w.conditionId) return false; }
    else if (w.conditionId.in) { if (!w.conditionId.in.includes(f.conditionId)) return false; }
    else if (w.conditionId.not) { if (f.conditionId === w.conditionId.not) return false; }
  }
  return true;
};

const tabla: any = {
  findMany: async ({ where }: any) => FILAS.filter((f) => coincide(f, where)).map((f) => ({ ...f })),
  findFirst: async ({ where }: any) => { const f = FILAS.find((x) => coincide(x, where)); return f ? { id: f.id } : null; },
  deleteMany: async ({ where }: any) => { const antes = FILAS.length; FILAS = FILAS.filter((f) => !coincide(f, where)); return { count: antes - FILAS.length }; },
  create: async ({ data }: any) => { const f = { id: `e${++seq}`, notes: null, updatedAt: new Date(), ...data }; FILAS.push(f); return f; },
  update: async ({ where, data }: any) => { const f = FILAS.find((x) => x.id === where.id)!; Object.assign(f, data); return f; },
  upsert: async ({ where, create, update }: any) => {
    const w = where.patientId_toothNumber_surface_conditionId;
    const f = FILAS.find((x) => coincide(x, w));
    if (f) { Object.assign(f, update); return f; }
    const n = { id: `e${++seq}`, notes: null, ...create }; FILAS.push(n); return n;
  },
  createMany: async ({ data, skipDuplicates }: any) => {
    let n = 0;
    for (const d of data) {
      const dup = FILAS.some((f) => f.patientId === d.patientId && f.toothNumber === d.toothNumber && f.surface === d.surface && f.conditionId === d.conditionId && f.surface !== null);
      if (dup && skipDuplicates) continue;
      FILAS.push({ id: `e${++seq}`, notes: null, ...d }); n++;
    }
    return { count: n };
  },
};
const prismaFalso: any = {
  odontogramEntry: tabla,
  auditLog: { create: async ({ data }: any) => { AUDIT.push(data); return data; } },
  $transaction: async (fn: (tx: any) => Promise<unknown>, opts?: { timeout?: number }) => { TX_OPTS.push(opts); return fn(prismaFalso); },
  $executeRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => { CANDADOS.push(String(vals[0])); return 1; },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/odontogram/api-auth", {
  namedExports: {
    getDbUser: async () => COOKIE,
    puedeEscribirOdontograma: () => true,
    puedeLeerOdontograma: () => true,
    ensurePatientInClinic: async (pid: string) => pid === PACIENTE,
    isMissingTableError: () => false,
  },
});
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/audit", { namedExports: { extractAuditMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }) } });
mock.module("@/lib/admin/suplantacion", {
  namedExports: { suplantacionDeEstaPeticion: async () => null, anotarAccionDeSuplantacion: async () => {} },
});

const fila = (toothNumber: number, surface: string | null, conditionId: string, notes: string | null = null): Fila =>
  ({ id: `e${++seq}`, patientId: PACIENTE, toothNumber, surface, conditionId, notes, updatedAt: new Date("2026-10-19T10:00:00Z") } as Fila);

async function post(body: unknown) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../sync/route");
  return POST(new NextRequest("http://localhost/api/odontogram/sync", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  }));
}

const estado = () => FILAS.map((f) => `${f.toothNumber}:${f.surface ?? "-"}:${f.conditionId}${f.notes ? `=${f.notes}` : ""}`).sort();

beforeEach(() => {
  FILAS = []; AUDIT = []; CANDADOS = []; TX_OPTS = []; seq = 0; COOKIE = DR_DE_LA_COOKIE;
  FILAS.push(fila(16, "O", "caries"), fila(36, null, "rct"), fila(11, null, "__note__", "sensible"));
});

test("O4: «Guardar consulta» aplica solo el cambio del doctor y NO pisa lo que otra pestaña autoguardó", async () => {
  // la otra pestaña autoguarda DESPUÉS de que la consulta leyó el vivo
  FILAS.push(fila(16, null, "crown"), fila(26, "O", "caries"));
  const res = await post({
    patientId: PACIENTE,
    cambios: {
      16: { base: { surfaces: { O: ["caries"] }, tooth: [] }, now: { surfaces: { M: ["restoration"] }, tooth: [] } },
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(estado(), [
    "11:-:__note__=sensible",
    "16:-:crown",          // autoguardado de la otra pestaña: se queda
    "16:M:restoration",    // lo que añadió el doctor
    "26:O:caries",         // autoguardado en un diente que la consulta no tocó: se queda
    "36:-:rct",
  ]);
  assert.equal(AUDIT.length, 1);
  assert.equal(AUDIT[0].action, "odontogram_sync");
  assert.deepEqual(AUDIT[0].changes._odontogram.before.dientes, [16]);
  assert.equal(TX_OPTS[0]?.timeout, 20_000, "tope de la transacción por encima de los 5 s por defecto (t8)");
});

test("t8 N3-O8: una pestaña con el JS de ANTES del despliegue («records») no se rechaza: se aplica con la regla segura (solo añade)", async () => {
  // El JS viejo manda el odontograma entero de la consulta. Mientras, otra
  // pestaña autoguardó una corona en el 16 y una caries en el 26, que la foto
  // de la consulta no trae. Antes: se borraban. Con 410: «Guardar consulta»
  // avisaba que el odontograma no se actualizó. Ahora: se añade lo que falta
  // (la restauración y la incisal del 11, que el JS viejo manda como «I») y
  // NO se borra nada.
  FILAS.push(fila(16, null, "crown"), fila(26, "O", "caries"));
  const res = await post({
    patientId: PACIENTE,
    records: {
      16: { surfaces: { O: ["caries"], M: ["restoration"] }, tooth: [] },
      11: { surfaces: { I: ["caries"] }, tooth: [], note: "otra nota" },
    },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.modo, "compat");
  assert.deepEqual(estado(), [
    "11:-:__note__=sensible",   // la nota que había no se pisa
    "11:O:caries",              // la «I» del JS viejo, guardada como «O»
    "16:-:crown",               // autoguardado de otra pestaña: se queda
    "16:M:restoration",         // lo que añadió la consulta
    "16:O:caries",
    "26:O:caries",              // se queda
    "36:-:rct",                 // se queda
  ]);
  assert.equal(body.sinQuitar, 3, "corona del 16, caries del 26 y rct del 36: antes se borraban");
  assert.equal(body.notasSinPisar, 1);
  assert.equal(AUDIT[0].changes._odontogram.modo, "records-compat");
});

test("t8 N3-O8: pasada la temporada (1-dic-2026) el modo viejo responde 410 sin tocar nada", async () => {
  const antes = estado();
  const real = Date.now;
  Date.now = () => Date.parse("2026-12-01T06:00:01Z");
  try {
    const res = await post({ patientId: PACIENTE, records: { 16: { surfaces: { M: ["restoration"] }, tooth: [] } } });
    assert.equal(res.status, 410);
    assert.match((await res.json()).hint, /recarga la página/);
  } finally {
    Date.now = real;
  }
  assert.deepEqual(estado(), antes);
});

test("O4: diente completo y nota con el mismo candado que el autoguardado; sin duplicar lo que ya está", async () => {
  FILAS.push(fila(16, null, "crown")); // la otra pestaña ya puso la corona que el doctor también puso
  const res = await post({
    patientId: PACIENTE,
    cambios: {
      16: { base: { surfaces: { O: ["caries"] }, tooth: [] }, now: { surfaces: { O: ["caries"] }, tooth: ["crown"] } },
      11: { base: { surfaces: {}, tooth: [], note: "sensible" }, now: { surfaces: {}, tooth: [], note: "fractura" } },
      36: { base: { surfaces: {}, tooth: ["rct"] }, now: { surfaces: {}, tooth: [] } },
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(estado(), ["11:-:__note__=fractura", "16:-:crown", "16:O:caries"]);
  assert.equal(FILAS.filter((f) => f.toothNumber === 16 && f.conditionId === "crown").length, 1, "la corona no se duplica");
  assert.ok(CANDADOS.includes(`odontogram:${PACIENTE}:16:crown`), "alta de diente completo bajo el candado del PUT");
  assert.ok(CANDADOS.includes(`odontogram:${PACIENTE}:11:__note__`), "nota bajo el candado de /note");
});

test("O4: un diente que no existe o mandar los dos modos se rechaza sin tocar nada", async () => {
  const antes = estado();
  assert.equal((await post({ patientId: PACIENTE, cambios: { 19: { base: { surfaces: {}, tooth: [] }, now: { surfaces: {}, tooth: ["crown"] } } } })).status, 400);
  assert.equal((await post({ patientId: PACIENTE, records: {}, cambios: {} })).status, 400);
  assert.equal((await post({ patientId: "otro", cambios: {} })).status, 404);
  assert.deepEqual(estado(), antes);
});

test("GET /api/odontogram devuelve la clínica y el usuario de la SESIÓN (de quién es lo pendiente del autoguardado)", async () => {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../route");
  const res = await GET(new NextRequest(`http://localhost/api/odontogram?patientId=${PACIENTE}`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.clinicId, CLINICA);
  assert.equal(body.userId, "u_dr", "antes de reintentar, la cola comprueba que la sesión siga siendo la misma (t8 N3-O2)");
  assert.deepEqual(body.notes, { 11: "sensible" });
});

test("t8 N4-O5 / N4-O6: el modo viejo vuelve a poner lo que otra pestaña quitó (aceptado, decisión 8) y la bitácora dice QUÉ añadió", async () => {
  // La consulta vieja cargó con el rct del 36 y la caries del 16. Mientras
  // estaba abierta, en el Odontograma alguien quitó el rct del 36. El JS viejo
  // manda todo lo que cargó → el rct vuelve. Es lo que hace hoy producción y
  // solo pasa con pestañas de antes del despliegue y hasta el 1-dic-2026.
  FILAS = FILAS.filter((f) => !(f.toothNumber === 36 && f.conditionId === "rct"));
  const res = await post({
    patientId: PACIENTE,
    records: {
      16: { surfaces: { O: ["caries"] }, tooth: [] },
      36: { surfaces: {}, tooth: ["rct"] },
      21: { surfaces: { I: ["caries"] }, tooth: [] },
      24: { surfaces: {}, tooth: [], note: "movilidad" },
    },
  });
  assert.equal(res.status, 200);
  assert.ok(estado().includes("36:-:rct"), "vuelve (límite aceptado, N4-O5)");
  const after = AUDIT[0].changes._odontogram.after;
  assert.equal(after.creadas, 3);
  assert.deepEqual(after.agregadas.slice().sort(), ["21:O:caries", "24:-:__note__", "36:-:rct"],
    "qué se añadió, para poder rastrear un hallazgo que reapareció (N4-O6)");
  assert.deepEqual(after.sinQuitarClaves, [], "nada quedó sin quitar: la consulta traía todo lo que hay");
});

/* ---------------- N4-O2: la cadena completa (cola → adaptador → rutas) ---------------- */

const DRA_A = { userId: "u_dr", clinicId: CLINICA };
const DR_B = { id: "u_b", role: "DOCTOR", clinicId: CLINICA };

/** El navegador: cada fetch del adaptador llega a la ruta real con la cookie de ahora. */
async function navegador() {
  const { NextRequest } = await import("next/server");
  const raiz = await import("../route");
  const nota = await import("../note/route");
  const reset = await import("../reset/route");
  const vistos: { metodo: string; ruta: string; keepalive: boolean; cabecera: string | null; status: number }[] = [];
  let sinRed = false;
  const fetchFalso = async (url: string, init: RequestInit = {}) => {
    if (sinRed) throw new TypeError("Failed to fetch");
    const req = new NextRequest(new URL(url, "http://localhost"), init as any);
    const metodo = (init.method ?? "GET").toUpperCase();
    const ruta = req.nextUrl.pathname;
    const mod: any = ruta.endsWith("/note") ? nota : ruta.endsWith("/reset") ? reset : raiz;
    const res: Response = await mod[metodo](req);
    vistos.push({ metodo, ruta, keepalive: !!init.keepalive, cabecera: req.headers.get("x-odontograma-sesion"), status: res.status });
    return res;
  };
  return { vistos, fetchFalso, cortarRed: (v: boolean) => { sinRed = v; } };
}

test("t8 N4-O2: con la sesión del Dr. B en otra pestaña, NADA de la Dra. A sale firmado por B — ni lo nuevo, ni el reintento, ni el keepalive", async () => {
  const { SaveQueue } = await import("@/components/dashboard/odontogram-v2/autosave");
  const adapter = await import("@/components/dashboard/odontogram-v2/adapter");
  const nav = await navegador();
  const realFetch = globalThis.fetch;
  globalThis.fetch = nav.fetchFalso as unknown as typeof fetch;
  const fired: (() => void)[] = [];
  try {
    const q = new SaveQueue({
      send: (op, o) => op.kind === "put"
        ? adapter.putFinding({ patientId: PACIENTE, toothNumber: op.toothNumber, surface: op.surface, conditionId: op.conditionId }, o)
        : op.kind === "note" ? adapter.setNote(PACIENTE, op.toothNumber, op.text, o)
        : op.kind === "reset" ? adapter.resetOdontogram(PACIENTE, o)
        : adapter.deleteFinding({ patientId: PACIENTE, toothNumber: op.toothNumber, surface: op.surface, conditionId: op.conditionId }, o),
      whoAmI: adapter.fetchQuienSoy,
      setTimer: (fn) => { fired.push(fn); return fired.length; }, clearTimer: () => {},
    });
    q.setOwner(DRA_A); // la página se pintó con la Dra. A
    const antes = estado();

    // 1) el servidor falla un momento (sin red) con algo de A en cola
    nav.cortarRed(true);
    q.enqueue({ kind: "put", toothNumber: 46, surface: null, conditionId: "crown" });
    await new Promise((r) => setImmediate(r));
    assert.equal(q.getStatus().state, "retrying");
    // …y en ese rato el Dr. B entra en otra pestaña del mismo navegador
    nav.cortarRed(false);
    COOKIE = DR_B;
    // vence el temporizador del reintento: antes de mandar se pregunta quién es
    fired.shift()!();
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    assert.ok(!nav.vistos.some((v) => v.metodo === "PUT"), "el reintento NO sale con B");
    assert.equal(q.getStatus().state, "error");
    assert.match(q.getStatus().error ?? "", /La sesión de esta pestaña cambió/);

    // 2) una marca NUEVA de la Dra. A en su pestaña: sale, pero el servidor la para (409) sin escribir
    q.enqueue({ kind: "note", toothNumber: 11, text: "fractura" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    const put11 = nav.vistos.find((v) => v.ruta.endsWith("/note"));
    assert.equal(put11?.status, 409);
    assert.equal(put11?.cabecera, "u_dr|cli_1", "lleva la sesión con que se abrió al paciente");
    assert.match(q.getStatus().error ?? "", /La sesión de esta pestaña cambió/);
    assert.deepEqual(estado(), antes, "nada escrito con la cookie de B");

    // 3) «Limpiar todo» y una caries, y cierra la pestaña antes de que salgan:
    //    keepalive de lo pendiente… el servidor tampoco lo escribe
    q.enqueue({ kind: "reset" });
    q.enqueue({ kind: "put", toothNumber: 26, surface: "O", conditionId: "caries" });
    q.flushForUnload();
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    const ka = nav.vistos.filter((v) => v.keepalive);
    // el «Limpiar todo» va primero y lo demás solo si ese entró (si no, lo borraría detrás)
    assert.deepEqual(ka.map((v) => `${v.metodo} ${v.ruta}`), ["POST /api/odontogram/reset"], "salió por keepalive…");
    assert.ok(ka.every((v) => v.cabecera === "u_dr|cli_1" && v.status === 409), "…con la sesión de A, y el servidor no lo escribió");
    assert.ok(nav.vistos.filter((v) => v.metodo !== "GET").every((v) => v.status === 409), JSON.stringify(nav.vistos));
    assert.deepEqual(estado(), antes, "ni el «Limpiar todo» ni la caries se escribieron con B");
    assert.equal(AUDIT.length, 0);

    // el «Limpiar todo» rechazado no se aparta para después: se descarta con
    // aviso (verificación final, V-O1)
    assert.equal(q.getStatus().discarded, 1);
    assert.match(q.getStatus().error ?? "", /La sesión de esta pestaña cambió/);

    // 4) vuelve la Dra. A y pulsa «Reintentar»: ahora sí, con su sesión
    COOKIE = DR_DE_LA_COOKIE;
    assert.equal(await q.retryNow(), true);
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    assert.equal(q.hasPending(), false);
    assert.ok(nav.vistos.filter((v) => v.metodo !== "GET").every((v) => v.cabecera === "u_dr|cli_1"));
    assert.ok(!nav.vistos.some((v) => v.ruta.endsWith("/reset") && v.status !== 409), "el «Limpiar todo» no se reintenta");
    assert.deepEqual(estado(), [...antes, "26:O:caries"].sort(), "lo que marcó después, sin borrar nada");
    assert.equal(q.getStatus().state, "discarded");
    assert.match(q.getStatus().error ?? "", /El «Limpiar todo» de hace un momento no se aplicó; si lo quieres, vuelve a pulsarlo\./);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("t8 N4-O2: sin cabecera (otras pantallas, JS de antes) no se compara; una cabecera ilegible no escribe; GET ?quien=1 no mira al paciente", async () => {
  const { PUT, GET } = await import("../route");
  const { NextRequest } = await import("next/server");
  const pedir = (cabecera?: string) => PUT(new NextRequest("http://localhost/api/odontogram", {
    method: "PUT",
    body: JSON.stringify({ patientId: PACIENTE, toothNumber: 21, surface: "V", conditionId: "caries" }),
    headers: { "content-type": "application/json", ...(cabecera ? { "x-odontograma-sesion": cabecera } : {}) },
  }));
  assert.equal((await pedir()).status, 200);
  assert.equal((await pedir("u_dr|cli_2")).status, 409, "otra sede");
  assert.equal((await pedir("basura")).status, 409);
  assert.equal((await pedir("u_dr|%E0%A4%A")).status, 409, "mal codificada");
  assert.equal(FILAS.filter((f) => f.toothNumber === 21).length, 1);
  // «¿quién soy?» con un paciente que no existe: responde igual (un 404 de verdad se reconoce como tal)
  const r = await GET(new NextRequest("http://localhost/api/odontogram?quien=1&patientId=borrado"));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { clinicId: CLINICA, userId: "u_dr" });
  COOKIE = null;
  assert.equal((await GET(new NextRequest("http://localhost/api/odontogram?quien=1"))).status, 401);
});

test("t8 V-O1 y V-O3 (verificación final), con la cadena completa: el «Limpiar todo» viejo no borra lo de después; la sesión vencida se dice", async () => {
  const { SaveQueue } = await import("@/components/dashboard/odontogram-v2/autosave");
  const adapter = await import("@/components/dashboard/odontogram-v2/adapter");
  const nav = await navegador();
  const realFetch = globalThis.fetch;
  globalThis.fetch = nav.fetchFalso as unknown as typeof fetch;
  const fired: (() => void)[] = [];
  let ahora = Date.parse("2026-10-20T10:00:00Z");
  try {
    const q = new SaveQueue({
      send: (op, o) => op.kind === "put"
        ? adapter.putFinding({ patientId: PACIENTE, toothNumber: op.toothNumber, surface: op.surface, conditionId: op.conditionId }, o)
        : op.kind === "note" ? adapter.setNote(PACIENTE, op.toothNumber, op.text, o)
        : op.kind === "reset" ? adapter.resetOdontogram(PACIENTE, o)
        : adapter.deleteFinding({ patientId: PACIENTE, toothNumber: op.toothNumber, surface: op.surface, conditionId: op.conditionId }, o),
      whoAmI: adapter.fetchQuienSoy,
      now: () => ahora,
      setTimer: (fn) => { fired.push(fn); return fired.length; }, clearTimer: () => {},
    });
    q.setOwner(DRA_A);
    const antes = estado();
    // V-O1: sin red, «Limpiar todo»; a los 10 min, una corona en el 46; la red vuelve a los 16
    nav.cortarRed(true);
    q.enqueue({ kind: "reset" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    ahora += 10 * 60_000;
    q.enqueue({ kind: "put", toothNumber: 46, surface: null, conditionId: "crown" });
    ahora += 6 * 60_000;
    nav.cortarRed(false);
    fired.shift()!();
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(estado(), [...antes, "46:-:crown"].sort());
    assert.match(q.getStatus().error ?? "", /El «Limpiar todo» de hace 16 min no se aplicó; si lo quieres, vuelve a pulsarlo\./);
    await q.retryNow();
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    assert.ok(!nav.vistos.some((v) => v.ruta.endsWith("/reset")), "el «Limpiar todo» viejo nunca llegó al servidor");
    assert.deepEqual(estado(), [...antes, "46:-:crown"].sort(), "la corona guardada sigue");

    // V-O3: un fallo del servidor y, mientras, vence la sesión (la ruta real da 401 a ?quien=1)
    nav.cortarRed(true);
    q.enqueue({ kind: "put", toothNumber: 26, surface: "O", conditionId: "caries" });
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    nav.cortarRed(false);
    COOKIE = null;
    fired.shift()!();
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    const quien = nav.vistos.filter((v) => v.ruta === "/api/odontogram" && v.metodo === "GET").at(-1);
    assert.equal(quien?.status, 401);
    assert.equal(q.getStatus().state, "error");
    assert.equal(q.getStatus().error, adapter.SESION_VENCIDA);
    assert.equal(fired.length, 0, "no se queda «reintentando» para siempre");
    assert.equal(q.hasPending(), true, "lo pendiente se queda");
    // vuelve a entrar y pulsa «Reintentar»: se guarda con su sesión
    COOKIE = DR_DE_LA_COOKIE;
    assert.equal(await q.retryNow(), true);
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
    assert.equal(q.hasPending(), false);
    assert.deepEqual(estado(), [...antes, "26:O:caries", "46:-:crown"].sort());
  } finally {
    globalThis.fetch = realFetch;
  }
});
