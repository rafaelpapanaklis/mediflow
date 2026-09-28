// ws1-t4 #77 — «Pago por control»: la ficha lista los controles que se deben, cada uno con su «Cobrar».
// Correr: npm run test:orto-controles-por-cobrar
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { controlesPorCobrarDe } from "../controles-por-cobrar";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const cargo = (o: Partial<{ invoiceId: string; invoiceNumber: string | null; total: number; pagado: number; vencimiento: string; status: string }> = {}) => ({
  invoiceId: "i1", invoiceNumber: "MF-1", total: 300, pagado: 0, vencimiento: "2026-09-10", status: "PENDING", ...o,
});

test("solo los controles con saldo, del más viejo al más nuevo", () => {
  const r = controlesPorCobrarDe([
    cargo({ invoiceId: "nuevo", vencimiento: "2026-09-20" }),
    cargo({ invoiceId: "viejo", vencimiento: "2026-09-01", pagado: 100 }),
    cargo({ invoiceId: "pagado", status: "PAID", pagado: 300 }),
    cargo({ invoiceId: "cancelado", status: "CANCELLED" }),
  ]);
  assert.deepEqual(r.map((c) => c.invoiceId), ["viejo", "nuevo"]);
  assert.equal(r[0].balance, 200);
});

test("un centavo de ruido no cuenta como deuda", () => {
  assert.deepEqual(controlesPorCobrarDe([cargo({ total: 300, pagado: 299.999 })]), []);
});

test("la ficha cobra el primer control y no la colocación ya pagada, y lista cada uno con su Cobrar", () => {
  const f = leer("components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.match(f, /esPorControl && controlesPorCobrar\.length > 0\s*\?\s*controlesPorCobrar\[0\]/);
  assert.match(f, /data-controles-por-cobrar/);
  assert.match(f, /kind: "cobrar-control", invoiceId: c\.invoiceId/);
  const a = leer("app/actions/orthodontics/cobro/cargarPanelDeCobro.ts");
  assert.match(a, /controlesPorCobrarDe\(cargosControl\)/);
});
