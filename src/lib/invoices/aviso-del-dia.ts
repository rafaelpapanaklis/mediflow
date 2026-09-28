// ws1-t4 #82 — la hora del aviso de cobro que ya salió hoy, en la zona de la clínica. Puro.
export function horaDelAvisoPrevio(cuando: Date, zonaHoraria: string | null | undefined): string {
  try {
    return cuando.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: zonaHoraria || "America/Mexico_City" });
  } catch {
    return cuando.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
  }
}
