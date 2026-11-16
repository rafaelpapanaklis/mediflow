/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "BARRIO" — negro y concreto, una sola familia (ws6-t3).

   Mockup B de Fable (entregas-ws6/barber-web-mockups-474acf4e/web-b.html).
   Lo que la distingue de las otras doce:
     · UNA familia (Archivo, autoalojada) llevada de muy condensada
       (titulares, precios) a muy ancha (el nombre en la marca).
     · Tira de secciones pegada arriba: en el celular se desliza con el
       dedo; en la computadora lleva la marca, «Mis citas» y «Reservar».
     · Portada con el nombre a todo lo ancho y una PEGATINA girada que
       lleva a reservar. La foto, si la hay, sale en blanco y negro.
     · Cinta corredera con los servicios Y SUS PRECIOS, de la misma tabla
       que la carta (urbana corre un texto; ésta corre la carta).
     · Los servicios de la categoría «Combos»/«Paquetes» salen como
       tarjetas grandes; el resto, en lista con el precio enorme.
     · Cortes en REJILLA DE INSTAGRAM, con la cuenta si la barbería la
       puso. La rejilla nunca deja huecos (ver `planRejilla`).
     · Reseñas sobre el color de la barbería a bloque completo (sin promedio:
       las escribe la barbería, no es una calificación).
     · En el celular, un muelle flotante con WhatsApp y «Reservar».

   Cero hooks: se pinta en el servidor para /b/[slug] y en el navegador
   para la vista previa. Nada aquí sabe qué día es (ISR): no hay «hoy».
   ═══════════════════════════════════════════════════════════════════════ */

