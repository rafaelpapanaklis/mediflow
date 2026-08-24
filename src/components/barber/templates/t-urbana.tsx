/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "URBANA" — street y fades.

   Lo que la distingue de las otras siete:
     · Densidad ALTA: bloques pegados, sin aire entre secciones, cada uno
       con su fondo. Es la contraria exacta de `premium`.
     · Tipografía condensada en MAYÚSCULAS y titulares enormes que se
       comen el ancho.
     · Cinta corredera bajo la portada, con el texto que quiera la
       barbería. (Se detiene sola con `prefers-reduced-motion`: ver
       skins.css — una cinta que no para marea y es un problema de
       accesibilidad, no un detalle.)
     · Precios en números BLOQUE, del tamaño del nombre del servicio.
     · Fotos en rejilla densa de cuatro, sin márgenes entre ellas.
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment } from "react";
import {
  direccionCompleta,
  horarioAgrupado,
  rutaReservaBarberia,
  tieneHorario,
  urlComoLlegar,
  urlWhatsApp,
} from "@/lib/barber/landing";
import {
  Boton,
  Duracion,
  Estrellas,
  Foto,
  IcoFlecha,
  IcoMapa,
  IcoWhatsApp,
  Pie,
  Precio,
  Ranura,
  Redes,
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

export function PlantillaUrbana({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Qué onda, quiero reservar en ${shop.name}`);
  const marca = logo(data);
  const cinta = copia(data, "portada", "portada.cinta");

  return (
    <div className="dcbw dcbw-urbana" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada: bloque a tope + cinta ────────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-ur-hero">
              <div className="dcbw-ur-hero-in">
                <div className="dcbw-ur-hero-txt">
                  {marca && <Foto src={marca} alt={shop.name} className="dcbw-marca-img" prioridad />}
                  <h1 className="dcbw-h1">{shop.name}</h1>
                  <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>
                  <div className="dcbw-acciones">
                    <Boton href={reservar}>
                      {copia(data, "portada", "portada.cta")} <IcoFlecha size={15} />
                    </Boton>
                    {wa && (
                      <Boton href={wa} variante="whatsapp" externo>
                        <IcoWhatsApp size={16} /> {copia(data, "portada", "portada.whatsapp")}
                      </Boton>
                    )}
                  </div>
                </div>
                <Ranura
                  url={foto(data, "portada")}
                  etiqueta={nombreRanura(data, "portada", "portada")}
                  alt={shop.name}
                  className="dcbw-ur-hero-img"
                  editando={editando}
                  prioridad
                />
              </div>
              {cinta && (
                <div className="dcbw-ur-cinta" aria-hidden>
                  <div className="dcbw-ur-cinta-pista">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <span key={i}>{cinta}</span>
                    ))}
                  </div>
                </div>
              )}
            </Sec>
          )}

          {/* ── Precios en bloque ─────────────────────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-ur-precios">
              <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
              <ul className="dcbw-ur-lista">
                {servicios.map((sv) => (
                  <li key={sv.id}>
                    <div className="dcbw-ur-lista-txt">
                      <h3>{sv.nombre}</h3>
                      <Duracion min={sv.duracionMin} />
                      {sv.descripcion && <p className="dcbw-carta-desc">{sv.descripcion}</p>}
                    </div>
                    <Precio n={sv.precio} className="dcbw-ur-cifra" />
                    <a href={reservar} className="dcbw-ur-lista-cta">
                      {copia(data, "servicios", "servicios.cta")}
                    </a>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Portafolio: rejilla densa, sin huecos ─────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-ur-galeria">
              <Encabezado titulo={titulo(data, "portafolio")} />
              <div className="dcbw-ur-rejilla">
                {config.galeria.map((u, i) => (
                  <Foto key={i} src={u} alt={`Corte en ${shop.name}`} />
                ))}
              </div>
            </Sec>
          )}

          {/* ── Barberos: cuadrados con nombre encima ─────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-ur-equipo">
              <Encabezado titulo={titulo(data, "equipo")} />
              <ul className="dcbw-ur-barberos">
                {barberos.map((b) => (
                  <li key={b.id}>
                    {b.fotoUrl ? (
                      <Foto src={b.fotoUrl} alt={b.nombre} />
                    ) : (
                      <span className="dcbw-inicial dcbw-inicial-cuadro">{b.nombre.charAt(0)}</span>
                    )}
                    <div className="dcbw-ur-barbero-txt">
                      <h3>{b.apodo || b.nombre}</h3>
                      <a href={rutaReservaBarberia(shop.slug, b.id)}>
                        {copia(data, "equipo", "equipo.cta")}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Reseñas ───────────────────────────────────────── */}
          {s.id === "resenas" && (
            <Sec id="resenas" className="dcbw-ur-resenas">
              <Encabezado titulo={titulo(data, "resenas")} />
              <ul className="dcbw-tira">
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

          {/* ── Contacto: bloque de datos en columnas ─────────── */}
          {s.id === "contacto" && (
            <Sec id="contacto" className="dcbw-ur-contacto">
              <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
              <div className="dcbw-ur-datos">
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
              </div>
              <Redes config={config} textoWhatsApp={`Qué onda, quiero reservar en ${shop.name}`} size={22} />
            </Sec>
          )}

          {/* ── Cierre ────────────────────────────────────────── */}
          {s.id === "reservar" && (
            <Sec id="reservar" className="dcbw-ur-cierre">
              <h2 className="dcbw-h2">{titulo(data, "reservar")}</h2>
              {subtitulo(data, "reservar") && <p className="dcbw-bajada">{subtitulo(data, "reservar")}</p>}
              <Boton href={reservar}>
                {copia(data, "reservar", "reservar.cta")} <IcoFlecha size={15} />
              </Boton>
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} />
    </div>
  );
}
