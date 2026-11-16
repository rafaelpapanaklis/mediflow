/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "OFICIO" — la barbería de toda la vida, con el arco del espejo.
   (ws6-t2, 16-nov; mockup A «Oficio» de entregas-ws6/barber-web-mockups.)

   Lo que la distingue de las otras:
     · El ARCO del espejo de barbería es la única forma que se repite: la
       foto de portada, los retratos del equipo, el mapa y algunos cortes
       van dentro de un arco con filete de latón.
     · Espresso y papel: secciones oscuras y claras alternadas, letra de
       rótulo (Abril Fatface) y texto en Libre Franklin, autoalojadas en
       /barber/fuentes (ver la piel .dcbw-oficio en skins.css).
     · Servicios en dos columnas: los COMBOS (categoría «Combos» o
       «Paquetes») en un tablero oscuro aparte y la carta con puntitos al
       lado. La vitrina de productos va justo después de la carta.
     · En el teléfono, «Reservar» vive abajo, en la zona del pulgar, junto
       al WhatsApp (barra pegada, `sticky` y no `fixed`: ver la piel).

   TODO sale de BarberWebData. Lo que no hay no se pinta: sin foto de
   portada, el arco lleva la inicial de la barbería en letra de rótulo
   (nunca una foto de muestra); sin logo, un monograma con esa inicial.

   Cero hooks: se pinta en el servidor (/b/[slug]) y en el navegador (la
   vista previa y las miniaturas del editor).
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment } from "react";
import {
  direccionCompleta,
  duracionBarberWeb,
  horarioAgrupado,
  rutaReservaBarberia,
  tieneHorario,
  urlComoLlegar,
  urlFacebook,
  urlInstagram,
  urlMapaEmbed,
  urlTiktok,
  urlWhatsApp,
} from "@/lib/barber/landing";
import {
  Boton,
  Estrellas,
  Foto,
  HuecoFoto,
  IcoFlecha,
  IcoInstagram,
  IcoMapa,
  IcoReloj,
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
  tieneSeccion,
  titulo,
  varsDeAcento,
} from "./helpers";
import type { BarberWebData, BarberWebServicio } from "./types";

/** Cómo se llama cada sección en el menú de arriba (corto: cabe en un teléfono). */
const MENU: Record<string, string> = {
  servicios: "Servicios",
  equipo: "Barberos",
  portafolio: "Cortes",
  resenas: "Reseñas",
  contacto: "Visítanos",
};

/** La forma de cada foto de la pared de cortes, en ciclo (como el mockup). */
const PARED = ["alta arco", "cuadro", "media", "cuadro", "alta", "media arco", "cuadro", "media"];

/** «Combos de la casa»: la categoría que la barbería llamó así va al tablero oscuro. */
const ES_COMBO = /\b(combos?|paquetes?)\b/i;

/** Palabras que no sirven de inicial: «Barbería El Roble» → R. */
const SIN_INICIAL = new Set([
  "barberia", "barbería", "barber", "barbershop", "shop", "peluqueria", "peluquería", "salon", "salón",
  "estetica", "estética", "y", "&", "el", "la", "los", "las", "the", "de", "del",
]);

function inicialDe(nombre: string): string {
  const palabras = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  const util = palabras.find((p) => !SIN_INICIAL.has(p.toLowerCase())) ?? palabras[0] ?? "";
  return (util.charAt(0) || "·").toUpperCase();
}

function primerNombre(nombre: string): string {
  return (nombre ?? "").trim().split(/\s+/)[0] ?? "";
}

/** «30 min · A tijera o máquina» — lo que haya de las dos cosas. */
function notaServicio(sv: BarberWebServicio): string {
  return [duracionBarberWeb(sv.duracionMin), sv.descripcion?.trim()].filter(Boolean).join(" · ");
}

