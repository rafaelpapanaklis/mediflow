/* ═══════════════════════════════════════════════════════════════════════
   EL MOTOR: pinta la plantilla leyendo el manifiesto.

   No hay un componente por plantilla. Hay un componente por BLOQUE y un
   manifiesto que dice, para cada una de las nueve, qué bloques lleva, en
   qué orden y con qué maquetado. Agregar la décima plantilla es escribir
   su manifiesto y su piel: este archivo no se toca.

   El ORDEN y la VISIBILIDAD los resuelve bloquesVisibles() en
   @/lib/realty/landing — el mismo cálculo que usa el editor para dibujar
   sus controles, para que lo que se ve en la vista previa sea exactamente
   lo que se va a publicar.
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment } from "react";
import {
  bloquesVisibles,
  hayDatosDe,
  ligaWhatsApp,
  rutaContactoWeb,
  rutaPropiedadesWeb,
  rutaWebInmobiliaria,
  urlFacebook,
  urlInstagram,
  urlLinkedin,
  urlTiktok,
  urlYoutube,
  type RealtyWebBloqueId,
  type RealtyWebData,
} from "@/lib/realty/landing";
import { logo, varsDeAcento, whatsappDe } from "@/components/realty/web/helpers";
import { Foto, IcoWhatsApp, Pie } from "@/components/realty/web/pieces";
import { BloquePortada } from "@/components/realty/web/blocks/portada";
import { BloqueBuscador } from "@/components/realty/web/blocks/buscador";
import { BloqueInmuebles } from "@/components/realty/web/blocks/inmuebles";
import { BloqueMapa } from "@/components/realty/web/blocks/mapa";
import { BloqueContacto } from "@/components/realty/web/blocks/contacto";
import { BloqueSobreMi } from "@/components/realty/web/blocks/sobre-mi";
import { BloqueCredenciales } from "@/components/realty/web/blocks/credenciales";
import { BloqueZonas } from "@/components/realty/web/blocks/zonas";
import { BloqueTestimonios } from "@/components/realty/web/blocks/testimonios";
import { BloqueEquipo } from "@/components/realty/web/blocks/equipo";
import { BloqueSucursales } from "@/components/realty/web/blocks/sucursales";
import { BloqueNumeros } from "@/components/realty/web/blocks/numeros";
import { BloqueDisponibilidad } from "@/components/realty/web/blocks/disponibilidad-ahora";
import { BloqueRequisitos } from "@/components/realty/web/blocks/requisitos-para-rentar";
import { BloqueTratoDirecto } from "@/components/realty/web/blocks/trato-directo";
import "@/components/realty/web/skin.css";
// Los maquetados PREMIUM (seis plantillas de la segunda ola) viven junto a
// su bloque y se cargan DESPUÉS de skin.css: misma especificidad, gana lo
// declarado después. Solo agregan variantes; no pisan las nueve originales.
import "@/components/realty/web/blocks/portada.css";
import "@/components/realty/web/blocks/inmuebles.css";
import "@/components/realty/web/blocks/secundarios.css";

type ComponenteBloque = (props: { data: RealtyWebData }) => JSX.Element | null;

/** Registro id → componente. Un id sin entrada simplemente no se pinta. */
export const REALTY_WEB_COMPONENTES: Record<RealtyWebBloqueId, ComponenteBloque> = {
  portada: BloquePortada,
  buscador: BloqueBuscador,
  inmuebles: BloqueInmuebles,
  mapa: BloqueMapa,
  contacto: BloqueContacto,
  "sobre-mi": BloqueSobreMi,
  credenciales: BloqueCredenciales,
  zonas: BloqueZonas,
  testimonios: BloqueTestimonios,
  equipo: BloqueEquipo,
  sucursales: BloqueSucursales,
  numeros: BloqueNumeros,
  "disponibilidad-ahora": BloqueDisponibilidad,
  "requisitos-para-rentar": BloqueRequisitos,
  "trato-directo": BloqueTratoDirecto,
};

/** Las redes que la cuenta llenó, ya como URLs. */
export function redesDe(data: RealtyWebData): Array<{ url: string; nombre: string }> {
  const c = data.config;
  return [
    { url: urlInstagram(c.instagram), nombre: "Instagram" },
    { url: urlFacebook(c.facebook), nombre: "Facebook" },
    { url: urlTiktok(c.tiktok), nombre: "TikTok" },
    { url: urlYoutube(c.youtube), nombre: "YouTube" },
    { url: urlLinkedin(c.linkedin), nombre: "LinkedIn" },
  ].filter((r): r is { url: string; nombre: string } => r.url !== null);
}

/**
 * El armazón de la web: tokens del acento, piel de la plantilla y pie.
 * Lo comparten la portada y las páginas interiores (buscador, ficha,
 * asesor, contacto) para que todas se vean de la misma marca.
 */
export function ArmazonRealtyWeb({
  data,
  children,
}: {
  data: RealtyWebData;
  children: React.ReactNode;
}) {
  const licencia = data.cuenta.licencia
    ? `Licencia inmobiliaria ${data.cuenta.licencia.numero}${
        data.cuenta.licencia.estado ? ` · ${data.cuenta.licencia.estado}` : ""
      }`
    : null;

  const wa = ligaWhatsApp(whatsappDe(data), `Hola, vi ${data.cuenta.nombre} en internet.`);
  const marca = logo(data);

  return (
    // `dcrw-p-<id>` y no `dcrw-<id>`: sin el prefijo de PLANTILLA, la piel
    // de "asesor" chocaría con la clase de cada asesor del bloque de equipo
    // y la de "historia" con el bloque de la historia. Dos cosas distintas
    // con el mismo nombre en la misma hoja se pisan en silencio.
    <div className={`dcrw dcrw-p-${data.manifest.id}`} style={varsDeAcento(data)}>
      {/* Barra ESTÁTICA, nunca sticky: `.dcrw` declara container-type y eso
          crea contexto de contención, que atrapa cualquier position:fixed
          de dentro y descoloca el sticky dentro del marco escalado de la
          vista previa del editor. */}
      <nav className="dcrw-barra" aria-label="Navegación del sitio">
        <div className="dcrw-ancho dcrw-barra-caja">
          <a className="dcrw-barra-marca" href={rutaWebInmobiliaria(data.cuenta.slug)}>
            {marca ? <Foto url={marca} alt={data.cuenta.nombre} prioridad /> : null}
            <span>{data.cuenta.nombre}</span>
          </a>
          <div className="dcrw-barra-ligas">
            <a href={rutaPropiedadesWeb(data.cuenta.slug)}>Inmuebles</a>
            <a href={rutaContactoWeb(data.cuenta.slug)}>Contacto</a>
            {wa ? (
              <a className="dcrw-btn dcrw-btn-whatsapp" href={wa} target="_blank" rel="noopener noreferrer">
                <IcoWhatsApp />
                WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      </nav>
      <main id="contenido">{children}</main>
      <Pie nombre={data.cuenta.nombre} licencia={licencia} redes={redesDe(data)} />
    </div>
  );
}

/** La portada completa: los bloques de la plantilla, en su orden. */
export function PlantillaRealtyWeb({ data }: { data: RealtyWebData }) {
  const bloques = bloquesVisibles(data.manifest, data.config, hayDatosDe(data));
  return (
    <ArmazonRealtyWeb data={data}>
      {bloques.map((b) => {
        const Componente = REALTY_WEB_COMPONENTES[b.id];
        if (!Componente) return null;
        return (
          <Fragment key={b.id}>
            <Componente data={data} />
          </Fragment>
        );
      })}
    </ArmazonRealtyWeb>
  );
}
