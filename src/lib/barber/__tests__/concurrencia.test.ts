import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_DEPOSIT_LINE_PREFIX,
  addDays,
  buildConsumeWhere,
  depositLineDescription,
  isDepositLine,
} from "../memberships-core";

// Correr:  npx tsx --test src/lib/barber/__tests__/concurrencia.test.ts
//
// ═══════════════════════════════════════════════════════════════════════
// QUÉ PRUEBA ESTE ARCHIVO (y qué NO)
//
// Prueba que las DECISIONES de esta ola aguantan dos peticiones al mismo
// tiempo, ejecutando el mismo predicado que se manda a Prisma contra un
// motor que imita las dos garantías de Postgres que usamos:
//
//  1. UPDATE ... WHERE de UNA sentencia: la condición se evalúa contra la
//     versión ya actualizada de la fila (READ COMMITTED re-verifica el WHERE
//     tras esperar el lock). Aquí se modela como una sección crítica que no
//     cede el control a la mitad.
//  2. SELECT ... FOR UPDATE dentro de una transacción: serializa a quien
//     llegue a la misma fila.
//
// Cada caso trae su CONTROL: la versión ingenua (leer y luego escribir, o
// revisar sin candado) que SÍ rompe el invariante. Si el arreglo se cayera,
// el test no pasaría por casualidad — el control demuestra que sabe
// distinguir.
//
// Lo que NO prueba: que Postgres cumpla esas dos garantías. Eso es
// comportamiento documentado del motor, no de este código.
// ═══════════════════════════════════════════════════════════════════════

const NOW = new Date("2026-08-24T12:00:00.000Z");
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ── Motor mínimo: evalúa el subconjunto de `where` que usa la ola ──────
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("gt" in cond && !(value > cond.gt)) return false;
      if ("lt" in cond && !(value < cond.lt)) return false;
      if ("lte" in cond && !(value <= cond.lte)) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

