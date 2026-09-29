// Ortodoncia — fechas de los formularios. Todas se ven y se escriben dd/mm/aaaa con el `DateField` del
// panel (calendario en español) y viajan como ISO «aaaa-mm-dd», igual que con el `<input type="date">`.
// Estos dos límites son para el calendario: sin `max`, el selector de año se detiene en el año actual.

const dos = (n: number) => String(n).padStart(2, "0");

/** «aaaa-mm-dd» de HOY en la zona del navegador (no en UTC: de noche caería en mañana). */
export function hoyISO(ahora: Date = new Date()): string {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

/** Tope para fechas del futuro (colocación, promesa de pago, próxima revisión): hoy + `anios`. */
export function hoyMasAniosISO(anios: number, ahora: Date = new Date()): string {
  return `${ahora.getFullYear() + anios}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}
