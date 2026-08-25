// ═══════════════════════════════════════════════════════════════════════
// /barberias/comparar — el índice de las comparativas.
//
// Tres tarjetas hacia las páginas con detalle y, debajo, la tabla de TODOS
// los que alguien compara en México (incluidos los que no tienen página
// propia). Nuestra fila sale de barber_plan_configs; las suyas, de lo que
// publica cada quien, con fuente y fecha.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
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
  COMPETIDORES,
  PANORAMA,
  REVISADO_EL_TEXTO,
  fuentesDelIndice,
  rangoPrecios,
} from "@/lib/barber/comparativas";
import {
  BloqueCta,
  Encabezado,
  FilaPanorama,
  Fuentes,
  Seccion,
  TarjetaCompetidor,
} from "@/components/public/barberias/comparar/comparar-ui";

// El precio vive en la tabla y el admin lo puede mover sin redeploy: la
// página se regenera cada hora en vez de congelarse en el build.
export const revalidate = 3600;

const t = getBarberT("es");

const TITLE = t("barber.comparar.meta.indiceTitle");
const DESCRIPTION = t("barber.comparar.meta.indiceDescription", {
  fecha: REVISADO_EL_TEXTO,
});

export const metadata: Metadata = buildMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/barberias/comparar",
  ogImage: `${SITE_URL}/og/blog?title=${encodeURIComponent(TITLE)}`,
  keywords: [
    "software para barberías",
    "alternativa a Booksy",
    "alternativa a Fresha",
    "comparativa software barbería México",
    "agenda para barbería WhatsApp",
  ],
});

export default async function CompararIndicePage() {
  const planes = await getBarberPlans();

  // JSON-LD: el producto con el rango REAL de precios (salen de la tabla,
  // no escritos a mano) y las migas hacia la landing. Nunca un tipo de
  // negocio: aquí se habla del software, no de una barbería.
  const jsonLd = barberComparativaLd({
    producto: BARBER_PRODUCT_NAME,
    descripcion: DESCRIPTION,
    path: "/barberias/comparar",
    precios: activeBarberPlans(planes).map((p) => p.priceMonthly),
    migas: [
      { name: BARBER_PRODUCT_NAME, path: "/barberias" },
      { name: t("barber.comparar.indice.h1"), path: "/barberias/comparar" },
    ],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeBarberJsonLd(jsonLd) }}
      />
      <Encabezado
        kicker={t("barber.comparar.indice.kicker")}
        titulo={t("barber.comparar.indice.h1")}
        lede={t("barber.comparar.indice.lede")}
      />

      <div className="dcb-cmp__wrap">
        <Seccion
          titulo={t("barber.comparar.indice.tablaTitulo")}
          sub={t("barber.comparar.indice.tablaLede")}
        >
          <div className="dcb-cmp__grid">
            {COMPETIDORES.map((c) => (
              <TarjetaCompetidor key={c.slug} competidor={c} t={t} />
            ))}
          </div>
        </Seccion>

        <Seccion
          titulo={t("barber.comparar.indice.panoramaTitulo")}
          sub={t("barber.comparar.indice.panoramaLede")}
        >
          <div className="dcb-cmp__pan">
            {/* Nuestra fila: el precio sale de la tabla, nunca escrito a mano. */}
            <FilaPanorama
              destacada
              nombre="DaleControl Barber"
              precio={rangoPrecios(planes)}
              origen="México"
              nota={t("barber.comparar.indice.nosotrosNota")}
            />

            {COMPETIDORES.map((c) => (
              <FilaPanorama
                key={c.slug}
                nombre={c.nombre}
                precio={c.ejes.precio.texto}
                origen={c.origen}
                nota={c.resumen}
                fuenteId={c.ejes.precio.fuenteId}
              />
            ))}

            {PANORAMA.map((p) => (
              <FilaPanorama
                key={p.nombre}
                nombre={p.nombre}
                precio={p.precio}
                origen={p.origen}
                nota={p.nota}
                fuenteId={p.fuenteId}
              />
            ))}
          </div>
        </Seccion>

        <Fuentes fuentes={fuentesDelIndice()} t={t} />

        <BloqueCta t={t} />
      </div>
    </>
  );
}
