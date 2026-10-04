"use server";
// N-31 (segunda auditoría): la pestaña Ortodoncia tardaba ~21 s en asentarse. Next ejecuta las acciones de servidor
// de UNA en UNA por pestaña del navegador, y al abrirla se disparaban 21 lecturas en fila (~1–1.5 s cada una desde
// el servidor de pruebas). Esta acción hace esas mismas lecturas —las MISMAS funciones, con sus mismos permisos y
// su misma clínica de la sesión— dentro de UN solo viaje, de dos en dos (cada una ya hace sus propias consultas: no
// se rebasa el tope del pooler). Los componentes la reutilizan al montarse (`conPrecarga`); si algo falla aquí, cada
// uno vuelve a pedir lo suyo como siempre.

import { getCaseIntakeOptions } from "./getCaseIntakeOptions";
import { leerVersionesDelCaso } from "./versionesDelCaso";
import { leerDiagnosticoCompleto } from "./leerDiagnosticoCompleto";
import { listCephalometricAnalyses } from "./imagen/listCephalometricAnalyses";
import { historialDeLigasAction, mecanicasDelCasoAction } from "./hojaExtras";
import { getAlignerCase } from "./alineadores/getAlignerCase";
import { getElasticsCompliance } from "./alineadores/getElasticsCompliance";
import { listMonitoringPhotos } from "./alineadores/listMonitoringPhotos";
import { cargarPanelDeCobro } from "./cobro/cargarPanelDeCobro";
import { listarExtrasPorCobrar } from "./procedimientosDeHoja";

const A_LA_VEZ = 2;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function precargarPestanaOrto(input: {
  patientId: string;
  treatmentPlanId?: string | null;
  diagnosisId?: string | null;
}): Promise<Record<string, unknown>> {
  const patientId = typeof input?.patientId === "string" && ID.test(input.patientId) ? input.patientId : null;
  const planId = typeof input?.treatmentPlanId === "string" && ID.test(input.treatmentPlanId) ? input.treatmentPlanId : null;
  const dxId = typeof input?.diagnosisId === "string" && ID.test(input.diagnosisId) ? input.diagnosisId : null;
  if (!patientId) return {};

  const tareas: Array<[string, () => Promise<unknown>]> = [["getCaseIntakeOptions", () => getCaseIntakeOptions({ patientId })]];
  if (planId) {
    tareas.push(
      ["cargarPanelDeCobro", () => cargarPanelDeCobro(planId)],
      ["leerVersionesDelCaso", () => leerVersionesDelCaso(planId)],
      ["mecanicasDelCaso", () => mecanicasDelCasoAction({ treatmentPlanId: planId })],
      ["historialDeLigas", () => historialDeLigasAction({ treatmentPlanId: planId })],
      ["listarExtrasPorCobrar", () => listarExtrasPorCobrar({ treatmentPlanId: planId })],
      ["listCephalometricAnalyses", () => listCephalometricAnalyses(planId)],
      ["getAlignerCase", () => getAlignerCase(planId)],
      ["getElasticsCompliance", () => getElasticsCompliance(planId)],
      ["listMonitoringPhotos", () => listMonitoringPhotos(planId)],
    );
  }
  if (dxId) tareas.push(["leerDiagnosticoCompleto", () => leerDiagnosticoCompleto(dxId)]);

  const salida: Record<string, unknown> = {};
  let i = 0;
  const trabajador = async () => {
    while (i < tareas.length) {
      const [clave, f] = tareas[i++]!;
      try {
        salida[clave] = await f();
      } catch {
        // Sin dato: el componente pide el suyo.
      }
    }
  };
  await Promise.all(Array.from({ length: A_LA_VEZ }, trabajador));
  return salida;
}
