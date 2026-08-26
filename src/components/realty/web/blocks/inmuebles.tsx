/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: INMUEBLES.

   El catálogo. Nueve maquetados que SÍ cambian la lectura. Los cuatro de
   las plantillas originales, que se pintan con la tarjeta compartida:
     · rejilla    → tres columnas. El inventario de una inmobiliaria.
     · filas      → una por renglón, foto chica. Lista para hojear rápido.
     · escaparate → una por fila a lo ancho, foto enorme. Pocas y caras.
     · preventa   → rejilla con el ESTATUS comercial muy visible
                    (disponible / apartado / vendido), que es lo que
                    pregunta quien compra en preventa.

   Y los cinco de las plantillas PREMIUM. El encargo fue que se vean CARAS
   como las webs de inmobiliarias de alto nivel, y lo caro es lo contrario
   del exceso: fotos grandes con aire, nada de cajas ni bordes, tipografía
   editorial (la serif la pone la piel; aquí solo se pide donde toca) y,
   porque esto es México, el PRECIO y la COLONIA leyéndose al instante y
   el WhatsApp a la vista:
     · revista    (AGENCY/galeria)  → dos por fila, foto 3:2 grande sin
                    caja; el precio va PRIMERO, luego la colonia y luego
                    el título. Es la tarjeta de siempre REORDENADA por CSS
                    (`order` en el cuerpo), así no hay dos tarjetas que
                    mantener.
     · discreta   (AGENCY/torre)    → filas compactas con foto cuadrada
                    chica. EXCLUYE el desarrollo que ya manda la portada
                    (destacado(), comparado por `ref`): el protagonista no
                    se repite abajo como uno más, y la lista no compite.
     · portafolio (AGENT/editorial) → piezas numeradas "01", "02"…, foto
                    sin radio y título en serif; en escritorio la primera
                    va a doble ancho, como la apertura de un reportaje.
     · columna    (AGENT/tarjeta)   → SIEMPRE una columna (la piel recorta
                    el ancho): tarjetas altas para el pulgar, el precio
                    como pastilla blanca sobre la foto y la colonia en la
                    esquina contraria. Se entiende sin leer el cuerpo.
     · vitrina    (OWNER/vitrina)   → cada inmueble es un "spread" a dos
                    columnas alternando el lado de la foto: el recorrido
                    virtual embebido si lo tiene, miniaturas, amenidades y
                    su PROPIO botón de WhatsApp con el mensaje ya escrito
                    (por eso el catálogo declara "whatsapp" para el bloque).

   La insignia de "Recorrido virtual" la decide ESTE bloque y se la pasa a
   la tarjeta: es un argumento de venta y quien lo tiene quiere que se vea
   desde el listado, no al abrir la ficha.

   El CSS de los cinco premium vive al lado, en inmuebles.css.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  fotoPortada,
  ligaWhatsApp,
  precioAnunciado,
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  tieneRecorrido,
  ubicacionPublica,
  type RealtyWebData,
  type RealtyWebInmuebleDTO,
} from "@/lib/realty/landing";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  REALTY_PROPERTY_STATUS_UI,
  realtyAmenityLabel,
} from "@/lib/realty/types";
import { realtyTourEmbedUrl, realtyTourProviderLabel } from "@/lib/realty/tours";
import {
  copia,
  subtitulo,
  titulo,
  variante,
  whatsappDe,
  Encabezado,
  Sec,
} from "@/components/realty/web/helpers";
import {
  DatosInmueble,
  Foto,
  IcoFlecha,
  IcoRecorrido,
  IcoWhatsApp,
  Pastilla,
  SinFoto,
  TarjetaInmueble,
} from "@/components/realty/web/pieces";
import { EmbedRecorrido } from "@/components/realty/web/recorrido-cliente";
import { destacado } from "@/components/realty/web/blocks/portada";

const ID = "inmuebles";

/** Cuántos se enseñan en la portada según el maquetado. */
const TOPE: Record<string, number> = {
  rejilla: 6,
  filas: 8,
  escaparate: 3,
  preventa: 6,
  // Premium: pocos y grandes. Más de cuatro en revista o portafolio ya no
  // es "selección", es catálogo, y para eso está "ver todos".
  revista: 4,
  discreta: 8,
  portafolio: 4,
  columna: 6,
  vitrina: 4,
};

