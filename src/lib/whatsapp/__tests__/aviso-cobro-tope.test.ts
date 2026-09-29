// ws1-t10 — el tope de un aviso de cobro por teléfono: cuenta el AUTOMÁTICO y se reserva
// antes de enviar (dos clics a la vez no mandan dos).
// Correr: npx tsx --test src/lib/whatsapp/__tests__/aviso-cobro-tope.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoAutomaticoDeCobroReciente,
  clavePorTelefono,
  reservarAvisoDeCobro,
  VIGENCIA_RESERVA_MS,
  type DbReserva,
} from "../aviso-cobro-tope";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Doble de Prisma: las transacciones se serializan (como el candado de Postgres) y auditLog es una lista. */
function doble() {
  const filas: Array<{ clinicId: string; entityType: string; entityId: string; action: string; createdAt: Date; n: number }> = [];
  let cola: Promise<unknown> = Promise.resolve();
  let n = 0;
  const insertar = (data: any[]) => data.forEach((d) => filas.push({ ...d, createdAt: new Date(), n: n++ }));
  const tx = {
    $executeRaw: async () => {},
    auditLog: {
      findFirst: async ({ where }: any) =>
        [...filas].filter((f) => f.clinicId === where.clinicId && f.entityType === where.entityType && f.entityId === where.entityId).sort((a, b) => b.n - a.n)[0] ?? null,
      createMany: async ({ data }: any) => insertar(data),
    },
  };
  const db: DbReserva = {
    $transaction: (fn: any) => {
      const r = cola.then(() => fn(tx));
      cola = r.catch(() => {});
      return r;
    },
    auditLog: { createMany: async ({ data }: any) => insertar(data) },
  };
  return { db, filas };
}

test("dos envíos a la vez al mismo teléfono: solo UNO reserva", async () => {
  const { db } = doble();
  const a = { clinicId: "c1", userId: "u1", telefonos: ["+52 55 1234 5678"] };
  const [r1, r2] = await Promise.all([reservarAvisoDeCobro(a, db), reservarAvisoDeCobro({ ...a, telefonos: ["5512345678"] }, db)]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1);
});

test("al liberar, se puede volver a reservar; sin liberar, la reserva caduca a los 90 s", async () => {
  const { db } = doble();
  const a = { clinicId: "c1", userId: "u1", telefonos: ["5512345678"] };
  const r1 = await reservarAvisoDeCobro(a, db);
  assert.equal(r1.ok, true);
  assert.equal((await reservarAvisoDeCobro(a, db)).ok, false);
  if (r1.ok) await r1.liberar();
  const r3 = await reservarAvisoDeCobro(a, db);
  assert.equal(r3.ok, true); // liberada
  // sin liberar y pasados 90 s: caduca
  const despues = new Date(Date.now() + VIGENCIA_RESERVA_MS + 1000);
  assert.equal((await reservarAvisoDeCobro({ ...a, ahora: despues }, db)).ok, true);
});

test("teléfonos distintos o clínicas distintas no se estorban", async () => {
  const { db } = doble();
  assert.equal((await reservarAvisoDeCobro({ clinicId: "c1", userId: "u", telefonos: ["5511111111"] }, db)).ok, true);
  assert.equal((await reservarAvisoDeCobro({ clinicId: "c1", userId: "u", telefonos: ["5522222222"] }, db)).ok, true);
  assert.equal((await reservarAvisoDeCobro({ clinicId: "c2", userId: "u", telefonos: ["5511111111"] }, db)).ok, true);
});

test("paciente y responsable: reservar los dos teléfonos bloquea a quien llegue por cualquiera de ellos", async () => {
  const { db } = doble();
  assert.equal((await reservarAvisoDeCobro({ clinicId: "c1", userId: "u", telefonos: ["5511111111", "5522222222"] }, db)).ok, true);
  assert.equal((await reservarAvisoDeCobro({ clinicId: "c1", userId: "u", telefonos: ["5522222222"] }, db)).ok, false);
});

test("si la reserva falla (bitácora o candado), NO se bloquea el envío", async () => {
  const roto: DbReserva = { $transaction: async () => { throw new Error("boom"); }, auditLog: { createMany: async () => {} } };
  assert.equal((await reservarAvisoDeCobro({ clinicId: "c1", userId: "u", telefonos: ["5511111111"] }, roto)).ok, true);
});

test("sin clínica o sin teléfono usable: no se reserva nada y se deja pasar", async () => {
  const { db, filas } = doble();
  assert.equal((await reservarAvisoDeCobro({ clinicId: "", userId: "u", telefonos: ["5511111111"] }, db)).ok, true);
  assert.equal((await reservarAvisoDeCobro({ clinicId: "c1", userId: "u", telefonos: ["12"] }, db)).ok, true);
  assert.equal(filas.length, 0);
});

test("clavePorTelefono: últimos 10 dígitos, sin repetir y en orden fijo", () => {
  assert.deepEqual(clavePorTelefono(["+52 (55) 2222-2222", "5511111111", "5522222222"]), ["5511111111", "5522222222"]);
});

test("el aviso AUTOMÁTICO de mensualidad (fila PAYMENT_DUE enviada) cuenta; una pendiente o de otro teléfono, no", async () => {
  const sentAt = new Date(Date.now() - 3600_000);
  let consulta: any = null;
  const db = { whatsAppReminder: { findFirst: async (q: any) => { consulta = q; return { sentAt }; } } } as any;
  const r = await avisoAutomaticoDeCobroReciente("c1", "+52 55 1234 5678", new Date(), db);
  assert.equal(r?.getTime(), sentAt.getTime());
  assert.equal(consulta.where.clinicId, "c1");
  assert.equal(consulta.where.type, "PAYMENT_DUE");
  assert.equal(consulta.where.status, "SENT");
  assert.deepEqual(consulta.where.patientPhone, { endsWith: "5512345678" });
  assert.ok(consulta.where.sentAt.gte instanceof Date);
  // sin clínica / sin teléfono: ni consulta
  consulta = null;
  assert.equal(await avisoAutomaticoDeCobroReciente("", "5512345678", new Date(), db), null);
  assert.equal(await avisoAutomaticoDeCobroReciente("c1", "", new Date(), db), null);
  assert.equal(consulta, null);
  // si la consulta falla: null (no bloquea)
  assert.equal(await avisoAutomaticoDeCobroReciente("c1", "5512345678", new Date(), { whatsAppReminder: { findFirst: async () => { throw new Error("x"); } } } as any), null);
});

test("la ruta de la factura y el recordatorio de Alertas usan el tope nuevo y reservan antes de enviar", () => {
  const r = leer("app/api/invoices/[id]/send-whatsapp/route.ts");
  assert.match(r, /ultimoAvisoDeCobroEnTelefonos\(ctx\.clinicId, telefonos\)/);
  assert.match(r, /reservarAvisoDeCobro\(\{ clinicId: ctx\.clinicId, userId: ctx\.userId, telefonos \}\)/);
  assert.match(r, /code: "AVISO_EN_CURSO"/);
  assert.match(r, /finally \{\s*await reserva\.liberar\(\);/);
  const m = leer("app/actions/orthodontics/whatsapp/sendMensualidadReminder.ts");
  assert.match(m, /ultimoAvisoDeCobro\(ctx\.clinicId, telefonoDestino, ahora\)/);
  assert.match(m, /reservarAvisoDeCobro\(\{ clinicId: ctx\.clinicId, userId: ctx\.userId, telefonos: \[telefonoDestino\] \}\)/);
  assert.match(m, /finally \{\s*await reserva\.liberar\(\);/);
});
