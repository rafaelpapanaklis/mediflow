// ws1-t6 (punto 6 del tercer ticket): «Colocación de aparatología» marcada «Incluido» y
// con precio $0 seguía diciendo «Con costo aparte.» en su descripción.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  descripcionContradiceCobro,
  descripcionSembrada,
  descripcionTrasCambioDeCobro,
  esDescripcionSembrada,
} from "../procedimiento-ortodoncia-reglas";
import { DEFAULT_ORTHO_PROCEDURES, cobroDelProcedimiento } from "../catalog-procedures";

test("la precarga: cada descripción dice lo mismo que su bandera", () => {
  for (const p of DEFAULT_ORTHO_PROCEDURES) {
    if (p.orthoIncludedInTreatment === null) continue;
    assert.equal(
      descripcionContradiceCobro(p.description, p.orthoIncludedInTreatment),
      false,
      `${p.name}: «${p.description}» contradice ${p.orthoIncludedInTreatment}`,
    );
    // Leída sin la columna, la descripción da el mismo cobro que la bandera.
    assert.equal(cobroDelProcedimiento({ name: `${p.name} (copia)`, description: p.description, orthoIncludedInTreatment: null }), p.orthoIncludedInTreatment);
  }
});

test("marcar «Incluido» corrige la descripción sembrada (el caso del ticket)", () => {
  const r = descripcionTrasCambioDeCobro({
    nombre: "Colocación de aparatología",
    actual: "Con costo aparte.",
    enviada: undefined,
    incluido: true,
  });
  assert.equal(r, "Incluido en el tratamiento.");
});

test("también cuando la bandera ya estaba en «Incluido» y se vuelve a guardar el formulario sin tocar el texto", () => {
  const r = descripcionTrasCambioDeCobro({
    nombre: "Colocación de aparatología",
    actual: "Con costo aparte.",
    enviada: "Con costo aparte.",
    incluido: true,
  });
  assert.equal(r, "Incluido en el tratamiento.");
});

test("y de vuelta a «Con costo aparte», con los matices de la precarga", () => {
  assert.equal(
    descripcionTrasCambioDeCobro({ nombre: "Colocación de elásticos", actual: "Incluido en el tratamiento.", enviada: undefined, incluido: false }),
    "Con costo aparte.",
  );
  assert.equal(
    descripcionTrasCambioDeCobro({ nombre: "Urgencia de ortodoncia", actual: "Fuera del control del mes. Con costo aparte.", enviada: undefined, incluido: true }),
    "Fuera del control del mes. Incluido en el tratamiento.",
  );
  assert.equal(
    descripcionTrasCambioDeCobro({ nombre: "Reposición de bracket", actual: "Con costo aparte, pasadas las reposiciones incluidas del caso.", enviada: undefined, incluido: true }),
    "Incluido en el tratamiento.",
  );
  assert.equal(
    descripcionTrasCambioDeCobro({ nombre: "Reposición de bracket", actual: "Incluido en el tratamiento.", enviada: undefined, incluido: false }),
    "Con costo aparte, pasadas las reposiciones incluidas del caso.",
  );
});

test("una descripción escrita a mano NO se pisa", () => {
  for (const actual of [
    "Con costo aparte. Incluye brackets metálicos.",
    "Se cobra al colocar, $5,000.",
    "Con costo aparte para casos de otra clínica",
  ]) {
    assert.equal(descripcionTrasCambioDeCobro({ nombre: "Colocación de aparatología", actual, enviada: undefined, incluido: true }), undefined, actual);
  }
  // …pero se avisa en la lista si dice lo contrario.
  assert.equal(descripcionContradiceCobro("Con costo aparte. Incluye brackets metálicos.", true), true);
  assert.equal(descripcionContradiceCobro("Se cobra al colocar, $5,000.", true), false);
});

test("lo que se tecleó en el mismo guardado manda", () => {
  assert.equal(
    descripcionTrasCambioDeCobro({ nombre: "Colocación de aparatología", actual: "Con costo aparte.", enviada: "Va dentro del paquete Elite.", incluido: true }),
    undefined,
  );
});

test("sin cambio de cobro, o sin texto sembrado, no hay nada que escribir", () => {
  assert.equal(descripcionTrasCambioDeCobro({ nombre: "Retenedor superior", actual: "Con costo aparte.", enviada: undefined, incluido: false }), undefined);
  assert.equal(descripcionTrasCambioDeCobro({ nombre: "Retenedor superior", actual: "Con costo aparte.", enviada: undefined, incluido: null }), undefined);
  assert.equal(descripcionTrasCambioDeCobro({ nombre: "Retenedor superior", actual: null, enviada: undefined, incluido: true }), undefined);
  assert.equal(descripcionTrasCambioDeCobro({ nombre: "Retenedor superior", actual: "", enviada: undefined, incluido: true }), undefined);
});

test("un procedimiento propio de la clínica con el texto genérico también se corrige", () => {
  assert.equal(esDescripcionSembrada("Recementado", "Con costo aparte."), true);
  assert.equal(
    descripcionTrasCambioDeCobro({ nombre: "Recementado", actual: " Con costo  aparte. ", enviada: undefined, incluido: true }),
    "Incluido en el tratamiento.",
  );
  assert.equal(descripcionSembrada("Recementado", false), "Con costo aparte.");
});