import { Fragment, type CSSProperties } from "react";
import {
  direccionCompleta,
  horarioBarberWeb,
  rutaReservaBarberia,
  tieneHorario,
  type BarberWebConfig,
  urlComoLlegar,
  urlInstagram,
  urlMapaEmbed,
  urlWhatsApp,
} from "@/lib/barber/landing";
import {
  Duracion,
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
  Ranura,
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

/* ══════════════════════════════════════════════════════════════
   Medidas que dependen de los datos
   ══════════════════════════════════════════════════════════════ */

/**
 * Cuántas letras tiene que caber por renglón en un titular enorme.
 *
 * La palabra más larga manda (no puede partirse), pero un nombre de 40
 * letras con palabras cortas tampoco debe salir en seis renglones: se
 * apunta a tres como mucho. La piel convierte esto en tamaño de letra.
 */
export function letrasPorRenglon(texto: string): number {
  const limpio = texto.trim();
  const larga = Math.max(1, ...limpio.split(/\s+/).map((p) => p.length));
  return Math.max(larga, Math.ceil(limpio.length / 3), 4);
}

/** Una celda de la rejilla: columnas, filas y proporción, por ancho. */
export interface CeldaRejilla {
  col: number;
  fila: number;
  /** "1 / 1", "2 / 1"… (la fila mide lo mismo que un cuadro). */
  proporcion: string;
  oculta: boolean;
}

/** Reparte `r` fotos en un renglón de `C` columnas, sin huecos. */
function repartir(r: number, C: number): number[] {
  const base = Math.floor(C / r);
  const extra = C % r;
  return Array.from({ length: r }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * La rejilla de Instagram SIN HUECOS para `n` fotos en `C` columnas.
 *
 * · Con suficientes fotos, la primera va grande (2×2), como en la maqueta.
 * · El último renglón se reparte entre las fotos que le tocan: dos fotos
 *   en tres columnas = una doble y una sencilla, nunca un cuadro vacío.
 * · Un renglón con UNA sola foto (que saldría como tira de 3:1 o de 6:1,
 *   recortando la cabeza del corte) se evita juntando las dos últimas
 *   filas: 4 fotos en 3 columnas = (doble, sencilla) + (sencilla, doble).
 * · Más de `tope` fotos: la rejilla es un adelanto, como el de Instagram;
 *   las demás se esconden en ese ancho.
 *
 * Exportada para la prueba: el «sin huecos» se comprueba con números, no
 * a ojo.
 */
export function planRejilla(n: number, C: number, tope: number): CeldaRejilla[] {
  const visibles = Math.min(n, tope);
  const celdas: CeldaRejilla[] = Array.from({ length: n }, (_, i) => ({
    col: 1,
    fila: 1,
    proporcion: "1 / 1",
    oculta: i >= visibles,
  }));
  if (visibles === 0) return celdas;
  if (visibles === 1) {
    celdas[0] = { col: C, fila: 1, proporcion: C >= 6 ? "21 / 9" : "4 / 3", oculta: false };
    return celdas;
  }

  // ¿Va grande la primera? Solo si las dos filas que ocupa quedan llenas
  // (resto ≥ 0) y lo que sobra no es UNA foto sola sin un renglón de
  // cuadros antes con el que juntarse (resto = 1).
  const alLado = 2 * (C - 2);
  const restoConGrande = visibles - 1 - alLado;
  const grande = restoConGrande >= 0 && restoConGrande !== 1;

  let inicio = 0;
  let sueltas = visibles;
  if (grande) {
    celdas[0] = { col: 2, fila: 2, proporcion: "1 / 1", oculta: false };
    inicio = 1 + alLado;
    sueltas = restoConGrande;
  }
  // Las de en medio son cuadros (ya lo son). Falta el final.
  const r = sueltas % C;
  if (r === 0) return celdas;
  const fin = inicio + sueltas; // índice siguiente a la última visible
  if (r === 1 && sueltas > C) {
    // Juntar las dos últimas filas: C + 1 fotos en 2·C columnas.
    const total = C + 1;
    const arriba = Math.ceil(total / 2);
    const abajo = total - arriba;
    const a = repartir(arriba, C);
    const b = repartir(abajo, C).reverse();
    [...a, ...b].forEach((col, k) => {
      celdas[fin - total + k] = { col, fila: 1, proporcion: `${col} / 1`, oculta: false };
    });
    return celdas;
  }
  repartir(r, C).forEach((col, k) => {
    celdas[fin - r + k] = { col, fila: 1, proporcion: `${col} / 1`, oculta: false };
  });
  return celdas;
}

/**
 * El tramo de días SEGUIDOS abiertos con el mismo horario más largo, para la
 * píldora de la portada: «Mar – Sáb: 11:00 am – 9:00 pm». Sale de las filas
 * de horarioBarberWeb (datos), no de partir el texto de horarioAgrupado. Con
 * dos tramos igual de largos gana el primero de la semana. Sin días abiertos,
 * null.
 */
export function tramoMasLargo(config: BarberWebConfig): string | null {
  const filas = horarioBarberWeb(config);
  let mejor: { desde: number; hasta: number } | null = null;
  let i = 0;
  while (i < filas.length) {
    if (!filas[i].abierto) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < filas.length && filas[j + 1].abierto && filas[j + 1].rango === filas[i].rango) j++;
    if (!mejor || j - i > mejor.hasta - mejor.desde) mejor = { desde: i, hasta: j };
    i = j + 1;
  }
  if (!mejor) return null;
  const a = filas[mejor.desde];
  const b = filas[mejor.hasta];
  const dias = a.dia === b.dia ? a.etiquetaCorta : `${a.etiquetaCorta} – ${b.etiquetaCorta}`;
  return `${dias}: ${a.rango}`;
}

/** ¿Es una categoría de combos? Esa sale en tarjetas grandes. */
function esCombo(categoria: string | null): boolean {
  return !!categoria && /combo|paquete/i.test(categoria);
}

/** El usuario de Instagram para enseñarlo («@filo»), aunque pegaran la liga. */
function usuarioInstagram(v: string): string {
  const crudo = v.trim().replace(/\/+$/, "");
  const ultimo = crudo.includes("/") ? crudo.split("/").pop() ?? "" : crudo;
  return `@${ultimo.replace(/^@/, "")}`;
}

/** Iniciales para el retrato sin foto: «Daniel Orozco» → «DO». */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.charAt(0) ?? "") + (partes.length > 1 ? partes[partes.length - 1].charAt(0) : "")).toUpperCase() || "?";
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

