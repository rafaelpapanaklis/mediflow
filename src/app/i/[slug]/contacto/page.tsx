import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/blog/json-ld";
import { ArmazonRealtyWeb } from "@/components/realty/web";
import { ContactoForm } from "@/components/realty/web/contacto-form";
import { Migas } from "@/components/realty/web/migas";
import { WebApagada } from "@/components/realty/web/apagada";
import { IcoMapa, IcoWhatsApp } from "@/components/realty/web/pieces";
import { copia, whatsappDe } from "@/components/realty/web/helpers";
import {
  ligaMapaDireccion,
  ligaWhatsApp,
  rutaContactoWeb,
  urlFacebook,
  urlInstagram,
  urlLinkedin,
  urlTiktok,
  urlYoutube,
} from "@/lib/realty/landing";
import { cargarSeoRealty, cargarWebRealty } from "../_shared/data";
import { descripcionSeo, imagenSocial, jsonLdMigas, metadataDe, migasDe } from "../_shared/seo";

/* ═══════════════════════════════════════════════════════════════════════
   /i/[slug]/contacto

   Una página propia y no solo el bloque de la portada, por dos razones:
   es la URL que se manda por WhatsApp cuando alguien pregunta "¿cómo los
   contacto?", y es la que sostiene el enlace "Contacto" de la barra en
   todas las páginas interiores.

   Lo que se escribe aquí cae en el CRM como prospecto con fuente "web"
   (o "letrero" si vino del QR), igual que en la ficha.
   ═══════════════════════════════════════════════════════════════════════ */

export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const seo = await cargarSeoRealty(params.slug);
  if (!seo) return { title: "Página no encontrada", robots: { index: false, follow: false } };
  return metadataDe({
    titulo: `Contacto — ${seo.cuenta.nombre}`,
    descripcion: descripcionSeo(seo.cuenta, seo.config),
    ruta: rutaContactoWeb(seo.cuenta.slug),
    imagen: imagenSocial(seo.config, seo.cuenta),
    indexable: seo.indexable,
    nombre: seo.cuenta.nombre,
  });
}

export default async function PaginaContacto({ params }: Props) {
  const carga = await cargarWebRealty(params.slug);
  if (!carga) notFound();
  if (!carga.publicada) return <WebApagada data={carga.data} />;

  const data = carga.data;
  const wa = ligaWhatsApp(whatsappDe(data), `Hola, vi ${data.cuenta.nombre} en internet.`);
  const tel = data.config.telefono || data.cuenta.telefono;
  // SOLO el del editor. El de la cuenta es el correo con el que se entra al
  // panel y no se publica nunca (ver SELECT_CUENTA en _shared/data.ts).
  const correo = data.config.correo;
  const matriz = data.sucursales.find((s) => s.esMatriz) ?? data.sucursales[0] ?? null;
  const direccion =
    matriz?.direccion ??
    [data.cuenta.direccion, data.cuenta.ciudad, data.cuenta.estado].filter(Boolean).join(", ");
  const mapa = ligaMapaDireccion(direccion);

  const redes = [
    { url: urlInstagram(data.config.instagram), nombre: "Instagram" },
    { url: urlFacebook(data.config.facebook), nombre: "Facebook" },
    { url: urlTiktok(data.config.tiktok), nombre: "TikTok" },
    { url: urlYoutube(data.config.youtube), nombre: "YouTube" },
    { url: urlLinkedin(data.config.linkedin), nombre: "LinkedIn" },
  ].filter((r): r is { url: string; nombre: string } => r.url !== null);

  const migas = migasDe(data.cuenta, [
    { nombre: "Contacto", ruta: rutaContactoWeb(data.cuenta.slug) },
  ]);

  return (
    <ArmazonRealtyWeb data={data}>
      <JsonLd data={jsonLdMigas(migas)} />
      <section className="dcrw-sec">
        <div className="dcrw-ancho">
          <Migas migas={migas} />
          <header className="dcrw-encabezado">
            <h1 className="dcrw-titulo">Contacto</h1>
            <p className="dcrw-bajada">
              Déjanos tus datos o escríbenos por WhatsApp: contestamos el mismo día.
            </p>
          </header>

          <div className="dcrw-ficha">
            <ContactoForm
              slug={data.cuenta.slug}
              whatsapp={wa}
              etiquetas={{
                nombre: copia(data, "contacto", "contacto.nombre") || "Tu nombre",
                telefono: copia(data, "contacto", "contacto.telefono") || "Tu WhatsApp",
                mensaje: copia(data, "contacto", "contacto.mensaje") || "¿Qué estás buscando?",
                enviar: copia(data, "contacto", "contacto.enviar") || "Enviar",
                whatsapp: copia(data, "contacto", "contacto.whatsapp") || "Mejor por WhatsApp",
                aviso:
                  copia(data, "contacto", "contacto.aviso") ||
                  "Usamos tus datos solo para contactarte sobre este inmueble.",
              }}
            />

            <aside className="dcrw-ficha-panel">
              {wa ? (
                <a className="dcrw-btn dcrw-btn-whatsapp" href={wa} target="_blank" rel="noopener noreferrer">
                  <IcoWhatsApp />
                  WhatsApp
                </a>
              ) : null}
              {tel ? (
                <p>
                  <strong>Teléfono</strong>
                  <br />
                  <a href={`tel:${tel}`}>{tel}</a>
                </p>
              ) : null}
              {correo ? (
                <p>
                  <strong>Correo</strong>
                  <br />
                  <a href={`mailto:${correo}`}>{correo}</a>
                </p>
              ) : null}
              {direccion ? (
                <p>
                  <strong>Dónde estamos</strong>
                  <br />
                  {direccion}
                  {mapa ? (
                    <>
                      <br />
                      <a className="dcrw-sucursal-liga" href={mapa} target="_blank" rel="noopener noreferrer">
                        <IcoMapa size={14} />
                        Cómo llegar
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
              {redes.length > 0 ? (
                <p>
                  <strong>Redes</strong>
                  <br />
                  {redes.map((r, i) => (
                    <span key={r.url}>
                      {i > 0 ? " · " : ""}
                      <a href={r.url} target="_blank" rel="noopener noreferrer">
                        {r.nombre}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </aside>
          </div>
        </div>
      </section>
    </ArmazonRealtyWeb>
  );
}
