/* ============================================================
   CÓMO SE LLAMA CADA CAMPO, PARA EL LIENZO.

   "Botón de reservar de la barra", "Título de servicios", "Precio".
   Son las etiquetas que ve la clínica al pasar por encima de un texto
   editable y el marcador de posición del campo vacío.

   ── POR QUÉ VIVEN AQUÍ Y NO EN LA PLANTILLA ───────────────────
   Antes cada <Txt> las llevaba escritas: `etiqueta="Botón principal
   de la portada"`. Eso son 4,6 KB de texto que NUNCA se pinta en la
   página pública viajando igualmente al navegador de los pacientes,
   solo para que el editor tenga cómo llamar al campo.

   Este módulo lo importa SOLO _shared/edit-runtime.tsx, que a su vez
   solo lo carga LivePreviewBridge con import() dinámico y bajo
   ?edit=1. Así que el manifiesto y estas etiquetas no tocan nunca el
   bundle de /[slug]. Se comprueba en el output del build, no se asume.

   La fuente es el MANIFIESTO, que ya declaraba la etiqueta de cada
   texto y de cada ranura. Tenerla en dos sitios era la manera de que
   se separaran.

   Sin "use client": lo carga el runtime, que ya lo es.
   ============================================================ */
import { manifestOf, TEMPLATE_MANIFESTS } from "./template-manifest";
import { etiquetaDeColumna } from "@/lib/landing-address";

/* Los campos de las listas no están en el manifiesto: no dependen de la
   plantilla, son la forma de un servicio, una FAQ o un testimonio. */
const SERVICIO: Record<string, string> = {
  name: "Nombre del servicio", desc: "Descripción del servicio", price: "Precio",
};
const FAQ: Record<string, string> = { q: "Pregunta", a: "Respuesta" };
const TESTIMONIO: Record<string, string> = {
  name: "Quién lo dice", text: "Opinión", meta: "Cuándo / de dónde",
};

/**
 * Busca en el manifiesto de ESTA plantilla y, si no está, en el de
 * cualquiera.
 *
 * El orden importa: la misma dirección puede tener nombres distintos según
 * la plantilla (`sec:servicios:titulo` es "Título de servicios" en classic y
 * "Título de tratamientos" en especialistas), y la clínica tiene que leer el
 * de la suya. El respaldo existe para las direcciones que una plantilla pinta
 * sin declarar —no debería haberlas, la prueba de instrumentación lo exige—
 * y para que esto nunca devuelva una cadena vacía.
 */
function buscar<T>(tpl: string | null | undefined, saca: (m: any) => T | undefined): T | undefined {
  const mio = saca(manifestOf(tpl));
  if (mio !== undefined) return mio;
  for (const m of Object.values(TEMPLATE_MANIFESTS)) {
    const otro = saca(m);
    if (otro !== undefined) return otro;
  }
  return undefined;
}

/**
 * El nombre humano de una dirección de campo.
 *
 * Si no se reconoce, devuelve la dirección tal cual: es feo, pero es
 * información — sale en el título del elemento y se ve al pasar por encima.
 */
export function etiquetaDeCampo(campo: string, tpl?: string | null): string {
  const partes = campo.split(":");

  if (partes.length === 2 && partes[0] === "clinica") {
    return etiquetaDeColumna(partes[1]) ?? campo;
  }

  if (partes.length === 2 && partes[0] === "copia") {
    return buscar(tpl, m => (m.copia ?? []).find((c: any) => c.clave === partes[1])?.etiqueta) ?? campo;
  }

  if (partes.length === 3 && partes[0] === "sec") {
    return buscar(tpl, m =>
      m.textos.find((t: any) => t.seccion === partes[1] && t.campo === partes[2])?.etiqueta,
    ) ?? campo;
  }

  if (partes.length === 3) {
    const tabla =
      partes[0] === "servicio"   ? SERVICIO :
      partes[0] === "faq"        ? FAQ :
      partes[0] === "testimonio" ? TESTIMONIO : null;
    if (tabla && tabla[partes[2]]) return tabla[partes[2]];
  }

  return campo;
}

/** El nombre humano de una ranura de foto, y la nota de qué foto subir. */
export function ranuraDeFoto(slot: string, tpl?: string | null): { nombre: string; ayuda?: string } {
  const f = buscar(tpl, m => m.fotos.find((x: any) => x.id === slot));
  return f ? { nombre: f.nombre, ayuda: f.ayuda } : { nombre: slot };
}
