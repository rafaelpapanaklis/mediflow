/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "ESTUDIO" — barbería-estudio, sobria y cara.

   Lo que la distingue de las demás:
     · Una COLUMNA LATERAL FIJA a la izquierda con todo lo que hace falta
       para decidir —marca, nombre, eslogan, dirección, horario, teléfono
       y el botón de reservar— y el contenido que scrollea a la derecha.
       En ninguna otra la reserva está siempre a la vista sin ser una
       barra.
     · Por eso NO tiene sección de cierre "reservar": sería el mismo botón
       dos veces. Es una decisión de estructura, no un olvido.
     · Serif FINA en los titulares, kickers con tracking, filetes de un
       pelo por todas partes, retratos en blanco y negro y un solo acento.
       Hueso y grafito: lo contrario del negro de `premium`.
     · En el teléfono la lateral se pliega a una cabecera compacta
       (marca, nombre, dirección y el primer renglón del horario) y la
       reserva baja a una barra pegada al borde inferior.

   La lateral es `position: sticky`, no `fixed`: la raíz .dcbw es un
   contenedor de consulta y eso la convierte en bloque contenedor de los
   `fixed`. Sticky se mide contra el scrollport real —la ventana en
   público, el lienzo del editor en la vista previa— y funciona en los dos.
   La disposición a dos columnas vive en `.dcbw-es-marco`, un hijo de la
   raíz, porque un elemento no puede consultar su propio contenedor.

   Cero hooks y sin "use client": se pinta en el servidor.
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment } from "react";
import {
  direccionCompleta,
  horarioAgrupado,
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

export function PlantillaEstudio({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const comoLlegar = urlComoLlegar(dir);
  const mapa = urlMapaEmbed(config, dir);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quisiera reservar en ${shop.name}`);
  const marca = logo(data);
  const conHorario = tieneHorario(config);
  // La lateral pinta el horario agrupado ("Lun – Vie: 9:00 am – 8:00 pm")
  // porque cabe en la columna; la tabla completa va en el contacto.
  const horario = conHorario ? horarioAgrupado(config) : [];
  const ambiente = foto(data, "ambiente");
  const conRedes = !!(config.instagram || config.facebook || config.tiktok);
  // En público, un contacto sin un solo dato sería un título sobre nada.
  const conDatos = !!(dir || conHorario || shop.phone || wa || conRedes);
  const conVisual = !!(mapa || ambiente || editando);
  const conContacto = editando || conDatos || conVisual;
  const marcoContacto = ["dcbw-es-contacto-marco", conVisual ? "" : "dcbw-es-sin-visual", conDatos ? "" : "dcbw-es-sin-datos"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="dcbw dcbw-estudio" style={varsDeAcento(data)}>
      <div className="dcbw-es-marco">
        {/* ── La lateral: en el teléfono, cabecera compacta ─────── */}
        <div className="dcbw-es-columna">
          <aside className="dcbw-es-lateral" aria-label={`Datos y reserva de ${shop.name}`}>
            <div className="dcbw-es-marca">
              {marca && <Foto src={marca} alt={shop.name} className="dcbw-es-logo" prioridad />}
              <div className="dcbw-es-marca-txt">
                <p className="dcbw-es-nombre">{shop.name}</p>
                {(dir || horario.length > 0) && (
                  <p className="dcbw-es-linea">
                    {dir && <span>{dir}</span>}
                    {horario[0] && <span>{horario[0]}</span>}
                  </p>
                )}
              </div>
            </div>

            <div className="dcbw-es-ficha">
              <p className="dcbw-es-eslogan">{copia(data, "portada", "portada.eslogan")}</p>
              {dir && (
                <div className="dcbw-dato">
                  <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                  <p>{dir}</p>
                  {comoLlegar && (
                    <a href={comoLlegar} target="_blank" rel="noopener noreferrer" className="dcbw-es-enlace">
                      {copia(data, "contacto", "contacto.comoLlegar")}
                    </a>
                  )}
                </div>
              )}
              {conHorario && (
                <div className="dcbw-dato">
                  <h3>{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                  <ul className="dcbw-es-horario">
                    {horario.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
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
              <Redes config={config} conWhatsApp={false} size={16} className="dcbw-es-redes" />
              <div className="dcbw-es-reserva">
                <Boton href={reservar} className="dcbw-es-btn">
                  {copia(data, "portada", "portada.cta")} <IcoFlecha size={14} />
                </Boton>
                {wa && (
                  <Boton href={wa} variante="fantasma" externo className="dcbw-es-btn">
                    <IcoWhatsApp size={15} /> {copia(data, "portada", "portada.whatsapp")}
                  </Boton>
                )}
                <p className="dcbw-es-nota">{copia(data, "portada", "portada.nota")}</p>
              </div>
            </div>
          </aside>
        </div>

        {/* ── El contenido: scrollea al lado de la lateral ──────── */}
        <div className="dcbw-es-contenido">
          {secs.map((s) => (
            <Fragment key={s.id}>
              {/* ── Portada: el nombre en display y la foto ───────── */}
              {s.id === "portada" && (
                <Sec id="portada" className="dcbw-es-hero">
                  <div className="dcbw-es-hero-txt">
                    <h1 className="dcbw-h1">{shop.name}</h1>
                    {/* Solo en el teléfono: ahí la lateral está plegada y
                        el eslogan no tendría dónde salir. En escritorio se
                        oculta para no repetir el de la columna. */}
                    <p className="dcbw-es-hero-eslogan">{copia(data, "portada", "portada.eslogan")}</p>
                  </div>
                  <Ranura
                    url={foto(data, "portada")}
                    etiqueta={nombreRanura(data, "portada", "portada")}
                    alt={`El estudio de ${shop.name}`}
                    className="dcbw-es-hero-img"
                    editando={editando}
                    prioridad
                  />
                </Sec>
              )}

              {/* ── Servicios: lista con filetes ──────────────────── */}
              {s.id === "servicios" && (
                <Sec id="servicios" className="dcbw-es-servicios">
                  <Encabezado
                    kicker={copia(data, "servicios", "servicios.kicker")}
                    titulo={titulo(data, "servicios")}
                    subtitulo={subtitulo(data, "servicios")}
                  />
                  {porCategoria(servicios).map((g, i) => (
                    <div key={i} className="dcbw-es-grupo">
                      {g.categoria && <h3 className="dcbw-es-categoria">{g.categoria}</h3>}
                      <ul className="dcbw-es-lista">
                        {g.items.map((sv) => (
                          <li key={sv.id}>
                            <span className="dcbw-es-servicio">{sv.nombre}</span>
                            <Precio n={sv.precio} className="dcbw-es-precio" />
                            <Duracion min={sv.duracionMin} className="dcbw-es-duracion" />
                            {sv.descripcion && <p className="dcbw-es-desc">{sv.descripcion}</p>}
                            <a href={reservar} className="dcbw-es-enlace dcbw-es-cta">
                              {copia(data, "servicios", "servicios.cta")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </Sec>
              )}

              {/* ── Equipo: retratos en blanco y negro ────────────── */}
              {s.id === "equipo" && (
                <Sec id="equipo" className="dcbw-es-equipo">
                  <Encabezado
                    kicker={copia(data, "equipo", "equipo.kicker")}
                    titulo={titulo(data, "equipo")}
                    subtitulo={subtitulo(data, "equipo")}
                  />
                  <ul className="dcbw-es-barberos">
                    {barberos.map((b) => (
                      <li key={b.id}>
                        {b.fotoUrl ? (
                          <Foto src={b.fotoUrl} alt={b.nombre} className="dcbw-es-retrato" />
                        ) : (
                          <span className="dcbw-es-retrato dcbw-es-inicial" aria-hidden>
                            {b.nombre.charAt(0)}
                          </span>
                        )}
                        <h3>{b.nombre}</h3>
                        {b.apodo && <p className="dcbw-es-apodo">{b.apodo}</p>}
                        {b.bio && <p className="dcbw-bio">{b.bio}</p>}
                        <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-es-enlace">
                          {copia(data, "equipo", "equipo.cta")} <IcoFlecha size={13} />
                        </a>
                      </li>
                    ))}
                  </ul>
                  <Ranura
                    url={foto(data, "equipoFoto")}
                    etiqueta={nombreRanura(data, "equipo", "equipoFoto")}
                    alt={`El equipo de ${shop.name}`}
                    className="dcbw-es-equipo-foto"
                    editando={editando}
                  />
                </Sec>
              )}

              {/* ── Portafolio: rejilla apretada, sin bordes ──────── */}
              {s.id === "portafolio" && (
                <Sec id="portafolio" className="dcbw-es-portafolio">
                  <Encabezado
                    kicker={copia(data, "portafolio", "portafolio.kicker")}
                    titulo={titulo(data, "portafolio")}
                  />
                  <div className="dcbw-es-rejilla">
                    {config.galeria.map((u, i) => (
                      <Foto key={i} src={u} alt={`Trabajo de ${shop.name}`} />
                    ))}
                  </div>
                </Sec>
              )}

              {/* ── Reseñas: citas en serif itálica, a dos columnas ─ */}
              {s.id === "resenas" && (
                <Sec id="resenas" className="dcbw-es-resenas">
                  <Encabezado kicker={copia(data, "resenas", "resenas.kicker")} titulo={titulo(data, "resenas")} />
                  <ul className="dcbw-es-citas">
                    {config.resenas.map((r, i) => (
                      <li key={i}>
                        <Estrellas n={r.estrellas} size={12} />
                        <blockquote>{r.texto}</blockquote>
                        <cite>{r.nombre}</cite>
                      </li>
                    ))}
                  </ul>
                </Sec>
              )}

              {/* ── Contacto: el detalle (la lateral lleva el resumen) */}
              {s.id === "contacto" && conContacto && (
                <Sec id="contacto" className="dcbw-es-contacto">
                  <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
                  <div className={marcoContacto}>
                    {conDatos && (
                      <div className="dcbw-es-contacto-txt">
                        {dir && (
                          <div className="dcbw-dato">
                            <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                            <p>{dir}</p>
                            {comoLlegar && (
                              <a href={comoLlegar} target="_blank" rel="noopener noreferrer" className="dcbw-es-enlace">
                                {copia(data, "contacto", "contacto.comoLlegar")}
                              </a>
                            )}
                          </div>
                        )}
                        {conHorario && (
                          <div className="dcbw-dato">
                            <h3>{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                            <TablaHorario config={config} className="dcbw-es-tabla" />
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
                        {(wa || conRedes) && (
                          <div className="dcbw-es-contacto-acciones">
                            {wa && (
                              <Boton href={wa} variante="fantasma" externo>
                                <IcoWhatsApp size={15} /> {copia(data, "contacto", "contacto.whatsapp")}
                              </Boton>
                            )}
                            <Redes config={config} conWhatsApp={false} size={16} />
                          </div>
                        )}
                      </div>
                    )}
                    {conVisual && (
                      <div className="dcbw-es-contacto-visual">
                        {mapa && <Mapa src={mapa} titulo={`Mapa de ${shop.name}`} />}
                        <Ranura
                          url={ambiente}
                          etiqueta={nombreRanura(data, "contacto", "ambiente")}
                          alt={`El local de ${shop.name}`}
                          className="dcbw-es-ambiente"
                          editando={editando}
                        />
                      </div>
                    )}
                  </div>
                </Sec>
              )}
            </Fragment>
          ))}

          {/* ── Barra de reserva pegada abajo (solo teléfono) ─────── */}
          <div className="dcbw-es-barra">
            <span>{shop.name}</span>
            <Boton href={reservar}>
              {copia(data, "portada", "portada.cta")} <IcoFlecha size={14} />
            </Boton>
          </div>

          <Pie nombre={shop.name} />
        </div>
      </div>
    </div>
  );
}
