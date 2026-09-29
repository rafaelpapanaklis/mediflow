// H6 (revisión final): «Registrar promesa de pago» aceptaba una fecha pasada;
// solo el `min` del input lo evitaba y el servidor no validaba. Una promesa es
// «voy a pagar el…»: hoy o después, en el día de calendario de la clínica.
// Ambas fechas son «YYYY-MM-DD». PURO.

export function errorDeFechaDePromesa(promisedDate: string, hoy: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(promisedDate)) return "Fecha de promesa inválida";
  const d = new Date(`${promisedDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== promisedDate) return "Fecha de promesa inválida";
  if (promisedDate < hoy) return "La fecha de la promesa no puede ser anterior a hoy";
  return null;
}