class MembershipRow {
  row: Record<string, any>;
  constructor(includedCuts: number | null) {
    this.row = {
      id: "cm_1",
      barbershopId: "shop_1",
      status: "ACTIVE",
      endAt: addDays(NOW, 10),
      cutsUsed: 0,
      includedCuts,
    };
  }
  /** UNA sentencia: el predicado y el incremento no se separan. */
  updateManyIncrement(where: Record<string, any>): number {
    if (!matches(this.row, where)) return 0;
    this.row.cutsUsed += 1;
    return 1;
  }
  async read(): Promise<Record<string, any>> {
    await tick();
    return { ...this.row };
  }
  async writeIncrement(): Promise<void> {
    await tick();
    this.row.cutsUsed += 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 1. El cupo nunca queda negativo — ni con peticiones simultáneas
// ═══════════════════════════════════════════════════════════════════════

async function consumeAtomic(store: MembershipRow): Promise<boolean> {
  // Latencia antes de la sentencia: aquí es donde se cruzan las peticiones.
  await tick();
  const where = buildConsumeWhere({
    clientMembershipId: "cm_1",
    barbershopId: "shop_1",
    includedCuts: store.row.includedCuts,
    now: NOW,
  });
  return store.updateManyIncrement(where) === 1;
}

/** CONTROL: leer, decidir en JS y luego escribir. Es el bug que evitamos. */
async function consumeNaive(store: MembershipRow): Promise<boolean> {
  const snapshot = await store.read();
  if (snapshot.includedCuts !== null && snapshot.cutsUsed >= snapshot.includedCuts) return false;
  await store.writeIncrement();
  return true;
}

test("membresía de 2 cortes: el tercero se cobra", async () => {
  const store = new MembershipRow(2);
  assert.equal(await consumeAtomic(store), true);
  assert.equal(await consumeAtomic(store), true);
  assert.equal(await consumeAtomic(store), false, "el tercer corte NO lo cubre la membresía");
  assert.equal(store.row.cutsUsed, 2);
});

test("5 cierres SIMULTÁNEOS sobre 2 cortes: solo 2 pasan y el cupo no se pasa", async () => {
  const store = new MembershipRow(2);
  const results = await Promise.all([
    consumeAtomic(store),
    consumeAtomic(store),
    consumeAtomic(store),
    consumeAtomic(store),
    consumeAtomic(store),
  ]);
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(store.row.cutsUsed, 2);
  assert.ok(store.row.cutsUsed <= store.row.includedCuts, "el cupo jamás se pasa");
});

test("CONTROL: leer-y-luego-escribir SÍ se pasa del cupo (por eso no se usa)", async () => {
  const store = new MembershipRow(2);
  const results = await Promise.all([
    consumeNaive(store),
    consumeNaive(store),
    consumeNaive(store),
    consumeNaive(store),
    consumeNaive(store),
  ]);
  // Los 5 leen cutsUsed = 0, los 5 creen tener cupo: 5 cortes regalados.
  assert.equal(results.filter(Boolean).length, 5);
  assert.ok(
    store.row.cutsUsed > store.row.includedCuts,
    "el control debe romperse: si no, la prueba no distingue nada",
  );
});

test("dos cierres simultáneos con UN solo corte disponible: gana uno", async () => {
  const store = new MembershipRow(1);
  const [a, b] = await Promise.all([consumeAtomic(store), consumeAtomic(store)]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal(store.row.cutsUsed, 1);
});

test("la ilimitada deja pasar a todos y nunca se queda sin cupo", async () => {
  const store = new MembershipRow(null);
  const results = await Promise.all(Array.from({ length: 6 }, () => consumeAtomic(store)));
  assert.equal(results.filter(Boolean).length, 6);
  assert.equal(store.row.cutsUsed, 6);
});

test("una membresía vencida no descuenta aunque le sobre cupo", async () => {
  const store = new MembershipRow(5);
  store.row.endAt = addDays(NOW, -1);
  assert.equal(await consumeAtomic(store), false);
  assert.equal(store.row.cutsUsed, 0);
});

test("una barbería NO puede descontar el cupo de otra", async () => {
  const store = new MembershipRow(2);
  const foreignWhere = buildConsumeWhere({
    clientMembershipId: "cm_1",
    barbershopId: "shop_2", // otra barbería
    includedCuts: 2,
    now: NOW,
  });
  assert.equal(store.updateManyIncrement(foreignWhere), 0);
  assert.equal(store.row.cutsUsed, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// 2. El anticipo no se aplica dos veces
// ═══════════════════════════════════════════════════════════════════════

class VisitLedger {
  items: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  /** SELECT ... FOR UPDATE sobre la cita: serializa a los concurrentes. */
  withApptLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  async countDepositLines(): Promise<number> {
    await tick();
    return this.items.filter(isDepositLine).length;
  }
  async insert(description: string): Promise<void> {
    await tick();
    this.items.push(description);
  }
}

async function applyDepositLocked(ledger: VisitLedger): Promise<boolean> {
  return ledger.withApptLock(async () => {
    if ((await ledger.countDepositLines()) > 0) return false;
    await ledger.insert(depositLineDescription("24 ago"));
    return true;
  });
}

/** CONTROL: la misma revisión SIN candado sobre la cita. */
async function applyDepositUnlocked(ledger: VisitLedger): Promise<boolean> {
  if ((await ledger.countDepositLines()) > 0) return false;
  await ledger.insert(depositLineDescription("24 ago"));
  return true;
}

test("el anticipo aplicado a un ticket no se puede aplicar dos veces", async () => {
  const ledger = new VisitLedger();
  assert.equal(await applyDepositLocked(ledger), true);
  assert.equal(await applyDepositLocked(ledger), false, "la segunda vez NO vuelve a descontar");
  assert.equal(ledger.items.filter(isDepositLine).length, 1);
});

test("dos aplicaciones SIMULTÁNEAS del mismo anticipo: solo una entra", async () => {
  const ledger = new VisitLedger();
  const results = await Promise.all([
    applyDepositLocked(ledger),
    applyDepositLocked(ledger),
    applyDepositLocked(ledger),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(ledger.items.filter(isDepositLine).length, 1);
});

test("CONTROL: sin el candado sobre la cita, el anticipo se descuenta dos veces", async () => {
  const ledger = new VisitLedger();
  const results = await Promise.all([applyDepositUnlocked(ledger), applyDepositUnlocked(ledger)]);
  assert.equal(results.filter(Boolean).length, 2);
  assert.ok(
    ledger.items.filter(isDepositLine).length > 1,
    "el control debe romperse: si no, la prueba no distingue nada",
  );
});

test("la línea de anticipo se reconoce por su prefijo reservado", () => {
  const line = depositLineDescription("24 ago");
  assert.ok(line.startsWith(BARBER_DEPOSIT_LINE_PREFIX));
  assert.equal(isDepositLine(line), true);
  assert.equal(isDepositLine("Corte de cabello"), false);
});
