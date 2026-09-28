/**
 * B4 de la QA en vivo de ws1-t10 (REPORTE-ws1-t10.md): la caducidad de una
 * compra se guardaba con una convención distinta a la del alta manual de
 * lote (medianoche UTC vs. medianoche de la zona de la clínica), y un mismo
 * día de calendario caducaba 6 h antes por un camino que por el otro.
 *
 * Al revisar el código (ws1-t6) esto ya estaba arreglado por un commit
 * concurrente de ws1-t5 (ef96f3ed, "un lote caduca al día SIGUIENTE de su
 * fecha, y la compra lleva el día de la zona de la clínica"): los dos
 * caminos parsean la caducidad con `parseFechaCalendario` antes de guardar.
 * Este test es el candado para que no se vuelvan a separar.
 *
 * Run: npx tsx --test src/lib/inventory/__tests__/convencion-caducidad-compra-lote.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFechaCalendario } from "../fecha-calendario";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("la compra parsea expiresAt de cada línea con parseFechaCalendario", () => {
  const texto = leer("app/api/inventory/purchases/route.ts");
  assert.match(texto, /import\s*\{[^}]*parseFechaCalendario[^}]*\}\s*from\s*"@\/lib\/inventory\/fecha-calendario"/);
  assert.match(
    texto,
    /expiresAt:\s*l\?\.expiresAt\s*\?\s*parseFechaCalendario\(String\(l\.expiresAt\)\)\s*:\s*null/,
    "la línea de compra debe convertir expiresAt con parseFechaCalendario, igual que el alta de lote",
  );
});

test("el alta manual de lote también parsea expiresAt con parseFechaCalendario", () => {
  const texto = leer("app/api/inventory/[id]/lots/route.ts");
  assert.match(texto, /import\s*\{[^}]*parseFechaCalendario[^}]*\}\s*from\s*"@\/lib\/inventory\/fecha-calendario"/);
  assert.match(texto, /parseFechaCalendario\(String\(body\.expiresAt\)\)/);
});

test("el mismo día de calendario da el mismo instante por los dos caminos", () => {
  // No hace falta llamar a los endpoints: los dos usan la misma función pura,
  // así que basta con fijar la función en sí (ya cubierta por
  // fecha-calendario.test.ts) y confirmar aquí el caso del hallazgo B4.
  const compra = parseFechaCalendario("2026-10-09");
  const lote = parseFechaCalendario("2026-10-09");
  assert.equal(compra?.toISOString(), lote?.toISOString());
  assert.equal(compra?.toISOString(), "2026-10-09T00:00:00.000Z");
});
