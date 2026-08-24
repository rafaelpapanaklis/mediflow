/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "EQUIPO" — los barberos mandan.

   Lo que la distingue de las otras siete:
     · No tiene portada grande: solo una FRANJA con el nombre. Los
       retratos empiezan casi en el borde de arriba.
     · Los barberos van en tarjetas VERTICALES 3:4 a sangre, con el
       nombre sobre la foto y SU PROPIA liga de reserva. Es lo que más
       piden los clientes: "quiero con Beto".
     · Los servicios bajan a fichas compactas de tres en fondo, sin
       jerarquía de carta.
     · La bio de cada barbero se lee entera; en las otras es un renglón.
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment } from "react";
import {
  direccionCompleta,
  rutaReservaBarberia,
  tieneHorario,
  urlComoLlegar,
  urlMapaEmbed,
  urlWhatsApp,
} from "@/lib/barber/landing";
import {
  Boton,
  Duracion,
  Estrellas,
  Foto,
  IcoFlecha,
  IcoMapa,
  IcoTijeras,
  IcoWhatsApp,
  Mapa,
  Pie,
  Precio,
  Redes,
  TablaHorario,
} from "./pieces";
import { Encabezado, Sec, copia, logo, secciones, subtitulo, titulo, varsDeAcento } from "./helpers";
import type { BarberWebData } from "./types";

export function PlantillaEquipo({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const marca = logo(data);

  return (
    <div className="dcbw dcbw-equipo" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Franja de portada: apenas el nombre ───────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-equipo-franja">
              <div className="dcbw-equipo-franja-in">
                <div className="dcbw-marca">
                  {marca ? (
                    <Foto src={marca} alt={shop.name} className="dcbw-marca-img" prioridad />
                  ) : (
                    <IcoTijeras size={26} />
                  )}
                  <div>
                    <h1 className="dcbw-h1">{shop.name}</h1>
                    <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>
                  </div>
                </div>
                <div className="dcbw-acciones">
                  <Boton href={reservar}>{copia(data, "portada", "portada.cta")}</Boton>
                  {wa && (
                    <Boton href={wa} variante="whatsapp" externo>
                      <IcoWhatsApp /> {copia(data, "portada", "portada.whatsapp")}
                    </Boton>
                  )}
                </div>
              </div>
            </Sec>
          )}

          {/* ── Barberos: retratos verticales, arriba de todo ── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-equipo-lista">
              <Encabezado
                kicker={copia(data, "equipo", "equipo.kicker")}
                titulo={titulo(data, "equipo")}
                subtitulo={subtitulo(data, "equipo")}
              />
              <ul className="dcbw-equipo-rejilla">
                {barberos.map((b, i) => (
                  <li key={b.id} className="dcbw-equipo-tarjeta">
                    <div className="dcbw-equipo-foto">
                      {b.fotoUrl ? (
                        <Foto src={b.fotoUrl} alt={b.nombre} prioridad={i < 2} />
                      ) : (
                        <span className="dcbw-inicial dcbw-inicial-xl">{b.nombre.charAt(0)}</span>
                      )}
                      <div className="dcbw-equipo-nombre">
                        <h3>{b.nombre}</h3>
                        {b.apodo && <p>«{b.apodo}»</p>}
                      </div>
                    </div>
                    {b.bio && <p className="dcbw-bio">{b.bio}</p>}
                    <Boton href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-equipo-cta">
                      {copia(data, "equipo", "equipo.cta")} <IcoFlecha size={14} />
                    </Boton>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Servicios: fichas compactas ───────────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-equipo-servicios">
              <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
              <ul className="dcbw-equipo-fichas">
                {servicios.map((sv) => (
                  <li key={sv.id}>
                    <div className="dcbw-ficha-top">
                      <h3>{sv.nombre}</h3>
                      <Precio n={sv.precio} />
                    </div>
                    <Duracion min={sv.duracionMin} />
                    {sv.descripcion && <p className="dcbw-carta-desc">{sv.descripcion}</p>}
                    <a href={reservar} className="dcbw-enlace">
                      {copia(data, "servicios", "servicios.cta")}
                    </a>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Portafolio ────────────────────────────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-equipo-galeria">
              <Encabezado titulo={titulo(data, "portafolio")} />
              <div className="dcbw-tira">
                {config.galeria.map((u, i) => (
                  <Foto key={i} src={u} alt={`Corte en ${shop.name}`} />
                ))}
              </div>
            </Sec>
          )}

          {/* ── Reseñas ───────────────────────────────────────── */}
          {s.id === "resenas" && (
            <Sec id="resenas" className="dcbw-equipo-resenas">
              <Encabezado titulo={titulo(data, "resenas")} />
              <ul className="dcbw-rejilla-3">
                {config.resenas.map((r, i) => (
                  <li key={i} className="dcbw-resena">
                    <Estrellas n={r.estrellas} />
                    <p>{r.texto}</p>
                    <cite>{r.nombre}</cite>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Contacto ──────────────────────────────────────── */}
          {s.id === "contacto" && (
            <Sec id="contacto" className="dcbw-equipo-contacto">
              <div>
                <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
                {dir && (
                  <p className="dcbw-dato-linea">
                    <IcoMapa /> {dir}
                  </p>
                )}
                {urlComoLlegar(dir) && (
                  <a href={urlComoLlegar(dir)!} target="_blank" rel="noopener noreferrer" className="dcbw-enlace">
                    {copia(data, "contacto", "contacto.comoLlegar")} <IcoFlecha size={14} />
                  </a>
                )}
                {tieneHorario(config) && (
                  <div className="dcbw-dato">
                    <h3>{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                    <TablaHorario config={config} />
                  </div>
                )}
                {shop.phone && (
                  <p className="dcbw-dato-linea">
                    {copia(data, "contacto", "contacto.etiquetaTelefono")}:{" "}
                    <a href={`tel:${shop.phone}`} className="dcbw-tel">
                      {shop.phone}
                    </a>
                  </p>
                )}
                <Redes config={config} textoWhatsApp={`Hola, quiero reservar en ${shop.name}`} />
              </div>
              {urlMapaEmbed(config, dir) && (
                <Mapa src={urlMapaEmbed(config, dir)!} titulo={`Mapa de ${shop.name}`} />
              )}
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} />
    </div>
  );
}
