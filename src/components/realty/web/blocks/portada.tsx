/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: PORTADA.

   El único bloque que existe en las nueve plantillas y el único que se
   pinta aunque no haya nada más: una cuenta recién dada de alta tiene
   página, no un 404.

   Cinco maquetados, y cada uno cambia QUIÉN es el sujeto:
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

   Declara pinta: whatsapp, inmuebles, recorrido — los tres por la variante
   unaPropiedad, que es la única que toca la cartera.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  ligaWhatsApp,
  precioAnunciado,
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  tieneRecorrido,
  ubicacionPublica,
  fotoPortada,
  type RealtyWebData,
  type RealtyWebInmuebleDTO,
} from "@/lib/realty/landing";
import { realtyTourEmbedUrl, realtyTourProviderLabel } from "@/lib/realty/tours";
import { copia, foto, logo, subtitulo, titulo, variante, whatsappDe } from "@/components/realty/web/helpers";
import { DatosInmueble, Foto, IcoWhatsApp, SinFoto } from "@/components/realty/web/pieces";
import { EmbedRecorrido } from "@/components/realty/web/recorrido-cliente";

const ID = "portada";

/** El inmueble que protagoniza la plantilla "una-propiedad". */
function destacado(data: RealtyWebData): RealtyWebInmuebleDTO | null {
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
    const tour = tieneRecorrido(inm) ? inm.tours[0] : null;
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
