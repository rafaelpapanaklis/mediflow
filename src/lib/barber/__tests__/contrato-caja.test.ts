import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BARBER_CASH_MEMBERSHIP_SUFFIX,
  BARBER_MEMBERSHIP_LINE_PREFIX,
  isMembershipLine,
} from "../memberships-core";

// Correr:  npx tsx --test src/lib/barber/__tests__/contrato-caja.test.ts
//
// ═══════════════════════════════════════════════════════════════════════
// CONTRATO CON LA CAJA (T3)
//
// La caja marca la línea de servicio cubierta por la membresía con un
// SUFIJO en la descripción (MEMBERSHIP_SUFFIX de src/lib/barber/cash.ts) y
// unitPrice en 0. Esta ola marca con un PREFIJO en una línea de crédito
// aparte. Las dos marcas tienen que reconocerse entre sí o la misma visita
// podría descontar dos cortes.
//
// No se importa cash.ts porque es server-only (arrastraría prisma a un
// módulo client-safe): se lee el archivo y se compara el texto. Si alguien
// cambia el sufijo allá, esta prueba truena aquí.
// ═══════════════════════════════════════════════════════════════════════

const CASH_TS = path.join(process.cwd(), "src", "lib", "barber", "cash.ts");

test("el sufijo de membresía de la caja sigue siendo el que reconocemos", () => {
  if (!fs.existsSync(CASH_TS)) {
    // La caja todavía no está en esta rama: no hay contrato que romper.
    return;
  }
  const src = fs.readFileSync(CASH_TS, "utf8");
  const m = /export const MEMBERSHIP_SUFFIX\s*=\s*"([^"]*)"/.exec(src);
  assert.ok(m, "src/lib/barber/cash.ts ya no exporta MEMBERSHIP_SUFFIX");
  assert.equal(
    m[1],
    BARBER_CASH_MEMBERSHIP_SUFFIX,
    "El sufijo de la caja cambió: actualiza BARBER_CASH_MEMBERSHIP_SUFFIX en memberships-core.ts",
  );
});

test("reconocemos las DOS marcas de 'esta visita ya usó la membresía'", () => {
  // La nuestra: línea de crédito con prefijo.
  assert.equal(isMembershipLine(`${BARBER_MEMBERSHIP_LINE_PREFIX}Ilimitado — Corte`), true);
  // La de la caja: el servicio con sufijo y precio en 0.
  assert.equal(isMembershipLine(`Corte de cabello${BARBER_CASH_MEMBERSHIP_SUFFIX}`), true);
  // Un servicio normal no es ninguna de las dos.
  assert.equal(isMembershipLine("Corte de cabello"), false);
  assert.equal(isMembershipLine("Membresía anual del gimnasio"), false);
});
