// «Visitas» del portal del paciente: las citas completadas MÁS los controles de
// ortodoncia firmados que no son ya una de esas citas (una hoja firmada sin
// cita, o cuya cita nadie marcó como atendida). Una hoja y su cita son la misma
// visita, no dos; tampoco lo es una hoja suelta del mismo día que una cita
// atendida (misma regla que `visitasDelCaso`, Controles y Alertas). PURO.

import { diaEnZona } from "./controles-modulo";

export function visitasConHojas(args: {
  citasCompletadas: ReadonlyArray<{ id: string; startsAt: Date }>;
  hojasFirmadas: ReadonlyArray<{ appointmentId: string | null; visitDate: Date }>;
  zona: string;
}): number {
  const idsCitas = new Set(args.citasCompletadas.map((c) => c.id));
  const diasConVisita = new Set(args.citasCompletadas.map((c) => diaEnZona(c.startsAt, args.zona)));
  let extra = 0;
  for (const h of args.hojasFirmadas) {
    if (h.appointmentId && idsCitas.has(h.appointmentId)) continue;
    const dia = diaEnZona(h.visitDate, args.zona);
    if (diasConVisita.has(dia)) continue;
    diasConVisita.add(dia);
    extra += 1;
  }
  return args.citasCompletadas.length + extra;
}
