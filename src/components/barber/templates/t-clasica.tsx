/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "CLÁSICA" — la barbería de toda la vida.

   Lo que la distingue de las otras siete:
     · Portada PARTIDA en dos: texto a la izquierda, foto enmarcada con
       poste de barbero a la derecha. Ninguna otra parte la portada.
     · Los servicios se leen como una CARTA: nombre a la izquierda, precio
       a la derecha y puntitos uniendo los dos.
     · El equipo va en una fila de retratos REDONDOS, tamaño medio.
     · Densidad media y tipografía con serifa para los titulares.

   Cero hooks: se pinta en el servidor. El único JavaScript de la página
   pública es el que Next necesita para hidratar, y aquí no hay nada que
   hidratar.
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
  IcoMapa,
  IcoReloj,
  IcoTelefono,
  IcoWhatsApp,
  Mapa,
  Pie,
  Poste,
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

export function PlantillaClasica({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const marca = logo(data);

  return (
    <div className="dcbw dcbw-clasica" style={varsDeAcento(data)}>
      {/* ── Barra ─────────────────────────────────────────────── */}
      <header className="dcbw-barra">
        <a className="dcbw-marca" href={`/b/${shop.slug}`}>
          {marca ? <Foto src={marca} alt={shop.name} className="dcbw-marca-img" prioridad /> : <Poste />}
          <span>{shop.name}</span>
        </a>
        <nav className="dcbw-menu" aria-label="Secciones">
          {secs
            .filter((s) => s.id !== "portada" && s.id !== "reservar")
            .map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.nombre.split(" ")[0]}
              </a>
            ))}
        </nav>
        <Boton href={reservar} className="dcbw-barra-cta">
          {copia(data, "portada", "portada.cta")}
        </Boton>
      </header>

      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada: partida en dos ───────────────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-clasica-hero">
              <div className="dcbw-clasica-hero-txt">
                <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>
                <h1 className="dcbw-h1">{shop.name}</h1>
                <div className="dcbw-clasica-datos">
                  {dir && (
                    <p>
                      <IcoMapa /> {dir}
                    </p>
                  )}
                  {tieneHorario(config) && (
                    <p>
                      <IcoReloj /> {horarioAgrupado(config)[0]}
                    </p>
                  )}
                  {shop.phone && (
                    <p>
                      <IcoTelefono />{" "}
                      <a href={`tel:${shop.phone}`} className="dcbw-tel">
                        {shop.phone}
                      </a>
                    </p>
                  )}
                </div>
                <div className="dcbw-acciones">
                  <Boton href={reservar}>
                    {copia(data, "portada", "portada.cta")} <IcoFlecha />
                  </Boton>
                  {wa && (
                    <Boton href={wa} variante="whatsapp" externo>
                      <IcoWhatsApp /> {copia(data, "portada", "portada.whatsapp")}
                    </Boton>
                  )}
                </div>
              </div>
              {/* Sin foto de portada la columna entera desaparece y el texto
                  ocupa el ancho completo (lo remata el `:has()` de skins.css).
                  Si no, quedaba media pantalla vacía con un poste suelto
                  flotando en medio — justo lo que ve una barbería recién dada
                  de alta, que es la que menos margen tiene para dudar. */}
              {(foto(data, "portada") || editando) && (
                <div className="dcbw-clasica-hero-foto">
                  <Poste className="dcbw-clasica-poste" />
                  <Ranura
                    url={foto(data, "portada")}
                    etiqueta={nombreRanura(data, "portada", "portada")}
                    alt={`Interior de ${shop.name}`}
                    className="dcbw-clasica-img"
                    editando={editando}
                    prioridad
                  />
                </div>
              )}
            </Sec>
          )}

          {/* ── Servicios: carta con puntitos ─────────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-clasica-carta">
              <Encabezado
                kicker={copia(data, "servicios", "servicios.kicker")}
                titulo={titulo(data, "servicios")}
                subtitulo={subtitulo(data, "servicios")}
              />
              {porCategoria(servicios).map((g, i) => (
                <div key={i} className="dcbw-grupo">
                  {g.categoria && <h3 className="dcbw-grupo-titulo">{g.categoria}</h3>}
                  <ul className="dcbw-carta">
                    {g.items.map((sv) => (
                      <li key={sv.id}>
                        <div className="dcbw-carta-linea">
                          <span className="dcbw-carta-nombre">{sv.nombre}</span>
                          <span className="dcbw-carta-puntos" aria-hidden />
                          <Precio n={sv.precio} />
                        </div>
                        <div className="dcbw-carta-pie">
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
            </Sec>
          )}

          {/* ── Equipo: retratos redondos en fila ─────────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-clasica-equipo">
              <Encabezado
                kicker={copia(data, "equipo", "equipo.kicker")}
                titulo={titulo(data, "equipo")}
                subtitulo={subtitulo(data, "equipo")}
              />
              <ul className="dcbw-clasica-barberos">
                {barberos.map((b) => (
                  <li key={b.id}>
                    {b.fotoUrl ? (
                      <Foto src={b.fotoUrl} alt={b.nombre} className="dcbw-redondo" />
                    ) : (
                      <span className="dcbw-redondo dcbw-inicial">{b.nombre.charAt(0)}</span>
                    )}
                    <h3>{b.nombre}</h3>
                    {b.apodo && <p className="dcbw-apodo">«{b.apodo}»</p>}
                    {b.bio && <p className="dcbw-bio">{b.bio}</p>}
                    <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-enlace">
                      {copia(data, "equipo", "equipo.cta")} <IcoFlecha size={14} />
                    </a>
                  </li>
                ))}
              </ul>
              <Ranura
                url={foto(data, "equipoFoto")}
                etiqueta={nombreRanura(data, "equipo", "equipoFoto")}
                alt={`Equipo de ${shop.name}`}
                className="dcbw-clasica-equipo-foto"
                editando={editando}
              />
            </Sec>
          )}

          {/* ── Portafolio: tres columnas ─────────────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-clasica-galeria">
              <Encabezado
                kicker={copia(data, "portafolio", "portafolio.kicker")}
                titulo={titulo(data, "portafolio")}
              />
              <div className="dcbw-rejilla-3">
                {config.galeria.map((u, i) => (
                  <Foto key={i} src={u} alt={`Corte en ${shop.name}`} />
                ))}
              </div>
            </Sec>
          )}

          {/* ── Reseñas ───────────────────────────────────────── */}
          {s.id === "resenas" && (
            <Sec id="resenas" className="dcbw-clasica-resenas">
              <Encabezado kicker={copia(data, "resenas", "resenas.kicker")} titulo={titulo(data, "resenas")} />
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
            <Sec id="contacto" className="dcbw-clasica-contacto">
              <div className="dcbw-clasica-contacto-txt">
                <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
                {dir && (
                  <div className="dcbw-dato">
                    <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                    <p>{dir}</p>
                    {urlComoLlegar(dir) && (
                      <a href={urlComoLlegar(dir)!} target="_blank" rel="noopener noreferrer" className="dcbw-enlace">
                        {copia(data, "contacto", "contacto.comoLlegar")} <IcoFlecha size={14} />
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
                {wa && (
                  <Boton href={wa} variante="whatsapp" externo>
                    <IcoWhatsApp /> {copia(data, "contacto", "contacto.whatsapp")}
                  </Boton>
                )}
                <Redes config={config} conWhatsApp={false} />
              </div>
              <div className="dcbw-clasica-contacto-mapa">
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
            <Sec id="reservar" className="dcbw-clasica-cierre">
              <Poste className="dcbw-clasica-poste-cierre" />
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