const vars = (o: Record<string, string | number>) => o as CSSProperties;

/* ══════════════════════════════════════════════════════════════
   La plantilla
   ══════════════════════════════════════════════════════════════ */

export function PlantillaBarrio({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const marca = logo(data);
  const tienda = enlaceTienda(data);
  const portadaFoto = foto(data, "portada");
  const cta = copia(data, "portada", "portada.cta");
  const textoWa = copia(data, "portada", "portada.whatsapp");

  // El menú: las secciones que se pintan, con el título que les puso la
  // barbería («Cortes», «Barberos»…), y «Tienda» junto a «Servicios».
  const menu = secs.filter(
    (s) => !["portada", "reservar", "tienda"].includes(s.id) && (s.id !== "contacto" || hayContacto(data, dir, wa)),
  );
  const ligaTienda = tienda ? (
    <a href={tienda}>{copia(data, "tienda", "tienda.menu")}</a>
  ) : null;

  // La cinta corre la carta solo si la carta se enseña.
  const conCinta = tieneSeccion(secs, "servicios") && servicios.length > 0;

  // El renglón de horario de la portada: el tramo abierto con más días.
  // No dice «hoy»: el HTML se cachea y no sabe qué día lo abren.
  const horarioPortada = tramoMasLargo(config);

  const sello = copia(data, "portada", "portada.sello");
  const lema = copia(data, "portada", "portada.lema");

  return (
    <div className="dcbw dcbw-barrio" style={varsDeAcento(data)}>
      {/* ── Cabecera del celular: marca y «Mis citas» ───────────── */}
      <header className="bw-cabecera">
        <a className="bw-marca" href={`/b/${shop.slug}`}>
          {marca ? (
            <Foto src={marca} alt="" className="bw-marca-logo" prioridad />
          ) : (
            <span className="bw-marca-logo bw-marca-letra" aria-hidden>
              {shop.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="bw-marca-nombre">{shop.name}</span>
        </a>
        {data.cuentaUrl ? (
          <a className="bw-mis" href={data.cuentaUrl}>
            <IcoAgenda /> Mis citas
          </a>
        ) : null}
      </header>

      {/* ── Tira de secciones (pegada arriba) ───────────────────── */}
      <div className="bw-tira">
        <nav aria-label="Secciones">
          <a className="bw-marca bw-tira-marca" href={`/b/${shop.slug}`}>
            {marca ? (
              <Foto src={marca} alt="" className="bw-marca-logo" />
            ) : (
              <span className="bw-marca-logo bw-marca-letra" aria-hidden>
                {shop.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span className="bw-marca-nombre">{shop.name}</span>
          </a>
          {tienda && !tieneSeccion(secs, "servicios") ? ligaTienda : null}
          {menu.map((s) => (
            <Fragment key={s.id}>
              <a href={`#${s.id}`}>{titulo(data, s.id) || s.nombre}</a>
              {s.id === "servicios" ? ligaTienda : null}
            </Fragment>
          ))}
          <span className="bw-tira-acciones">
            {data.cuentaUrl ? (
              <a className="bw-mis" href={data.cuentaUrl}>
                <IcoAgenda /> Mis citas
              </a>
            ) : null}
            <a className="bw-boton bw-boton-acento" href={reservar}>
              {cta}
            </a>
          </span>
        </nav>
      </div>

      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada ─────────────────────────────────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className={`bw-portada ${portadaFoto ? "bw-con-foto" : ""}`}>
              {portadaFoto || editando ? (
                <div className="bw-portada-foto">
                  <Ranura
                    url={portadaFoto}
                    etiqueta={nombreRanura(data, "portada", "portada")}
                    alt={`Interior de ${shop.name}`}
                    editando={editando}
                    prioridad
                  />
                </div>
              ) : null}
              {sello ? (
                <a className="bw-pegatina" href={reservar}>
                  <span>
                    {sello}
                    {lema ? <small>{lema}</small> : null}
                  </span>
                </a>
              ) : null}
              <div className="bw-portada-in">
                <h1 className="bw-titular bw-portada-nombre" style={vars({ "--bw-letras": letrasPorRenglon(shop.name) })}>
                  {shop.name}
                </h1>
                <div className="bw-portada-lado">
                  <p className="bw-portada-frase">{copia(data, "portada", "portada.eslogan")}</p>
                  {horarioPortada ? (
                    <p className="bw-portada-hoy">
                      <IcoReloj size={16} /> {horarioPortada}
                    </p>
                  ) : null}
                  <div className="bw-portada-acciones">
                    <a className="bw-boton bw-boton-acento" href={reservar}>
                      {cta} <IcoFlecha size={16} />
                    </a>
                    {wa ? (
                      <a className="bw-boton bw-boton-linea" href={wa} target="_blank" rel="noopener noreferrer">
                        <IcoWhatsApp size={17} /> {textoWa}
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </Sec>
          )}

          {/* ── Cinta: la carta corriendo ───────────────────────── */}
          {s.id === "portada" && conCinta ? <Cinta servicios={servicios} /> : null}

          {/* ── Servicios ───────────────────────────────────────── */}
          {s.id === "servicios" && <Servicios data={data} />}

          {/* ── Tienda (la pieza compartida, con la piel de Barrio) ─ */}
          {s.id === "tienda" && <SeccionProductos data={data} />}

          {/* ── Cortes: rejilla de Instagram ─────────────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="bw-clara bw-cortes">
              <div className="bw-cortes-cab">
                <Encabezado titulo={titulo(data, "portafolio")} />
                {urlInstagram(config.instagram) ? (
                  <div className="bw-ig">
                    <span className="bw-ig-avatar" aria-hidden>
                      <IcoInstagram size={24} />
                    </span>
                    <span className="bw-ig-nombre">
                      {usuarioInstagram(config.instagram!)}
                      <small>{copia(data, "portafolio", "portafolio.nota")}</small>
                    </span>
                    <a
                      className="bw-boton bw-boton-negro"
                      href={urlInstagram(config.instagram)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {copia(data, "portafolio", "portafolio.seguir")}
                    </a>
                  </div>
                ) : null}
              </div>
              {config.galeria.length > 0 ? (
                <Rejilla fotos={config.galeria} nombre={shop.name} />
              ) : editando ? (
                <HuecoFoto etiqueta="Tus cortes salen aquí, en rejilla" className="bw-rejilla-hueco" />
              ) : null}
            </Sec>
          )}

          {/* ── Barberos ────────────────────────────────────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="bw-oscura bw-equipo">
              <Encabezado titulo={titulo(data, "equipo")} subtitulo={subtitulo(data, "equipo")} />
              <ul className="bw-barberos">
                {barberos.map((b, i) => (
                  <li key={b.id} className="bw-barbero">
                    <div className="bw-barbero-foto" data-tono={i % 4}>
                      {b.fotoUrl ? (
                        <Foto src={b.fotoUrl} alt={`Retrato de ${b.nombre}`} />
                      ) : (
                        <span className="bw-barbero-inicial" aria-hidden>
                          {iniciales(b.nombre)}
                        </span>
                      )}
                      {b.apodo ? <span className="bw-barbero-apodo">«{b.apodo}»</span> : null}
                      <h3 className="bw-titular bw-barbero-nombre">{b.nombre}</h3>
                    </div>
                    {b.bio ? <p className="bw-barbero-bio">{b.bio}</p> : <span className="bw-barbero-bio" />}
                    {/* Sin horario no se ofrece «Reservar»: sigue en el equipo, no engaña (L3 ronda 2). */}
                    {!b.sinHorario ? (
                      <a className="bw-boton bw-boton-blanco" href={rutaReservaBarberia(shop.slug, b.id)}>
                        {copia(data, "equipo", "equipo.cta")} con {b.apodo?.trim() || b.nombre.trim().split(/\s+/)[0]}
                      </a>
                    ) : (
                      <p className="bw-barbero-nota">{copia(data, "equipo", "equipo.sinHorario")}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Reseñas: el color de la barbería a bloque ───────── */}
          {s.id === "resenas" && <Resenas data={data} />}

          {/* ── Ubicación ───────────────────────────────────────── */}
          {s.id === "contacto" && <Ubicacion data={data} dir={dir} wa={wa} />}

          {/* ── Cierre ──────────────────────────────────────────── */}
          {s.id === "reservar" && (
            <Sec id="reservar" className="bw-oscura bw-cierre">
              <div className="bw-cierre-in">
                <div>
                  <h2
                    className="bw-titular bw-cierre-titulo"
                    style={vars({ "--bw-letras": letrasPorRenglon(titulo(data, "reservar") || "Te toca.") })}
                  >
                    {titulo(data, "reservar")}
                  </h2>
                  {subtitulo(data, "reservar") ? <p className="bw-cierre-bajada">{subtitulo(data, "reservar")}</p> : null}
                </div>
                <a className="bw-boton bw-boton-acento bw-boton-grande" href={reservar}>
                  {copia(data, "reservar", "reservar.cta")} <IcoFlecha size={17} />
                </a>
              </div>
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} cuentaUrl={data.cuentaUrl} />

      {/* ── Muelle del celular: Reservar siempre a la mano ─────── */}
      <div className="bw-muelle">
        {wa ? (
          <a className="bw-muelle-wa" href={wa} target="_blank" rel="noopener noreferrer" aria-label={textoWa}>
            <IcoWhatsApp size={26} />
          </a>
        ) : null}
        <a className="bw-muelle-ir" href={reservar}>
          {cta} <IcoFlecha size={17} />
        </a>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Partes
   ══════════════════════════════════════════════════════════════ */

/** La carta corriendo: nombre y precio de cada servicio, de la tabla. */
function Cinta({ servicios }: { servicios: BarberWebServicio[] }) {
  // Al menos ocho piezas para que la cinta llene una pantalla ancha aunque
  // la barbería tenga un solo servicio; y la tanda va dos veces para que
  // el lazo (translateX -50%) no salte.
  const vueltas = Math.max(1, Math.ceil(8 / servicios.length));
  const tanda = Array.from({ length: vueltas }, () => servicios).flat();
  const piezas = [...tanda, ...tanda];
  return (
    <div className="bw-cinta">
      {/* WCAG 2.2.2: lo que se mueve solo más de 5 s se tiene que poder
          pausar. Sin JavaScript (la plantilla se pinta en el servidor): una
          casilla de verdad —se enfoca con Tab y se marca con Espacio— y la
          piel para la cinta con `:has(:checked)`. Además para sola al pasar
          el ratón o con el foco dentro, y con prefers-reduced-motion ni
          corre ni sale el botón. Los precios ya están en la carta: la cinta
          es decoración (aria-hidden), el botón no. */}
      <label className="bw-cinta-pausa">
        <input type="checkbox" className="dcbw-oculto" aria-label="Pausar la cinta de precios" />
        <svg className="bw-cinta-ico-pausa" width="14" height="14" viewBox="0 0 24 24" aria-hidden focusable="false">
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
        </svg>
        <svg className="bw-cinta-ico-seguir" width="14" height="14" viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M8 5l11 7-11 7z" fill="currentColor" />
        </svg>
      </label>
      <div className="bw-cinta-via" aria-hidden style={vars({ "--bw-cinta-s": `${Math.max(30, tanda.length * 6)}s` })}>
        {piezas.map((sv, i) => (
          <span key={i}>
            {sv.nombre} <b><Precio n={sv.precio} /></b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Servicios({ data }: { data: BarberWebData }) {
  const { shop, servicios } = data;
  const grupos = porCategoria(servicios).map((g, i) => ({ ...g, ancla: `bw-grupo-${i}` }));
  const combos = grupos.filter((g) => esCombo(g.categoria));
  const lista = grupos.filter((g) => !esCombo(g.categoria));
  const fichas = grupos.filter((g) => g.categoria);
  return (
    <Sec id="servicios" className="bw-clara bw-servicios">
      <div className={`bw-servicios-rejilla ${lista.length === 0 ? "bw-solo-izq" : ""}`}>
        <div className="bw-servicios-izq">
          <Encabezado titulo={titulo(data, "servicios")} subtitulo={subtitulo(data, "servicios")} />
          {fichas.length > 1 ? (
            <nav className="bw-fichas" aria-label={titulo(data, "servicios") || "Servicios"}>
              {fichas.map((g) => (
                <a key={g.ancla} href={`#${g.ancla}`}>
                  {g.categoria}
                </a>
              ))}
            </nav>
          ) : null}
          {combos.map((g) => (
            <ul key={g.ancla} id={g.ancla} className="bw-combos">
              {g.items.map((sv) => (
                <li key={sv.id}>
                  <a className="bw-combo" href={rutaReservaBarberia(shop.slug, null, sv.id)}>
                    <span className="bw-combo-marca">{g.categoria}</span>
                    <span className="bw-titular bw-combo-nombre">{sv.nombre}</span>
                    {sv.descripcion ? <span className="bw-combo-desc">{sv.descripcion}</span> : null}
                    <span className="bw-combo-pie">
                      <Precio n={sv.precio} className="bw-titular bw-combo-precio" />
                      <Duracion min={sv.duracionMin} className="bw-combo-dur" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ))}
        </div>
        {lista.length > 0 ? (
          <div className="bw-servicios-der">
            {lista.map((g) => (
              <div key={g.ancla} id={g.ancla} className="bw-grupo">
                {g.categoria ? <h3 className="bw-titular bw-grupo-titulo">{g.categoria}</h3> : null}
                <ul>
                  {g.items.map((sv) => (
                    <li key={sv.id}>
                      <a className="bw-servicio" href={rutaReservaBarberia(shop.slug, null, sv.id)}>
                        <span className="bw-servicio-nombre">
                          {sv.nombre}
                          <span className="bw-servicio-nota">
                            <Duracion min={sv.duracionMin} />
                            {sv.descripcion ? <> · {sv.descripcion}</> : null}
                          </span>
                        </span>
                        <Precio n={sv.precio} className="bw-titular bw-servicio-precio" />
                        <span className="bw-servicio-ir" aria-hidden>
                          <IcoFlecha size={18} />
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Sec>
  );
}

/** Los cortes en rejilla: el plan de 3 columnas (celular) y el de 6. */
function Rejilla({ fotos, nombre }: { fotos: string[]; nombre: string }) {
  const cel = planRejilla(fotos.length, 3, 15);
  const pc = planRejilla(fotos.length, 6, 15);
  return (
    <div className="bw-rejilla">
      {fotos.map((u, i) => (
        <figure
          key={i}
          className={`${cel[i].oculta ? "bw-oculta-cel" : ""} ${pc[i].oculta ? "bw-oculta-pc" : ""}`}
          style={vars({
            "--bw-c-col": cel[i].col,
            "--bw-c-fila": cel[i].fila,
            "--bw-c-prop": cel[i].proporcion,
            "--bw-p-col": pc[i].col,
            "--bw-p-fila": pc[i].fila,
            "--bw-p-prop": pc[i].proporcion,
          })}
        >
          <Foto src={u} alt={`Corte ${i + 1} en ${nombre}`} />
        </figure>
      ))}
    </div>
  );
}

function Resenas({ data }: { data: BarberWebData }) {
  const lista = data.config.resenas;
  // Sin promedio (revisión ws6-t8, B3): las reseñas las escribe la barbería
  // a mano en Mi web, así que una cifra «4.8 de 5» se leería como una
  // calificación que nadie dio. El hueco de la cifra del mockup lo llenan
  // unas comillas enormes, de adorno.
  return (
    <Sec id="resenas" className="bw-bloque bw-resenas">
      <div className="bw-resenas-rejilla">
        <div>
          <Encabezado titulo={titulo(data, "resenas")} />
          {lista.length > 0 ? (
            <span className="bw-titular bw-comillas" aria-hidden>
              “
            </span>
          ) : null}
        </div>
        <ul className="bw-resenas-lista">
          {lista.map((r, i) => (
            <li key={i} className="bw-resena">
              <Estrellas n={r.estrellas} size={18} />
              <p>{r.texto}</p>
              <cite>{r.nombre}</cite>
            </li>
          ))}
        </ul>
      </div>
    </Sec>
  );
}

/**
 * ¿Hay algo que enseñar en «Ubicación»? La sección es obligatoria en el
 * manifiesto, pero sin dirección, horario, teléfono, WhatsApp ni redes
 * sería un título con un hueco debajo: en público no se pinta, y tampoco
 * sale en la tira (una liga a un ancla que no existe).
 */
function hayContacto(data: BarberWebData, dir: string | null, wa: string | null): boolean {
  const { shop, config, editando } = data;
  return !!(editando || dir || tieneHorario(config) || shop.phone || wa || config.instagram || config.facebook || config.tiktok);
}

function Ubicacion({ data, dir, wa }: { data: BarberWebData; dir: string | null; wa: string | null }) {
  const { shop, config } = data;
  const mapa = urlMapaEmbed(config, dir);
  const llegar = urlComoLlegar(dir);
  if (!hayContacto(data, dir, wa)) return null;

  const calle = shop.address?.trim() || null;
  const resto = [shop.city, shop.state].filter((p) => p && p.trim()).join(", ");
  return (
    <Sec id="contacto" className="bw-clara bw-ubicacion">
      <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
      <div className={`bw-ubicacion-rejilla ${mapa ? "" : "bw-sin-mapa"}`}>
        {mapa ? (
          <div className="bw-mapa">
            <Mapa src={mapa} titulo={`Mapa: ${dir ?? shop.name}`} />
            {llegar ? (
              <a className="bw-boton bw-boton-negro" href={llegar} target="_blank" rel="noopener noreferrer">
                <IcoMapa size={17} /> {copia(data, "contacto", "contacto.comoLlegar")}
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="bw-ubicacion-datos">
          {calle || resto ? (
            <p className="bw-titular bw-direccion">
              {calle ?? resto}
              {calle && resto ? <small>{resto}</small> : null}
            </p>
          ) : null}
          {/* La pieza compartida: los siete días desde horarioBarberWeb, sin
              rearmar el texto de horarioAgrupado (revisión ws6-t8, B2). */}
          {tieneHorario(config) ? <TablaHorario config={config} className="bw-horario" /> : null}
          {wa || shop.phone ? (
            <div className="bw-contacto">
              {wa ? (
                <a className="bw-boton bw-boton-linea" href={wa} target="_blank" rel="noopener noreferrer">
                  <IcoWhatsApp size={17} /> {copia(data, "contacto", "contacto.whatsapp")}
                </a>
              ) : null}
              {shop.phone ? (
                <a className="bw-boton bw-boton-linea" href={`tel:${shop.phone}`}>
                  <IcoTelefono size={17} /> {shop.phone}
                </a>
              ) : null}
            </div>
          ) : null}
          <Redes config={config} conWhatsApp={false} size={22} className="bw-redes" />
        </div>
      </div>
    </Sec>
  );
}
