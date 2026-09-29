// H25 (ws1-t6): TODO camino que cobra en efectivo desde el panel usa el mismo
// freno y el mismo aviso de «caja cerrada». Si alguien añade un camino nuevo de
// cobro y no lo conecta, o copia el texto, esta prueba lo dice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const CAMINOS = [
  ["«Registrar pago» (ventana de cobro)", "src/components/dashboard/billing/payment-modal.tsx"],
  ["cobro dentro del detalle de la factura", "src/components/dashboard/factura-un-popup/use-cobro.ts"],
  ["«Marcar pagada» del detalle", "src/components/dashboard/billing/invoice-detail-modal.tsx"],
  ["«Registrar anticipo recibido»", "src/components/dashboard/billing/modal-registrar-anticipo.tsx"],
] as const;

for (const [nombre, archivo] of CAMINOS) {
  test(`el camino «${nombre}» usa el freno compartido de caja cerrada`, () => {
    const t = leer(archivo);
    assert.match(t, /useFrenoCajaCerrada/, `${archivo} no usa useFrenoCajaCerrada`);
    assert.match(t, /frenar\(\)/, `${archivo} no llama a frenar() antes de cobrar`);
  });
}

test("el aviso se pinta con el componente compartido en cada camino", () => {
  for (const archivo of [
    "src/components/dashboard/billing/payment-modal.tsx",
    "src/components/dashboard/factura-un-popup/seccion-cobro.tsx",
    "src/components/dashboard/billing/invoice-detail-modal.tsx",
    "src/components/dashboard/billing/modal-registrar-anticipo.tsx",
  ]) {
    assert.match(leer(archivo), /<AvisoCajaCerrada/, `${archivo} no pinta AvisoCajaCerrada`);
  }
});

function ts(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "__tests__" && n !== "node_modules") ts(p, acc); }
    else if (/\.(tsx?|jsx?)$/.test(n)) acc.push(p);
  }
  return acc;
}

test("el texto del aviso vive en UN solo archivo (nadie lo copia)", () => {
  const con = ts(join(RAIZ, "src")).filter((f) => readFileSync(f, "utf8").includes("este efectivo no entrará en ningún corte"));
  assert.deepEqual(con.map((f) => f.slice(RAIZ.length + 1)), ["src/components/dashboard/billing/aviso-caja-cerrada.component.tsx"]);
});
