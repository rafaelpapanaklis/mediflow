// ws1-t1 (Ortodoncia conectada a la reserva web) — puro, sin Prisma ni React:
// mezcla "Valoración de ortodoncia" en la lista de servicios de la reserva
// pública de la landing, como si la clínica lo hubiera escrito a mano en su
// `landingServices`. Lo consume `[slug]/_shared/booking-modal.tsx`
// (toBookingClinic) y lo prueba `landing-servicio-valoracion.test.ts`.

export interface ServicioDeLanding {
  name: string;
  price?: string | null;
  durationMin?: number | null;
  icon?: string | null;
}

/**
 * Agrega un servicio de ortodoncia (nombre EXACTO del catálogo de
 * Configuración, para que `Appointment.type` quede reconocible por el resto
 * del módulo) a `servicios`, sin duplicar si la clínica ya tiene uno con ese
 * mismo nombre escrito a mano en su landing.
 */
function conServicioDeOrtodoncia<T extends ServicioDeLanding>(
  servicios: T[],
  servicio: { name: string; durationMin: number } | null | undefined,
): T[] {
  if (!servicio?.name) return servicios;
  const yaEsta = servicios.some(
    (s) => s.name.trim().toLowerCase() === servicio.name.trim().toLowerCase(),
  );
  if (yaEsta) return servicios;
  return [
    ...servicios,
    { name: servicio.name, price: null, durationMin: servicio.durationMin, icon: "🦷" } as T,
  ];
}

/**
 * Agrega "Valoración de ortodoncia" — se ofrece a TODO visitante (con o sin
 * sesión) cuando el módulo está activo en la clínica. Ver
 * `conControlDeOrtodoncia` para el caso del paciente YA identificado con un
 * caso activo (ws1-t1 ronda 2).
 */
export function conValoracionDeOrtodoncia<T extends ServicioDeLanding>(
  servicios: T[],
  orthoValoracion: { name: string; durationMin: number } | null | undefined,
): T[] {
  return conServicioDeOrtodoncia(servicios, orthoValoracion);
}

/**
 * ws1-t1 ronda 2 — agrega "Control de ortodoncia" SOLO para el paciente ya
 * identificado (sesión del portal) que tiene un caso activo en esta clínica
 * (`GET /api/public/orthodontics/mi-control`). Un visitante sin sesión, o un
 * paciente sin caso, nunca ve esta opción — solo Valoración.
 */
export function conControlDeOrtodoncia<T extends ServicioDeLanding>(
  servicios: T[],
  casoActivo: { label: string; durationMin: number } | null | undefined,
): T[] {
  return conServicioDeOrtodoncia(servicios, casoActivo ? { name: casoActivo.label, durationMin: casoActivo.durationMin } : null);
}
