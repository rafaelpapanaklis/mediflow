/**
 * Traduce la respuesta de error de la API de citas a algo que una recepcionista
 * pueda leer. Antes se pintaba el código crudo (`appointment_overlap`,
 * `internal_error`) o un genérico que no decía nada.
 *
 * Lo usa la pantalla vieja «Citas» (`appointments-client.tsx`); vive aparte y
 * puro para probarlo con las respuestas REALES de las rutas (WS1-T5,
 * revisión t8, A5).
 */
export function apiErrorMessage(status: number, body: any, fallback: string): string {
  // WS1-T5 (revisión t8, A5): con la agenda flexible el 409 se puede
  // sobreagendar, pero esta pantalla (la vieja) no tiene el «¿Seguro?»: se
  // dice dónde hacerlo en vez de un «Elige otra hora» a secas.
  const dondeSobreagendar = body?.sobreagendable === true ? " Si necesitas sobreagendar, hazlo desde la Agenda." : "";
  if (body?.error === "lunch_overlap") {
    const c = body.comida;
    return c?.lunchStart && c?.lunchEnd
      ? `Esa hora es la comida del doctor (de ${c.lunchStart} a ${c.lunchEnd}). Elige otra hora.${dondeSobreagendar}`
      : `Esa hora es la comida del doctor. Elige otra hora.${dondeSobreagendar}`;
  }
  if (body?.error === "appointment_overlap") {
    const c = body.conflictingAppointment;
    if (c?.startsAt && c?.endsAt) {
      const h = (iso: string) =>
        new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
      return `Ese horario ya está ocupado: ${c.patientName ?? "otra cita"} de ${h(c.startsAt)} a ${h(c.endsAt)}. Elige otra hora.${dondeSobreagendar}`;
    }
    return `Ese horario ya está ocupado por otra cita. Elige otra hora.${dondeSobreagendar}`;
  }
  if (typeof body?.reason === "string" && body.reason) return body.reason;
  if (body?.error === "resource_unavailable") return "El sillón no está disponible a esa hora.";
  if (body?.error === "patient_not_found") return "No se encontró el paciente.";
  if (body?.error === "doctor_not_found") return "No se encontró al profesional.";
  if (body?.error === "invalid_duration") return "La hora de fin tiene que ser posterior a la de inicio.";
  if (status === 403) return "Tu rol no permite hacer este cambio.";
  return fallback;
}
