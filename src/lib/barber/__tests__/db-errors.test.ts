/**
 * Reconocer "la base va atrás del schema" en TODAS sus formas — la red de
 * seguridad de los módulos que antes leían con SQL crudo (42P01 / 42703 vía
 * P2010) y hoy con el cliente Prisma (P2021 / P2022). Si una forma deja de
 * reconocerse, una pantalla que hoy cae a sus defaults pasaría a tronar.
 *
 *   npx tsx --test src/lib/barber/__tests__/db-errors.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { isMissingColumnError, isMissingTableError, isSchemaBehindError } from "../db-errors";

function known(code: string, message: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "5.22.0", meta });
}

test("P2021 del cliente Prisma = tabla ausente", () => {
  const e = known("P2021", "The table `public.barber_bot_settings` does not exist in the current database.", {
    table: "public.barber_bot_settings",
  });
  assert.equal(isMissingTableError(e), true);
  assert.equal(isSchemaBehindError(e), true);
});

test("P2022 del cliente Prisma = columna ausente", () => {
  const e = known("P2022", "The column `barber_shops.bookingPolicy` does not exist in the current database.", {
    column: "barber_shops.bookingPolicy",
  });
  assert.equal(isMissingColumnError(e), true);
  assert.equal(isSchemaBehindError(e), true);
});

test("P2010 (crudo) con el código nativo de Postgres en meta.code", () => {
  const tabla = known("P2010", "Raw query failed. Code: `42P01`. Message: `relation \"x\" does not exist`", {
    code: "42P01",
    message: 'relation "barber_admin_actions" does not exist',
  });
  const columna = known("P2010", "Raw query failed. Code: `42703`. Message: `column \"y\" does not exist`", {
    code: "42703",
    message: 'column "loyaltyThreshold" does not exist',
  });
  assert.equal(isMissingTableError(tabla), true);
  assert.equal(isMissingColumnError(tabla), false, "42P01 no es una columna");
  assert.equal(isMissingColumnError(columna), true);
  assert.equal(isMissingTableError(columna), false, "42703 no es una tabla");
});

test("un Error a secas con el texto de Postgres también cuenta", () => {
  assert.equal(isMissingTableError(new Error('relation "barber_bot_usage" does not exist')), true);
  assert.equal(isMissingColumnError(new Error('column "campaignTemplates" does not exist')), true);
  assert.equal(isMissingColumnError(new Error("ERROR: 42703 undefined_column")), true);
  assert.equal(isMissingTableError(new Error("ERROR: 42P01 undefined_table")), true);
});

test("lo que NO es deriva de schema no se disfraza de deriva", () => {
  for (const e of [
    known("P2002", "Unique constraint failed on the fields: (`barbershopId`,`phone`)", {
      target: ["barbershopId", "phone"],
    }),
    known("P2025", "An operation failed because it depends on one or more records that were required but not found."),
    new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    new Error("timeout"),
    null,
    undefined,
    "42703",
    { code: 42703 },
  ]) {
    assert.equal(isMissingTableError(e), false, `tabla: ${String(e)}`);
    assert.equal(isMissingColumnError(e), false, `columna: ${String(e)}`);
    assert.equal(isSchemaBehindError(e), false, `schema: ${String(e)}`);
  }
});
