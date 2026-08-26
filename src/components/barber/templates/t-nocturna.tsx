/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "NOCTURNA" — la barbería que abre de noche.

   Lo que la distingue de las otras once:
     · Portada a PANTALLA COMPLETA con la foto en DUOTONO hecho solo con
       CSS: la foto en escala de grises y, encima, dos capas que mezclan
       — el negro azulado con `lighten` (se lleva las sombras) y el acento
       claro con `multiply` (se lleva las luces). La barbería sube la foto
       que tenga y sale entintada; nadie procesa la imagen.
     · EL RELOJ: "Abierto hasta las 10:00 pm" sale del HORARIO real — el
       cierre más tardío de la semana y los días que cierran a esa hora.
       Nada de "hoy": la página se cachea por ISR y no corre JS, así que
       un "hoy" calculado en el servidor se congelaría con la caché. Son
       funciones puras de este archivo: sin Date y sin estado.
     · Servicios en TARJETAS con borde luminoso. Es el único brillo de la
       página, para que sea un acento y no un letrero de neón.
     · Barberos en TIRA horizontal que se arrastra con el dedo.

   Decisiones de piel (ver skins.css):
     · Botón primario "encendido": fondo `--dcbw-acento-claro` con texto
       OSCURO. Sobre el negro azulado, el acento fuerte con blanco se
       hunde; el claro es la única luz de la página, que es la metáfora
       entera. Contraste con #0a0e14: whisky 11:1, vino (el más bajo)
       5,6:1. El hover se redefine porque el compartido cambia a `base`,
       que con texto oscuro no pasa AA en vino.
     · Acento sugerido whisky: luz cálida sobre noche azul (la paleta de
       toda foto nocturna). Acero dejaría la página monocroma y fría.
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment } from "react";
import {
  BARBER_WEB_DIAS_CORTOS,
  direccionCompleta,
  horaBarberWeb,
  horarioBarberWeb,
  rutaReservaBarberia,
  tieneHorario,
  urlComoLlegar,
  urlMapaEmbed,
  urlWhatsApp,
  type BarberWebConfig,
} from "@/lib/barber/landing";
import {
  Boton,
  Duracion,
  Estrellas,
  Foto,
  IcoFlecha,
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
   El reloj: el cierre más tardío de la semana

   Puro a propósito: recibe el config y devuelve datos. Sin Date, sin
   estado y sin "hoy" (ver la cabecera). Exportado para poder probarlo
   sin pintar nada.
   ══════════════════════════════════════════════════════════════ */

export interface CierreNocturna {
  /** "22:00", tal cual lo guarda el config. */
  hasta: string;
  /** Los días (0 = lunes … 6 = domingo) que cierran a esa hora, en orden. */
  dias: number[];
}

/** "22:00" → 1320; lo que no sea HH:MM → null. */
function minutosDe(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * La hora de cierre más tardía entre los días abiertos y qué días cierran
 * a esa hora. `horarioBarberWeb` ya normaliza los siete días y dice cuál
 * está abierto; el `hasta` crudo se lee del config porque las filas
 * formateadas ya no lo traen. Sin ningún día abierto (o sin una hora
 * legible), null: la portada no pinta el reloj.
 */
export function cierreMasTardio(config: BarberWebConfig): CierreNocturna | null {
  const hastaPorDia = new Map<number, unknown>();
  const lista = Array.isArray(config?.horario) ? config.horario : [];
  for (const d of lista) {
    if (d && typeof d === "object") hastaPorDia.set(Number(d.dia), d.hasta);
  }
  let mejor: { min: number; hasta: string; dias: number[] } | null = null;
  for (const f of horarioBarberWeb(config)) {
    if (!f.abierto) continue;
    const crudo = hastaPorDia.get(f.dia);
    const min = minutosDe(crudo);
    if (min === null) continue;
    if (!mejor || min > mejor.min) {
      mejor = { min, hasta: (crudo as string).trim(), dias: [f.dia] };
    } else if (min === mejor.min) {
      mejor.dias.push(f.dia);
    }
  }
  return mejor ? { hasta: mejor.hasta, dias: mejor.dias } : null;
}

/**
 * Los días, agrupados si son consecutivos:
 *   [3,4,5] → "Jue – Sáb" · [4,5] → "Vie y Sáb" · [0..6] → "Lun – Dom"
 *   [5] → "Sáb" · [0,2,4] → "Lun, Mié y Vie" · [0,1,3,4,5] → "Lun, Mar y Jue – Sáb"
 */
export function etiquetaDias(dias: number[]): string {
  const validos = dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const tramos: number[][] = [];
  for (const d of validos) {
    const t = tramos[tramos.length - 1];
    if (t && t[t.length - 1] === d - 1) t.push(d);
    else tramos.push([d]);
  }
  const partes: string[] = [];
  for (const t of tramos) {
    const a = BARBER_WEB_DIAS_CORTOS[t[0]];
    const z = BARBER_WEB_DIAS_CORTOS[t[t.length - 1]];
    if (t.length >= 3) partes.push(`${a} – ${z}`);
    else if (t.length === 2 && tramos.length === 1) partes.push(`${a} y ${z}`);
    else if (t.length === 2) partes.push(a, z);
    else partes.push(a);
  }
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/**
 * El bloque del reloj. En público, sin horario no se pinta; en el editor
 * se pinta con "— : —" para que la barbería vea dónde va a caer.
 */
function Reloj({ data, chico = false }: { data: BarberWebData; chico?: boolean }) {
  const cierre = cierreMasTardio(data.config);
  if (!cierre && !data.editando) return null;
  return (
    <div className={`dcbw-no-reloj ${chico ? "dcbw-no-reloj-chico" : ""}`}>
      <span className="dcbw-no-reloj-etq">{copia(data, "portada", "portada.reloj")}</span>
      <span className="dcbw-no-reloj-hora">{cierre ? horaBarberWeb(cierre.hasta) : "— : —"}</span>
      {cierre && <span className="dcbw-no-reloj-dias">{etiquetaDias(cierre.dias)}</span>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   La plantilla
   ══════════════════════════════════════════════════════════════ */

export function PlantillaNocturna({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const saludo = `Hola, quiero reservar en ${shop.name}`;
  const wa = urlWhatsApp(config.whatsapp, saludo);
  const portada = foto(data, "portada");
  const mapa = urlMapaEmbed(config, dir);
  const comoLlegar = urlComoLlegar(dir);

  return (
    <div className="dcbw dcbw-nocturna" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada a pantalla completa, en duotono ────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-no-hero">
              <div className="dcbw-no-duo">
                <Ranura
                  url={portada}
                  etiqueta={nombreRanura(data, "portada", "portada")}
                  alt=""
                  className="dcbw-no-duo-img"
                  editando={editando}
                  prioridad
                />
                {/* Las dos capas del duotono solo tienen sentido sobre una
                    foto: sobre el hueco del editor lo entintarían y la
                    etiqueta dejaría de leerse. */}
                {portada && <span className="dcbw-no-duo-sombra" aria-hidden />}
                {portada && <span className="dcbw-no-duo-luz" aria-hidden />}
              </div>
              <div className="dcbw-no-velo" aria-hidden />
              <div className="dcbw-no-hero-in">
                <div className="dcbw-no-hero-txt">
                  <Ranura
                    url={logo(data)}
                    etiqueta={nombreRanura(data, "portada", "logo")}
                    alt={shop.name}
                    className="dcbw-no-logo"
                    editando={editando}
                    prioridad
                  />
                  <h1 className="dcbw-h1">{shop.name}</h1>
                  <p className="dcbw-no-eslogan">{copia(data, "portada", "portada.eslogan")}</p>
                </div>
                <Reloj data={data} />
                <div className="dcbw-acciones dcbw-no-hero-acc">
                  <Boton href={reservar}>
                    {copia(data, "portada", "portada.cta")} <IcoFlecha size={15} />
                  </Boton>
                  {wa && (
                    <Boton href={wa} variante="fantasma" externo>
                      <IcoWhatsApp size={16} /> {copia(data, "portada", "portada.whatsapp")}
                    </Boton>
                  )}
                </div>
              </div>
            </Sec>
          )}

          {/* ── Servicios: tarjetas con borde luminoso ────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-no-servicios">
              <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
              {porCategoria(servicios).map((g, gi) => (
                <div key={gi} className="dcbw-no-grupo">
                  {g.categoria && <p className="dcbw-no-cat">{g.categoria}</p>}
                  <ul className="dcbw-no-tarjetas">
                    {g.items.map((sv) => (
                      <li key={sv.id} className="dcbw-no-tarjeta">
                        <div className="dcbw-no-tarjeta-cab">
                          <h3>{sv.nombre}</h3>
                          <Duracion min={sv.duracionMin} />
                        </div>
                        {sv.descripcion && <p className="dcbw-carta-desc">{sv.descripcion}</p>}
                        <div className="dcbw-no-tarjeta-pie">
                          <Precio n={sv.precio} />
                          <a href={reservar} className="dcbw-no-liga">
                            {copia(data, "servicios", "servicios.cta")} <IcoFlecha size={13} />
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Sec>
          )}

          {/* ── Barberos: tira horizontal por gesto ───────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-no-equipo">
              <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
              <ul className="dcbw-no-tira">
                {barberos.map((b) => (
                  <li key={b.id} className="dcbw-no-barbero">
                    {b.fotoUrl ? (
                      <Foto src={b.fotoUrl} alt={b.nombre} className="dcbw-no-barbero-foto" />
                    ) : (
                      <span className="dcbw-inicial dcbw-no-barbero-foto">{b.nombre.charAt(0)}</span>
                    )}
                    <div className="dcbw-no-barbero-txt">
                      <h3>{b.nombre}</h3>
                      {b.apodo && <p className="dcbw-apodo">{b.apodo}</p>}
                      {b.bio && <p className="dcbw-bio">{b.bio}</p>}
                      <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-no-liga">
                        {copia(data, "equipo", "equipo.cta")} <IcoFlecha size={13} />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Portafolio: cuadrados con borde tenue ─────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-no-portafolio">
              <Encabezado titulo={titulo(data, "portafolio")} />
              <div className="dcbw-no-rejilla">
                {config.galeria.map((u, i) => (
                  <Foto key={i} src={u} alt={`Corte en ${shop.name}`} />
                ))}
              </div>
            </Sec>
          )}

          {/* ── Reseñas: borde fino, sin brillo ───────────────── */}
          {s.id === "resenas" && (
            <Sec id="resenas" className="dcbw-no-resenas">
              <Encabezado titulo={titulo(data, "resenas")} />
              <ul className="dcbw-no-opiniones">
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

          {/* ── Cierre: el mismo reloj, en chico, y el botón ──── */}
          {s.id === "reservar" && (
            <Sec id="reservar" className="dcbw-no-cierre">
              <div className="dcbw-no-cierre-in">
                <Encabezado titulo={titulo(data, "reservar")} subtitulo={subtitulo(data, "reservar")} />
                <Reloj data={data} chico />
                <Boton href={reservar}>
                  {copia(data, "reservar", "reservar.cta")} <IcoFlecha size={15} />
                </Boton>
              </div>
            </Sec>
          )}

          {/* ── Contacto: datos y mapa ────────────────────────── */}
          {s.id === "contacto" && (
            <Sec id="contacto" className="dcbw-no-contacto">
              <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
              <div className={`dcbw-no-contacto-in ${mapa ? "dcbw-no-contacto-con-mapa" : ""}`}>
                <div className="dcbw-no-datos">
                  {dir && (
                    <div className="dcbw-dato">
                      <h3>{copia(data, "contacto", "contacto.etiquetaDireccion")}</h3>
                      <p>{dir}</p>
                      {comoLlegar && (
                        <a href={comoLlegar} target="_blank" rel="noopener noreferrer" className="dcbw-no-liga">
                          <IcoMapa size={14} /> {copia(data, "contacto", "contacto.comoLlegar")}
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
                    <Boton href={wa} variante="fantasma" externo className="dcbw-no-contacto-wa">
                      <IcoWhatsApp size={16} /> {copia(data, "contacto", "contacto.whatsapp")}
                    </Boton>
                  )}
                  <Redes config={config} conWhatsApp={false} />
                </div>
                {mapa && <Mapa src={mapa} titulo={`Mapa de ${shop.name}`} className="dcbw-no-mapa" />}
              </div>
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} />
    </div>
  );
}
