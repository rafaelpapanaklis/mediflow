/* ═══════════════════════════════════════════════════════════════════════
   EL REGISTRO DE PLANTILLAS.

   El ÚNICO sitio que conoce a las doce por su nombre. Ni la página
   pública, ni el editor, ni la API saben qué plantillas existen: piden
   `<PlantillaBarberWeb data={…} />` y esto resuelve.

   Agregar la decimotercera = una línea aquí (más su manifiesto, su
   componente y su piel). Ver el procedimiento completo en ./manifest.ts.

   Sin "use client": se pinta en el servidor para /b/[slug] y en el
   navegador para la vista previa del editor.
   ═══════════════════════════════════════════════════════════════════════ */

import type { BarberWebTemplateId } from "@/lib/barber/landing";
import type { BarberWebData, BarberWebTemplateComponent } from "./types";
import { PlantillaCarta } from "./t-carta";
import { PlantillaClasica } from "./t-clasica";
import { PlantillaClub } from "./t-club";
import { PlantillaEquipo } from "./t-equipo";
import { PlantillaEstudio } from "./t-estudio";
import { PlantillaMinimal } from "./t-minimal";
import { PlantillaNocturna } from "./t-nocturna";
import { PlantillaPortafolio } from "./t-portafolio";
import { PlantillaPrecios } from "./t-precios";
import { PlantillaPremium } from "./t-premium";
import { PlantillaUrbana } from "./t-urbana";
import { PlantillaVintage } from "./t-vintage";
import "./skins.css";

export const BARBER_WEB_TEMPLATES: Record<BarberWebTemplateId, BarberWebTemplateComponent> = {
  clasica: PlantillaClasica,
  equipo: PlantillaEquipo,
  portafolio: PlantillaPortafolio,
  minimal: PlantillaMinimal,
  premium: PlantillaPremium,
  urbana: PlantillaUrbana,
  vintage: PlantillaVintage,
  precios: PlantillaPrecios,
  estudio: PlantillaEstudio,
  carta: PlantillaCarta,
  nocturna: PlantillaNocturna,
  club: PlantillaClub,
};

/**
 * Pinta la plantilla que diga `data.manifest.id`.
 *
 * Cae a la clásica si el id no existe: una barbería con una plantilla
 * retirada de la lista sigue teniendo página, no una pantalla en blanco.
 */
export function PlantillaBarberWeb({ data }: { data: BarberWebData }) {
  const Componente = BARBER_WEB_TEMPLATES[data.manifest.id] ?? PlantillaClasica;
  return <Componente data={data} />;
}

export { BARBER_WEB_MANIFESTS, BARBER_WEB_MANIFEST_LIST, manifiestoBarberWeb } from "./manifest";
export type { BarberWebData, BarberWebShop, BarberWebServicio, BarberWebBarbero } from "./types";
