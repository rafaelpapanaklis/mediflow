/* ============================================================
   ARMAR UNA DIRECCIÓN DE CAMPO. Nada más.

   Este archivo no importa nada y no deja NINGÚN dato en el bundle:
   seis funciones de una línea y un puñado de tipos, que TypeScript
   borra al compilar.

   Es deliberado. Las plantillas lo importan para etiquetar cada <Txt>
   ("sec:servicios:titulo") y las plantillas viajan al navegador de los
   PACIENTES. Si importaran @/lib/landing-address entero se llevarían
   el manifiesto de las ocho plantillas (17 KB) y las etiquetas del
   editor a una página que no usa ni una cosa ni la otra.

   Quien LEE una dirección —el editor, fuera del iframe— usa
   @/lib/landing-address, que la valida contra el manifiesto. Los dos
   lados tienen que conocer el mismo juego de formas, y por eso los
   tipos viven aquí: en landing-address los arrays de validación se
   declaran `satisfies` contra ellos, así que separarse deja de
   compilar.
   ============================================================ */

/** Columnas sueltas de la clínica que se editan haciendo clic encima. */
export type ColumnaSuelta =
  | "name" | "phone" | "address" | "description"
  | "landingTagline" | "landingPatients" | "landingUrgentText";

export type CampoDeServicio   = "name" | "desc" | "price";
export type CampoDeFaq        = "q" | "a";
export type CampoDeTestimonio = "name" | "text" | "meta";
export type CampoDeSeccion    = "titulo" | "subtitulo";

export const dirClinica    = (c: ColumnaSuelta) => `clinica:${c}`;
export const dirSeccion    = (seccion: string, campo: CampoDeSeccion) => `sec:${seccion}:${campo}`;
export const dirServicio   = (i: number, campo: CampoDeServicio) => `servicio:${i}:${campo}`;
export const dirFaq        = (i: number, campo: CampoDeFaq) => `faq:${i}:${campo}`;
export const dirTestimonio = (i: number, campo: CampoDeTestimonio) => `testimonio:${i}:${campo}`;
export const dirFoto       = (ranura: string) => `foto:${ranura}`;
/**
 * Un texto suelto de la plantilla (kicker, botón, leyenda), guardado en la
 * columna `landingCopy`. La clave la declara el manifiesto: "hero.cta".
 * Lleva puntos y NUNCA dos puntos, que es lo que separa la dirección.
 */
export const dirCopia      = (clave: string) => `copia:${clave}`;
