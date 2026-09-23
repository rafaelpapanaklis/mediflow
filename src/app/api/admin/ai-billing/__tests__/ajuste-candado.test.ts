/**
 * CANDADO DE «AJUSTAR SALDO» — un doble envío no aplica dos ajustes, y nunca
 * se crea un monedero en negativo.
 *
 * Run: npm run test:ajuste-candado
 *
 * Conduce la RUTA real (`POST /api/admin/ai-billing/adjust`) contra un doble
 * de prisma con tablas en memoria que aplica el `where` de verdad (clinicId,
 * reference, type, source, amountCents, note, createdAt gte). Lo que se
 * comprueba es lo que le pasa al dinero: cuántos asientos quedan en el libro
 * mayor y en qué saldo termina el monedero.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Fila = Record<string, any>;

// ── Doble de prisma ─────────────────────────────────────────────────────────

let tablas: { clinic: Fila[]; aiWallet: Fila[]; aiWalletTransaction: Fila[] };
let secuencia = 0;

function cumple(fila: Fila, where: any): boolean {
  if (!where) return true;
  for (const [clave, cond] of Object.entries(where)) {
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      for (const [op, v] of Object.entries(cond as Record<string, any>)) {
        if (op === "gte") { if (!(fila[clave] >= v)) return false; }
        else if (op === "gt") { if (!(fila[clave] > v)) return false; }
        else throw new Error(`operador sin doble: ${op}`); // nada de falsos verdes
      }
      continue;
    }
    if (fila[clave] !== cond) return false;
  }
  return true;
}

function buscar(nombre: keyof typeof tablas, { where, orderBy, take }: any = {}) {
  let filas = tablas[nombre].filter((f) => cumple(f, where));
  if (orderBy?.createdAt === "desc") {
    filas = [...filas].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  return typeof take === "number" ? filas.slice(0, take) : filas;
}

// Cada ida a la base cede el turno, como un `await` contra Postgres: así dos
// peticiones simultáneas se ENTRELAZAN de verdad (A lee, B lee, A escribe…).
// Sin esta pausa el doble contesta tan rápido que las dos corren en fila y la
// prueba de concurrencia pasaría también sin candado.
const idaALaBase = () => new Promise<void>((r) => setImmediate(r));

const modeloSoloLectura = (nombre: keyof typeof tablas) => ({
  findUnique: async (args: any) => { await idaALaBase(); return buscar(nombre, args)[0] ?? null; },
  findFirst: async (args: any) => { await idaALaBase(); return buscar(nombre, args)[0] ?? null; },
  findMany: async (args: any) => { await idaALaBase(); return buscar(nombre, args); },
});

let bloqueos: string[] = [];

// pg_advisory_xact_lock DE VERDAD: una cola por clave que se suelta cuando
// termina la transacción que la tomó. Sin esto, la prueba de dos envíos
// simultáneos pasaría también con la ruta sin candado.
const colas = new Map<string, Promise<void>>();

// Barrera para las pruebas de envíos simultáneos. Sin ella, que las dos
// peticiones se crucen depende de cuánto tarde cada `req.json()`, y la prueba
// podría pasar sin candado por pura suerte. Con ella, cada transacción espera
// en su primera lectura a que llegue la otra (plazo 50 ms): sin candado se
// cruzan SIEMPRE; con candado la segunda está bloqueada, la primera agota el
// plazo y sigue sola.
let barrera: { llegadas: number; soltar: Array<() => void> } | null = null;

async function esperarALaOtra() {
  if (!barrera) return;
  const b = barrera;
  b.llegadas++;
  if (b.llegadas >= 2) { b.soltar.forEach((s) => s()); return; }
  await new Promise<void>((r) => {
    b.soltar.push(r);
    setTimeout(r, 50);
  });
}

function nuevaTx(soltarAlFinal: Array<() => void>) {
  let primeraLectura = true;
  return {
  $executeRaw: async (partes: TemplateStringsArray, ...valores: any[]) => {
    assert.match(partes.join("?"), /pg_advisory_xact_lock/, "el ajuste se serializa por clínica");
    const clave = String(valores[0]);
    bloqueos.push(clave);
    const anterior = colas.get(clave) ?? Promise.resolve();
    let soltar!: () => void;
    const mia = new Promise<void>((r) => { soltar = r; });
    colas.set(clave, anterior.then(() => mia));
    soltarAlFinal.push(soltar);
    await anterior;
    return 1;
  },
  clinic: modeloSoloLectura("clinic"),
  aiWalletTransaction: {
    ...modeloSoloLectura("aiWalletTransaction"),
    findFirst: async (args: any) => {
      if (primeraLectura) { primeraLectura = false; await esperarALaOtra(); }
      return modeloSoloLectura("aiWalletTransaction").findFirst(args);
    },
    create: async ({ data }: any) => {
      await idaALaBase();
      const fila = { id: `txn_${++secuencia}`, createdAt: new Date(), ...data };
      tablas.aiWalletTransaction.push(fila);
      return fila;
    },
  },
  aiWallet: {
    ...modeloSoloLectura("aiWallet"),
    upsert: async ({ where, create, update }: any) => {
      await idaALaBase();
      const existente = tablas.aiWallet.find((w) => w.clinicId === where.clinicId);
      if (existente) {
        existente.balanceCents += update.balanceCents.increment;
        return existente;
      }
      const fila = { id: `w_${++secuencia}`, status: "ACTIVE", ...create };
      tablas.aiWallet.push(fila);
      return fila;
    },
  },
  };
}

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: modeloSoloLectura("clinic"),
      aiWallet: modeloSoloLectura("aiWallet"),
      aiWalletTransaction: modeloSoloLectura("aiWalletTransaction"),
      $transaction: async (fn: (t: ReturnType<typeof nuevaTx>) => Promise<any>) => {
        const soltar: Array<() => void> = [];
        try {
          return await fn(nuevaTx(soltar));
        } finally {
          soltar.forEach((s) => s()); // COMMIT/ROLLBACK suelta el candado
        }
      },
    },
  },
});

(mock as any).module("@/lib/admin-auth", {
  namedExports: { getAdminSession: async () => ({ user: { id: "adm1", email: "admin@dalecontrol.test" } }) },
});

const auditorias: any[] = [];
(mock as any).module("@/lib/admin-audit", {
  namedExports: {
    logAdminClinicMutation: async (opts: any) => { auditorias.push(opts); },
    logAdminGlobalEvent: () => {},
  },
});

// ── Conducir la ruta ────────────────────────────────────────────────────────

async function ajustar(body: Record<string, any>) {
  const { POST } = await import("@/app/api/admin/ai-billing/adjust/route");
  const req = new Request("http://dalecontrol.test/api/admin/ai-billing/adjust", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req as any);
  return { status: res.status, body: await res.json() };
}

const asientos = () => tablas.aiWalletTransaction.filter((t) => t.type === "ADJUSTMENT");
const saldo = (clinicId: string) => tablas.aiWallet.find((w) => w.clinicId === clinicId)?.balanceCents;

beforeEach(() => {
  secuencia = 0;
  bloqueos = [];
  colas.clear();
  barrera = null;
  auditorias.length = 0;
  tablas = {
    clinic: [{ id: "bevadent" }, { id: "sin-monedero" }],
    aiWallet: [{ id: "w0", clinicId: "bevadent", balanceCents: 10_000, status: "ACTIVE" }],
    aiWalletTransaction: [],
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Doble envío
// ═══════════════════════════════════════════════════════════════════════════

test("la misma petición dos veces (mismo requestId) aplica UN ajuste y la segunda lo devuelve sin repetirlo", async () => {
  const cuerpo = { clinicId: "bevadent", amountCents: 20_000, note: "Pago Stripe no acreditado", requestId: "11111111-2222-4333-8444-555555555555" };
  const primera = await ajustar(cuerpo);
  const segunda = await ajustar(cuerpo);

  assert.equal(primera.status, 201);
  assert.equal(primera.body.balanceAfterCents, 30_000);
  assert.equal(segunda.status, 200);
  assert.equal(segunda.body.repeated, true);
  assert.equal(segunda.body.transactionId, primera.body.transactionId, "devuelve el asiento ya hecho");

  assert.equal(asientos().length, 1, "solo un asiento en el libro mayor");
  assert.equal(saldo("bevadent"), 30_000, "el saldo subió una sola vez");
  assert.equal(auditorias.length, 1, "la repetición no se audita como otro ajuste");
  assert.equal(asientos()[0].reference, "admin-adjust:11111111-2222-4333-8444-555555555555");
  assert.deepEqual(bloqueos, ["ai-wallet-adjust:bevadent", "ai-wallet-adjust:bevadent"], "cada intento tomó el candado de la clínica");
});

test("un ajuste idéntico desde otra pestaña (otro requestId) dentro de la ventana se rechaza con 409", async () => {
  const a = await ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía", requestId: "aaaaaaaa-0000-4000-8000-000000000001" });
  const b = await ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía", requestId: "bbbbbbbb-0000-4000-8000-000000000002" });
  const c = await ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía" }); // sin clave

  assert.equal(a.status, 201);
  assert.equal(b.status, 409);
  assert.equal(b.body.code, "AJUSTE_DUPLICADO");
  assert.equal(c.status, 409);
  assert.equal(asientos().length, 1);
  assert.equal(saldo("bevadent"), 30_000);
});

test("dos envíos SIMULTÁNEOS del mismo ajuste (doble clic que se saltó el botón): uno se aplica, el otro no", async () => {
  barrera = { llegadas: 0, soltar: [] };
  const cuerpo = { clinicId: "bevadent", amountCents: 20_000, note: "cortesía", requestId: "cccccccc-0000-4000-8000-000000000003" };
  const [a, b] = await Promise.all([ajustar(cuerpo), ajustar(cuerpo)]);

  assert.deepEqual([a.status, b.status].sort(), [200, 201], "uno aplica (201) y el otro lo encuentra hecho (200)");
  assert.equal(asientos().length, 1, "un solo asiento");
  assert.equal(saldo("bevadent"), 30_000, "el saldo subió una sola vez");
});

test("dos pestañas SIMULTÁNEAS con el mismo ajuste (otra clave): uno se aplica y el otro recibe 409", async () => {
  barrera = { llegadas: 0, soltar: [] };
  const [a, b] = await Promise.all([
    ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía", requestId: "dddddddd-0000-4000-8000-000000000004" }),
    ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía", requestId: "eeeeeeee-0000-4000-8000-000000000005" }),
  ]);

  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(asientos().length, 1);
  assert.equal(saldo("bevadent"), 30_000);
});

test("el candado es POR clínica: dos clínicas distintas a la vez no se estorban", async () => {
  barrera = { llegadas: 0, soltar: [] };
  tablas.clinic.push({ id: "otra" });
  tablas.aiWallet.push({ id: "w9", clinicId: "otra", balanceCents: 0, status: "ACTIVE" });
  const [a, b] = await Promise.all([
    ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía" }),
    ajustar({ clinicId: "otra", amountCents: 20_000, note: "cortesía" }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(saldo("otra"), 20_000);
});

test("la misma clave con OTRO importe (respuesta perdida y el admin corrigió la cifra): 409, ni se aplica ni se da por hecha", async () => {
  const clave = "ffffffff-0000-4000-8000-000000000006";
  const a = await ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía", requestId: clave });
  const b = await ajustar({ clinicId: "bevadent", amountCents: 25_000, note: "cortesía", requestId: clave });

  assert.equal(a.status, 201);
  assert.equal(b.status, 409);
  assert.equal(b.body.code, "CLAVE_REUTILIZADA");
  assert.match(b.body.error, /200\.00/, "le dice qué importe ya entró");
  assert.notEqual(b.body.repeated, true, "no le dice al admin que su ajuste de $250 ya entró");
  assert.equal(asientos().length, 1);
  assert.equal(saldo("bevadent"), 30_000);
});

test("otro importe u otra nota sí pasan: no es un duplicado", async () => {
  await ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía" });
  const otroImporte = await ajustar({ clinicId: "bevadent", amountCents: 5_000, note: "cortesía" });
  const otraNota = await ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "segunda cortesía" });

  assert.equal(otroImporte.status, 201);
  assert.equal(otraNota.status, 201);
  assert.equal(asientos().length, 3);
  assert.equal(saldo("bevadent"), 10_000 + 20_000 + 5_000 + 20_000);
});

test("el mismo ajuste fuera de la ventana (hace 3 min) vuelve a aplicarse", async () => {
  tablas.aiWalletTransaction.push({
    id: "viejo", clinicId: "bevadent", type: "ADJUSTMENT", source: "ADMIN",
    amountCents: 20_000, balanceAfterCents: 30_000, note: "cortesía", reference: null,
    createdAt: new Date(Date.now() - 3 * 60_000),
  });
  const res = await ajustar({ clinicId: "bevadent", amountCents: 20_000, note: "cortesía" });
  assert.equal(res.status, 201);
  assert.equal(asientos().length, 2);
});

test("la nota vacía cuenta como la misma nota (null) a efectos del duplicado", async () => {
  const a = await ajustar({ clinicId: "bevadent", amountCents: -1_000 });
  const b = await ajustar({ clinicId: "bevadent", amountCents: -1_000, note: "   " });
  assert.equal(a.status, 201);
  assert.equal(b.status, 409);
  assert.equal(saldo("bevadent"), 9_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Saldo negativo
// ═══════════════════════════════════════════════════════════════════════════

test("sin monedero, un ajuste negativo se rechaza y NO crea un monedero en negativo", async () => {
  const res = await ajustar({ clinicId: "sin-monedero", amountCents: -5_000, note: "cargo" });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "SIN_MONEDERO");
  assert.equal(saldo("sin-monedero"), undefined, "no se creó monedero");
  assert.equal(asientos().length, 0);
});

test("sin monedero, un abono sí lo crea con ese saldo", async () => {
  const res = await ajustar({ clinicId: "sin-monedero", amountCents: 5_000, note: "abono inicial" });
  assert.equal(res.status, 201);
  assert.equal(saldo("sin-monedero"), 5_000);
});

test("con monedero, dejar el saldo en negativo sigue permitido (es una deuda que la pantalla confirma)", async () => {
  const res = await ajustar({ clinicId: "bevadent", amountCents: -15_000, note: "consumo fuera del bot" });
  assert.equal(res.status, 201);
  assert.equal(res.body.balanceAfterCents, -5_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Bordes
// ═══════════════════════════════════════════════════════════════════════════

test("el tope de ±$50,000 MXN sigue vigente", async () => {
  const res = await ajustar({ clinicId: "bevadent", amountCents: 5_000_001 });
  assert.equal(res.status, 400);
  assert.equal(asientos().length, 0);
});

test("un requestId con forma rara se ignora en vez de romper (y el candado de ventana sigue)", async () => {
  const a = await ajustar({ clinicId: "bevadent", amountCents: 1_000, requestId: "<script>" });
  const b = await ajustar({ clinicId: "bevadent", amountCents: 1_000, requestId: "<script>" });
  assert.equal(a.status, 201);
  assert.equal(asientos()[0].reference, null, "no se guardó una referencia inventada");
  assert.equal(b.status, 409, "sin clave válida, el duplicado lo frena la ventana");
});

test("clínica inexistente: 404 y nada en el libro mayor", async () => {
  const res = await ajustar({ clinicId: "nadie", amountCents: 1_000 });
  assert.equal(res.status, 404);
  assert.equal(asientos().length, 0);
});
