// Los avisos de la vista previa de «Convertir en presupuesto» (ws1-t3; ws1-t12, revisión t8 N4-PDF1).
//
// Puro y aparte del componente para que la prueba de la ruta los saque del mismo cuerpo que recibe la
// pantalla. El dinero va con `dineroExacto`, igual que el PDF del plan y el borrador (t8, N4-PDF2).

import { dineroExacto } from "@/lib/treatments/dinero-exacto";
import type { TEXTOS_CONVERTIR_PRESUPUESTO } from "./textos-convertir-presupuesto";

type Textos = (typeof TEXTOS_CONVERTIR_PRESUPUESTO)["es"];

export interface VistaParaAvisos {
  total: number;
  sinDetalle: boolean;
  sinPrecio: number;
  sinTarifario: number;
  totalDifiere: boolean;
  planEnCero?: boolean;
}

/** El plan en $0 va primero: es el que cambia el monto de lo que se crea. */
export function avisosDeLaVista(vista: VistaParaAvisos, planCosto: number, t: Textos): string[] {
  const avisos: string[] = [];
  if (vista.planEnCero) avisos.push(t.avisoPlanEnCero(dineroExacto(vista.total)));
  if (vista.sinDetalle) avisos.push(t.avisoSinDetalle);
  if (vista.sinPrecio > 0) avisos.push(t.avisoSinPrecio(vista.sinPrecio));
  if (vista.sinTarifario > 0 && !vista.sinDetalle) avisos.push(t.avisoSinTarifario(vista.sinTarifario));
  if (vista.totalDifiere) avisos.push(t.avisoTotalDifiere(dineroExacto(planCosto)));
  return avisos;
}
