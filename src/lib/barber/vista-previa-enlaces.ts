/* ═══════════════════════════════════════════════════════════════════════
   LOS ENLACES DENTRO DE LA VISTA PREVIA DEL EDITOR DE «MI WEB».

   La vista previa pinta la plantilla DE VERDAD, así que sus enlaces también
   son de verdad. QA de cierre B (16-nov): tocar «Reservar cita» en la vista
   previa navegaba la pestaña entera a /b/<slug>/reservar — fuera del panel —
   y, con cambios sin publicar, el navegador preguntaba si salir y perderlos.

   Regla: lo que se queda en la página (anclas) se deja; lo que llevaría a
   OTRA página se abre en una pestaña nueva. El editor nunca se pierde.

   Vive en src/lib (sin React ni CSS) para poder probarse con tsx.
   ═══════════════════════════════════════════════════════════════════════ */

export type DestinoEnlaceVistaPrevia = "dejar" | "pestana-nueva";

export function destinoEnlaceVistaPrevia(
  href: string | null | undefined,
  target?: string | null,
): DestinoEnlaceVistaPrevia {
  const h = (href ?? "").trim();
  // Sin destino o ancla de la propia página: el lienzo se desplaza y ya.
  if (!h || h.startsWith("#")) return "dejar";
  // Ya abre aparte (WhatsApp, mapa, redes): no hay nada que proteger.
  if ((target ?? "").toLowerCase() === "_blank") return "dejar";
  // Llamar o escribir no cambia de página.
  if (/^(tel|mailto|sms):/i.test(h)) return "dejar";
  // Reservar, Tienda, un producto, «Mis citas»…: otra página.
  return "pestana-nueva";
}
