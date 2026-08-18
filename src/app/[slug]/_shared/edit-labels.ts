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
import { manifestOf, TEMPLATE_MANIFESTS, topeDeCopia } from "./template-manifest";
import { etiquetaDeColumna, reglaDeColumna } from "@/lib/landing-address";

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

/* ============================================================
   CUÁNTO ADMITE CADA CAMPO, Y SI PUEDE QUEDARSE VACÍO

   Estaba escrito en cada <Txt> de cada plantilla (`maxLen`, `linea`,
   `requerido`): ~1000 props que no se pintan nunca en público y que, además,
   se habían separado de la regla real. En diez botones el campo dejaba
   escribir 80 caracteres donde el servidor solo acepta 60: la clínica
   escribía, `aplicarDireccion` descartaba el cambio por pasarse del tope, y
   el texto volvía atrás sin decir nada.

   Ahora el tope sale de la MISMA fuente que aplica el servidor —
   `topeDeCopia` del manifiesto y `reglaDeColumna` de landing-address — así
   que no se pueden separar.

   Los topes de las listas son los del lienzo (más ajustados que el tope duro
   de `aplicarDireccion`, que son 2000): un nombre de servicio de 2000
   caracteres cabe en la base pero rompe la tarjeta.
   ============================================================ */

interface Regla { maxLen: number; linea: boolean; requerido: boolean }

const SERVICIO_R: Record<string, Regla> = {
  name:  { maxLen: 120, linea: true,  requerido: true },
  desc:  { maxLen: 400, linea: false, requerido: false },
  price: { maxLen: 40,  linea: true,  requerido: false },
};
const FAQ_R: Record<string, Regla> = {
  q: { maxLen: 200,  linea: true,  requerido: true },
  a: { maxLen: 1200, linea: false, requerido: true },
};
const TESTIMONIO_R: Record<string, Regla> = {
  text: { maxLen: 800, linea: false, requerido: true },
  name: { maxLen: 80,  linea: true,  requerido: false },
  meta: { maxLen: 80,  linea: true,  requerido: false },
};
/** Título y bajada de sección. El tope duro del servidor son 2000. */
const SECCION_R: Record<string, Regla> = {
  titulo:    { maxLen: 160, linea: true,  requerido: false },
  subtitulo: { maxLen: 600, linea: false, requerido: false },
};
/** Las columnas que se escriben en una sola línea. */
const COLUMNA_DE_UNA_LINEA = new Set(["name", "phone"]);

const POR_DEFECTO: Regla = { maxLen: 300, linea: false, requerido: false };

/** Cuánto admite ese campo, si va en una línea y si puede quedarse vacío. */
export function reglaDeCampo(campo: string, tpl?: string | null): Regla {
  const partes = campo.split(":");

  if (partes.length === 2 && partes[0] === "clinica") {
    const r = reglaDeColumna(partes[1]);
    return r
      ? { maxLen: r.maxLen, linea: COLUMNA_DE_UNA_LINEA.has(partes[1]), requerido: r.requerido }
      : POR_DEFECTO;
  }

  if (partes.length === 2 && partes[0] === "copia") {
    const decl = buscar(tpl, (m: any) => (m.copia ?? []).find((c: any) => c.clave === partes[1]));
    return {
      // El tope es el del MANIFIESTO, que es el que aplica el PATCH.
      maxLen: topeDeCopia(partes[1]),
      linea: decl?.linea ?? false,
      requerido: false,
    };
  }

  if (partes.length === 3) {
    const tabla =
      partes[0] === "sec"        ? SECCION_R :
      partes[0] === "servicio"   ? SERVICIO_R :
      partes[0] === "faq"        ? FAQ_R :
      partes[0] === "testimonio" ? TESTIMONIO_R : null;
    if (tabla && tabla[partes[2]]) return tabla[partes[2]];
  }

  return POR_DEFECTO;
}
