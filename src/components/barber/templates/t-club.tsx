/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "CLUB" — barbería de socios.

   Lo que la distingue de las otras once:
     · La PORTADA es un EMBLEMA: un monograma tipográfico armado con las
       iniciales del nombre (sin una sola imagen) dentro de un círculo con
       marco doble, y el nombre completo rodeándolo en versalitas por un
       <textPath>. Si la barbería sube logo, el logo toma el centro.
     · Una FRANJA DE SOCIOS a sangre con tres beneficios en romanos. Es
       COPIA EDITABLE: en el contrato no existe ninguna membresía y esta
       plantilla no la inventa. La barbería la puede apagar.
     · Las TARIFAS van al FINAL, en una columna estrecha y con letra
       pequeña: lo contrario exacto de `precios`. Un socio no viene por el
       precio; la carta está para quien la busque.
     · Retratos en blanco y negro con marco doble. El marco fino doble es
       el ÚNICO motivo (emblema, retratos, franja, mapa). Cero ornamentos.

   Verde botella y latón. El latón es el acento del config (caramelo por
   defecto) leído SIEMPRE por --dcbw-acento-claro: es un fondo oscuro.
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

/* ══════════════════════════════════════════════════════════════
   El monograma

   Iniciales de hasta tres palabras del nombre, saltándose artículos y
   conectores: "Barbería El Corte" → BC, "La Navaja de Oro" → NO,
   "Nueva" → N. Si el nombre fuera SOLO conectores, se usan igual.
   ══════════════════════════════════════════════════════════════ */

const CONECTORES = new Set(["de", "del", "la", "el", "los", "las", "y", "&", "e"]);