/** Hasta cuántas amenidades enseña cada spread de la vitrina. */
const AMENIDADES_VITRINA = 6;

/** Cuántas miniaturas lleva cada spread de la vitrina, aparte de la portada. */
const MINIATURAS_VITRINA = 3;

/* ── Trocitos que comparten las piezas premium ────────────────────── */

/**
 * La colonia sola (o la ciudad si no capturaron colonia): para los rótulos
 * cortos sobre la foto y las líneas en mayúsculas, donde
 * "Providencia, Guadalajara, Jalisco" ya no cabe.
 */
function coloniaCorta(inm: RealtyWebInmuebleDTO): string | null {
  return inm.colonia?.trim() || inm.ciudad?.trim() || null;
}

/** "Casa · Venta", la misma línea que la tarjeta base. */
function tipoYOperacion(inm: RealtyWebInmuebleDTO): string {
  return [REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "Inmueble", REALTY_OPERATION_LABELS[inm.operation] ?? ""]
    .filter(Boolean)
    .join(" · ");
}

/** La portada del inmueble o el hueco con el tipo, igual que en la tarjeta. */
function FotoDelInmueble({ inm, prioridad }: { inm: RealtyWebInmuebleDTO; prioridad?: boolean }) {
  const portada = fotoPortada(inm);
  return portada ? (
    <Foto url={portada.url} alt={inm.titulo} width={portada.width} height={portada.height} prioridad={prioridad} />
  ) : (
    <SinFoto etiqueta={REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "Inmueble"} />
  );
}

/** La misma insignia de recorrido que pone la tarjeta base. */
function Insignia({ etiqueta }: { etiqueta: string }) {
  return (
    <span className="dcrw-insignia">
      <IcoRecorrido />
      {etiqueta}
    </span>
  );
}

interface PiezaProps {
  inm: RealtyWebInmuebleDTO;
  href: string;
  cta: string;
  /** ¿Lleva la insignia de recorrido virtual? Lo decide el BLOQUE. */
  recorrido: boolean;
  etiquetaRecorrido: string;
  /** La primera del listado se carga sin diferir. */
  prioridad: boolean;
}

/* ── discreta (Torre): fila compacta ──────────────────────────────── */

