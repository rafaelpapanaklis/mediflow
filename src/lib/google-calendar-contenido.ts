/**
 * Google Calendar — QUÉ viaja a Google en cada evento. Un solo sitio decide la
 * privacidad: google-calendar.ts arma el evento con lo que devuelve esto.
 *
 * Reglas (auditoría ws1-t2, hueco #5):
 *  · Las notas internas de la cita NO viajan (ni a la descripción, ni, por lo
 *    tanto, a la invitación que Google manda por correo). Esta función ni
 *    siquiera las recibe: no hay forma de que se cuelen.
 *  · La descripción lleva solo lo necesario: tipo de cita, doctor, clínica y
 *    dirección.
 *  · El título lleva el nombre de pila y la inicial del apellido («Ana G.»): lo
 *    suficiente para que recepción reconozca la cita, sin el nombre completo en
 *    el título que se ve en listas, notificaciones y correos.
 *  · El paciente solo es invitado si la clínica lo permite
 *    («Enviar invitación por correo al paciente», por defecto sí = como antes).
 *  · Nadie es invitado con la cuenta DUEÑA del calendario donde se copia la
 *    cita (WS1-T3): ya la ve ahí. Si no, al doctor que conectó la clínica
 *    con su Gmail la cita le salía DOS veces en su Google (la copia y la
 *    invitación). Una cita, una vez en el Google de cada persona.
 *
 * Sin dependencias: pura y probada.
 */

export interface DatosContenidoEvento {
  type: string;
  patientName: string;
  doctorName?: string | null;
  doctorEmail?: string | null;
  patientEmail?: string | null;
  clinicName: string;
  clinicAddress?: string | null;
  /** Default true (el comportamiento de antes de existir el interruptor). */
  invitarPaciente?: boolean;
  /** La cuenta de Google dueña del calendario donde se copia (`clinics.googleCalendarEmail`): nunca se invita. */
  cuentaDelCalendario?: string | null;
}

export interface ContenidoEventoGoogle {
  summary: string;
  description: string;
  location: string;
  attendees: { email: string }[];
}

/** «Ana García López» → «Ana L.». Una sola palabra se queda tal cual. */
export function nombreCortoParaTitulo(nombreCompleto: string): string {
  const partes = String(nombreCompleto ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "Paciente";
  if (partes.length === 1) return partes[0];
  const inicial = Array.from(partes[partes.length - 1])[0]?.toLocaleUpperCase("es") ?? "";
  return inicial ? `${partes[0]} ${inicial}.` : partes[0];
}

function correoValido(e: string | null | undefined): e is string {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

/** ¿Ese correo es la cuenta dueña del calendario? (sin mayúsculas ni espacios) */
export function esLaCuentaDelCalendario(correo: string | null | undefined, cuenta: string | null | undefined): boolean {
  const a = correo?.trim().toLowerCase();
  const b = cuenta?.trim().toLowerCase();
  return !!a && !!b && a === b;
}

export function armarContenidoEventoGoogle(d: DatosContenidoEvento): ContenidoEventoGoogle {
  const attendees: { email: string }[] = [];
  const invitar = (correo: string) => {
    const c = correo.trim();
    if (esLaCuentaDelCalendario(c, d.cuentaDelCalendario)) return;
    if (!attendees.some((a) => a.email.toLowerCase() === c.toLowerCase())) attendees.push({ email: c });
  };
  if (correoValido(d.doctorEmail)) invitar(d.doctorEmail);
  if (d.invitarPaciente !== false && correoValido(d.patientEmail)) invitar(d.patientEmail);

  const direccion = d.clinicAddress?.trim() || "";
  const description = [
    `Tipo: ${d.type}`,
    d.doctorName ? `Doctor/a: ${d.doctorName}` : "",
    `Clínica: ${d.clinicName}`,
    direccion ? `Dirección: ${direccion}` : "",
    "\nAgendado desde DaleControl",
  ].filter(Boolean).join("\n");

  return {
    summary: `🏥 ${d.type} — ${nombreCortoParaTitulo(d.patientName)}`,
    description,
    location: direccion || d.clinicName,
    attendees,
  };
}
