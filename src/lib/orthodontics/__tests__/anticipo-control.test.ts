// ws1-t10, decisión 5 — «Pedir anticipo» oculto en controles solo en modo «a plazos».
// Correr: npm run test:orto-anticipo-control
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ocultarAnticipoPorMensualidad } from "../anticipo-control";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("control de un caso «a plazos»: sin anticipo", () => assert.equal(ocultarAnticipoPorMensualidad(true, "PRECIO_TOTAL"), true));
test("control de un caso «por control»: sí se ofrece", () => assert.equal(ocultarAnticipoPorMensualidad(true, "PAGO_POR_CONTROL"), false));
test("control sin caso: se ofrece como cualquier cita", () => assert.equal(ocultarAnticipoPorMensualidad(true, null), false));
test("mientras la ranura no contesta, un control no muestra el botón (no parpadea)", () => assert.equal(ocultarAnticipoPorMensualidad(true, undefined), true));
test("una cita que no es control nunca se toca", () => {
  for (const m of ["PRECIO_TOTAL", "PAGO_POR_CONTROL", null, undefined] as const) assert.equal(ocultarAnticipoPorMensualidad(false, m), false);
});

test("el panel usa la regla y la ranura avisa el modo que trae la acción", () => {
  const p = leer("components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(p, /!ocultarAnticipoPorMensualidad\(esCitaOrtoConHoja\(dto\.reason \?\? null\), modoCobroOrto\)/);
  assert.match(p, /<RanuraCita dto=\{dto\} onModoDeCobro=\{setModoCobroOrto\} \/>/);
  assert.match(leer("app/actions/orthodontics/getTreatmentPlanIdForAppointment.ts"), /cargarModoDeCobro\(ctx\.clinicId, plan\.id\)/);
  assert.match(leer("components/specialties/orthodontics/agenda/ranura-cita-estado.ts"), /billingMode: res\.data\.billingMode \?\? null/);
});
