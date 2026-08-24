/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "PORTAFOLIO" — la galería es la portada.

   Lo que la distingue de las otras siete:
     · La primera pantalla ES el mosaico de cortes, a sangre y sin
       márgenes, con el nombre encima. Ninguna otra abre con fotos.
     · Barra de reserva pegada abajo: el visitante viene de Instagram, mira
       fotos y el botón nunca se le va de la pantalla.
     · Los precios se reducen a una TIRA de una línea por servicio: aquí
       el precio informa, no vende.
     · Fondo oscuro para que las fotos sean lo único con color.

   La barra de abajo es `position: sticky`, no `fixed`: la raíz .dcbw es
   un contenedor de consulta (@container) y eso crea bloque contenedor
   para los `fixed`, así que un `bottom: 0` fijo se habría anclado al
   final de la PÁGINA en vez de a la ventana. Sticky se mide contra el
   scrollport real, que es la ventana en público y el lienzo del editor
   en la vista previa: funciona igual en los dos sitios.
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

export function PlantillaPortafolio({ data }: { data: BarberWebData }) {
  const { shop, config, servicios, barberos, editando } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, vi tu página y quiero reservar en ${shop.name}`);
  const marca = logo(data);
  // El mosaico usa las 6 primeras del portafolio; si no hay ninguna, cae a
  // la ranura de portada y, si tampoco, al color de fondo. La portada nunca
  // se ve rota por no haber subido fotos todavía.
  const mosaico = config.galeria.slice(0, 6);

  return (
    <div className="dcbw dcbw-portafolio" style={varsDeAcento(data)}>
      {secs.map((s) => (
        <Fragment key={s.id}>
          {/* ── Portada: el mosaico a sangre ──────────────────── */}
          {s.id === "portada" && (
            <Sec id="portada" className="dcbw-pf-hero">
              <div className={`dcbw-pf-mosaico dcbw-pf-mosaico-${Math.min(mosaico.length, 6)}`} aria-hidden>
                {mosaico.length > 0 ? (
                  mosaico.map((u, i) => <Foto key={i} src={u} alt="" prioridad={i < 2} />)
                ) : (
                  <Ranura
                    url={foto(data, "portada")}
                    etiqueta={nombreRanura(data, "portada", "portada")}
                    alt=""
                    editando={editando}
                    prioridad
                  />
                )}
              </div>
              <div className="dcbw-pf-hero-txt">
                {marca && <Foto src={marca} alt={shop.name} className="dcbw-marca-img" prioridad />}
                <h1 className="dcbw-h1">{shop.name}</h1>
                <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>
                {dir && (
                  <p className="dcbw-pf-dir">
                    <IcoMapa size={15} /> {dir}
                  </p>
                )}
              </div>
            </Sec>
          )}

          {/* ── Portafolio: rejilla grande ────────────────────── */}
          {s.id === "portafolio" && (
            <Sec id="portafolio" className="dcbw-pf-galeria">
              <Encabezado titulo={titulo(data, "portafolio")} subtitulo={subtitulo(data, "portafolio")} />
              <div className="dcbw-pf-rejilla">
                {config.galeria.map((u, i) => (
                  <Foto key={i} src={u} alt={`Corte en ${shop.name}`} />
                ))}
              </div>
            </Sec>
          )}

          {/* ── Servicios: una tira de renglones ──────────────── */}
          {s.id === "servicios" && (
            <Sec id="servicios" className="dcbw-pf-precios">
              <Encabezado titulo={titulo(data, "servicios")} />
              <ul className="dcbw-pf-tira">
                {servicios.map((sv) => (
                  <li key={sv.id}>
                    <span className="dcbw-pf-tira-nombre">{sv.nombre}</span>
                    <Duracion min={sv.duracionMin} />
                    <Precio n={sv.precio} />
                    <a href={reservar} className="dcbw-enlace">
                      {copia(data, "servicios", "servicios.cta")}
                    </a>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Barberos: tira de cuadrados ───────────────────── */}
          {s.id === "equipo" && (
            <Sec id="equipo" className="dcbw-pf-equipo">
              <Encabezado titulo={titulo(data, "equipo")} />
              <ul className="dcbw-pf-barberos">
                {barberos.map((b) => (
                  <li key={b.id}>
                    {b.fotoUrl ? (
                      <Foto src={b.fotoUrl} alt={b.nombre} />
                    ) : (
                      <span className="dcbw-inicial dcbw-inicial-cuadro">{b.nombre.charAt(0)}</span>
                    )}
                    <h3>{b.apodo || b.nombre}</h3>
                    <a href={rutaReservaBarberia(shop.slug, b.id)} className="dcbw-enlace">
                      {copia(data, "equipo", "equipo.cta")}
                    </a>
                  </li>
                ))}
              </ul>
            </Sec>
          )}

          {/* ── Reseñas ───────────────────────────────────────── */}
          {s.id === "resenas" && (
            <Sec id="resenas" className="dcbw-pf-resenas">
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

          {/* ── Contacto: compacto, todo en una columna ───────── */}
          {s.id === "contacto" && (
            <Sec id="contacto" className="dcbw-pf-contacto">
              <Encabezado titulo={titulo(data, "contacto")} subtitulo={subtitulo(data, "contacto")} />
              {dir && <p className="dcbw-dato-linea">{dir}</p>}
              {tieneHorario(config) && (
                <ul className="dcbw-pf-horario">
                  {horarioAgrupado(config).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              )}
              {shop.phone && (
                <p className="dcbw-dato-linea">
                  <a href={`tel:${shop.phone}`} className="dcbw-tel">
                    {shop.phone}
                  </a>
                </p>
              )}
              <div className="dcbw-acciones">
                {urlComoLlegar(dir) && (
                  <Boton href={urlComoLlegar(dir)!} variante="fantasma" externo>
                    <IcoMapa size={15} /> {copia(data, "contacto", "contacto.comoLlegar")}
                  </Boton>
                )}
                {wa && (
                  <Boton href={wa} variante="whatsapp" externo>
                    <IcoWhatsApp /> {copia(data, "contacto", "contacto.whatsapp")}
                  </Boton>
                )}
              </div>
              <Redes config={config} conWhatsApp={false} size={22} />
            </Sec>
          )}
        </Fragment>
      ))}

      <Pie nombre={shop.name} />

      {/* ── Barra de reserva pegada abajo ─────────────────────── */}
      <div className="dcbw-pf-barra">
        <span>{shop.name}</span>
        <Boton href={reservar}>
          {copia(data, "portada", "portada.cta")} <IcoFlecha size={14} />
        </Boton>
      </div>
    </div>
  );
}
