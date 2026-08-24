/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "VINTAGE" — americana clásica de los cincuenta.

   Lo que la distingue de las otras siete:
     · Fondo CREMA con textura (dos degradados repetidos, cero imágenes) y
       marcos DOBLES con ornamento. Es la única con ornamentos.
     · Un SELLO circular en la portada, con el año de fundación o el lema
       que la barbería quiera. También es la única con sello.
     · Los retratos van en ÓVALO, como en un retrato de estudio antiguo.
     · La carta de servicios lleva filete arriba y abajo y el precio en
       versalitas: se lee como el menú de un local de 1955.
     · Las fotos del portafolio salen en marcos tipo polaroid, ligeramente
       giradas.
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
  IcoNavaja,
  IcoTijeras,
  IcoWhatsApp,
  Mapa,
  Pie,
  Precio,
  Ranura,
  Redes,
  TablaHorario,
  porCategoria,
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

export function PlantillaVintage({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const marca = logo(data);

  return (
    <div className="dcbw dcbw-vintage" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada con marco doble y sello ───────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-vi-hero">
              <Ranura
                url={foto(data, "portada")}
                etiqueta={nombreRanura(data, "portada", "portada")}
                alt={shop.name}
                className="dcbw-vi-hero-img"
                editando={editando}
                prioridad
              />
              <div className="dcbw-vi-marco">
                <div className="dcbw-vi-marco-in">
                  <span className="dcbw-vi-orn" aria-hidden>
                    <IcoTijeras size={20} />
                  </span>
                  {marca && <Foto src={marca} alt={shop.name} className="dcbw-marca-img" prioridad />}
                  <h1 className="dcbw-h1">{shop.name}</h1>
                  <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>
                  <span className="dcbw-vi-filete" aria-hidden />
                  <div className="dcbw-acciones">
                    <Boton href={reservar}>{copia(data, "portada", "portada.cta")}</Boton>
                    {wa && (
                      <Boton href={wa} variante="fantasma" externo>
                        <IcoWhatsApp size={16} /> {copia(data, "portada", "portada.whatsapp")}
                      </Boton>
                    )}
                  </div>
                </div>
                <div className="dcbw-vi-sello">
                  <span className="dcbw-vi-sello-arriba">{copia(data, "portada", "portada.sello")}</span>
                  <IcoNavaja size={22} />
                  <span className="dcbw-vi-sello-abajo">{copia(data, "portada", "portada.lema")}</span>
                </div>
              </div>
            </Sec>
          )}

          {/* ── La carta con filete ───────────────────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-vi-carta">
              <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
              <div className="dcbw-vi-carta-caja">
                {porCategoria(servicios).map((g, i) => (
                  <div key={i} className="dcbw-grupo">
                    {g.categoria && <h3 className="dcbw-vi-grupo">{g.categoria}</h3>}
                    <ul>
                      {g.items.map((sv) => (
                        <li key={sv.id}>
                          <div className="dcbw-vi-linea">
                            <span className="dcbw-carta-nombre">{sv.nombre}</span>
                            <span className="dcbw-carta-puntos" aria-hidden />
                            <Precio n={sv.precio} />
                          </div>
                          <div className="dcbw-vi-pie">
                            <Duracion min={sv.duracionMin} />
                            {sv.descripcion && <span className="dcbw-carta-desc">{sv.descripcion}</span>}
                            <a href={reservar} className="dcbw-enlace">
                              {copia(data, "servicios", "servicios.cta")}
                            </a>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Sec>
          )}

          {/* ── Maestros en óvalo ─────────────────────────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-vi-equipo">
              <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
              <ul className="dcbw-vi-barberos">
                {barberos.map((b) => (
                  <li key={b.id}>
                    <span className="dcbw-vi-ovalo">
                      {b.fotoUrl ? (
                        <Foto src={b.fotoUrl} alt={b.nombre} />
                      ) : (
                        <span className="dcbw-inicial">{b.nombre.charAt(0)}</span>
                      )}
                    </span>
                    <h3>{b.nombre}</h3>
                    {b.apodo && <p className="dcbw-apodo">«{b.apodo}»</p>}
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
                className="dcbw-vi-equipo-foto"
                editando={editando}
              />
            </Sec>
          )}

          {/* ── Álbum: polaroids ──────────────────────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-vi-album">
              <Encabezado titulo={titulo(data, "portafolio")} />
              <div className="dcbw-vi-polaroids">
                {config.galeria.map((u, i) => (
                  <figure key={i}>
                    <Foto src={u} alt={`Corte en ${shop.name}`} />
                  </figure>
                ))}
              </div>
            </Sec>
          )}

          {/* ── Libro de visitas ──────────────────────────────── */}
          {s.id === "resenas" && (
            <Sec id="resenas" className="dcbw-vi-libro">
              <Encabezado titulo={titulo(data, "resenas")} />
              <ul>
                {config.resenas.map((r, i) => (
                  <li key={i} className="dcbw-resena">
                    <Estrellas n={r.estrellas} />
                    <p>“{r.texto}”</p>
                    <cite>— {r.nombre}</cite>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Contacto ──────────────────────────────────────── */}
          {s.id === "contacto" && (
            <Sec id="contacto" className="dcbw-vi-contacto">
              <div className="dcbw-vi-contacto-txt">
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
                <Redes config={config} textoWhatsApp={`Hola, quiero reservar en ${shop.name}`} />
              </div>
              <div className="dcbw-vi-contacto-visual">
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
            <Sec id="reservar" className="dcbw-vi-cierre">
              <span className="dcbw-vi-orn" aria-hidden>
                <IcoNavaja size={20} />
              </span>
              <h2 className="dcbw-h2">{titulo(data, "reservar")}</h2>
              {subtitulo(data, "reservar") && <p className="dcbw-bajada">{subtitulo(data, "reservar")}</p>}
              <Boton href={reservar}>{copia(data, "reservar", "reservar.cta")}</Boton>
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} />
    </div>
  );
}
