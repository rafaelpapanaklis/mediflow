// «Ver como barbería» contra Postgres de verdad (ws6-t1, 16-nov): la bitácora
// barber_admin_impersonation_sessions con el SQL real (sql/barber_admin_ver_como.sql).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/ver-como-barberia-integration.test.ts
//
// Solo corre contra una base LOCAL y con el SQL pegado; si no, se salta.
// Fija: el registro queda con admin, barbería, dueño y vencimiento; la sesión
// se lee por su session_id; vencida = «terminada» y se marca 'vencida'; la
// salida la marca 'salida'; un session_id no se registra dos veces.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { skip as skipDb } from "./_base-local";
import {
  _reiniciarCacheVerComo,
  cerrarVerComo,
  estadoVerComoDe,
  registrarVerComo,
  tablaVerComoLista,
} from "@/lib/barber/ver-como";
import { VER_COMO_DURACION_MS } from "@/lib/barber/ver-como-core";

const RUN = `vcb${Date.now().toString(36)}`;
let skip: false | string = skipDb;

function jwt(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(claims)}.firma`;
}
const cliente = (sessionId: string) => ({
  auth: { getSession: async () => ({ data: { session: { access_token: jwt({ session_id: sessionId }) } } }) },
});

type Fila = { id: string; adminEmail: string; barbershopId: string; targetBarberUserId: string; nota: string; expiresAt: Date; endedAt: Date | null; endedReason: string | null };
async function fila(sessionId: string): Promise<Fila | undefined> {
  const r = await prisma.$queryRaw<Fila[]>`
    SELECT "id", "adminEmail", "barbershopId", "targetBarberUserId", "nota", "expiresAt", "endedAt", "endedReason"
    FROM "barber_admin_impersonation_sessions" WHERE "supabaseSessionId" = ${sessionId}`;
  return r[0];
}

async function nueva(sufijo: string, expiresAt = new Date(Date.now() + VER_COMO_DURACION_MS)) {
  return registrarVerComo({
    adminUserId: "adm-1", adminEmail: "admin@dalecontrol.com", barbershopId: `${RUN}-shop`,
    targetBarberUserId: `${RUN}-bu`, targetSupabaseId: `${RUN}-sb`, supabaseSessionId: `${RUN}-${sufijo}`,
    nota: "Entrada de soporte", ip: "127.0.0.1", userAgent: "prueba", expiresAt,
  });
}

before(async () => {
  if (skip) return;
  _reiniciarCacheVerComo();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; // sin Supabase: revocar no sale de la máquina
  if (!(await tablaVerComoLista())) skip = "falta pegar sql/barber_admin_ver_como.sql en esta base local";
});

after(async () => {
  if (!skipDb) {
    try {
      await prisma.$executeRaw`DELETE FROM "barber_admin_impersonation_sessions" WHERE "supabaseSessionId" LIKE ${`${RUN}-%`}`;
    } catch { /* sin tabla */ }
  }
  await prisma.$disconnect();
});

test("registrar: la bitácora guarda admin, barbería, dueño, nota y vencimiento", async (t) => {
  if (skip) return t.skip(skip);
  await nueva("a");
  const f = await fila(`${RUN}-a`);
  assert.ok(f);
  assert.equal(f!.adminEmail, "admin@dalecontrol.com");
  assert.equal(f!.barbershopId, `${RUN}-shop`);
  assert.equal(f!.targetBarberUserId, `${RUN}-bu`);
  assert.equal(f!.nota, "Entrada de soporte");
  assert.equal(f!.endedAt, null);
  const vida = new Date(f!.expiresAt).getTime() - Date.now();
  assert.ok(vida > VER_COMO_DURACION_MS - 60_000 && vida <= VER_COMO_DURACION_MS);
});

test("la sesión se lee por su session_id: activa", async (t) => {
  if (skip) return t.skip(skip);
  await nueva("b");
  _reiniciarCacheVerComo();
  const e = await estadoVerComoDe(cliente(`${RUN}-b`));
  assert.equal(e.tipo, "activa");
  assert.equal(e.tipo === "activa" && e.fila.barbershopId, `${RUN}-shop`);
  assert.equal((await estadoVerComoDe(cliente(`${RUN}-nadie`))).tipo, "normal");
});

test("caducidad: vencida = «terminada» y queda marcada 'vencida'", async (t) => {
  if (skip) return t.skip(skip);
  await nueva("c", new Date(Date.now() - 1000));
  _reiniciarCacheVerComo();
  assert.equal((await estadoVerComoDe(cliente(`${RUN}-c`))).tipo, "terminada");
  await new Promise((r) => setTimeout(r, 300));
  const f = await fila(`${RUN}-c`);
  assert.equal(f!.endedReason, "vencida");
  assert.ok(f!.endedAt);
});

test("salir: queda cerrada con 'salida' y ya no vale", async (t) => {
  if (skip) return t.skip(skip);
  const id = await nueva("d");
  await cerrarVerComo(id, "salida");
  const f = await fila(`${RUN}-d`);
  assert.equal(f!.endedReason, "salida");
  _reiniciarCacheVerComo();
  assert.equal((await estadoVerComoDe(cliente(`${RUN}-d`))).tipo, "terminada");
  // Cerrar dos veces no pisa el motivo.
  await cerrarVerComo(id, "reemplazada");
  assert.equal((await fila(`${RUN}-d`))!.endedReason, "salida");
});

test("un mismo session_id no se registra dos veces (índice único)", async (t) => {
  if (skip) return t.skip(skip);
  await nueva("e");
  await assert.rejects(() => nueva("e"));
});
