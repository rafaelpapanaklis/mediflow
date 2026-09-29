import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armarLineas, esElegibleEnLaHoja, estadoDeLinea, hayPorCobrar, lineasDeLaNota, marcaDeExtraDeHoja, notaDeFacturaDeExtra,
  textoParaLaNota, totalDeLinea, type FilaDeCatalogo, type LineaDeVisita,
} from "../procedimientos-de-visita";

const fila = (o: Partial<FilaDeCatalogo> = {}): FilaDeCatalogo => ({
  id: "p1", name: "Recementado de bracket", code: null, category: "orthodontics", basePrice: 250, isActive: true, orthoIncludedInTreatment: false, ...o,
});
const catalogo = [
  fila(),
  fila({ id: "p2", name: "Retenedor incluido", basePrice: 0, orthoIncludedInTreatment: true }),
  fila({ id: "ctl", name: "Control de ortodoncia", code: "ORTO_CONTROL", basePrice: 300, orthoIncludedInTreatment: null }),
  fila({ id: "off", name: "Desactivado", isActive: false }),
  fila({ id: "gen", name: "Limpieza", category: "dental" }),
];

test("solo se eligen los de ortodoncia activos y con cobro definido; el control nunca", () => {
  assert.equal(esElegibleEnLaHoja(catalogo[0]), true);
  assert.equal(esElegibleEnLaHoja(catalogo[2]), false);
  assert.equal(esElegibleEnLaHoja(catalogo[3]), false);
  assert.equal(esElegibleEnLaHoja(catalogo[4]), false);
  assert.equal(esElegibleEnLaHoja(fila({ orthoIncludedInTreatment: null })), false);
  // el control por su nombre de siempre, aunque aún no lleve la llave
  assert.equal(esElegibleEnLaHoja(fila({ name: "Control de ortodoncia", orthoIncludedInTreatment: false })), false);
});

test("el precio, el nombre y el tipo salen del catálogo, no del cliente", () => {
  const r = armarLineas({ pedidos: [{ procedureId: "p1", quantity: 2 }, { procedureId: "p2", quantity: 1 }], catalogo, previas: [] });
  assert.equal(r.error, null);
  assert.deepEqual(r.lineas.map((l) => [l.name, l.quantity, l.unitPrice, l.incluido]), [
    ["Recementado de bracket", 2, 250, false],
    ["Retenedor incluido", 1, 0, true],
  ]);
  assert.equal(totalDeLinea(r.lineas[0]), 500);
  assert.equal(totalDeLinea(r.lineas[1]), 0);
});

test("rechaza el control, los inactivos, los de otra categoría y los que no existen", () => {
  for (const id of ["ctl", "off", "gen", "no-existe"]) {
    const r = armarLineas({ pedidos: [{ procedureId: id, quantity: 1 }], catalogo, previas: [] });
    assert.match(r.error ?? "", /ya no está disponible/, id);
  }
});

test("cantidad entera de 1 a 20; repetidos se suman", () => {
  for (const q of [0, -1, 1.5, 21, NaN]) {
    assert.match(armarLineas({ pedidos: [{ procedureId: "p1", quantity: q }], catalogo, previas: [] }).error ?? "", /entero de 1 a 20/, String(q));
  }
  const suma = armarLineas({ pedidos: [{ procedureId: "p1", quantity: 2 }, { procedureId: "p1", quantity: 3 }], catalogo, previas: [] });
  assert.equal(suma.lineas.length, 1);
  assert.equal(suma.lineas[0].quantity, 5);
  assert.match(armarLineas({ pedidos: [{ procedureId: "p1", quantity: 15 }, { procedureId: "p1", quantity: 10 }], catalogo, previas: [] }).error ?? "", /entero de 1 a 20/);
});

test("una línea ya facturada es intocable: se conserva aunque se omita o cambie", () => {
  const facturada: LineaDeVisita = { procedureId: "p1", name: "Recementado de bracket", quantity: 2, unitPrice: 200, incluido: false, invoiceId: "inv-1", invoiceNumber: "MF-1" };
  const omitida = armarLineas({ pedidos: [], catalogo, previas: [facturada] });
  assert.deepEqual(omitida.lineas, [facturada]);
  const cambiada = armarLineas({ pedidos: [{ procedureId: "p1", quantity: 9 }], catalogo, previas: [facturada] });
  assert.equal(cambiada.lineas[0].quantity, 2);
  assert.equal(cambiada.lineas[0].unitPrice, 200, "no se reprecia una línea facturada");
  assert.equal(cambiada.lineas[0].invoiceId, "inv-1");
  // ni aunque el procedimiento ya se desactivó en el catálogo
  const sinCatalogo = armarLineas({ pedidos: [], catalogo: [], previas: [facturada] });
  assert.equal(sinCatalogo.lineas.length, 1);
});

test("estados: incluido nunca se cobra; con costo aparte es por cobrar hasta que tiene factura", () => {
  assert.equal(estadoDeLinea({ incluido: true, invoiceId: null }), "incluido");
  assert.equal(estadoDeLinea({ incluido: true, invoiceId: "x" }), "incluido");
  assert.equal(estadoDeLinea({ incluido: false, invoiceId: null }), "por-cobrar");
  assert.equal(estadoDeLinea({ incluido: false, invoiceId: "x" }), "facturado");
  const l = (incluido: boolean, invoiceId: string | null): LineaDeVisita => ({ procedureId: "a", name: "A", quantity: 1, unitPrice: 1, incluido, invoiceId });
  assert.equal(hayPorCobrar([l(true, null)]), false, "un incluido no deja nada por cobrar");
  assert.equal(hayPorCobrar([l(false, null)]), true);
  assert.equal(hayPorCobrar([l(false, "inv")]), false);
});

test("la nota firmada lista los procedimientos con su nombre y si fue incluido o con costo aparte", () => {
  const r = armarLineas({ pedidos: [{ procedureId: "p1", quantity: 2 }, { procedureId: "p2", quantity: 1 }], catalogo, previas: [] });
  assert.equal(
    textoParaLaNota(r.lineas),
    "Procedimientos de esta visita:\n• Recementado de bracket ×2 — con costo aparte\n• Retenedor incluido — incluido en el tratamiento",
  );
  assert.equal(textoParaLaNota([]), "");
});

test("la marca de la factura identifica hoja y procedimiento (para no duplicar)", () => {
  assert.equal(marcaDeExtraDeHoja("card-1", "p1"), "[extra-hoja:card-1:p1]");
  const nota = notaDeFacturaDeExtra("card-1", { procedureId: "p1", name: "Recementado de bracket", quantity: 2 }, 3);
  assert.ok(nota.startsWith("[extra-hoja:card-1:p1]"));
  assert.match(nota, /hoja de control 3/);
});

test("lee las líneas de la nota y tolera basura", () => {
  assert.deepEqual(lineasDeLaNota(null), []);
  assert.deepEqual(lineasDeLaNota({ procedimientos: "x" }), []);
  const ok = lineasDeLaNota({ procedimientos: [{ procedureId: "a", name: "A", quantity: 2, unitPrice: 10, incluido: false, invoiceId: "i" }, { nada: 1 }, null] });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].invoiceId, "i");
});
