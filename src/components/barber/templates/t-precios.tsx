/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "PRECIOS" — el menú manda.

   Lo que la distingue de las otras siete:
     · La TABLA es lo primero que se ve después de una franja de dos
       renglones. Ninguna otra plantilla pone los precios arriba.
     · Es una tabla de verdad (<table>), con encabezados de columna y
       agrupada por categoría. Se lee de un vistazo y también en un lector
       de pantalla.
     · Los precios van en cifras grandes, alineadas a la derecha: la
       comparación entre servicios es el objetivo, no la sorpresa.
     · Todo lo demás (equipo, fotos, reseñas) baja de tamaño y va después.
       Para la barbería que compite por precio, lo demás es contexto.
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
  Estrellas,
  Foto,
  IcoFlecha,
  IcoMapa,
  IcoWhatsApp,
  Mapa,
  Pie,
  Ranura,
  Redes,
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
import { duracionBarberWeb, precioBarberWeb } from "@/lib/barber/landing";
import type { BarberWebData } from "./types";

export function PlantillaPrecios({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, vi tus precios y quiero reservar en ${shop.name}`);
  const marca = logo(data);

  return (
    <div className="dcbw dcbw-precios" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Franja de portada: dos renglones ──────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-pc-franja">
              <div className="dcbw-marca">
                {marca && <Foto src={marca} alt={shop.name} className="dcbw-marca-img" prioridad />}
                <div>
                  <h1 className="dcbw-h1">{shop.name}</h1>
                  <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>
                </div>
              </div>
              <div className="dcbw-acciones">
                <Boton href={reservar}>
                  {copia(data, "portada", "portada.cta")} <IcoFlecha size={14} />
                </Boton>
                {wa && (
                  <Boton href={wa} variante="whatsapp" externo>
                    <IcoWhatsApp size={16} /> {copia(data, "portada", "portada.whatsapp")}
                  </Boton>
                )}
              </div>
            </Sec>
          )}

          {/* ── La tabla ──────────────────────────────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-pc-tabla">
              <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
              <div className="dcbw-pc-scroll">
                <table>
                  <caption className="dcbw-oculto">
                    {titulo(data, "servicios")} de {shop.name}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{copia(data, "servicios", "servicios.columnaServicio")}</th>
                      <th scope="col">{copia(data, "servicios", "servicios.columnaDuracion")}</th>
                      <th scope="col" className="dcbw-pc-th-precio">
                        {copia(data, "servicios", "servicios.columnaPrecio")}
                      </th>
                      <th scope="col">
                        <span className="dcbw-oculto">Reservar</span>
                      </th>
                    </tr>
                  </thead>
                  {porCategoria(servicios).map((g, i) => (
                    <tbody key={i}>
                      {g.categoria && (
                        <tr className="dcbw-pc-grupo">
                          <th scope="colgroup" colSpan={4}>
                            {g.categoria}
                          </th>
                        </tr>
                      )}
                      {g.items.map((sv) => (
                        <tr key={sv.id}>
                          <td>
                            <span className="dcbw-pc-nombre">{sv.nombre}</span>
                            {sv.descripcion && <span className="dcbw-carta-desc">{sv.descripcion}</span>}
                          </td>
                          <td className="dcbw-pc-dur">{duracionBarberWeb(sv.duracionMin)}</td>
                          <td className="dcbw-pc-cifra">{precioBarberWeb(sv.precio)}</td>
                          <td className="dcbw-pc-accion">
                            <a href={reservar} className="dcbw-enlace">
                              {copia(data, "servicios", "servicios.cta")}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            </Sec>
          )}

          {/* ── Equipo: tira chica ────────────────────────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-pc-equipo">
              <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
              <ul className="dcbw-pc-barberos">
                {barberos.map((b) => (
                  <li key={b.id}>
                    {b.fotoUrl ? (
                      <Foto src={b.fotoUrl} alt={b.nombre} className="dcbw-redondo" />
                    ) : (
                      <span className="dcbw-redondo dcbw-inicial">{b.nombre.charAt(0)}</span>
                    )}
                    <h3>{b.nombre}</h3>
                    <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-enlace">
                      {copia(data, "equipo", "equipo.cta")}
                    </a>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Portafolio: tira horizontal ───────────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-pc-galeria">
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
            <Sec id="resenas" className="dcbw-pc-resenas">
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
            <Sec id="contacto" className="dcbw-pc-contacto">
              <div>
                <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
                {dir && (
                  <div className="dcbw-dato">
                    <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                    <p>{dir}</p>
                    {urlComoLlegar(dir) && (
                      <a href={urlComoLlegar(dir)!} target="_blank" rel="noopener noreferrer" className="dcbw-enlace">
                        <IcoMapa size={14} /> {copia(data, "contacto", "contacto.comoLlegar")}
                      </a>
                    )}
                  </div>
                )}
                {tieneHorario(config) && (
                  <div className="dcbw-dato">
                    <h3>{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                    {horarioAgrupado(config).map((l, i) => (
                      <p key={i}>{l}</p>
                    ))}
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
                <Redes config={config} textoWhatsApp={`Hola, vi tus precios y quiero reservar en ${shop.name}`} />
              </div>
              <div className="dcbw-pc-contacto-visual">
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
        </Fragment>
      ))}

      <Pie nombre={shop.name} />
    </div>
  );
}
