// Cómo se nombra el estado periimplantar (PeriImplantStatus) en pantalla.
// 12i (ticket 3 de BEVADENT): al guardar un control de mantenimiento el aviso
// decía «evaluación periimplantar: MUCOSITIS»; los valores del enum no son para
// leerse. Una sola tabla, exhaustiva sobre el enum (la prueba lo cuida).
export const ETIQUETA_ESTADO_PERIIMPLANTAR: Record<string, string> = {
  SALUD: "salud periimplantar",
  MUCOSITIS: "mucositis periimplantar",
  PERIIMPLANTITIS_INICIAL: "periimplantitis inicial",
  PERIIMPLANTITIS_MODERADA: "periimplantitis moderada",
  PERIIMPLANTITIS_AVANZADA: "periimplantitis avanzada",
};

export function nombreEstadoPeriimplantar(status: string): string {
  return ETIQUETA_ESTADO_PERIIMPLANTAR[status] ?? "sin clasificar";
}
