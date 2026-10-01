/**
 * /dashboard/appointments es la agenda ANTERIOR al rediseño. Con el diseño
 * nuevo encendido (lo está por defecto) la dirección ya no la pinta: manda a
 * /dashboard/agenda y se lleva SOLO los parámetros que la agenda nueva entiende
 * (date, highlight y solicitudes=1). `new`, `patient(Id)`, `view`,
 * `resourceId` y `focus` solo los lee la pantalla vieja: se descartan en vez de
 * viajar a un sitio donde no hacen nada.
 */
type Consulta = Record<string, string | string[] | undefined>;

const PARAMS_QUE_ENTIENDE_LA_NUEVA = ["date", "highlight", "solicitudes"] as const;

export function destinoAgendaVieja(consulta: Consulta | undefined): string {
  const qs = new URLSearchParams();
  for (const k of PARAMS_QUE_ENTIENDE_LA_NUEVA) {
    const v = consulta?.[k];
    const valor = Array.isArray(v) ? v[0] : v;
    if (valor) qs.set(k, valor);
  }
  const s = qs.toString();
  return s ? `/dashboard/agenda?${s}` : "/dashboard/agenda";
}

/**
 * Qué hace la dirección vieja según el interruptor y el permiso. Una sola
 * decisión, sin I/O, para que la pantalla y las pruebas usen la misma.
 *  · rediseño encendido → "agenda-nueva" (sin mirar permiso: la agenda nueva
 *    exige agenda.view por su cuenta y no se carga nada aquí).
 *  · apagado sin agenda.view → "sin-permiso".
 *  · apagado con agenda.view → "pantalla-vieja".
 */
export function decidirAgendaVieja(rediseno: boolean, puedeVerAgenda: boolean): "agenda-nueva" | "sin-permiso" | "pantalla-vieja" {
  if (rediseno) return "agenda-nueva";
  return puedeVerAgenda ? "pantalla-vieja" : "sin-permiso";
}
