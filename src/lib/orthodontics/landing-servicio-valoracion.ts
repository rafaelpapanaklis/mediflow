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
 * Agrega "Valoración de ortodoncia" a `servicios` si el módulo está activo
 * (`orthoValoracion` no nulo) y la clínica no tiene ya un servicio con ese
 * mismo nombre en su landing (lo habría escrito a mano). `name` sale del
 * catálogo de Configuración: al reservarlo, `Appointment.type` queda con el
 * texto EXACTO que reconoce el resto del módulo (Tablero, Agenda).
 */
export function conValoracionDeOrtodoncia<T extends ServicioDeLanding>(
  servicios: T[],
  orthoValoracion: { name: string; durationMin: number } | null | undefined,
): T[] {
  if (!orthoValoracion?.name) return servicios;
  const yaEsta = servicios.some(
    (s) => s.name.trim().toLowerCase() === orthoValoracion.name.trim().toLowerCase(),
  );
  if (yaEsta) return servicios;
  return [
    ...servicios,
    { name: orthoValoracion.name, price: null, durationMin: orthoValoracion.durationMin, icon: "🦷" } as T,
  ];
}
