/* ═══════════════════════════════════════════════════════════════════════
   SEO DEL VERTICAL INSTITUCIONAL — núcleo PURO.

   Sin prisma y sin "server-only": lo importa `src/app/sitemap.ts` (que es
   servidor y está VIVO en producción para el dental) y lo puede importar
   cualquier superficie pública del vertical. La lectura de la base, si
   algún día hace falta, va en su propio archivo — este NO puede arrastrar
   prisma a un bundle de navegador.

   Es el espejo de `src/lib/barber/seo.ts` y usa el `SITE_URL` de
   `src/lib/seo.ts` en vez de declarar otro: el dominio es UNO.

   ── QUÉ SE INDEXA Y QUÉ NO ──────────────────────────────────────────
   Público ≠ indexable. Del vertical solo se anuncia la LANDING. Todo lo
   que cuelga de `/instituto/**` es panel —o una liga con token— y no
   entra en el sitemap: no porque se nos olvide, sino porque cada una de
   esas URLs o exige sesión o lleva datos de una persona.

   ⚠️ En particular `/instituto/consentimiento/[token]`: es pública (el
   paciente la abre desde su teléfono sin cuenta) y lleva su nombre y el
   procedimiento que va a firmar. Jamás en un buscador.
   ═══════════════════════════════════════════════════════════════════════ */

import { SITE_URL } from "@/lib/seo";
import { EDU_LANDING_PATH } from "@/lib/edu/marketing";

export type EduChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface EduSitemapPath {
  path: string;
  changeFrequency: EduChangeFrequency;
  priority: number;
}

/**
 * Las rutas ESTÁTICAS del vertical que sí se publican. Hoy es una, y ése
 * es el punto: cuando el vertical tenga una segunda superficie pública
 * (una comparativa, una página por especialidad), se añade AQUÍ y
 * `src/app/sitemap.ts` —archivo compartido con el dental— no se vuelve a
 * tocar. Ése es todo el motivo de que esta función exista en vez de un
 * renglón suelto allá.
 *
 * Prioridad 0.9, la misma que la landing de barberías: es la puerta
 * comercial de un vertical entero, no una página más.
 */
export function eduStaticSitemapPaths(): EduSitemapPath[] {
  return [{ path: EDU_LANDING_PATH, changeFrequency: "monthly", priority: 0.9 }];
}

/** URL absoluta de la landing. Para el canonical y el JSON-LD. */
export function eduLandingUrl(): string {
  return `${SITE_URL}${EDU_LANDING_PATH}`;
}

/**
 * Las rutas públicas del vertical que NO se indexan, y por qué. No es
 * documentación decorativa: es el contrato que evita que el próximo
 * cambio meta una de éstas en el sitemap "porque es pública".
 */
export const EDU_RUTAS_NO_INDEXADAS: { patron: string; porque: string }[] = [
  {
    patron: "/instituto/login",
    porque:
      "Puerta del panel. No aporta nada a un buscador y compite con la landing por el término de marca.",
  },
  {
    patron: "/instituto/consentimiento/[token]",
    porque:
      "Liga personal del paciente para firmar su carta de consentimiento. Lleva su nombre y el procedimiento: nunca debe existir en un buscador.",
  },
  {
    patron: "/instituto/**",
    porque:
      "Panel del instituto. Exige sesión y el middleware lo manda al login; una URL de panel en el sitemap solo gasta rastreo.",
  },
];
