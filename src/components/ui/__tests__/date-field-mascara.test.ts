// C-70 (auditoría de uso): en «Fecha del primer pago» teclear «2026-11-05» dejaba «20/26/1105» sin error y el
// formulario seguía con la fecha anterior (el resumen decía otra). Con el código viejo `handleType` solo emitía
// cuando la fecha era válida y no había forma de saber que lo tecleado no existía (este módulo no existía).

import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarTecleo } from "../date-field-mascara";

test("«2026-11-05» tecleado: fecha completa que no existe → campo vacío e inválido", () => {
  assert.deepEqual(interpretarTecleo("2026-11-05"), { text: "20/26/1105", iso: "", invalida: true });
});

test("fecha válida, a medias, vacía y fuera de rango", () => {
  assert.deepEqual(interpretarTecleo("05/11/2026"), { text: "05/11/2026", iso: "2026-11-05", invalida: false });
  assert.deepEqual(interpretarTecleo("05/11/20"), { text: "05/11/20", iso: null, invalida: false });
  assert.deepEqual(interpretarTecleo(""), { text: "", iso: "", invalida: false });
  assert.deepEqual(interpretarTecleo("31/02/2026"), { text: "31/02/2026", iso: "", invalida: true });
  assert.equal(interpretarTecleo("05/11/2040", undefined, "2031-10-04").invalida, true);
});
