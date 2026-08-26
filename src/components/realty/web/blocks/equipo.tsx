/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: EQUIPO (solo modo AGENCY).

   🔴 CADA ASESOR CON SU PÁGINA, Y ESO NO ES ORGANIZACIÓN: ES SEO.

   Si los doce asesores de una inmobiliaria hablan de las mismas colonias
   desde la MISMA página, compiten entre sí por las mismas búsquedas y
   Google resuelve el empate no rankeando a ninguno. Con un subdirectorio
   por asesor —/i/[slug]/agentes/[agente]— cada uno tiene su propia URL,
   sus zonas, su historial y su WhatsApp, y el prospecto que llega por ahí
   entra al CRM ATRIBUIDO a él (ver lead-action.ts).

   Un asesor solo sale aquí si tiene ficha con `publicSlug` y los DOS
   interruptores encendidos (el de la cuenta y el suyo). Eso lo resuelve el
   cargador; este bloque solo pinta lo que le llega.

   Variantes: `tarjetas`, `compacto`, `retratos` y la premium `sobrio`
   (galería): retrato 3:4 sin tarjeta, zonas en una línea, sin bio y las
   acciones como ligas de texto — el equipo se ve serio sin gritar.
   ═══════════════════════════════════════════════════════════════════════ */

import { ligaWhatsApp, rutaAgenteWeb, type RealtyWebData } from "@/lib/realty/landing";
import { copia, foto, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { Foto, IcoWhatsApp, Pastilla, SinFoto } from "@/components/realty/web/pieces";

const ID = "equipo";

export function BloqueEquipo({ data }: { data: RealtyWebData }) {
  if (data.agentes.length === 0) return null;
  const v = variante(data, ID) || "tarjetas";
  const cta = copia(data, ID, "equipo.cta");
  const ctaWa = copia(data, ID, "equipo.whatsapp");
  const grupal = foto(data, "equipoFoto");
  // `sobrio` cambia tres cosas del asesor y ninguna del resto: las zonas
  // pasan de pastillas a una línea, la bio no sale y las acciones son
  // ligas de texto en vez de botones. La foto grupal se queda igual.
  const sobrio = v === "sobrio";

  return (
    <Sec id={ID} variante={v}>
      <Encabezado
        kicker={copia(data, ID, "equipo.kicker")}
        titulo={titulo(data, ID)}
        subtitulo={subtitulo(data, ID)}
      />
      <ul className={`dcrw-equipo dcrw-equipo-${v}`}>
        {data.agentes.map((a) => {
          const href = a.ref ? rutaAgenteWeb(data.cuenta.slug, a.ref) : null;
          const wa = a.whatsapp
            ? ligaWhatsApp(a.whatsapp, `Hola ${a.nombre}, te escribo desde la página de ${data.cuenta.nombre}.`)
            : null;
          return (
            <li className="dcrw-asesor" key={a.ref ?? a.nombre}>
              <div className="dcrw-asesor-foto">
                {a.foto ? <Foto url={a.foto} alt={a.nombre} /> : <SinFoto etiqueta={a.nombre} />}
              </div>
              <div className="dcrw-asesor-cuerpo">
                <h3 className="dcrw-asesor-nombre">
                  {href ? <a href={href}>{a.nombre}</a> : a.nombre}
                </h3>
                {a.zonas.length > 0 && sobrio ? (
                  <p className="dcrw-asesor-zonas-linea">{a.zonas.slice(0, 4).join(" · ")}</p>
                ) : a.zonas.length > 0 ? (
                  <ul className="dcrw-asesor-zonas">
                    {a.zonas.slice(0, 4).map((z) => (
                      <li key={z}>
                        <Pastilla>{z}</Pastilla>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {v !== "compacto" && !sobrio && a.bio ? <p className="dcrw-asesor-bio">{a.bio}</p> : null}
                {sobrio ? (
                  <div className="dcrw-asesor-acciones">
                    {href ? (
                      <a className="dcrw-asesor-liga" href={href}>
                        {cta}
                      </a>
                    ) : null}
                    {wa ? (
                      <a
                        className="dcrw-asesor-liga dcrw-asesor-liga-wa"
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <IcoWhatsApp size={14} />
                        {ctaWa}
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="dcrw-asesor-acciones">
                    {href ? (
                      <a className="dcrw-btn dcrw-btn-fantasma" href={href}>
                        {cta}
                      </a>
                    ) : null}
                    {wa ? (
                      <a
                        className="dcrw-btn dcrw-btn-whatsapp"
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <IcoWhatsApp />
                        {ctaWa}
                      </a>
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {grupal ? (
        <div className="dcrw-equipo-grupal">
          <Foto url={grupal} alt={`Equipo de ${data.cuenta.nombre}`} />
        </div>
      ) : null}
    </Sec>
  );
}
