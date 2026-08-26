/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "CARTA" — la página se lee como la carta de una barbería-bar.

   Lo que la distingue de las demás:
     · Toda la página es UNA HOJA: un envoltorio centrado con marco de
       filete doble (latón por fuera, tenue por dentro) sobre papel oscuro
       cálido. Las secciones viven DENTRO de la hoja, una debajo de otra,
       separadas por un filete; ninguna va a sangre.
     · Las secciones van NUMERADAS con romanos (I, II, III…) según el
       orden REAL de `secciones(data)`. La numeración se calcula al pintar,
       así que si la barbería apaga o reordena una sección, sigue bien.
     · A partir de 760 px de contenedor TODO va en dos columnas de menú:
       los servicios con filete de puntos de 1 px entre nombre y precio,
       el equipo como retratos pequeños en blanco y negro, las reseñas
       como citas cortas, el contacto como contraportada.
     · Serif también en el cuerpo, versalitas con `font-variant-caps` y un
       solo acento —el latón— para numerales, precios y filetes.
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
  IcoMapa,
  IcoWhatsApp,
  Mapa,
  Pie,
  Precio,
  Ranura,
  Redes,
  TablaHorario,
  porCategoria,
} from "./pieces";
import { Sec, copia, logo, nombreRanura, secciones, subtitulo, titulo, varsDeAcento } from "./helpers";
import type { BarberWebData } from "./types";

/** 1 → "I", 4 → "IV", 9 → "IX", 14 → "XIV". Fuera de rango, cadena vacía. */
export function romano(n: number): string {
  if (!Number.isFinite(n) || n < 1) return "";
  const tabla: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let resto = Math.floor(n);
  let out = "";
  for (const [valor, letras] of tabla) {
    while (resto >= valor) {
      out += letras;
      resto -= valor;
    }
  }
  return out;
}

/** Encabezado de sección de la carta: numeral en latón, título en serif, filete corto. */
function CabeceraCarta({
  numeral,
  titulo: t,
  subtitulo: s,
}: {
  numeral: string;
  titulo: string;
  subtitulo?: string | null;
}) {
  if (!t && !s) return null;
  return (
    <header className="dcbw-ca-cab">
      {numeral ? (
        <span className="dcbw-ca-num" aria-hidden>
          {numeral}
        </span>
      ) : null}
      {t ? <h2 className="dcbw-h2">{t}</h2> : null}
      {s ? <p className="dcbw-ca-bajada">{s}</p> : null}
      <span className="dcbw-ca-filete" aria-hidden />
    </header>
  );
}

