import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/blog/json-ld";
import { ArmazonRealtyWeb } from "@/components/realty/web";
import { BuscadorInmuebles, leerFiltros, hayFiltros } from "@/components/realty/web/buscador-form";
import { opcionesDelInventario } from "@/components/realty/web/blocks/buscador";
import { TarjetaInmueble } from "@/components/realty/web/pieces";
import { copia } from "@/components/realty/web/helpers";
import { rutaInmuebleWeb, rutaPropiedadesWeb, tieneRecorrido } from "@/lib/realty/landing";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  type RealtyOperation,
  type RealtyPropertyKind,
} from "@/lib/realty/types";
import { buscarInmueblesWeb, cargarSeoRealty, cargarWebRealty, TOPE_LISTADO } from "../_shared/data";
import { descripcionSeo, imagenSocial, jsonLdListado, jsonLdMigas, metadataDe, migasDe } from "../_shared/seo";
import { WebApagada } from "@/components/realty/web/apagada";
import { Migas } from "@/components/realty/web/migas";

/* ═══════════════════════════════════════════════════════════════════════
   EL BUSCADOR CON FILTROS: /i/[slug]/propiedades

   DINÁMICA a propósito y sin ISR: lee searchParams, y leerlos en una ruta
   con `revalidate` lanza DYNAMIC_SERVER_USAGE al regenerar y devuelve un
   500 al visitante. El filtro va en SQL (buscarInmueblesWeb), no en
   memoria: una cartera de cuatrocientos inmuebles no se trae entera para
   descartar el 95%.

   Cada combinación de filtros es una URL propia —?op=RENTA&zona=Providencia—
   que Google puede indexar: eso es media estrategia de SEO local regalada
   por usar un formulario GET en vez de estado en el cliente.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const seo = await cargarSeoRealty(params.slug);
  if (!seo) return { title: "Página no encontrada", robots: { index: false, follow: false } };

  const f = leerFiltros(searchParams);
  const partes = [
    f.op ? REALTY_OPERATION_LABELS[f.op as RealtyOperation] : null,
    f.tipo ? REALTY_PROPERTY_KIND_LABELS[f.tipo as RealtyPropertyKind] : null,
    f.zona ? `en ${f.zona}` : null,
  ].filter(Boolean);

  const titulo = partes.length > 0
    ? `${partes.join(" · ")} — ${seo.cuenta.nombre}`
    : `Inmuebles — ${seo.cuenta.nombre}`;

  return metadataDe({
    titulo,
    descripcion: descripcionSeo(seo.cuenta, seo.config),
    ruta: rutaPropiedadesWeb(seo.cuenta.slug),
    imagen: imagenSocial(seo.config, seo.cuenta),
    // Una búsqueda con filtros NO se indexa: son miles de combinaciones de
    // la misma cartera y Google las trata como contenido duplicado. La que
    // se indexa es la lista completa, que es la que tiene contenido propio.
    indexable: seo.indexable && !hayFiltros(f),
    nombre: seo.cuenta.nombre,
  });
}

export default async function PaginaPropiedades({ params, searchParams }: Props) {
  const carga = await cargarWebRealty(params.slug);
  if (!carga) notFound();
  if (!carga.publicada) return <WebApagada data={carga.data} />;

  const filtros = leerFiltros(searchParams);
  const resultado = await buscarInmueblesWeb(params.slug, filtros);
  const inmuebles = resultado?.inmuebles ?? [];
  const total = resultado?.total ?? 0;

  const data = carga.data;
  const { zonas, tipos, operaciones } = opcionesDelInventario({
    ...data,
    // Las opciones salen de la cartera COMPLETA que trajo la portada, no
    // del resultado filtrado: si salieran del resultado, filtrar por
    // "Providencia" dejaría el selector con una sola zona y ya no habría
    // forma de cambiar de idea sin borrar la URL a mano.
    inmuebles: data.inmuebles,
  });

  const migas = migasDe(data.cuenta, [
    { nombre: "Inmuebles", ruta: rutaPropiedadesWeb(data.cuenta.slug) },
  ]);

  const etiquetas = {
    operacion: copia(data, "buscador", "buscador.operacion") || "Operación",
    tipo: copia(data, "buscador", "buscador.tipo") || "Tipo de inmueble",
    zona: copia(data, "buscador", "buscador.zona") || "Ciudad o colonia",
    recamaras: copia(data, "buscador", "buscador.recamaras") || "Recámaras",
    buscar: copia(data, "buscador", "buscador.buscar") || "Buscar",
    limpiar: copia(data, "buscador", "buscador.limpiar") || "Limpiar filtros",
  };
  const vacio = copia(data, "buscador", "buscador.vacio") ||
    "No encontramos inmuebles con esos filtros. Prueba con menos.";
  const cta = copia(data, "inmuebles", "inmuebles.cta") || "Ver inmueble";
  const etiquetaRecorrido = copia(data, "inmuebles", "inmuebles.recorrido") || "Recorrido virtual";

  return (
    <ArmazonRealtyWeb data={data}>
      <JsonLd data={jsonLdMigas(migas)} />
      {inmuebles.length > 0 ? (
        <JsonLd data={jsonLdListado(data.cuenta, inmuebles, "Inmuebles", total)} />
      ) : null}

      <section className="dcrw-sec">
        <div className="dcrw-ancho">
          <Migas migas={migas} />
          <header className="dcrw-encabezado">
            <h1 className="dcrw-titulo">Inmuebles</h1>
            <p className="dcrw-bajada">
              {total === 1 ? "1 inmueble disponible" : `${total} inmuebles disponibles`}
            </p>
          </header>

          <BuscadorInmuebles
            slug={data.cuenta.slug}
            zonas={zonas}
            tipos={tipos}
            operaciones={operaciones}
            valores={filtros}
            etiquetas={etiquetas}
          />

          {inmuebles.length === 0 ? (
            <p className="dcrw-vacio">{vacio}</p>
          ) : (
            <div className="dcrw-lista dcrw-lista-rejilla" style={{ marginTop: 26 }}>
              {inmuebles.map((inm, i) => (
                <TarjetaInmueble
                  key={inm.ref}
                  inm={inm}
                  href={rutaInmuebleWeb(data.cuenta.slug, inm.ref)}
                  cta={cta}
                  recorrido={tieneRecorrido(inm)}
                  etiquetaRecorrido={etiquetaRecorrido}
                  prioridad={i === 0}
                />
              ))}
            </div>
          )}

          {total > TOPE_LISTADO ? (
            <p className="dcrw-vacio" style={{ marginTop: 20 }}>
              Se muestran los {TOPE_LISTADO} más recientes de {total}. Afina la búsqueda con los
              filtros de arriba.
            </p>
          ) : null}
        </div>
      </section>
    </ArmazonRealtyWeb>
  );
}
