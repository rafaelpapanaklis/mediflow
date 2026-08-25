import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/blog/json-ld";
import { ArmazonRealtyWeb } from "@/components/realty/web";
import { ContactoForm } from "@/components/realty/web/contacto-form";
import { MapaBajoDemanda } from "@/components/realty/web/mapa-cliente";
import { EmbedRecorrido } from "@/components/realty/web/recorrido-cliente";
import { Migas } from "@/components/realty/web/migas";
import { WebApagada } from "@/components/realty/web/apagada";
import {
  DatosInmueble,
  Foto,
  IcoWhatsApp,
  Pastilla,
  SinFoto,
  TarjetaInmueble,
} from "@/components/realty/web/pieces";
import { copia, whatsappDe } from "@/components/realty/web/helpers";
import {
  embedMapa,
  fotoPortada,
  ligaMapa,
  ligaWhatsApp,
  precioAnunciado,
  rutaAgenteWeb,
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  tieneRecorrido,
  ubicacionPublica,
} from "@/lib/realty/landing";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  REALTY_PROPERTY_STATUS_UI,
  realtyAmenityLabel,
} from "@/lib/realty/types";
import { realtyTourEmbedUrl, realtyTourProviderLabel } from "@/lib/realty/tours";
import { cargarFichaRealty, cargarSeoRealty, cargarWebRealty } from "../../_shared/data";
import {
  imagenSocial,
  jsonLdInmueble,
  jsonLdMigas,
  jsonLdPreguntas,
  metadataDe,
  migasDe,
  preguntasDeFicha,
} from "../../_shared/seo";

/* ═══════════════════════════════════════════════════════════════════════
   LA FICHA DEL INMUEBLE: /i/[slug]/propiedades/[inmueble]

   Es la página que se comparte por WhatsApp, la que abre el QR del letrero
   y la que Google indexa para "casa en renta en <colonia>". Todo lo demás
   del sitio existe para traer a alguien aquí.

   ── PRIVACIDAD ───────────────────────────────────────────────────
   🔴 La calle y las coordenadas SOLO salen si showExactAddress. Eso no se
   decide aquí: lo decide aInmueblePublico() al armar el DTO, que deja
   `direccion`, `lat` y `lng` en null cuando el propietario pidió
   privacidad. Este archivo no podría filtrarlas ni equivocándose.

   ── EL `?f=letrero` NO SE LEE AQUÍ ───────────────────────────────
   La ruta es ISR y leer searchParams lanzaría DYNAMIC_SERVER_USAGE al
   regenerar. La atribución del letrero la lee el formulario en el
   navegador, al enviar (ver contacto-form.tsx).
   ═══════════════════════════════════════════════════════════════════════ */

export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams(): { slug: string; inmueble: string }[] {
  return [];
}