export function monograma(nombre: string): string {
  const palabras = (typeof nombre === "string" ? nombre : "")
    .split(/\s+/)
    // Sin comillas ni puntuación en las puntas: «El» es "El".
    .map((p) => p.replace(/^[^0-9A-Za-zÀ-ÿ]+|[^0-9A-Za-zÀ-ÿ]+$/g, ""))
    .filter(Boolean);
  const utiles = palabras.filter((p) => !CONECTORES.has(p.toLowerCase()));
  const base = utiles.length ? utiles : palabras;
  return base
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

/* ══════════════════════════════════════════════════════════════
   La corona de texto

   El SVG mide 128 × 128 unidades y el círculo del emblema ocupa 100 de
   ellas, centrado: así 1 unidad = 1 % del diámetro y el texto escala con
   el emblema sin medir nada. El camino es el círculo completo empezando
   ABAJO y girando en el sentido del reloj, de modo que el 50 % cae justo
   arriba: con `text-anchor: middle` el nombre se centra en las doce y
   puede crecer hacia los dos lados sin que se corte ningún glifo.
   ══════════════════════════════════════════════════════════════ */

const ARCO_R = 54.5;
const ARCO_D = `M 64 ${64 + ARCO_R} A ${ARCO_R} ${ARCO_R} 0 1 1 64 ${64 - ARCO_R} A ${ARCO_R} ${ARCO_R} 0 1 1 64 ${64 + ARCO_R}`;

/** Cuerpo del texto de la corona (en unidades del viewBox) para que el nombre quepa en el arco de arriba. */
function cuerpoDelArco(nombre: string): number {
  const n = Math.max(1, nombre.length);
  // Un poco más de medio círculo: las puntas bajan apenas del ecuador.
  const disponible = 2 * Math.PI * ARCO_R * 0.56;
  // ~0,85 em por carácter en versalitas con 0,32 em de tracking.
  const cuerpo = Math.min(6, Math.max(2.6, disponible / (n * 0.85)));
  return Math.round(cuerpo * 100) / 100;
}

const ROMANOS = ["I", "II", "III"];

export function PlantillaClub({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const waSocio = urlWhatsApp(config.whatsapp, `Hola, quiero información para ser socio de ${shop.name}`);
  const marca = logo(data);
  const mono = monograma(shop.name);
  const mapa = urlMapaEmbed(config, dir);
  const fotoEquipo = foto(data, "equipoFoto");
  // Una o dos citas, grandes. Más abaratan.
  const citas = config.resenas.slice(0, 2);
  const sello = copia(data, "portada", "portada.sello");
  const lema = copia(data, "portada", "portada.lema");
  const lineas = ROMANOS.map((_, i) => copia(data, "socios", `socios.linea${i + 1}`)).filter(Boolean);
  const ctaSocios = copia(data, "socios", "socios.cta");
  const nota = copia(data, "socios", "socios.nota");
  const ctaTarifas = copia(data, "servicios", "servicios.cta");
  // En público, un "La casa" sin nada debajo parece abandonado: solo se
  // pinta si hay algo que enseñar. En el editor sale siempre.
  const hayContacto =
    !!dir ||
    tieneHorario(config) ||
    !!shop.phone ||
    !!config.whatsapp ||
    !!config.instagram ||
    !!config.facebook ||
    !!config.tiktok;

  return (
    <div className="dcbw dcbw-club" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada: el emblema ───────────────────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-cb-hero">
              <div className="dcbw-cb-hero-in">
                <div className="dcbw-cb-emblema-caja">
                  <h1 className="dcbw-cb-nombre">
                    <span className="dcbw-oculto">{shop.name}</span>
                    <svg className="dcbw-cb-arco" viewBox="0 0 128 128" aria-hidden focusable="false">
                      <defs>
                        <path id="dcbw-cb-arco-p" d={ARCO_D} fill="none" />
                      </defs>
                      <text className="dcbw-cb-arco-txt" fontSize={cuerpoDelArco(shop.name)} textAnchor="middle">
                        <textPath href="#dcbw-cb-arco-p" startOffset="50%">
                          {shop.name}
                        </textPath>
                      </text>
                    </svg>
                  </h1>
                  <div className="dcbw-cb-emblema dcbw-cb-marco">
                    {marca ? (
                      <Foto src={marca} alt="" className="dcbw-cb-logo" prioridad />
                    ) : mono ? (
                      <span className={`dcbw-cb-mono ${mono.length > 2 ? "dcbw-cb-mono-3" : ""}`} aria-hidden>
                        {mono}
                      </span>
                    ) : null}
                  </div>
                </div>

                {(sello || lema) && (
                  <p className="dcbw-cb-filetes dcbw-cb-sello">
                    <span>
                      {sello}
                      {sello && lema ? <span className="dcbw-cb-sello-punto" aria-hidden> · </span> : null}
                      {lema}
                    </span>
                  </p>
                )}

                <p className="dcbw-cb-eslogan">{copia(data, "portada", "portada.eslogan")}</p>

                <div className="dcbw-acciones">
                  <Boton href={reservar}>{copia(data, "portada", "portada.cta")}</Boton>
                  {wa && (
                    <Boton href={wa} variante="fantasma" externo>
                      <IcoWhatsApp size={15} /> {copia(data, "portada", "portada.whatsapp")}
                    </Boton>
                  )}
                </div>
              </div>
            </Sec>
          )}

          {/* ── La franja de socios (copia editable) ──────────── */}
          {s.id === "socios" && (
            <Sec id="socios" className="dcbw-cb-socios">
              <div className="dcbw-cb-socios-in dcbw-cb-marco">
                <Encabezado titulo={titulo(data, "socios")} subtitulo={subtitulo(data, "socios")} />
                {lineas.length > 0 && (
                  <ol className="dcbw-cb-beneficios">
                    {lineas.map((l, i) => (
                      <li key={i}>
                        <span className="dcbw-cb-romano" aria-hidden>
                          {ROMANOS[i]}
                        </span>
                        <span className="dcbw-cb-beneficio">{l}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {ctaSocios && (
                  <Boton href={waSocio ?? reservar} externo={!!waSocio}>
                    {ctaSocios}
                  </Boton>
                )}
                {nota && <p className="dcbw-cb-nota">{nota}</p>}
              </div>
            </Sec>
          )}

          {/* ── Los maestros: retratos en blanco y negro ──────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-cb-equipo">
              <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
              {barberos.length > 0 && (
                <ul className="dcbw-cb-maestros">
                  {barberos.map((b) => (
                    <li key={b.id}>
                      <span className="dcbw-cb-retrato dcbw-cb-marco">
                        {b.fotoUrl ? (
                          <Foto src={b.fotoUrl} alt={b.nombre} />
                        ) : (
                          <span className="dcbw-cb-inicial" aria-hidden>
                            {b.nombre.charAt(0)}
                          </span>
                        )}
                      </span>
                      <h3>{b.nombre}</h3>
                      {b.apodo && <p className="dcbw-cb-apodo">{b.apodo}</p>}
                      {b.bio && <p className="dcbw-bio">{b.bio}</p>}
                      <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-enlace">
                        {copia(data, "equipo", "equipo.cta")}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {(fotoEquipo || editando) && (
                <div className="dcbw-cb-equipo-foto dcbw-cb-marco">
                  <Ranura
                    url={fotoEquipo}
                    etiqueta={nombreRanura(data, "equipo", "equipoFoto")}
                    alt={`Equipo de ${shop.name}`}
                    editando={editando}
                  />
                </div>
              )}
            </Sec>
          )}

          {/* ── El trabajo: rejilla con marco fino ────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-cb-obras">
              <Encabezado titulo={titulo(data, "portafolio")} subtitulo={subtitulo(data, "portafolio")} />
              {config.galeria.length > 0 && (
                <div className="dcbw-cb-rejilla">
                  {config.galeria.map((u, i) => (
                    <figure key={i} className="dcbw-cb-obra">
                      <Foto src={u} alt={`Trabajo de ${shop.name}`} />
                    </figure>
                  ))}
                </div>
              )}
            </Sec>
          )}

          {/* ── Palabra de socio: una o dos citas grandes ─────── */}
          {s.id === "resenas" && citas.length > 0 && (
            <Sec id="resenas" className="dcbw-cb-palabra">
              {titulo(data, "resenas") && <h2 className="dcbw-cb-filetes">{titulo(data, "resenas")}</h2>}
              <ul className={`dcbw-cb-citas ${citas.length > 1 ? "dcbw-cb-citas-2" : ""}`}>
                {citas.map((r, i) => (
                  <li key={i}>
                    <blockquote>“{r.texto}”</blockquote>
                    <cite>{r.nombre}</cite>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Tarifas: discretas y al final ─────────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-cb-tarifas">
              <div className="dcbw-cb-tarifas-in">
                <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
                {porCategoria(servicios).map((g, i) => (
                  <div key={i} className="dcbw-cb-grupo">
                    {g.categoria && <h3 className="dcbw-cb-categoria">{g.categoria}</h3>}
                    <ul>
                      {g.items.map((sv) => (
                        <li key={sv.id} className="dcbw-cb-fila">
                          <span className="dcbw-cb-servicio">{sv.nombre}</span>
                          <Duracion min={sv.duracionMin} className="dcbw-cb-dur" />
                          <Precio n={sv.precio} className="dcbw-cb-cifra" />
                          {sv.descripcion && <span className="dcbw-cb-desc">{sv.descripcion}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {servicios.length > 0 && ctaTarifas && (
                  <div className="dcbw-cb-tarifas-cta">
                    <Boton href={reservar} variante="fantasma">
                      {ctaTarifas}
                    </Boton>
                  </div>
                )}
              </div>
            </Sec>
          )}

          {/* ── La casa ───────────────────────────────────────── */}
          {s.id === "contacto" && (editando || hayContacto) && (
            <Sec id="contacto" className={`dcbw-cb-casa ${mapa ? "" : "dcbw-cb-casa-sola"}`}>
              <div className="dcbw-cb-casa-datos">
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
                <Redes config={config} conWhatsApp={false} />
                {wa && (
                  <div className="dcbw-cb-casa-wa">
                    <Boton href={wa} variante="fantasma" externo>
                      <IcoWhatsApp size={15} /> {copia(data, "contacto", "contacto.whatsapp")}
                    </Boton>
                  </div>
                )}
              </div>
              {mapa && (
                <div className="dcbw-cb-casa-mapa dcbw-cb-marco">
                  <Mapa src={mapa} titulo={`Mapa de ${shop.name}`} />
                </div>
              )}
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} />
    </div>
  );
}
