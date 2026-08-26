/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: PORTADA.

   El único bloque que existe en las quince plantillas y el único que se
   pinta aunque no haya nada más: una cuenta recién dada de alta tiene
   página, no un 404.

   Los maquetados, y cada uno cambia QUIÉN es el sujeto:
     · retrato       (AGENT/asesor)    → la foto de la persona, a dos columnas.
     · sobria        (AGENT/minimal,
                      OWNER/catalogo)  → sin foto. Titular y botones.
     · editorial     (AGENT/historia)  → foto a sangre, texto encima.
     · buscador      (AGENCY/clasica)  → foto de fondo, promesa y botón al
                                          buscador que va justo debajo.
     · desarrollo    (AGENCY/corporativa)
     · boutique      (AGENCY/boutique)
     · tablero       (OWNER/mis-rentas)
     · unaPropiedad  (OWNER/una-propiedad) → la portada ES la ficha del
                       inmueble destacado: galería, precio y recorrido.

   Los seis PREMIUM (segunda ola), en blocks/portada.css:
     · cine          (AGENCY/galeria)  → foto a sangre a TODA la altura
                       visible, titular abajo a la izquierda, casi nada más.
                       Deja sitio para el buscador que flota sobre su borde.
     · torre         (AGENCY/torre)    → UN desarrollo manda: su foto a
                       sangre, "desde" tal precio, colonia; debajo, en la
                       misma portada, amenidades, recorrido y galería.
     · reportaje     (AGENT/editorial) → retrato pegado al borde derecho a
                       toda la altura; titular de revista a la izquierda.
     · tarjeta       (AGENT/tarjeta)   → vertical, foto redonda, nombre y el
                       WhatsApp enorme. Para abrirse desde la bio de Instagram.
     · aviso         (OWNER/disponibilidad) → clara, con el "sin comisión"
                       como sello y el contador de lo que está libre.
     · vitrina       (OWNER/vitrina)   → a sangre y centrada; sin foto
                       subida, usa la del primer inmueble.

   Declara pinta: whatsapp, inmuebles, recorrido — por unaPropiedad y torre,
   que son las que tocan la cartera.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  ligaWhatsApp,
  precioAnunciado,
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  recorridoEmbebible,
  tieneRecorrido,
  ubicacionPublica,
  fotoPortada,
  type RealtyWebData,
  type RealtyWebInmuebleDTO,
} from "@/lib/realty/landing";
import { realtyAmenityLabel } from "@/lib/realty/types";
import { realtyTourEmbedUrl, realtyTourProviderLabel } from "@/lib/realty/tours";
import { copia, foto, logo, subtitulo, titulo, variante, whatsappDe } from "@/components/realty/web/helpers";
import { DatosInmueble, Foto, IcoWhatsApp, Pastilla, SinFoto } from "@/components/realty/web/pieces";
import { EmbedRecorrido } from "@/components/realty/web/recorrido-cliente";

const ID = "portada";

/**
 * El inmueble que protagoniza las plantillas "una-propiedad" y "torre".
 * Exportado para que el listado `discreta` de Torre lo EXCLUYA: el
 * desarrollo que manda la portada no se repite abajo como uno más.
 */
export function destacado(data: RealtyWebData): RealtyWebInmuebleDTO | null {
  const ref = data.config.inmuebleDestacado;
  const elegido = ref ? data.inmuebles.find((i) => i.ref === ref) : null;
  // Si el destacado se despublicó o se rentó, cae al más reciente en vez de
  // dejar la página entera en blanco.
  return elegido ?? data.inmuebles[0] ?? null;
}

