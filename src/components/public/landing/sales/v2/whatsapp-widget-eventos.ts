/**
 * Puente entre la barra fija de móvil y el botón flotante de WhatsApp: «WhatsApp» de la
 * barra abre la tarjeta del botón (un solo WhatsApp a la vista). Si el botón flotante no
 * está montado nadie escucha, `alClic` devuelve false y el enlace a wa.me sigue su curso.
 */
export const EVENTO_ABRIR_WHATSAPP = "dc:abrir-whatsapp";

/** Pide abrir la tarjeta. true = alguien la atendió (el widget llama a `preventDefault` del evento). */
export function abrirTarjetaWhatsapp(conTeclado = false): boolean {
  if (typeof window === "undefined") return false;
  const ev = new CustomEvent(EVENTO_ABRIR_WHATSAPP, { cancelable: true, detail: { origen: "barra_movil", conTeclado } });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}
