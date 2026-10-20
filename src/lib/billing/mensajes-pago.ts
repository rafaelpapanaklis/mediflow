/**
 * Textos que la CLÍNICA lee cuando algo falla al pagar (checkout y «pagar / subir de plan»).
 *
 * Regla (Rafael): español neutro con tú, sin el nombre del proveedor de pagos, sin inglés y sin detalles
 * técnicos. Lo que diga Stripe va a la bitácora, nunca a la pantalla. Una prueba
 * (`pago-pendiente.test.ts`) falla si alguno de estos textos —o una respuesta real de las rutas— nombra al
 * proveedor.
 */
export const MENSAJES_CHECKOUT = {
  /** El pago por tarjeta no está disponible (falta configuración del lado de DaleControl). */
  pagosNoDisponibles: "Los pagos con tarjeta no están disponibles por ahora. Escríbenos a soporte@dalecontrol.com.",
  /** No se pudo comprobar si la clínica ya tiene una suscripción (nunca se abre un cobro nuevo a ciegas). */
  noPudimosComprobar: "No pudimos comprobar tu suscripción. Intenta de nuevo en un momento.",
  /** El proveedor no devolvió el enlace de pago. */
  noPudimosAbrirPago: "No pudimos abrir el pago. Inténtalo de nuevo o escribe a soporte.",
  /** El proveedor de pagos no contestó o rechazó la operación por una razón que la clínica no puede resolver. */
  proveedorNoContesto: "No pudimos completar la operación con el proveedor de pagos. Intenta de nuevo en unos minutos.",
  /** La suscripción de la clínica ya no existe (se borró del lado del proveedor): hay que activarla de nuevo. */
  suscripcionNoExiste: 'Tu suscripción ya no existe. Vuelve a activarla con "Activar / pagar mi plan" y elige el plan que quieres.',
  /** La suscripción está cancelada o incompleta: no se puede cambiar ni cobrar, hay que reactivarla. */
  suscripcionNoActiva: 'Tu suscripción no está activa. Reactívala con "Activar / pagar mi plan" y elige el plan que quieres.',
  /** La suscripción no trae ningún plan asociado (dato roto del lado del proveedor). */
  sinPlanAsociado: "No pudimos encontrar el plan de tu suscripción. Escribe a soporte para que lo revisemos.",
  /** Ya tiene suscripción de tarjeta viva: se le manda a gestionarla en el portal. */
  yaTieneSuscripcion: "Ya tienes una suscripción de tarjeta activa. Gestiónala (cambiar tarjeta, plan o cancelar) en el portal de facturación.",
} as const;
