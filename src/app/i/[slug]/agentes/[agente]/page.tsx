import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/blog/json-ld";
import { ArmazonRealtyWeb } from "@/components/realty/web";
import { ContactoForm } from "@/components/realty/web/contacto-form";
import { Migas } from "@/components/realty/web/migas";
import { WebApagada } from "@/components/realty/web/apagada";
import { Foto, IcoCheck, IcoWhatsApp, Pastilla, SinFoto, TarjetaInmueble } from "@/components/realty/web/pieces";
import { copia } from "@/components/realty/web/helpers";
import {
  ligaWhatsApp,
  rutaAgenteWeb,
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  tieneRecorrido,
} from "@/lib/realty/landing";
import { cargarAgenteRealty, cargarSeoRealty, cargarWebRealty } from "../../_shared/data";
import {
  jsonLdAgente,
  jsonLdListado,
  jsonLdMigas,
  metadataDe,
  migasDe,
} from "../../_shared/seo";

/* ═══════════════════════════════════════════════════════════════════════
   LA PÁGINA PROPIA DE UN ASESOR: /i/[slug]/agentes/[agente]

   🔴 ESTO ES ANTI-CANIBALIZACIÓN, NO ORGANIZACIÓN.

   Si los doce asesores de una inmobiliaria hablan de las mismas colonias
   desde la MISMA página, compiten entre sí por las mismas búsquedas y
   Google resuelve el empate no rankeando a ninguno. Con un subdirectorio
   por asesor, cada uno tiene su URL, sus zonas, su cartera, sus
   credenciales y su WhatsApp — y el prospecto que sale de aquí entra al
   CRM ATRIBUIDO a él (lead-action.ts resuelve el `agente` contra la
   cuenta y pone assignedUserId).

   Solo existe en modo AGENCY y solo con la feature `agentPages` del plan:
   cargarAgenteRealty devuelve null en cualquier otro caso y esto es un
   404 honesto, no una página vacía indexable.
   ═══════════════════════════════════════════════════════════════════════ */

export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams(): { slug: string; agente: string }[] {
  return [];
}

interface Props {
  params: { slug: string; agente: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [seo, carga] = await Promise.all([
    cargarSeoRealty(params.slug),
    cargarAgenteRealty(params.slug, params.agente),
  ]);
  if (!seo || !carga) {
    return { title: "Asesor no encontrado", robots: { index: false, follow: false } };
  }
  const a = carga.agente;
  const zonas = a.zonas.slice(0, 3).join(", ");
  return metadataDe({
    titulo: `${a.nombre} — Asesor inmobiliario | ${seo.cuenta.nombre}`,
    descripcion: (
      a.bio ??
      `${a.nombre}, asesor inmobiliario de ${seo.cuenta.nombre}${zonas ? `. Trabaja ${zonas}` : ""}. Mira su cartera y escríbele por WhatsApp.`
    )
      .replace(/\s+/g, " ")
      .slice(0, 165),
    ruta: rutaAgenteWeb(seo.cuenta.slug, a.ref ?? params.agente),
    imagen: a.foto,
    indexable: seo.indexable,
    nombre: seo.cuenta.nombre,
  });
}

export default async function PaginaAgente({ params }: Props) {
  const [web, carga] = await Promise.all([
    cargarWebRealty(params.slug),
    cargarAgenteRealty(params.slug, params.agente),
  ]);
  if (!web) notFound();
  if (!web.publicada) return <WebApagada data={web.data} />;
  if (!carga) notFound();

  const data = web.data;
  const a = carga.agente;
  const wa = a.whatsapp
    ? ligaWhatsApp(a.whatsapp, `Hola ${a.nombre}, te escribo desde la página de ${data.cuenta.nombre}.`)
    : null;

  const migas = migasDe(data.cuenta, [
    { nombre: "Inmuebles", ruta: rutaPropiedadesWeb(data.cuenta.slug) },
    { nombre: a.nombre, ruta: rutaAgenteWeb(data.cuenta.slug, a.ref ?? params.agente) },
  ]);

  const cta = copia(data, "inmuebles", "inmuebles.cta") || "Ver inmueble";
  const etiquetaRecorrido = copia(data, "inmuebles", "inmuebles.recorrido") || "Recorrido virtual";

  return (
    <ArmazonRealtyWeb data={data}>
      <JsonLd data={jsonLdAgente(data.cuenta, a)} />
      <JsonLd data={jsonLdMigas(migas)} />
      {carga.inmuebles.length > 0 ? (
        <JsonLd
          data={jsonLdListado(data.cuenta, carga.inmuebles, `Inmuebles de ${a.nombre}`, carga.total)}
        />
      ) : null}

      <section className="dcrw-sec">
        <div className="dcrw-ancho">
          <Migas migas={migas} />

          <div className="dcrw-agente-cabeza">
            {a.foto ? <Foto url={a.foto} alt={a.nombre} prioridad /> : <SinFoto etiqueta={a.nombre} />}
            <div>
              <p className="dcrw-kicker">Asesor de {data.cuenta.nombre}</p>
              <h1 className="dcrw-titulo">{a.nombre}</h1>
              {a.zonas.length > 0 ? (
                <ul className="dcrw-zonas" style={{ marginTop: 12 }}>
                  {a.zonas.map((z) => (
                    <li key={z}>
                      <Pastilla>{z}</Pastilla>
                    </li>
                  ))}
                </ul>
              ) : null}
              {wa ? (
                <p style={{ marginTop: 16 }}>
                  <a className="dcrw-btn dcrw-btn-whatsapp" href={wa} target="_blank" rel="noopener noreferrer">
                    <IcoWhatsApp />
                    Escríbele por WhatsApp
                  </a>
                </p>
              ) : null}
            </div>
          </div>

          {a.bio ? <p className="dcrw-agente-bio">{a.bio}</p> : null}

          {a.credenciales.length > 0 ? (
            <div style={{ marginTop: 26 }}>
              <h2 className="dcrw-titulo" style={{ fontSize: 22, marginBottom: 12 }}>
                Con qué respaldo trabaja
              </h2>
              <ul className="dcrw-credenciales dcrw-credenciales-tira">
                {a.credenciales.map((c) => (
                  <li className="dcrw-credencial" key={`${c.titulo}-${c.folio ?? ""}`}>
                    <IcoCheck />
                    <div>
                      <strong>{c.titulo}</strong>
                      {c.folio ? <span>Folio {c.folio}</span> : null}
                      {c.detalle ? <span>{c.detalle}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={{ marginTop: 34 }}>
            <h2 className="dcrw-titulo" style={{ fontSize: 22, marginBottom: 16 }}>
              {carga.total === 1
                ? "1 inmueble a su cargo"
                : `${carga.total} inmuebles a su cargo`}
            </h2>
            {carga.inmuebles.length === 0 ? (
              <p className="dcrw-vacio">
                Ahora mismo no tiene inmuebles publicados. Escríbele y te avisa en cuanto entre algo.
              </p>
            ) : (
              <div className="dcrw-lista dcrw-lista-rejilla">
                {carga.inmuebles.map((inm, i) => (
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
          </div>

          <div style={{ marginTop: 34 }}>
            <h2 className="dcrw-titulo" style={{ fontSize: 22, marginBottom: 14 }}>
              Escríbele directo
            </h2>
            <ContactoForm
              slug={data.cuenta.slug}
              agente={a.ref ?? params.agente}
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
          </div>
        </div>
      </section>
    </ArmazonRealtyWeb>
  );
}
