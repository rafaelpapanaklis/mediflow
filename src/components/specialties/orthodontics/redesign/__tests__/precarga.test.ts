// N-31 (segunda auditoría): la caché de la precarga de la pestaña Ortodoncia. Sin precarga (o de otro caso, o ya
// vieja) cada sección llama a su acción como siempre; con ella, usa el dato precargado. Este módulo no existía.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("conPrecarga usa el dato precargado del MISMO caso y si no, llama a la acción", async () => {
  const llamadas: string[] = [];
  mock.module("@/app/actions/orthodontics/precargarPestana", {
    namedExports: {
      precargarPestanaOrto: async (a: { parte?: string }) => {
        llamadas.push(`precarga:${a.parte}`);
        return a.parte === "cobro" ? { cargarPanelDeCobro: { ok: true, data: "del-lote" } } : { leerVersionesDelCaso: { ok: true, data: "resto" } };
      },
    },
  });
  // El módulo comprueba `window`: en Node se simula.
  (globalThis as { window?: unknown }).window = {};
  const { iniciarPrecarga, conPrecarga } = await import("../precarga");
  iniciarPrecarga({ patientId: "pac1", treatmentPlanId: "plan1", diagnosisId: null });
  iniciarPrecarga({ patientId: "pac1", treatmentPlanId: "plan1", diagnosisId: null }); // no repite
  const propia = async () => ({ ok: true, data: "propia" });
  assert.deepEqual(await conPrecarga("cargarPanelDeCobro", "plan1", propia), { ok: true, data: "del-lote" });
  // Otro caso: no se mezcla.
  assert.deepEqual(await conPrecarga("cargarPanelDeCobro", "plan2", propia), { ok: true, data: "propia" });
  // La segunda parte (lo demás) también se reutiliza.
  assert.deepEqual(await conPrecarga("leerVersionesDelCaso", "plan1", propia), { ok: true, data: "resto" });
  // Un dato que la precarga no trae: la acción de siempre.
  assert.deepEqual(await conPrecarga("historialDeLigas", "plan1", propia), { ok: true, data: "propia" });
  // Dos viajes: primero el cobro (saldo de la cabecera), después lo demás.
  assert.deepEqual(llamadas, ["precarga:cobro", "precarga:resto"]);
});