export function PlantillaCarta({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const marca = logo(data);
  const mapa = urlMapaEmbed(config, dir);
  const comoLlegar = urlComoLlegar(dir);
  const sello = copia(data, "portada", "portada.sello");
  const lema = copia(data, "portada", "portada.lema");
  const conHorario = tieneHorario(config);
  const conRedes = !!(config.instagram || config.facebook || config.tiktok);

  // La numeración sale del orden REAL de las secciones visibles, sin
  // contar la portada: apagar o mover una sección no deja huecos.
  const numeradas = secs.filter((s) => s.id !== "portada").map((s) => s.id);
  const numeral = (id: string) => romano(numeradas.indexOf(id) + 1);

  return (
    <div className="dcbw dcbw-carta" style={varsDeAcento(data)}>
      <div className="dcbw-ca-hoja">
        <div className="dcbw-ca-hoja-in">
          {secs.map((s) => (
            <Fragment key={s.id}>
              {/* ── Cabecera de la carta ──────────────────────────── */}
              {s.id === "portada" && (
                <Sec id="portada" className="dcbw-ca-cabecera">
                  {sello || lema ? (
                    <p className="dcbw-ca-sello">
                      <span className="dcbw-ca-sello-txt">
                        {sello ? <span>{sello}</span> : null}
                        {sello && lema ? (
                          <span className="dcbw-ca-sello-sep" aria-hidden>
                            ·
                          </span>
                        ) : null}
                        {lema ? <span>{lema}</span> : null}
                      </span>
                    </p>
                  ) : null}
                  <Ranura
                    url={marca}
                    etiqueta={nombreRanura(data, "portada", "logo")}
                    alt={shop.name}
                    className="dcbw-ca-logo"
                    editando={editando}
                    prioridad
                  />
                  <h1 className="dcbw-h1">{shop.name}</h1>
                  <p className="dcbw-ca-eslogan">{copia(data, "portada", "portada.eslogan")}</p>
                  <span className="dcbw-ca-filete" aria-hidden />
                  <div className="dcbw-acciones dcbw-ca-acciones">
                    <Boton href={reservar}>{copia(data, "portada", "portada.cta")}</Boton>
                    {wa && (
                      <Boton href={wa} variante="fantasma" externo>
                        <IcoWhatsApp size={15} /> {copia(data, "portada", "portada.whatsapp")}
                      </Boton>
                    )}
                  </div>
                </Sec>
              )}

              {/* ── La carta: nombre ······ precio ────────────────── */}
              {s.id === "servicios" && (
                <Sec id="servicios" className="dcbw-ca-servicios">
                  <CabeceraCarta
                    numeral={numeral("servicios")}
                    titulo={titulo(data, "servicios")}
                    subtitulo={subtitulo(data, "servicios")}
                  />
                  <div className="dcbw-ca-carta">
                    {porCategoria(servicios).map((g, i) => (
                      <div key={i} className="dcbw-ca-grupo">
                        {g.categoria && <h3 className="dcbw-ca-categoria">{g.categoria}</h3>}
                        <ul className="dcbw-ca-lista">
                          {g.items.map((sv) => (
                            <li key={sv.id} className="dcbw-ca-renglon">
                              <div className="dcbw-ca-linea">
                                <span className="dcbw-ca-nombre">{sv.nombre}</span>
                                <span className="dcbw-ca-puntos" aria-hidden />
                                <Precio n={sv.precio} className="dcbw-ca-precio" />
                              </div>
                              <div className="dcbw-ca-detalle">
                                <Duracion min={sv.duracionMin} className="dcbw-ca-duracion" />
                                {sv.descripcion && <span className="dcbw-ca-desc">{sv.descripcion}</span>}
                                <a href={reservar} className="dcbw-ca-liga">
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

              {/* ── Detrás de la barra: retratos en B/N ───────────── */}
              {s.id === "equipo" && (
                <Sec id="equipo" className="dcbw-ca-equipo">
                  <CabeceraCarta
                    numeral={numeral("equipo")}
                    titulo={titulo(data, "equipo")}
                    subtitulo={subtitulo(data, "equipo")}
                  />
                  <ul className="dcbw-ca-cuerpo dcbw-ca-barra">
                    {barberos.map((b) => (
                      <li key={b.id} className="dcbw-ca-barbero">
                        <span className="dcbw-ca-retrato">
                          {b.fotoUrl ? (
                            <Foto src={b.fotoUrl} alt={b.nombre} />
                          ) : (
                            <span className="dcbw-inicial">{b.nombre.charAt(0)}</span>
                          )}
                        </span>
                        <div className="dcbw-ca-barbero-txt">
                          <h3>{b.nombre}</h3>
                          {b.apodo && <p className="dcbw-ca-apodo">«{b.apodo}»</p>}
                          {b.bio && <p className="dcbw-ca-bio">{b.bio}</p>}
                          <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-ca-liga">
                            {copia(data, "equipo", "equipo.cta")}
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Sec>
              )}

              {/* ── Se dice en la barra: citas cortas ─────────────── */}
              {s.id === "resenas" && (
                <Sec id="resenas" className="dcbw-ca-resenas">
                  <CabeceraCarta
                    numeral={numeral("resenas")}
                    titulo={titulo(data, "resenas")}
                    subtitulo={subtitulo(data, "resenas")}
                  />
                  <ul className="dcbw-ca-cuerpo dcbw-ca-citas">
                    {config.resenas.map((r, i) => (
                      <li key={i} className="dcbw-ca-cita">
                        <Estrellas n={r.estrellas} size={13} />
                        <p>“{r.texto}”</p>
                        <cite>{r.nombre}</cite>
                      </li>
                    ))}
                  </ul>
                </Sec>
              )}

              {/* ── En la pared: cuadros con marco fino ───────────── */}
              {s.id === "portafolio" && (
                <Sec id="portafolio" className="dcbw-ca-portafolio">
                  <CabeceraCarta
                    numeral={numeral("portafolio")}
                    titulo={titulo(data, "portafolio")}
                    subtitulo={subtitulo(data, "portafolio")}
                  />
                  <div className="dcbw-ca-pared">
                    {config.galeria.map((u, i) => (
                      <figure key={i} className="dcbw-ca-cuadro">
                        <Foto src={u} alt={`Corte en ${shop.name}`} />
                      </figure>
                    ))}
                  </div>
                </Sec>
              )}

              {/* ── Cierre centrado ───────────────────────────────── */}
              {s.id === "reservar" && (
                <Sec id="reservar" className="dcbw-ca-cierre">
                  <CabeceraCarta
                    numeral={numeral("reservar")}
                    titulo={titulo(data, "reservar")}
                    subtitulo={subtitulo(data, "reservar")}
                  />
                  <Boton href={reservar}>{copia(data, "reservar", "reservar.cta")}</Boton>
                </Sec>
              )}

              {/* ── Contraportada: datos en dos columnas, mapa abajo ─ */}
              {s.id === "contacto" && (
                <Sec id="contacto" className="dcbw-ca-contacto">
                  <CabeceraCarta
                    numeral={numeral("contacto")}
                    titulo={titulo(data, "contacto")}
                    subtitulo={subtitulo(data, "contacto")}
                  />
                  <div className="dcbw-ca-cuerpo dcbw-ca-datos">
                    {(dir || conHorario) && (
                      <div className="dcbw-ca-col">
                        {dir && (
                          <div className="dcbw-ca-dato">
                            <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                            <p>{dir}</p>
                            {comoLlegar && (
                              <a href={comoLlegar} target="_blank" rel="noopener noreferrer" className="dcbw-ca-liga">
                                <IcoMapa size={13} /> {copia(data, "contacto", "contacto.comoLlegar")}
                              </a>
                            )}
                          </div>
                        )}
                        {conHorario && (
                          <div className="dcbw-ca-dato">
                            <h3>{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                            <TablaHorario config={config} className="dcbw-ca-horario" />
                          </div>
                        )}
                      </div>
                    )}
                    {(shop.phone || wa || conRedes) && (
                      <div className="dcbw-ca-col">
                        {shop.phone && (
                          <div className="dcbw-ca-dato">
                            <h3>{copia(data, "contacto", "contacto.etiquetaTelefono")}</h3>
                            <p>
                              <a href={`tel:${shop.phone}`} className="dcbw-tel">
                                {shop.phone}
                              </a>
                            </p>
                          </div>
                        )}
                        {wa && (
                          <div className="dcbw-ca-dato">
                            <Boton href={wa} variante="fantasma" externo className="dcbw-ca-wa">
                              <IcoWhatsApp size={15} /> {copia(data, "contacto", "contacto.whatsapp")}
                            </Boton>
                          </div>
                        )}
                        <Redes config={config} conWhatsApp={false} className="dcbw-ca-redes" />
                      </div>
                    )}
                  </div>
                  {mapa && (
                    <div className="dcbw-ca-mapa">
                      <Mapa src={mapa} titulo={`Mapa de ${shop.name}`} />
                    </div>
                  )}
                </Sec>
              )}
            </Fragment>
          ))}
        </div>
      </div>

      <Pie nombre={shop.name} />
    </div>
  );
}