function IcoAgenda({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
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

export function PlantillaOficio({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const marca = logo(data);
  const tienda = enlaceTienda(data);
  const inicial = inicialDe(shop.name);
  const cta = copia(data, "portada", "portada.cta");
  const fotoPortada = foto(data, "portada");
  const fotoAmbiente = foto(data, "ambiente");
  // Un nombre largo («Barbería y Peluquería Los Compadres del Norte») no
  // cabe al tamaño de rótulo de la portada: baja un escalón.
  const nombreLargo = shop.name.trim().length > 22;
  const insta = urlInstagram(config.instagram);
  const hayRedes = !!(insta || urlFacebook(config.facebook) || urlTiktok(config.tiktok));
  // El horario de la portada es el primer tramo ABIERTO: con el lunes
  // cerrado (muy común), el primero de horarioAgrupado es «Lun: Cerrado» y
  // era lo único que se enseñaba. Igual que Barrio y Revista.
  const tramoPortada = tieneHorario(config)
    ? horarioAgrupado(config).find((l) => !l.endsWith(": Cerrado")) ?? null
    : null;
  // «Visítanos» es obligatoria en el manifiesto, pero sin dirección, horario,
  // teléfono, WhatsApp ni redes no hay nada que enseñar: no sale, y tampoco
  // su liga del menú (un ancla a nada).
  const hayContacto = !!(editando || dir || tieneHorario(config) || wa || shop.phone || hayRedes);
  const conContacto = hayContacto && tieneSeccion(secs, "contacto");

  return (
    <div className="dcbw dcbw-oficio" style={varsDeAcento(data)}>
      {/* ── Barra de arriba ──────────────────────────────────── */}
      <header className="dcbw-of-barra">
        <a className="dcbw-of-marca" href="#portada" aria-label={`${shop.name}, inicio`}>
          {marca ? (
            <Foto src={marca} alt="" className="dcbw-of-marca-logo" prioridad />
          ) : (
            <span className="dcbw-of-monograma" aria-hidden>
              {inicial}
            </span>
          )}
          <span className="dcbw-of-marca-nombre">{shop.name}</span>
        </a>
        <nav className="dcbw-of-menu" aria-label="Secciones">
          {secs
            .filter((s) => MENU[s.id] && (s.id !== "contacto" || hayContacto))
            .map((s) => (
              <Fragment key={s.id}>
                <a href={`#${s.id}`}>{MENU[s.id]}</a>
                {/* «Tienda» va a la tienda (otra página), al lado de Servicios. */}
                {s.id === "servicios" && tienda ? <a href={tienda}>{copia(data, "tienda", "tienda.menu")}</a> : null}
              </Fragment>
            ))}
          {tienda && !tieneSeccion(secs, "servicios") ? <a href={tienda}>{copia(data, "tienda", "tienda.menu")}</a> : null}
          {data.cuentaUrl ? (
            <a href={data.cuentaUrl} className="dcbw-of-solo-cel">
              Mis citas
            </a>
          ) : null}
        </nav>
        <div className="dcbw-of-barra-acciones">
          {data.cuentaUrl ? (
            <a className="dcbw-of-mis" href={data.cuentaUrl}>
              <IcoAgenda /> Mis citas
            </a>
          ) : null}
          <Boton href={reservar} className="dcbw-of-boton">
            {cta}
          </Boton>
        </div>
      </header>

      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada: la foto dentro del arco del espejo ───────── */}
          {s.id === "portada" && (
            <>
              <Sec id="portada" className="dcbw-of-portada">
                <div className="dcbw-of-portada-in">
                  <div className="dcbw-of-espejos">
                    <div className="dcbw-of-espejo">
                      <div className="dcbw-of-espejo-in">
                        {fotoPortada ? (
                          <Foto src={fotoPortada} alt={`Interior de ${shop.name}`} className="dcbw-of-foto" prioridad />
                        ) : editando ? (
                          <HuecoFoto etiqueta={nombreRanura(data, "portada", "portada")} className="dcbw-of-foto" />
                        ) : (
                          // Sin foto: la inicial en letra de rótulo, nunca una foto de muestra.
                          <span className="dcbw-of-espejo-letra" aria-hidden>
                            {inicial}
                          </span>
                        )}
                      </div>
                    </div>
                    {fotoAmbiente ? (
                      <div className="dcbw-of-espejo-2">
                        <Foto src={fotoAmbiente} alt="" className="dcbw-of-foto" />
                      </div>
                    ) : null}
                  </div>
                  <div className="dcbw-of-portada-cuerpo">
                    <h1 className={`dcbw-of-rotulo dcbw-of-portada-titulo ${nombreLargo ? "dcbw-of-largo" : ""}`}>
                      {shop.name}
                    </h1>
                    <p className="dcbw-of-portada-frase">{copia(data, "portada", "portada.eslogan")}</p>
                    <div className="dcbw-of-portada-acciones">
                      <Boton href={reservar} className="dcbw-of-boton">
                        {cta} <IcoFlecha />
                      </Boton>
                      {wa ? (
                        <Boton href={wa} variante="fantasma" externo className="dcbw-of-boton dcbw-of-boton-linea">
                          <IcoWhatsApp /> {copia(data, "portada", "portada.whatsapp")}
                        </Boton>
                      ) : null}
                    </div>
                    {tramoPortada || shop.address || dir || shop.phone ? (
                      <ul className="dcbw-of-portada-datos">
                        {tramoPortada ? (
                          <li>
                            <IcoReloj />
                            <span>{tramoPortada}</span>
                          </li>
                        ) : null}
                        {shop.address || dir ? (
                          <li>
                            {conContacto ? (
                              <a href="#contacto">
                                <IcoMapa />
                                <span>{shop.address || dir}</span>
                              </a>
                            ) : (
                              <>
                                <IcoMapa />
                                <span>{shop.address || dir}</span>
                              </>
                            )}
                          </li>
                        ) : null}
                        {shop.phone ? (
                          <li className="dcbw-of-solo-cel">
                            <a href={`tel:${shop.phone}`}>
                              <IcoTelefono />
                              <span>{shop.phone}</span>
                            </a>
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </Sec>
              <div className="dcbw-of-poste" aria-hidden />
            </>
          )}

          {/* ── Servicios: combos en el tablero + la carta ──────── */}
          {s.id === "servicios" && <ServiciosOficio data={data} servicios={servicios} />}

          {/* ── Tienda: la pieza compartida, vestida de vitrina ───── */}
          {s.id === "tienda" && (
            <div className="dcbw-of-vitrina">
              <SeccionProductos data={data} />
            </div>
          )}

          {/* ── Equipo: retratos en arco, escalonados ─────────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-of-clara dcbw-of-equipo">
              <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
              <ul className={`dcbw-of-barberos ${barberos.length === 1 ? "dcbw-of-uno" : ""}`}>
                {barberos.map((b) => (
                  <li key={b.id} className="dcbw-of-barbero">
                    <div className={`dcbw-of-barbero-foto ${b.fotoUrl ? "" : "dcbw-of-sin-foto"}`}>
                      {b.fotoUrl ? (
                        <Foto src={b.fotoUrl} alt={b.nombre} className="dcbw-of-foto" />
                      ) : (
                        <span aria-hidden>{inicialDe(b.nombre)}</span>
                      )}
                    </div>
                    <h3>{b.nombre}</h3>
                    {b.apodo ? <p className="dcbw-of-apodo">«{b.apodo}»</p> : null}
                    {b.bio ? <p className="dcbw-of-bio">{b.bio}</p> : null}
                    {/* Sin horario no se ofrece «Reservar»: sigue en el equipo, no engaña. */}
                    {!b.sinHorario ? (
                      <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-of-enlace">
                        {copia(data, "equipo", "equipo.cta")} con {b.apodo?.trim() || primerNombre(b.nombre)}{" "}
                        <IcoFlecha size={16} />
                      </a>
                    ) : (
                      <p className="dcbw-of-nota">{copia(data, "equipo", "equipo.sinHorario")}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Portafolio: la pared de cortes ────────────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-of-oscura dcbw-of-cortes">
              <Encabezado titulo={titulo(data, "portafolio")} subtitulo={subtitulo(data, "portafolio")} />
              {config.galeria.length > 0 ? (
                <div className="dcbw-of-pared">
                  {config.galeria.map((u, i) => (
                    <figure key={i} className={PARED[i % PARED.length].split(" ").map((c) => `dcbw-of-${c}`).join(" ")}>
                      <Foto src={u} alt={`Corte en ${shop.name}`} className="dcbw-of-foto" />
                    </figure>
                  ))}
                </div>
              ) : editando ? (
                <HuecoFoto etiqueta={s.nombre} />
              ) : null}
              {insta ? (
                <p className="dcbw-of-pared-pie">
                  <a className="dcbw-of-enlace" href={insta} target="_blank" rel="noopener noreferrer">
                    <IcoInstagram /> {copia(data, "portafolio", "portafolio.instagram")} @
                    {(config.instagram ?? "").replace(/^@/, "")}
                  </a>
                </p>
              ) : null}
            </Sec>
          )}

          {/* ── Reseñas: una grande y las demás en lista ─────────── */}
          {s.id === "resenas" && (
            <Sec id="resenas" className="dcbw-of-clara-2 dcbw-of-resenas">
              <Encabezado titulo={titulo(data, "resenas")} />
              {config.resenas.length > 0 ? (
                <div className="dcbw-of-resenas-rejilla">
                  <figure className="dcbw-of-cita-mayor">
                    <blockquote>
                      <p>{config.resenas[0].texto}</p>
                    </blockquote>
                    <figcaption>
                      <span>{config.resenas[0].nombre}</span>
                      <Estrellas n={config.resenas[0].estrellas} size={18} />
                    </figcaption>
                  </figure>
                  {config.resenas.length > 1 ? (
                    <ul className="dcbw-of-citas">
                      {config.resenas.slice(1).map((r, i) => (
                        <li key={i}>
                          <Estrellas n={r.estrellas} size={18} />
                          <p>{r.texto}</p>
                          <cite>{r.nombre}</cite>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </Sec>
          )}

          {/* ── Visítanos: mapa en arco + los datos ──────────────── */}
          {s.id === "contacto" && hayContacto && (
            <Sec id="contacto" className="dcbw-of-oscura dcbw-of-contacto">
              <div className={`dcbw-of-visita ${urlMapaEmbed(config, dir) ? "" : "dcbw-of-sin-mapa"}`}>
                <Encabezado
                  className="dcbw-of-visita-cab"
                  titulo={titulo(data, "contacto")}
                  subtitulo={subtitulo(data, "contacto")}
                />
                {urlMapaEmbed(config, dir) ? (
                  <div className="dcbw-of-mapa">
                    <Mapa src={urlMapaEmbed(config, dir)!} titulo={`Mapa de ${shop.name}`} />
                  </div>
                ) : null}
                <div className="dcbw-of-visita-datos">
                  {dir ? (
                    <div className="dcbw-of-dato">
                      <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                      <p>{dir}</p>
                      {urlComoLlegar(dir) ? (
                        <Boton
                          href={urlComoLlegar(dir)!}
                          variante="fantasma"
                          externo
                          className="dcbw-of-boton dcbw-of-boton-linea"
                        >
                          <IcoMapa /> {copia(data, "contacto", "contacto.comoLlegar")}
                        </Boton>
                      ) : null}
                    </div>
                  ) : null}
                  {tieneHorario(config) ? (
                    <div className="dcbw-of-dato">
                      <h3>{copia(data, "contacto", "contacto.etiquetaHorario")}</h3>
                      <TablaHorario config={config} className="dcbw-of-horario" />
                    </div>
                  ) : null}
                  {wa || shop.phone ? (
                    <div className="dcbw-of-dato">
                      <h3>{copia(data, "contacto", "contacto.etiquetaTelefono")}</h3>
                      <div className="dcbw-of-contacto-botones">
                        {wa ? (
                          <Boton href={wa} variante="fantasma" externo className="dcbw-of-boton dcbw-of-boton-linea">
                            <IcoWhatsApp /> {copia(data, "contacto", "contacto.whatsapp")}
                          </Boton>
                        ) : null}
                        {shop.phone ? (
                          <Boton
                            href={`tel:${shop.phone}`}
                            variante="fantasma"
                            className="dcbw-of-boton dcbw-of-boton-linea"
                          >
                            <IcoTelefono /> {shop.phone}
                          </Boton>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {hayRedes ? (
                    <div className="dcbw-of-dato">
                      <h3>{copia(data, "contacto", "contacto.etiquetaRedes")}</h3>
                      <Redes config={config} conWhatsApp={false} size={22} className="dcbw-of-redes" />
                    </div>
                  ) : null}
                </div>
              </div>
            </Sec>
          )}

          {/* ── Cierre: el poste y el último «Reservar» ───────────── */}
          {s.id === "reservar" && (
            <>
              <div className="dcbw-of-poste" aria-hidden />
              <Sec id="reservar" className="dcbw-of-clara dcbw-of-cierre">
                <div className="dcbw-of-cierre-in">
                  <div>
                    <h2 className="dcbw-of-rotulo dcbw-of-cierre-titulo">{titulo(data, "reservar")}</h2>
                    {subtitulo(data, "reservar") ? <p>{subtitulo(data, "reservar")}</p> : null}
                  </div>
                  <Boton href={reservar} className="dcbw-of-boton dcbw-of-boton-grande">
                    {copia(data, "reservar", "reservar.cta")} <IcoFlecha />
                  </Boton>
                </div>
              </Sec>
            </>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} cuentaUrl={data.cuentaUrl} />

      {/* Teléfono: «Reservar» siempre a la mano, en la zona del pulgar. */}
      <div className="dcbw-of-reserva-fija">
        {wa ? (
          <a className="dcbw-of-redondo" href={wa} target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">
            <IcoWhatsApp size={26} />
          </a>
        ) : null}
        <Boton href={reservar} className="dcbw-of-boton">
          {cta}
        </Boton>
      </div>
    </div>
  );
}

/* ── Servicios ───────────────────────────────────────────────────── */

function ServiciosOficio({ data, servicios }: { data: BarberWebData; servicios: BarberWebServicio[] }) {
  const slug = data.shop.slug;
  const grupos = porCategoria(servicios);
  const combos = grupos.filter((g) => g.categoria && ES_COMBO.test(g.categoria));
  const carta = grupos.filter((g) => !combos.includes(g));
  const ir = copia(data, "servicios", "servicios.cta");
  // Con más de tres combos la columna izquierda ya no cabe en la pantalla:
  // pegada arriba escondería los de abajo. Entonces se desplaza normal.
  const muchosCombos = combos.reduce((n, g) => n + g.items.length, 0) > 3;

  return (
    <Sec id="servicios" className="dcbw-of-clara dcbw-of-servicios">
      <div
        className={`dcbw-of-servicios-rejilla ${carta.length === 0 ? "dcbw-of-solo-combos" : ""} ${
          muchosCombos ? "dcbw-of-sin-pegar" : ""
        }`}
      >
        <div className="dcbw-of-servicios-izq">
          <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
          {combos.map((g) => (
            <div key={g.categoria} className="dcbw-of-tablero">
              <h3>{g.categoria}</h3>
              {g.items.map((sv) => (
                <a key={sv.id} className="dcbw-of-combo" href={rutaReservaBarberia(slug, null, sv.id)}>
                  <span className="dcbw-of-combo-nombre">{sv.nombre}</span>
                  <Precio n={sv.precio} className="dcbw-of-combo-precio" />
                  {sv.descripcion ? <span className="dcbw-of-combo-desc">{sv.descripcion}</span> : null}
                  <span className="dcbw-of-combo-pie">
                    <span>{duracionBarberWeb(sv.duracionMin)}</span>
                    <span className="dcbw-of-enlace">
                      {ir} <IcoFlecha size={14} />
                    </span>
                  </span>
                </a>
              ))}
            </div>
          ))}
        </div>
        {carta.length > 0 ? (
          <div className={`dcbw-of-carta ${carta.length === 1 ? "dcbw-of-carta-una" : ""}`}>
            {carta.map((g, i) => (
              <div key={g.categoria ?? `g${i}`} className="dcbw-of-grupo">
                {g.categoria ? <h3>{g.categoria}</h3> : null}
                <ul>
                  {g.items.map((sv) => {
                    const nota = notaServicio(sv);
                    return (
                      <li key={sv.id}>
                        <a className="dcbw-of-servicio" href={rutaReservaBarberia(slug, null, sv.id)}>
                          <span className="dcbw-of-servicio-linea">
                            <span className="dcbw-of-servicio-nombre">{sv.nombre}</span>
                            <span className="dcbw-of-servicio-puntos" aria-hidden />
                            <Precio n={sv.precio} className="dcbw-of-servicio-precio" />
                          </span>
                          {nota ? <span className="dcbw-of-servicio-nota">{nota}</span> : null}
                          <span className="dcbw-of-servicio-ir">
                            {ir} <IcoFlecha size={14} />
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Sec>
  );
}