interface Props {
  params: { slug: string; inmueble: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [seo, ficha] = await Promise.all([
    cargarSeoRealty(params.slug),
    cargarFichaRealty(params.slug, params.inmueble),
  ]);
  if (!seo || !ficha) {
    return { title: "Inmueble no encontrado", robots: { index: false, follow: false } };
  }

  const inm = ficha.inmueble;
  const donde = ubicacionPublica(inm);
  const que = REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "Inmueble";
  const operacion = REALTY_OPERATION_LABELS[inm.operation] ?? "";
  const portada = fotoPortada(inm);

  return metadataDe({
    titulo: `${inm.titulo}${donde ? ` — ${donde}` : ""} | ${seo.cuenta.nombre}`,
    descripcion:
      (inm.descripcion ??
        `${que} ${operacion.toLowerCase()}${donde ? ` en ${donde}` : ""}. ${precioAnunciado(inm)}.`)
        .replace(/\s+/g, " ")
        .slice(0, 165),
    ruta: rutaInmuebleWeb(seo.cuenta.slug, inm.ref),
    imagen: portada?.url ?? imagenSocial(seo.config, seo.cuenta),
    indexable: seo.indexable,
    nombre: seo.cuenta.nombre,
  });
}

export default async function PaginaFicha({ params }: Props) {
  const [carga, ficha] = await Promise.all([
    cargarWebRealty(params.slug),
    cargarFichaRealty(params.slug, params.inmueble),
  ]);
  if (!carga) notFound();
  if (!carga.publicada) return <WebApagada data={carga.data} />;
  if (!ficha) notFound();

  const data = carga.data;
  const inm = ficha.inmueble;
  const portada = fotoPortada(inm);
  const resto = inm.fotos.filter((f) => f !== portada).slice(0, 6);
  const donde = ubicacionPublica(inm);
  const tour = tieneRecorrido(inm) ? inm.tours[0] : null;
  const embedTour = tour ? realtyTourEmbedUrl(tour.url) : null;
  const mapa = embedMapa(inm);
  const estatus = REALTY_PROPERTY_STATUS_UI[inm.status];

  const preguntas = preguntasDeFicha(data.cuenta, inm, data.config.requisitos);
  const ldPreguntas = jsonLdPreguntas(preguntas);
  const migas = migasDe(data.cuenta, [
    { nombre: "Inmuebles", ruta: rutaPropiedadesWeb(data.cuenta.slug) },
    { nombre: inm.titulo, ruta: rutaInmuebleWeb(data.cuenta.slug, inm.ref) },
  ]);

  const wa = ligaWhatsApp(
    ficha.asesor?.whatsapp || whatsappDe(data),
    `Hola, me interesa "${inm.titulo}"${inm.folio ? ` (${inm.folio})` : ""}. La vi en su página.`,
  );

  const etiquetaRecorrido = copia(data, "inmuebles", "inmuebles.recorrido") || "Recorrido virtual";
  const ctaTarjeta = copia(data, "inmuebles", "inmuebles.cta") || "Ver inmueble";

  return (
    <ArmazonRealtyWeb data={data}>
      <JsonLd data={jsonLdInmueble(data.cuenta, inm)} />
      <JsonLd data={jsonLdMigas(migas)} />
      {ldPreguntas ? <JsonLd data={ldPreguntas} /> : null}

      <section className="dcrw-sec">
        <div className="dcrw-ancho">
          <Migas migas={migas} />

          <header className="dcrw-encabezado" style={{ maxWidth: "none" }}>
            <p className="dcrw-kicker">
              {REALTY_PROPERTY_KIND_LABELS[inm.kind]} · {REALTY_OPERATION_LABELS[inm.operation]}
            </p>
            <h1 className="dcrw-titulo">{inm.titulo}</h1>
            {donde ? <p className="dcrw-bajada">{donde}</p> : null}
          </header>

          <div className="dcrw-ficha">
            <div>
              {/* Galería. El recorrido, si lo hay, va PRIMERO: es el
                  argumento que separa este anuncio de los del portal. */}
              <div className="dcrw-ficha-galeria">
                {embedTour && tour ? (
                  <EmbedRecorrido
                    src={embedTour}
                    titulo={inm.titulo}
                    etiqueta={etiquetaRecorrido}
                    proveedor={realtyTourProviderLabel(tour.provider)}
                    portada={
                      portada
                        ? { url: portada.url, width: portada.width, height: portada.height }
                        : null
                    }
                  />
                ) : portada ? (
                  <Foto
                    url={portada.url}
                    alt={inm.titulo}
                    width={portada.width}
                    height={portada.height}
                    prioridad
                  />
                ) : (
                  <SinFoto etiqueta={REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "Inmueble"} />
                )}

                {resto.length > 0 ? (
                  <div className="dcrw-ficha-mini">
                    {resto.map((f) => (
                      <Foto key={f.url} url={f.url} alt={inm.titulo} width={f.width} height={f.height} />
                    ))}
                  </div>
                ) : null}
              </div>

              {inm.descripcion ? (
                <div style={{ marginTop: 26 }}>
                  <h2 className="dcrw-titulo" style={{ fontSize: 22 }}>
                    Sobre este inmueble
                  </h2>
                  <p className="dcrw-ficha-desc" style={{ marginTop: 10 }}>
                    {inm.descripcion}
                  </p>
                </div>
              ) : null}

              {inm.amenidades.length > 0 ? (
                <div style={{ marginTop: 26 }}>
                  <h2 className="dcrw-titulo" style={{ fontSize: 22 }}>
                    Qué incluye
                  </h2>
                  <ul className="dcrw-amenidades" style={{ marginTop: 12 }}>
                    {inm.amenidades.map((a) => (
                      <li key={a}>
                        <Pastilla>{realtyAmenityLabel(a)}</Pastilla>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {mapa ? (
                <div style={{ marginTop: 26 }}>
                  <h2 className="dcrw-titulo" style={{ fontSize: 22 }}>
                    Dónde está
                  </h2>
                  <div style={{ marginTop: 12 }}>
                    <MapaBajoDemanda
                      src={mapa}
                      titulo={`Ubicación de ${inm.titulo}`}
                      ubicacion={donde}
                      etiquetaAbrir={copia(data, "mapa", "mapa.abrir") || "Ver el mapa"}
                      etiquetaComoLlegar={copia(data, "mapa", "mapa.comoLlegar") || "Cómo llegar"}
                      ligaComoLlegar={ligaMapa(inm)}
                      aviso={
                        inm.direccionExacta
                          ? null
                          : copia(data, "mapa", "mapa.aproximado") ||
                            "Ubicación aproximada. La dirección exacta se comparte al coordinar la visita."
                      }
                    />
                  </div>
                </div>
              ) : null}

              {/* Las preguntas se PINTAN y luego se marcan como FAQPage con
                  exactamente el mismo texto. Al revés (marcar sin pintar) es
                  motivo de acción manual de Google. */}
              {preguntas.length > 0 ? (
                <div style={{ marginTop: 26 }}>
                  <h2 className="dcrw-titulo" style={{ fontSize: 22 }}>
                    Preguntas frecuentes
                  </h2>
                  <dl className="dcrw-faq" style={{ marginTop: 12 }}>
                    {preguntas.map((p) => (
                      <div key={p.pregunta}>
                        <dt>{p.pregunta}</dt>
                        <dd>{p.respuesta}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </div>

            <aside className="dcrw-ficha-panel">
              {estatus ? <Pastilla tono="brand">{estatus.label}</Pastilla> : null}
              <p className="dcrw-precio dcrw-precio-grande" style={{ margin: 0 }}>
                {precioAnunciado(inm)}
              </p>
              {inm.mantenimiento ? (
                <p style={{ fontSize: 13.5, color: "var(--dcrw-tinta-3)" }}>
                  Mantenimiento aparte
                </p>
              ) : null}
              <DatosInmueble inm={inm} />
              {inm.folio ? <p className="dcrw-folio">Clave {inm.folio}</p> : null}

              {ficha.asesor ? (
                <div className="dcrw-ficha-asesor">
                  {ficha.asesor.foto ? (
                    <Foto url={ficha.asesor.foto} alt={ficha.asesor.nombre} />
                  ) : null}
                  <div>
                    <strong>{ficha.asesor.nombre}</strong>
                    {ficha.asesor.ref ? (
                      <a href={rutaAgenteWeb(data.cuenta.slug, ficha.asesor.ref)}>Ver su perfil</a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {wa ? (
                <a
                  className="dcrw-btn dcrw-btn-whatsapp"
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IcoWhatsApp />
                  Preguntar por WhatsApp
                </a>
              ) : null}

              <ContactoForm
                slug={data.cuenta.slug}
                inmueble={inm.ref}
                agente={ficha.asesor?.ref ?? undefined}
                whatsapp={wa}
                etiquetas={{
                  nombre: copia(data, "contacto", "contacto.nombre") || "Tu nombre",
                  telefono: copia(data, "contacto", "contacto.telefono") || "Tu WhatsApp",
                  mensaje: copia(data, "contacto", "contacto.mensaje") || "¿Qué te gustaría saber?",
                  enviar: copia(data, "contacto", "contacto.enviar") || "Agendar visita",
                  whatsapp: copia(data, "contacto", "contacto.whatsapp") || "Mejor por WhatsApp",
                  aviso:
                    copia(data, "contacto", "contacto.aviso") ||
                    "Usamos tus datos solo para contactarte sobre este inmueble.",
                }}
              />
            </aside>
          </div>

          {ficha.similares.length > 0 ? (
            <div style={{ marginTop: 44 }}>
              <h2 className="dcrw-titulo" style={{ fontSize: 22, marginBottom: 16 }}>
                Otros inmuebles
              </h2>
              <div className="dcrw-lista dcrw-lista-rejilla">
                {ficha.similares.map((s) => (
                  <TarjetaInmueble
                    key={s.ref}
                    inm={s}
                    href={rutaInmuebleWeb(data.cuenta.slug, s.ref)}
                    cta={ctaTarjeta}
                    recorrido={tieneRecorrido(s)}
                    etiquetaRecorrido={etiquetaRecorrido}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </ArmazonRealtyWeb>
  );
}
