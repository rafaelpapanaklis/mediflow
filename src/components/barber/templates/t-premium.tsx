/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "PREMIUM" — barbería de lujo.

   Lo que la distingue de las otras siete:
     · Densidad BAJA a propósito: mucho aire entre bloques, tipografía con
       serifa fina y titulares grandes. Es la contraria exacta de `urbana`.
     · Portada a sangre con la foto ocupando toda la pantalla y el nombre
       centrado sobre un velo, no en una columna.
     · Los servicios se numeran (01, 02, 03) y se separan con líneas de un
       pelo: se leen como un índice de revista, no como una lista de
       precios.
     · Las reseñas se reducen a UNA cita grande. Muchas reseñas pequeñas
       abaratan; una sola, en grande, hace lo contrario.
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
  Foto,
  IcoFlecha,
  IcoWhatsApp,
  Mapa,
  Pie,
  Precio,
  Ranura,
  Redes,
  TablaHorario,
} from "./pieces";
import {
  Encabezado,
  Sec,
  copia,
  foto,
  logo,
  nombreRanura,
  secciones,
  subtitulo,
  titulo,
  varsDeAcento,
} from "./helpers";
import type { BarberWebData } from "./types";

export function PlantillaPremium({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Buen día, quisiera reservar en ${shop.name}`);
  const marca = logo(data);
  // Una sola reseña, la primera. Ver la cabecera: en esta plantilla el
  // volumen resta.
  const cita = config.resenas[0];

  return (
    <div className="dcbw dcbw-premium" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada a sangre ──────────────────────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-pr-hero">
              <Ranura
                url={foto(data, "portada")}
                etiqueta={nombreRanura(data, "portada", "portada")}
                alt={`${shop.name}`}
                className="dcbw-pr-hero-img"
                editando={editando}
                prioridad
              />
              <div className="dcbw-pr-velo" />
              <div className="dcbw-pr-hero-txt">
                {marca && <Foto src={marca} alt={shop.name} className="dcbw-marca-img" prioridad />}
                <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>
                <h1 className="dcbw-h1">{shop.name}</h1>
                <span className="dcbw-pr-filete" aria-hidden />
                <div className="dcbw-acciones">
                  <Boton href={reservar}>{copia(data, "portada", "portada.cta")}</Boton>
                  {wa && (
                    <Boton href={wa} variante="fantasma" externo>
                      <IcoWhatsApp size={16} /> {copia(data, "portada", "portada.whatsapp")}
                    </Boton>
                  )}
                </div>
              </div>
            </Sec>
          )}

          {/* ── Servicios: índice numerado ────────────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-pr-servicios">
              <Encabezado
                kicker={copia(data, "servicios", "servicios.kicker")}
                titulo={titulo(data, "servicios")}
                subtitulo={subtitulo(data, "servicios")}
              />
              <ol className="dcbw-pr-indice">
                {servicios.map((sv, i) => (
                  <li key={sv.id}>
                    <span className="dcbw-pr-num">{String(i + 1).padStart(2, "0")}</span>
                    <div className="dcbw-pr-cuerpo">
                      <h3>{sv.nombre}</h3>
                      {sv.descripcion && <p>{sv.descripcion}</p>}
                    </div>
                    <div className="dcbw-pr-cifras">
                      <Duracion min={sv.duracionMin} />
                      <Precio n={sv.precio} />
                    </div>
                  </li>
                ))}
              </ol>
            </Sec>
          )}

          {/* ── Portafolio: dos columnas grandes ──────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-pr-galeria">
              <Encabezado titulo={titulo(data, "portafolio")} subtitulo={subtitulo(data, "portafolio")} />
              <div className="dcbw-pr-rejilla">
                {config.galeria.map((u, i) => (
                  <Foto key={i} src={u} alt={`Trabajo de ${shop.name}`} />
                ))}
              </div>
            </Sec>
          )}

          {/* ── Equipo: retratos chicos con mucho aire ────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-pr-equipo">
              <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
              <ul className="dcbw-pr-barberos">
                {barberos.map((b) => (
                  <li key={b.id}>
                    {b.fotoUrl ? (
                      <Foto src={b.fotoUrl} alt={b.nombre} className="dcbw-redondo" />
                    ) : (
                      <span className="dcbw-redondo dcbw-inicial">{b.nombre.charAt(0)}</span>
                    )}
                    <h3>{b.nombre}</h3>
                    {b.bio && <p className="dcbw-bio">{b.bio}</p>}
                    <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-enlace">
                      {copia(data, "equipo", "equipo.cta")}
                    </a>
                  </li>
                ))}
              </ul>
              <Ranura
                url={foto(data, "equipoFoto")}
                etiqueta={nombreRanura(data, "equipo", "equipoFoto")}
                alt={`Equipo de ${shop.name}`}
                className="dcbw-pr-equipo-foto"
                editando={editando}
              />
            </Sec>
          )}

          {/* ── Reseñas: UNA cita grande ──────────────────────── */}
          {s.id === "resenas" && cita && (
            <Sec id="resenas" className="dcbw-pr-cita">
              {titulo(data, "resenas") && <p className="dcbw-kicker">{titulo(data, "resenas")}</p>}
              <blockquote>“{cita.texto}”</blockquote>
              <cite>{cita.nombre}</cite>
            </Sec>
          )}

          {/* ── Contacto ──────────────────────────────────────── */}
          {s.id === "contacto" && (
            <Sec id="contacto" className="dcbw-pr-contacto">
              <div className="dcbw-pr-contacto-txt">
                <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
                {dir && (
                  <div className="dcbw-dato">
                    <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                    <p>{dir}</p>
                    {urlComoLlegar(dir) && (
                      <a href={urlComoLlegar(dir)!} target="_blank" rel="noopener noreferrer" className="dcbw-enlace">
                        {copia(data, "contacto", "contacto.comoLlegar")}
                      </a>
                    )}
                  </div>
                )}
                {tieneHorario(config) && (
                  <div className="dcbw-dato">
                    <h3>{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                    <TablaHorario config={config} />
                  </div>
                )}
                {shop.phone && (
                  <div className="dcbw-dato">
                    <h3>{copia(data, "contacto", "contacto.etiquetaTelefono")}</h3>
                    <p>
                      <a href={`tel:${shop.phone}`} className="dcbw-tel">
                        {shop.phone}
                      </a>
                    </p>
                  </div>
                )}
                <Redes config={config} textoWhatsApp={`Buen día, quisiera reservar en ${shop.name}`} />
              </div>
              <div className="dcbw-pr-contacto-visual">
                {urlMapaEmbed(config, dir) ? (
                  <Mapa src={urlMapaEmbed(config, dir)!} titulo={`Mapa de ${shop.name}`} />
                ) : (
                  <Ranura
                    url={foto(data, "ambiente")}
                    etiqueta={nombreRanura(data, "contacto", "ambiente")}
                    alt={`Local de ${shop.name}`}
                    editando={editando}
                  />
                )}
              </div>
            </Sec>
          )}

          {/* ── Cierre ────────────────────────────────────────── */}
          {s.id === "reservar" && (
            <Sec id="reservar" className="dcbw-pr-cierre">
              <h2 className="dcbw-h2">{titulo(data, "reservar")}</h2>
              <p className="dcbw-bajada">{subtitulo(data, "reservar")}</p>
              <Boton href={reservar}>
                {copia(data, "reservar", "reservar.cta")} <IcoFlecha />
              </Boton>
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} />
    </div>
  );
}