export function BloquePortada({ data }: { data: RealtyWebData }) {
  const v = variante(data, ID);
  const t = titulo(data, ID);
  const s = subtitulo(data, ID);
  const kicker = copia(data, ID, "portada.kicker");
  const cta = copia(data, ID, "portada.cta");
  const ctaWa = copia(data, ID, "portada.whatsapp");
  const marca = logo(data);
  const fondo = foto(data, "portada");
  const retrato = foto(data, "retrato");
  const wa = ligaWhatsApp(whatsappDe(data), `Hola, vi ${data.cuenta.nombre} en internet.`);
  const verInmuebles = rutaPropiedadesWeb(data.cuenta.slug);

  const marcaYNombre = (
    <div className="dcrw-hero-marca">
      {marca ? <Foto url={marca} alt={data.cuenta.nombre} prioridad className="dcrw-hero-logo" /> : null}
      <span className="dcrw-hero-nombre">{data.cuenta.nombre}</span>
    </div>
  );

  const botones = (
    <div className="dcrw-hero-botones">
      <a className="dcrw-btn dcrw-btn-primario" href={verInmuebles}>
        {cta}
      </a>
      {wa ? (
        <a className="dcrw-btn dcrw-btn-whatsapp" href={wa} target="_blank" rel="noopener noreferrer">
          <IcoWhatsApp />
          {ctaWa}
        </a>
      ) : null}
    </div>
  );

  const texto = (
    <div className="dcrw-hero-texto">
      {kicker ? <p className="dcrw-kicker">{kicker}</p> : null}
      <h1 className="dcrw-hero-titulo">{t}</h1>
      {s ? <p className="dcrw-hero-bajada">{s}</p> : null}
      {botones}
    </div>
  );

  /* ── La portada que ES una ficha ──────────────────────────────── */
  if (v === "unaPropiedad") {
    const inm = destacado(data);
    if (!inm) return null;
    const portada = fotoPortada(inm);
    // recorridoEmbebible devuelve el primero que SE PUEDE PINTAR, o null.
    // Antes esto era `tieneRecorrido(inm) ? inm.tours[0] : null`, que hacía
    // dos veces el mismo trabajo (y con tours[0] enseñaba la panorámica
    // propia en vez del Matterport si estaba primero).
    const tour = recorridoEmbebible(inm);
    const embed = tour ? realtyTourEmbedUrl(tour.url) : null;
    const donde = ubicacionPublica(inm);
    const waInm = ligaWhatsApp(
      whatsappDe(data),
      `Hola, me interesa "${inm.titulo}"${inm.folio ? ` (${inm.folio})` : ""}.`,
    );

    return (
      <section id={ID} className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-unapropiedad">
        <div className="dcrw-ancho dcrw-hero-caja">
          <div className="dcrw-hero-galeria">
            {embed && tour ? (
              <EmbedRecorrido
                src={embed}
                href={tour.url}
                titulo={inm.titulo}
                etiqueta={copia(data, ID, "portada.recorrido")}
                proveedor={realtyTourProviderLabel(tour.provider)}
                portada={portada ? { url: portada.url, width: portada.width, height: portada.height } : null}
              />
            ) : portada ? (
              <Foto url={portada.url} alt={inm.titulo} width={portada.width} height={portada.height} prioridad />
            ) : (
              <SinFoto etiqueta={inm.titulo} />
            )}
          </div>
          <div className="dcrw-hero-texto">
            {marcaYNombre}
            {kicker ? <p className="dcrw-kicker">{kicker}</p> : null}
            <h1 className="dcrw-hero-titulo">{t || inm.titulo}</h1>
            {donde ? <p className="dcrw-hero-donde">{donde}</p> : null}
            <p className="dcrw-precio dcrw-precio-grande">{precioAnunciado(inm)}</p>
            <DatosInmueble inm={inm} />
            {s ? <p className="dcrw-hero-bajada">{s}</p> : null}
            <div className="dcrw-hero-botones">
              <a className="dcrw-btn dcrw-btn-primario" href={rutaInmuebleWeb(data.cuenta.slug, inm.ref)}>
                {cta}
              </a>
              {waInm ? (
                <a className="dcrw-btn dcrw-btn-whatsapp" href={waInm} target="_blank" rel="noopener noreferrer">
                  <IcoWhatsApp />
                  {ctaWa}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* ── Torre: UN desarrollo manda la portada ────────────────────── */
  if (v === "torre") {
    const inm = destacado(data);
    if (!inm) return null;
    const portada = fotoPortada(inm);
    // La foto del desarrollo por delante; la subida al editor es el respaldo
    // para un desarrollo que todavía no tiene fotos.
    const lienzo = portada?.url ?? fondo;
    const tour = tieneRecorrido(inm) ? inm.tours[0] : null;
    const embed = tour ? realtyTourEmbedUrl(tour.url) : null;
    const donde = ubicacionPublica(inm);
    const waInm = ligaWhatsApp(
      whatsappDe(data),
      `Hola, me interesa "${inm.titulo}"${inm.folio ? ` (${inm.folio})` : ""}.`,
    );
    const ficha = rutaInmuebleWeb(data.cuenta.slug, inm.ref);
    // Renders, plantas y avance: TODAS las fotos menos la que ya es fondo.
    // No hay campo que distinga una planta de un render, así que el rótulo
    // (copia "portada.galeria") lo escribe la cuenta.
    const galeria = inm.fotos.filter((f) => f.url !== portada?.url).slice(0, 6);
    const amenidades = inm.amenidades.slice(0, 8);
    const hayFicha = amenidades.length > 0 || galeria.length > 0 || (embed && tour);

    return (
      <section
        id={ID}
        className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-cine dcrw-hero-torre"
        data-variante="torre"
      >
        <div className="dcrw-hero-lienzo">
          {lienzo ? <Foto url={lienzo} alt="" prioridad className="dcrw-hero-fondo" /> : null}
          <div className="dcrw-hero-velo" aria-hidden="true" />
          <div className="dcrw-ancho dcrw-hero-caja">
            {marcaYNombre}
            <div className="dcrw-hero-texto">
              {kicker ? <p className="dcrw-kicker">{kicker}</p> : null}
              <h1 className="dcrw-hero-titulo">{t || inm.titulo}</h1>
              {donde ? <p className="dcrw-hero-donde">{donde}</p> : null}
              <p className="dcrw-precio dcrw-precio-grande">
                <span className="dcrw-precio-rotulo">{copia(data, ID, "portada.precioRotulo")}</span>{" "}
                {precioAnunciado(inm)}
              </p>
              <DatosInmueble inm={inm} />
              {s ? <p className="dcrw-hero-bajada">{s}</p> : null}
              <div className="dcrw-hero-botones">
                <a className="dcrw-btn dcrw-btn-primario" href={ficha}>
                  {cta}
                </a>
                {waInm ? (
                  <a className="dcrw-btn dcrw-btn-whatsapp" href={waInm} target="_blank" rel="noopener noreferrer">
                    <IcoWhatsApp />
                    {ctaWa}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {hayFicha ? (
          <div className="dcrw-ancho dcrw-torre-ficha">
            {amenidades.length > 0 ? (
              <div className="dcrw-torre-amenidades">
                <p className="dcrw-kicker">{copia(data, ID, "portada.amenidades")}</p>
                <ul className="dcrw-amenidades">
                  {amenidades.map((a) => (
                    <li key={a}>
                      <Pastilla>{realtyAmenityLabel(a)}</Pastilla>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {embed && tour ? (
              <div className="dcrw-torre-recorrido">
                <EmbedRecorrido
                  src={embed}
                  titulo={inm.titulo}
                  etiqueta={copia(data, ID, "portada.recorrido")}
                  proveedor={realtyTourProviderLabel(tour.provider)}
                  portada={portada ? { url: portada.url, width: portada.width, height: portada.height } : null}
                />
              </div>
            ) : null}
            {galeria.length > 0 ? (
              <div className="dcrw-torre-galeria">
                <p className="dcrw-kicker">{copia(data, ID, "portada.galeria")}</p>
                {/* Decorativas y fuera del tabulador, como las miniaturas de
                    la vitrina: la ficha ya se abre desde el botón de arriba y
                    seis paradas de teclado más al MISMO destino estorban. */}
                <ul className="dcrw-torre-fotos" aria-hidden="true">
                  {galeria.map((f) => (
                    <li key={f.url}>
                      <a href={ficha} tabIndex={-1}>
                        <Foto url={f.url} alt="" width={f.width} height={f.height} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  /* ── Cine y vitrina: a sangre, a toda la altura visible ───────── */
  if (v === "cine" || v === "vitrina") {
    // La vitrina sin foto subida enseña la mejor del inventario: para un
    // rentista con tres casas bonitas, ESA es la portada.
    const lienzo = fondo ?? (v === "vitrina" ? (fotoPortada(data.inmuebles[0] ?? { fotos: [] })?.url ?? null) : null);
    return (
      <section
        id={ID}
        className={`dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-cine${v === "vitrina" ? " dcrw-hero-vitrina" : ""}`}
        data-variante={v}
      >
        <div className="dcrw-hero-lienzo">
          {lienzo ? <Foto url={lienzo} alt="" prioridad className="dcrw-hero-fondo" /> : null}
          <div className="dcrw-hero-velo" aria-hidden="true" />
          <div className="dcrw-ancho dcrw-hero-caja">
            {marcaYNombre}
            {texto}
          </div>
        </div>
      </section>
    );
  }

  /* ── Reportaje: el retrato pegado al borde, a toda la altura ──── */
  if (v === "reportaje") {
    return (
      <section id={ID} className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-reportaje" data-variante={v}>
        <div className="dcrw-hero-reportaje-caja">
          <div className="dcrw-hero-reportaje-texto">
            {marcaYNombre}
            {texto}
          </div>
          <div className="dcrw-hero-reportaje-foto">
            {retrato ? (
              <Foto url={retrato} alt={data.cuenta.nombre} prioridad />
            ) : (
              <SinFoto etiqueta={data.cuenta.nombre} />
            )}
          </div>
        </div>
      </section>
    );
  }

  /* ── Tarjeta: vertical, para la bio de Instagram ──────────────── */
  if (v === "tarjeta") {
    // Sin retrato, el logo hace de foto; sin ninguno, el hueco con el nombre.
    const cara = retrato ?? marca;
    return (
      <section id={ID} className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-tarjeta" data-variante={v}>
        <div className="dcrw-ancho dcrw-hero-caja">
          <div className="dcrw-hero-tarjeta-foto">
            {cara ? <Foto url={cara} alt={data.cuenta.nombre} prioridad /> : <SinFoto etiqueta={data.cuenta.nombre} />}
          </div>
          <p className="dcrw-hero-nombre">{data.cuenta.nombre}</p>
          <div className="dcrw-hero-texto">
            {kicker ? <p className="dcrw-kicker">{kicker}</p> : null}
            <h1 className="dcrw-hero-titulo">{t}</h1>
            {s ? <p className="dcrw-hero-bajada">{s}</p> : null}
            {/* El WhatsApp PRIMERO y enorme: en un teléfono es el único botón
                que importa. El listado es la segunda opción. */}
            <div className="dcrw-hero-botones dcrw-hero-botones-apiladas">
              {wa ? (
                <a
                  className="dcrw-btn dcrw-btn-whatsapp dcrw-btn-enorme"
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IcoWhatsApp size={20} />
                  {ctaWa}
                </a>
              ) : null}
              <a className="dcrw-btn dcrw-btn-secundario" href={verInmuebles}>
                {cta}
              </a>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* ── Aviso: clara, con el sello de "sin comisión" y el contador ── */
  if (v === "aviso") {
    // El contador solo cuenta lo LIBRE: es el dato que hace que alguien
    // escriba hoy y no la semana que entra. Con cero se calla.
    const libres = data.inmuebles.filter((i) => i.status === "DISPONIBLE").length;
    return (
      <section id={ID} className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-aviso" data-variante={v}>
        <div className="dcrw-ancho dcrw-hero-caja">
          {marcaYNombre}
          <div className="dcrw-hero-texto">
            {kicker ? <p className="dcrw-hero-sello">{kicker}</p> : null}
            <h1 className="dcrw-hero-titulo">{t}</h1>
            {s ? <p className="dcrw-hero-bajada">{s}</p> : null}
            {libres > 0 ? (
              <p className="dcrw-hero-contador">
                <strong>{libres}</strong>{" "}
                {libres === 1 ? copia(data, ID, "portada.libre") : copia(data, ID, "portada.libres")}
              </p>
            ) : null}
            {botones}
          </div>
        </div>
      </section>
    );
  }

  /* ── Retrato: la persona a la derecha ─────────────────────────── */
  if (v === "retrato") {
    return (
      <section id={ID} className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-retrato">
        <div className="dcrw-ancho dcrw-hero-caja">
          {/* Sin envolver `texto` en otro .dcrw-hero-texto: ya lo es, y
              anidar dos veces la misma clase es una bomba de relojería para
              quien le ponga estilos después. */}
          <div>
            {marcaYNombre}
            {texto}
          </div>
          <div className="dcrw-hero-retrato">
            {retrato ? (
              <Foto url={retrato} alt={data.cuenta.nombre} prioridad />
            ) : (
              <SinFoto etiqueta={data.cuenta.nombre} />
            )}
          </div>
        </div>
      </section>
    );
  }

  /* ── Editorial: foto a sangre, texto encima ───────────────────── */
  if (v === "editorial") {
    return (
      <section id={ID} className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-editorial">
        {fondo ? <Foto url={fondo} alt="" prioridad className="dcrw-hero-fondo" /> : null}
        <div className="dcrw-hero-velo" aria-hidden="true" />
        <div className="dcrw-ancho dcrw-hero-caja">
          {marcaYNombre}
          {texto}
        </div>
      </section>
    );
  }

  /* ── Sobria: sin foto. Carga en un parpadeo. ──────────────────── */
  if (v === "sobria") {
    return (
      <section id={ID} className="dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-sobria">
        <div className="dcrw-ancho dcrw-hero-caja">
          {marcaYNombre}
          {texto}
        </div>
      </section>
    );
  }

  /* ── Buscador / desarrollo / boutique / tablero ───────────────── */
  return (
    <section
      id={ID}
      className={`dcrw-sec dcrw-sec-portada dcrw-hero dcrw-hero-${v || "buscador"}`}
      data-variante={v || undefined}
    >
      {fondo ? <Foto url={fondo} alt="" prioridad className="dcrw-hero-fondo" /> : null}
      <div className="dcrw-hero-velo" aria-hidden="true" />
      <div className="dcrw-ancho dcrw-hero-caja">
        {marcaYNombre}
        {texto}
      </div>
    </section>
  );
}
