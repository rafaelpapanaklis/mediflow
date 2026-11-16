/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "REVISTA" — premium y tranquila (mockup C de ws6, 16-nov).

   Lo que la distingue de las otras doce:
     · En escritorio, una columna FIJA a la izquierda que es el ÍNDICE de
       la página: las secciones en serif, «Mis citas», el horario de un
       vistazo y Reservar + WhatsApp abajo. `estudio` también tiene lateral,
       pero la suya es una ficha (dirección, horario, teléfono); ésta es un
       índice que lleva a las secciones.
     · En el teléfono la lateral se pliega a una cabecera mínima (marca y
       «Mis citas») y el menú baja a una barra pegada al borde inferior:
       Servicios · Tienda · Visita · Reservar, con el pulgar.
     · Portada con el NOMBRE ENORME en serif ligera y la foto en CÁPSULA.
       Cápsulas también en tienda, equipo, trabajo y mapa.
     · UNA nota de color: el acento de la barbería, solo en lo que se toca
       (botones, subrayados, puntos) y en el recuadro de los combos.
     · Sin fotos sigue fina: la cápsula de portada se vuelve la inicial en
       itálica sobre el acento suave, los retratos la inicial sobre piedra,
       y lo demás es tipografía y aire. Nunca un hueco en público.

   La lateral es `position: sticky` y la barra de abajo también (no
   `fixed`): la raíz .dcbw es contenedor de consulta y eso la vuelve bloque
   contenedor de los `fixed`. Sticky se mide contra el scrollport real —la
   ventana en público, el lienzo en la vista previa del editor— y funciona
   en los dos. Ver la misma nota en t-estudio.tsx.

   Cero hooks y sin "use client": se pinta en el servidor.
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment } from "react";
import {
  direccionCompleta,
  horarioAgrupado,
  rutaReservaBarberia,
  tieneHorario,
  urlComoLlegar,
  urlInstagram,
  urlMapaEmbed,
  urlWhatsApp,
} from "@/lib/barber/landing";
import {
  Boton,
  Duracion,
  Estrellas,
  Foto,
  HuecoFoto,
  IcoFlecha,
  IcoInstagram,
  IcoMapa,
  IcoTelefono,
  IcoWhatsApp,
  Mapa,
  Pie,
  Precio,
  Redes,
  SeccionProductos,
  TablaHorario,
  enlaceTienda,
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

/** La inicial que sustituye a una foto: la primera letra de verdad del nombre. */
function inicial(nombre: string): string {
  const m = /\p{L}|\p{N}/u.exec(nombre);
  return (m ? m[0] : "·").toUpperCase();
}

/**
 * El tamaño del nombre en portada, según lo largo que sea.
 *
 * El nombre va en display enorme; «Raya» cabe a 150 px, pero «Barbería y
 * Peluquería Los Hermanos Gómez» no, y una palabra que no cabe en el ancho
 * desborda la página en el teléfono. Manda la palabra más larga (lo que no
 * se puede partir) y luego el total (cuántos renglones).
 */
function tallaNombre(nombre: string): "s" | "m" | "l" {
  const palabra = Math.max(0, ...nombre.split(/\s+/).map((p) => p.length));
  if (palabra <= 7 && nombre.length <= 12) return "s";
  if (palabra <= 11 && nombre.length <= 26) return "m";
  return "l";
}

/** «@cuenta» a partir de lo que la barbería escribió (usuario, @usuario o URL). */
function cuentaInstagram(crudo: string | null): string | null {
  if (!crudo) return null;
  const limpio = crudo
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(limpio) ? `@${limpio}` : null;
}

/** Los combos y paquetes se destacan en su recuadro de acento, como en el mockup. */
function esDestacada(categoria: string | null): boolean {
  return !!categoria && /combo|paquete|promo/i.test(categoria);
}

function IcoAgenda({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function PlantillaRevista({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const comoLlegar = urlComoLlegar(dir);
  const mapa = urlMapaEmbed(config, dir);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quisiera reservar en ${shop.name}`);
  const marca = logo(data);
  const tienda = enlaceTienda(data);
  const cuenta = data.cuentaUrl ?? null;
  const conHorario = tieneHorario(config);
  // Solo los tramos abiertos: «Lun: Cerrado» no le dice a nadie cuándo ir.
  const abiertos = conHorario ? horarioAgrupado(config).filter((l) => !l.endsWith(": Cerrado")) : [];
  const conRedes = !!(config.instagram || config.facebook || config.tiktok);
  const ig = urlInstagram(config.instagram);
  const igCuenta = cuentaInstagram(config.instagram);
  const fotoPortada = foto(data, "portada");
  const ciudad = [shop.city, shop.state].filter((p) => p && p.trim()).join(", ");

  // En público, una Visita sin un solo dato sería un título sobre nada.
  const conDatosVisita = !!(dir || conHorario || shop.phone || wa || conRedes);
  const conVisita = editando || conDatosVisita || !!mapa;
  const hay = (id: string) => secs.some((s) => s.id === id) && (id !== "contacto" || conVisita);
  const conDatosPortada = !!(dir || abiertos.length > 0 || shop.phone);

  const cta = copia(data, "portada", "portada.cta");
  const etiquetaMenu: Record<string, string> = {
    servicios: copia(data, "servicios", "servicios.menu"),
    equipo: copia(data, "equipo", "equipo.menu"),
    portafolio: copia(data, "portafolio", "portafolio.menu"),
    resenas: copia(data, "resenas", "resenas.menu"),
    contacto: copia(data, "contacto", "contacto.menu"),
  };
  const etiquetaTienda = copia(data, "tienda", "tienda.menu");

  // El índice: las secciones que SÍ se pintan, en su orden, con «Tienda»
  // (que es otra página) justo después de «Servicios».
  const indice: { href: string; texto: string }[] = [];
  for (const s of secs) {
    if (!etiquetaMenu[s.id] || !hay(s.id)) continue;
    indice.push({ href: `#${s.id}`, texto: etiquetaMenu[s.id] });
    if (s.id === "servicios" && tienda) indice.push({ href: tienda, texto: etiquetaTienda });
  }
  if (tienda && !hay("servicios")) indice.unshift({ href: tienda, texto: etiquetaTienda });

  return (
    <div className="dcbw dcbw-revista" style={varsDeAcento(data)}>
      <div className="dcbw-rv-marco">
        {/* ── Lateral (escritorio) / cabecera mínima (teléfono) ──── */}
        <div className="dcbw-rv-columna">
          <header className="dcbw-rv-lado">
            <a className="dcbw-rv-marca" href="#portada">
              {marca && <Foto src={marca} alt="" className="dcbw-rv-logo" prioridad />}
              <span className={`dcbw-rv-marca-nombre dcbw-rv-marca-${tallaNombre(shop.name)}`}>{shop.name}</span>
            </a>
            {cuenta && (
              <a className="dcbw-rv-mis dcbw-rv-solo-cel" href={cuenta}>
                <IcoAgenda /> Mis citas
              </a>
            )}
            {(indice.length > 0 || cuenta) && (
              <nav className="dcbw-rv-indice" aria-label="Secciones">
                <ul>
                  {indice.map((l) => (
                    <li key={l.href}>
                      <a href={l.href}>{l.texto}</a>
                    </li>
                  ))}
                </ul>
                {cuenta && (
                  <a className="dcbw-rv-mis" href={cuenta}>
                    <IcoAgenda /> Mis citas
                  </a>
                )}
              </nav>
            )}
            <div className="dcbw-rv-lado-pie">
              {abiertos[0] && (
                <p className="dcbw-rv-abierto">
                  <span className="dcbw-rv-punto" aria-hidden />
                  <span>{abiertos[0]}</span>
                </p>
              )}
              <Boton href={reservar} className="dcbw-rv-lado-btn">
                {cta}
              </Boton>
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="dcbw-rv-wa">
                  <IcoWhatsApp size={16} /> {copia(data, "portada", "portada.whatsapp")}
                </a>
              )}
            </div>
          </header>
        </div>

        {/* ── El contenido ──────────────────────────────────────── */}
        <div className="dcbw-rv-contenido">
          {secs.map((s) => (
            <Fragment key={s.id}>
              {/* ── Portada: el nombre enorme y la cápsula ────────── */}
              {s.id === "portada" && (
                <Sec
                  id="portada"
                  className={`dcbw-rv-portada ${conDatosPortada ? "" : "dcbw-rv-sin-datos"}`}
                >
                  <div className="dcbw-rv-portada-txt">
                    <p className="dcbw-rv-que">
                      <span className="dcbw-rv-punto" aria-hidden />
                      {copia(data, "portada", "portada.kicker")}
                    </p>
                    <h1 className={`dcbw-rv-titular dcbw-rv-talla-${tallaNombre(shop.name)}`}>{shop.name}</h1>
                    <p className="dcbw-rv-frase">{copia(data, "portada", "portada.eslogan")}</p>
                    <div className="dcbw-rv-acciones">
                      <Boton href={reservar}>
                        {cta} <IcoFlecha size={16} />
                      </Boton>
                      {hay("servicios") && (
                        <Boton href="#servicios" variante="fantasma" className="dcbw-rv-btn-linea">
                          {copia(data, "portada", "portada.secundario")}
                        </Boton>
                      )}
                    </div>
                  </div>

                  {conDatosPortada && (
                    <dl className="dcbw-rv-datos">
                      {abiertos.length > 0 && (
                        <div>
                          <dt>{copia(data, "contacto", "contacto.etiquetaHorario")}</dt>
                          {abiertos.slice(0, 2).map((l) => {
                            // «Mar – Vie: 10:00 am – 8:00 pm» → días y horas en
                            // renglones propios: el rango nunca se parte a la mitad.
                            const corte = l.indexOf(": ");
                            return (
                              <dd key={l}>
                                {corte > 0 ? (
                                  <>
                                    <span>{l.slice(0, corte)}</span> <span className="dcbw-rv-rango">{l.slice(corte + 2)}</span>
                                  </>
                                ) : (
                                  l
                                )}
                              </dd>
                            );
                          })}
                        </div>
                      )}
                      {dir && (
                        <div>
                          <dt>{copia(data, "contacto", "contacto.etiquetaDireccion")}</dt>
                          <dd>
                            {hay("contacto") ? <a href="#contacto">{shop.address || dir}</a> : shop.address || dir}
                          </dd>
                        </div>
                      )}
                      {shop.phone && (
                        <div>
                          <dt>{copia(data, "contacto", "contacto.etiquetaTelefono")}</dt>
                          <dd>
                            <a href={`tel:${shop.phone}`}>{shop.phone}</a>
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}

                  <div className={`dcbw-rv-capsula dcbw-rv-portada-foto ${fotoPortada ? "" : "dcbw-rv-sin-foto"}`}>
                    {fotoPortada ? (
                      <Foto src={fotoPortada} alt={`${shop.name}`} className="dcbw-rv-foto" prioridad />
                    ) : (
                      <>
                        <span className="dcbw-rv-letra" aria-hidden>
                          {inicial(shop.name)}
                        </span>
                        {/* En el editor, la cápsula dice qué foto va ahí; en
                            público la inicial basta y no hay hueco. */}
                        {editando && (
                          <span className="dcbw-rv-capsula-aviso">{nombreRanura(data, "portada", "portada")}</span>
                        )}
                      </>
                    )}
                  </div>
                </Sec>
              )}

              {/* ── Servicios: encabezado quieto a la izquierda ───── */}
              {s.id === "servicios" && (
                <Sec id="servicios" className="dcbw-rv-servicios dcbw-rv-piedra">
                  <div className="dcbw-rv-servicios-izq">
                    <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
                  </div>
                  <div className="dcbw-rv-carta">
                    {porCategoria(servicios).map((g, i) => (
                      <div key={i} className={`dcbw-rv-grupo ${esDestacada(g.categoria) ? "dcbw-rv-destacada" : ""}`}>
                        {g.categoria && (
                          <h3 className="dcbw-rv-categoria">
                            {esDestacada(g.categoria) && <span className="dcbw-rv-punto" aria-hidden />}
                            {g.categoria}
                          </h3>
                        )}
                        <ul>
                          {g.items.map((sv) => (
                            <li key={sv.id}>
                              <a href={rutaReservaBarberia(shop.slug, null, sv.id)} className="dcbw-rv-servicio">
                                <span className="dcbw-rv-servicio-nombre">{sv.nombre}</span>
                                <Precio n={sv.precio} className="dcbw-rv-servicio-precio" />
                                {sv.descripcion && <span className="dcbw-rv-servicio-nota">{sv.descripcion}</span>}
                                <Duracion min={sv.duracionMin} className="dcbw-rv-servicio-dur" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Sec>
              )}

              {/* ── Tienda: la pieza de las doce, con la cara de ésta ─ */}
              {s.id === "tienda" && <SeccionProductos data={data} />}

              {/* ── Equipo: retrato en cápsula y su texto al lado ──── */}
              {s.id === "equipo" && (
                <Sec id="equipo" className="dcbw-rv-equipo dcbw-rv-piedra">
                  <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
                  <ul className="dcbw-rv-barberos">
                    {barberos.map((b) => (
                      <li key={b.id}>
                        <div className="dcbw-rv-retrato">
                          {b.fotoUrl ? (
                            <Foto src={b.fotoUrl} alt={b.nombre} />
                          ) : (
                            <span className="dcbw-rv-letra" aria-hidden>
                              {inicial(b.nombre)}
                            </span>
                          )}
                        </div>
                        <div className="dcbw-rv-barbero-txt">
                          <h3>{b.nombre}</h3>
                          {b.apodo && <p className="dcbw-rv-apodo">«{b.apodo}»</p>}
                          {b.bio && <p className="dcbw-rv-bio">{b.bio}</p>}
                          {/* Sin horario no se ofrece «Reservar»: sigue en el equipo, no engaña (L3 ronda 2). */}
                          {!b.sinHorario ? (
                            <a
                              href={rutaReservaBarberia(shop.slug, b.id)}
                              className="dcbw-rv-enlace"
                              aria-label={`${copia(data, "equipo", "equipo.cta")} con ${b.nombre}`}
                            >
                              {copia(data, "equipo", "equipo.cta")} <IcoFlecha size={14} />
                            </a>
                          ) : (
                            <p className="dcbw-rv-nota">{copia(data, "equipo", "equipo.sinCitas")}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Sec>
              )}

              {/* ── Trabajo: tira de cápsulas sobre noche ─────────── */}
              {s.id === "portafolio" && (
                <Sec id="portafolio" className="dcbw-rv-trabajo dcbw-rv-noche">
                  <div className="dcbw-rv-trabajo-cab">
                    <Encabezado titulo={titulo(data, "portafolio")} subtitulo={subtitulo(data, "portafolio")} />
                    {ig && (
                      <a href={ig} target="_blank" rel="noopener noreferrer" className="dcbw-rv-enlace">
                        <IcoInstagram size={16} /> {igCuenta ?? "Instagram"}
                      </a>
                    )}
                  </div>
                  {/* Con el tabulador se puede llegar y desplazar con las flechas. */}
                  <div className="dcbw-rv-tira" tabIndex={0} role="region" aria-label={titulo(data, "portafolio")}>
                    {config.galeria.map((u, i) => (
                      <figure key={i}>
                        <Foto src={u} alt={`Corte ${i + 1} de ${shop.name}`} />
                      </figure>
                    ))}
                    {editando &&
                      config.galeria.length === 0 &&
                      [0, 1, 2].map((i) => (
                        <figure key={i}>
                          <HuecoFoto etiqueta={s.nombre} />
                        </figure>
                      ))}
                  </div>
                </Sec>
              )}

              {/* ── Reseñas: una en grande y las demás al lado ────── */}
              {s.id === "resenas" && (
                <Sec id="resenas" className="dcbw-rv-resenas">
                  <Encabezado titulo={titulo(data, "resenas")} />
                  {config.resenas.length > 0 && (
                    <div className={`dcbw-rv-resenas-rejilla ${config.resenas.length === 1 ? "dcbw-rv-una" : ""}`}>
                      <figure
                        className={`dcbw-rv-cita-mayor ${config.resenas[0].texto.length > 180 ? "dcbw-rv-cita-larga" : ""}`}
                      >
                        <blockquote>
                          <p>«{config.resenas[0].texto}»</p>
                        </blockquote>
                        <figcaption>
                          <span>{config.resenas[0].nombre}</span>
                          <Estrellas n={config.resenas[0].estrellas} size={15} />
                        </figcaption>
                      </figure>
                      {config.resenas.length > 1 && (
                        <ul className="dcbw-rv-citas">
                          {config.resenas.slice(1).map((r, i) => (
                            <li key={i}>
                              <Estrellas n={r.estrellas} size={14} />
                              <p>{r.texto}</p>
                              <cite>{r.nombre}</cite>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </Sec>
              )}

              {/* ── Visita: mapa en cápsula, dirección y horario ──── */}
              {s.id === "contacto" && conVisita && (
                <Sec id="contacto" className="dcbw-rv-visita dcbw-rv-piedra">
                  <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
                  <div className={`dcbw-rv-visita-rejilla ${mapa ? "" : "dcbw-rv-sin-mapa"}`}>
                    {mapa && (
                      <div className="dcbw-rv-capsula dcbw-rv-mapa">
                        <Mapa src={mapa} titulo={`Mapa de ${shop.name}`} />
                      </div>
                    )}
                    <div className="dcbw-rv-visita-datos">
                      {dir && (
                        <>
                          <p className="dcbw-rv-direccion">{shop.address || dir}</p>
                          {shop.address && ciudad && <p className="dcbw-rv-direccion-nota">{ciudad}</p>}
                          {comoLlegar && (
                            <Boton href={comoLlegar} variante="fantasma" externo className="dcbw-rv-btn-linea">
                              <IcoMapa size={16} /> {copia(data, "contacto", "contacto.comoLlegar")}
                            </Boton>
                          )}
                        </>
                      )}
                      {conHorario && (
                        <div className="dcbw-rv-horario">
                          <h3 className="dcbw-rv-rotulo">{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                          <TablaHorario config={config} />
                        </div>
                      )}
                      {(wa || shop.phone) && (
                        <div className="dcbw-rv-contacto">
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer" className="dcbw-rv-enlace">
                              <IcoWhatsApp size={16} /> {copia(data, "contacto", "contacto.whatsapp")}
                            </a>
                          )}
                          {shop.phone && (
                            <a
                              href={`tel:${shop.phone}`}
                              className="dcbw-rv-enlace"
                              aria-label={`${copia(data, "contacto", "contacto.etiquetaTelefono")}: ${shop.phone}`}
                            >
                              <IcoTelefono size={16} /> {shop.phone}
                            </a>
                          )}
                        </div>
                      )}
                      <Redes config={config} conWhatsApp={false} size={20} className="dcbw-rv-redes" />
                    </div>
                  </div>
                </Sec>
              )}

              {/* ── Cierre oscuro con Reservar ────────────────────── */}
              {s.id === "reservar" && (
                <Sec id="reservar" className="dcbw-rv-cierre dcbw-rv-noche">
                  <div>
                    <h2 className="dcbw-h2">{titulo(data, "reservar")}</h2>
                    {subtitulo(data, "reservar") && <p className="dcbw-bajada">{subtitulo(data, "reservar")}</p>}
                  </div>
                  <Boton href={reservar}>
                    {copia(data, "reservar", "reservar.cta")} <IcoFlecha size={16} />
                  </Boton>
                </Sec>
              )}
            </Fragment>
          ))}

          <Pie nombre={shop.name} cuentaUrl={cuenta} />

          {/* ── Barra de abajo (solo teléfono): menú y Reservar ──── */}
          <nav className="dcbw-rv-abajo" aria-label="Menú">
            {hay("servicios") && <a href="#servicios">{etiquetaMenu.servicios}</a>}
            {tienda && <a href={tienda}>{etiquetaTienda}</a>}
            {hay("contacto") && <a href="#contacto">{etiquetaMenu.contacto}</a>}
            <Boton href={reservar} className="dcbw-rv-abajo-btn">
              {cta}
            </Boton>
          </nav>
        </div>
      </div>
    </div>
  );
}