function FilaDiscreta({ inm, href, recorrido, etiquetaRecorrido, prioridad }: PiezaProps) {
  const donde = ubicacionPublica(inm);
  return (
    <article className="dcrw-discreta">
      <a href={href} className="dcrw-discreta-foto" aria-label={inm.titulo}>
        <FotoDelInmueble inm={inm} prioridad={prioridad} />
      </a>
      <div className="dcrw-discreta-cuerpo">
        <h3 className="dcrw-discreta-titulo">
          <a href={href}>{inm.titulo}</a>
        </h3>
        {donde ? <p className="dcrw-discreta-donde">{donde}</p> : null}
        <p className="dcrw-precio dcrw-discreta-precio">{precioAnunciado(inm)}</p>
        {/* Sobre una foto de 96px la insignia taparía media foto: aquí el
            recorrido se dice en una línea chica del cuerpo. */}
        {recorrido ? (
          <span className="dcrw-discreta-tag">
            <IcoRecorrido size={12} />
            {etiquetaRecorrido}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/* ── portafolio (Editorial): pieza numerada ───────────────────────── */

function PiezaPortafolio({
  inm,
  href,
  recorrido,
  etiquetaRecorrido,
  prioridad,
  numero,
}: PiezaProps & { numero: number }) {
  const linea = [tipoYOperacion(inm), coloniaCorta(inm)].filter(Boolean).join(" · ");
  const folio = numero < 10 ? `0${numero}` : String(numero);
  return (
    <article className="dcrw-portafolio-pieza">
      <span className="dcrw-portafolio-num" aria-hidden="true">
        {folio}
      </span>
      <a href={href} className="dcrw-portafolio-foto" aria-label={inm.titulo}>
        <FotoDelInmueble inm={inm} prioridad={prioridad} />
        {recorrido ? <Insignia etiqueta={etiquetaRecorrido} /> : null}
      </a>
      <div className="dcrw-portafolio-cuerpo">
        <div className="dcrw-portafolio-texto">
          <h3 className="dcrw-portafolio-titulo">
            <a href={href}>{inm.titulo}</a>
          </h3>
          <p className="dcrw-portafolio-linea">{linea}</p>
        </div>
        <div className="dcrw-portafolio-cifras">
          <p className="dcrw-precio">{precioAnunciado(inm)}</p>
          <DatosInmueble inm={inm} />
        </div>
      </div>
    </article>
  );
}

/* ── columna (Tarjeta): alta, para el pulgar ──────────────────────── */

function PiezaColumna({ inm, href, cta, recorrido, etiquetaRecorrido, prioridad }: PiezaProps) {
  const colonia = coloniaCorta(inm);
  return (
    <article className="dcrw-columna-pieza">
      {/* Sin aria-label: el precio y la colonia SOLO viven sobre la foto,
          y un aria-label los borraría del nombre accesible del enlace. */}
      <a href={href} className="dcrw-columna-foto">
        <FotoDelInmueble inm={inm} prioridad={prioridad} />
        {recorrido ? <Insignia etiqueta={etiquetaRecorrido} /> : null}
        <span className="dcrw-columna-velo" aria-hidden="true" />
        <span className="dcrw-columna-pie">
          <span className="dcrw-columna-precio">{precioAnunciado(inm)}</span>
          {colonia ? <span className="dcrw-columna-colonia">{colonia}</span> : null}
        </span>
      </a>
      <div className="dcrw-columna-cuerpo">
        <p className="dcrw-columna-op">{tipoYOperacion(inm)}</p>
        <h3 className="dcrw-columna-titulo">
          <a href={href}>{inm.titulo}</a>
        </h3>
        <DatosInmueble inm={inm} />
        <a href={href} className="dcrw-tarjeta-cta">
          {cta} <IcoFlecha />
        </a>
      </div>
    </article>
  );
}

/* ── vitrina (Vitrina): un spread por inmueble ────────────────────── */

function PiezaVitrina({
  inm,
  href,
  cta,
  etiquetaRecorrido,
  prioridad,
  etiquetaWhatsApp,
  whatsapp,
}: PiezaProps & { etiquetaWhatsApp: string; whatsapp: string | null }) {
  const portada = fotoPortada(inm);
  const tour = tieneRecorrido(inm) ? inm.tours[0] : null;
  // Si el proveedor no está en la allowlist, embed es null y se cae a la
  // foto: un iframe fuera del frame-src sale EN BLANCO sin avisar.
  const embed = tour ? realtyTourEmbedUrl(tour.url) : null;
  // Las miniaturas son las fotos que NO son la portada (la portada puede
  // no ser fotos[0] si marcaron otra como isCover).
  const minis = inm.fotos.filter((f) => f.url !== portada?.url).slice(0, MINIATURAS_VITRINA);
  const donde = ubicacionPublica(inm);
  const amenidades = inm.amenidades.slice(0, AMENIDADES_VITRINA);

  return (
    <article className="dcrw-vitrina-pieza">
      <div className="dcrw-vitrina-media">
        {embed && tour ? (
          <EmbedRecorrido
            src={embed}
            titulo={inm.titulo}
            etiqueta={etiquetaRecorrido}
            proveedor={realtyTourProviderLabel(tour.provider)}
            portada={portada ? { url: portada.url, width: portada.width, height: portada.height } : null}
          />
        ) : (
          <a href={href} className="dcrw-vitrina-foto" aria-label={inm.titulo}>
            <FotoDelInmueble inm={inm} prioridad={prioridad} />
          </a>
        )}
        {minis.length > 0 ? (
          // Decorativas y fuera del tabulador: la ficha ya se abre desde el
          // título y el botón, y tres paradas más por inmueble estorban.
          <a href={href} className="dcrw-vitrina-minis" tabIndex={-1} aria-hidden="true">
            {minis.map((f) => (
              <Foto key={f.url} url={f.url} alt="" width={f.width} height={f.height} />
            ))}
          </a>
        ) : null}
      </div>
      <div className="dcrw-vitrina-texto">
        <p className="dcrw-vitrina-kicker">{tipoYOperacion(inm)}</p>
        <h3 className="dcrw-vitrina-titulo">
          <a href={href}>{inm.titulo}</a>
        </h3>
        {donde ? <p className="dcrw-vitrina-donde">{donde}</p> : null}
        <p className="dcrw-precio dcrw-precio-grande">{precioAnunciado(inm)}</p>
        <DatosInmueble inm={inm} />
        {amenidades.length > 0 ? (
          <ul className="dcrw-amenidades">
            {amenidades.map((a) => (
              <li key={a}>
                <Pastilla>{realtyAmenityLabel(a)}</Pastilla>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="dcrw-vitrina-botones">
          <a className="dcrw-btn dcrw-btn-primario" href={href}>
            {cta}
          </a>
          {whatsapp ? (
            <a className="dcrw-btn dcrw-btn-whatsapp" href={whatsapp} target="_blank" rel="noopener noreferrer">
              <IcoWhatsApp />
              {etiquetaWhatsApp}
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* ── El bloque ────────────────────────────────────────────────────── */

export function BloqueInmuebles({ data }: { data: RealtyWebData }) {
  const v = variante(data, ID) || "rejilla";

  // `discreta` (Torre): el desarrollo que manda la portada no se repite
  // abajo. Se compara por `ref`, que es el segmento de URL y el único
  // identificador del inmueble que viaja al público.
  const protagonista = v === "discreta" ? destacado(data) : null;
  const cartera = protagonista ? data.inmuebles.filter((inm) => inm.ref !== protagonista.ref) : data.inmuebles;
  const lista = cartera.slice(0, TOPE[v] ?? 6);
  if (lista.length === 0) return null;

  // "Ver todos" se decide contra el total SIN el protagonista, por la misma
  // razón: ya está en la página, y ofrecer "ver los 5" cuando abajo hay 4 y
  // arriba el quinto es mandar a la gente a una lista que ya vio.
  const total = data.totalInmuebles - (protagonista ? 1 : 0);

  const cta = copia(data, ID, "inmuebles.cta");
  const etiquetaRecorrido = copia(data, ID, "inmuebles.recorrido");
  const verTodos = copia(data, ID, "inmuebles.todos");
  const etiquetaWhatsApp = copia(data, ID, "inmuebles.whatsapp");
  const telefono = whatsappDe(data);
  const conEstatus = v === "preventa";
  const slug = data.cuenta.slug;

  return (
    <Sec id={ID} variante={v}>
      <Encabezado
        kicker={copia(data, ID, "inmuebles.kicker")}
        titulo={titulo(data, ID)}
        subtitulo={subtitulo(data, ID)}
      />
      <div className={`dcrw-lista dcrw-lista-${v}`}>
        {lista.map((inm, i) => {
          const comun: PiezaProps = {
            inm,
            href: rutaInmuebleWeb(slug, inm.ref),
            cta,
            recorrido: tieneRecorrido(inm),
            etiquetaRecorrido,
            prioridad: i === 0,
          };
          if (v === "discreta") return <FilaDiscreta key={inm.ref} {...comun} />;
          if (v === "portafolio") return <PiezaPortafolio key={inm.ref} {...comun} numero={i + 1} />;
          if (v === "columna") return <PiezaColumna key={inm.ref} {...comun} />;
          if (v === "vitrina") {
            return (
              <PiezaVitrina
                key={inm.ref}
                {...comun}
                etiquetaWhatsApp={etiquetaWhatsApp}
                whatsapp={ligaWhatsApp(
                  telefono,
                  `Hola, me interesa "${inm.titulo}"${inm.folio ? ` (${inm.folio})` : ""}.`,
                )}
              />
            );
          }
          // rejilla · filas · escaparate · preventa · revista: la tarjeta
          // compartida. `revista` solo se reordena por CSS.
          return (
            <TarjetaInmueble
              key={inm.ref}
              {...comun}
              forma={v}
              estatus={conEstatus ? (REALTY_PROPERTY_STATUS_UI[inm.status]?.label ?? null) : null}
            />
          );
        })}
      </div>
      {total > lista.length ? (
        <p className="dcrw-lista-mas">
          <a className="dcrw-btn dcrw-btn-secundario" href={rutaPropiedadesWeb(slug)}>
            {verTodos}
          </a>
        </p>
      ) : null}
    </Sec>
  );
}
