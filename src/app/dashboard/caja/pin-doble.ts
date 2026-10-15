// Caja — el PIN nuevo SIEMPRE se escribe dos veces.
//
// Regla de Rafael, sin excepción: primera vez al abrir Caja, primera vez tras
// un «Restablecer PIN», y el nuevo al cambiarlo. Solo se continúa si las dos
// son idénticas y de 6 dígitos EXACTOS.
//
// Puro (sin React, sin bcrypt) para probarlo con tsx y para que lo importe el
// navegador: `@/lib/caja-pin` arrastra bcryptjs y no puede ir al cliente. El
// servidor repite la comparación (/api/caja/pin, `pinConfirm`): la pantalla
// valida, el servidor no se fía.

export const PIN_DE_CAJA_RE = /^\d{6}$/;

export type MotivoPinRechazado = "formato" | "no-coinciden" | "actual-formato";

export type ResultadoPin =
  | { ok: true; pin: string }
  | { ok: false; motivo: MotivoPinRechazado };

/** Deja solo dígitos y corta a 6, como los campos de PIN de la pantalla. */
export function soloDigitosDelPin(valor: string): string {
  return valor.replace(/\D/g, "").slice(0, 6);
}

/** ¿Las dos son un PIN válido e idéntico? */
export function validarPinDoble(pin: string, confirmacion: string): ResultadoPin {
  if (!PIN_DE_CAJA_RE.test(pin)) return { ok: false, motivo: "formato" };
  if (pin !== confirmacion) return { ok: false, motivo: "no-coinciden" };
  return { ok: true, pin };
}

/**
 * «Cambiar mi PIN»: el actual (6 dígitos) + el nuevo dos veces. Sin PIN
 * todavía (`tieneActual` false) no hay actual que pedir: es crearlo.
 */
export function validarCambioDePin(o: {
  tieneActual: boolean;
  actual: string;
  nuevo: string;
  confirmacion: string;
}): ResultadoPin & { currentPin?: string } {
  if (o.tieneActual && !PIN_DE_CAJA_RE.test(o.actual)) return { ok: false, motivo: "actual-formato" };
  const r = validarPinDoble(o.nuevo, o.confirmacion);
  if (!r.ok) return r;
  return o.tieneActual ? { ...r, currentPin: o.actual } : r;
}

/** El cuerpo de POST /api/caja/pin: SIEMPRE lleva la confirmación. */
export function cuerpoDePinNuevo(o: { pin: string; confirmacion: string; currentPin?: string }) {
  return {
    action: "set" as const,
    pin: o.pin,
    pinConfirm: o.confirmacion,
    ...(o.currentPin !== undefined && { currentPin: o.currentPin }),
  };
}

/**
 * El texto de «¿Olvidaste tu PIN?». El dueño (SUPER_ADMIN) no tiene a quién
 * pedírselo: lo restablece él, en su propia ficha de Equipo. Cualquier otro rol
 * sigue leyendo «Pídele al dueño…». El rol llega del servidor (page.tsx).
 */
export function claveDelTextoOlvidePin(esSuperAdmin: boolean): string {
  return esSuperAdmin ? "cashRegister.pin.olvidasteTextoDueno" : "cashRegister.pin.olvidasteTexto";
}
