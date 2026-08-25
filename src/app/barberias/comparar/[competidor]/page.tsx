// ═══════════════════════════════════════════════════════════════════════
// /barberias/comparar/<competidor> — una página por competidor.
//
// Son tres URLs reales (booksy, fresha, agendapro), cada una con su propio
// <title>, su descripción y su canónica. El segmento es dinámico sólo para
// no copiar y pegar tres archivos iguales: generateStaticParams las genera
// las tres en el build y dynamicParams las cierra, así que /comparar/loquesea
// da 404 en vez de intentar pintar una comparativa vacía.
//
// El orden de la página es deliberado: primero los datos con fuente (tabla),
// luego el cálculo enseñado (escenarios), luego en qué son MEJORES ellos, y
// hasta después nuestras ventajas. Al final, lo que reportan usuarios, que
// es lo menos verificable y por eso lo que menos peso debe cargar.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { getBarberPlans } from "@/lib/barber/plans";
import { barberComparativaLd } from "@/lib/barber/seo";
import {
  BARBER_PRODUCT_NAME,
  activeBarberPlans,
  serializeBarberJsonLd,
} from "@/lib/barber/marketing";
import {
  COMPETIDOR_SLUGS,
  REVISADO_EL_TEXTO,
  fuentesDeCompetidor,
  getCompetidor,
} from "@/lib/barber/comparativas";
import {
  BloqueCta,
  Encabezado,
  Fortalezas,
  Fuentes,
  RUTA_INDICE,
  Reportes,
  TablaEscenarios,
  TablaLadoALado,
  Ventajas,
} from "@/components/public/barberias/comparar/comparar-ui";

// Igual que el índice: el precio nuestro vive en barber_plan_configs y el
// admin lo puede mover sin redeploy.
export const revalidate = 3600;

// Sólo existen los slugs de COMPETIDORES. Cualquier otro es 404 directo.
export const dynamicParams = false;

const t = getBarberT("es");

interface PageProps {
  params: { competidor: string };
}

export function generateStaticParams(): { competidor: string }[] {
  return COMPETIDOR_SLUGS.map((competidor) => ({ competidor }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const competidor = getCompetidor(params.competidor);
  if (!competidor) return {};

  const title = t("barber.comparar.meta.competidorTitle", {
    competidor: competidor.nombre,
  });
  const description = t("barber.comparar.meta.competidorDescription", {
    competidor: competidor.nombre,
    fecha: REVISADO_EL_TEXTO,
  });

  return buildMetadata({
    title,
    description,
    path: `/barberias/comparar/${competidor.slug}`,
    ogImage: `${SITE_URL}/og/blog?title=${encodeURIComponent(title)}`,
    keywords: [
      `alternativa a ${competidor.nombre}`,
      `${competidor.nombre} vs DaleControl`,
      `${competidor.nombre} precios México`,
      "software para barberías México",
      "agenda para barbería con WhatsApp",
    ],
  });
}

export default async function CompararCompetidorPage({ params }: PageProps) {
  const competidor = getCompetidor(params.competidor);
  // dynamicParams=false ya cierra la puerta; esto es el cinturón por si
  // algún día se abre y para que TypeScript estreche el tipo.
  if (!competidor) notFound();

  const planes = await getBarberPlans();

  // JSON-LD: el producto con el rango REAL de precios (de la tabla) y las
  // migas landing -> índice -> esta comparativa. Nunca un tipo de negocio:
  // aquí se habla del software, no de una barbería.
  const jsonLd = barberComparativaLd({
    producto: BARBER_PRODUCT_NAME,
    // La descripción de ESTA página, no `competidor.resumen`: ese texto
    // describe al competidor, y colgárselo a un nodo que se llama
    // "DaleControl Barber" le diría a Google que somos ellos.
    descripcion: t("barber.comparar.meta.competidorDescription", {
      competidor: competidor.nombre,
      fecha: REVISADO_EL_TEXTO,
    }),
    path: `${RUTA_INDICE}/${competidor.slug}`,
    precios: activeBarberPlans(planes).map((p) => p.priceMonthly),
    migas: [
      { name: BARBER_PRODUCT_NAME, path: "/barberias" },
      { name: t("barber.comparar.indice.h1"), path: RUTA_INDICE },
      { name: competidor.nombre, path: `${RUTA_INDICE}/${competidor.slug}` },
    ],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeBarberJsonLd(jsonLd) }}
      />
      <Encabezado
        kicker={t("barber.comparar.pagina.kicker")}
        titulo={t("barber.comparar.pagina.h1", { competidor: competidor.nombre })}
        lede={competidor.resumen}
        volver={{ href: RUTA_INDICE, label: t("barber.comparar.pagina.volver") }}
      />

      <div className="dcb-cmp__wrap">
        <TablaLadoALado competidor={competidor} planes={planes} t={t} />
        <TablaEscenarios competidor={competidor} planes={planes} t={t} />
        <Fortalezas competidor={competidor} planes={planes} t={t} />
        <Ventajas competidor={competidor} t={t} />
        <Reportes competidor={competidor} t={t} />
        <Fuentes fuentes={fuentesDeCompetidor(competidor)} t={t} />
        <BloqueCta t={t} conSecundario />
      </div>
    </>
  );
}
