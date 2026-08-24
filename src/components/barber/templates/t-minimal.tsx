/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA "MINIMAL" — una sola pantalla.

   Lo que la distingue de las otras siete:
     · Cabe ENTERA en un viewport: logo, nombre, dirección, horario
       agrupado, teléfono y un botón enorme. Sin galería y sin equipo, a
       propósito: es para el barbero que trabaja solo y cuya página vive
       en la bio de Instagram.
     · Es la única que NO recorre las secciones en columna: mete portada y
       contacto DENTRO de la misma pantalla, porque su valor es que no
       haya que hacer scroll para saber dónde y cuándo.
     · La lista de precios queda debajo del pliegue, en una columna
       estrecha, para quien sí quiere mirarla.

   El editor sigue mandando: si la barbería apaga "contacto" o "precios",
   desaparecen. Lo que decide la plantilla es la DISPOSICIÓN, no qué se ve.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  direccionCompleta,
  horarioAgrupado,
  rutaReservaBarberia,
  tieneHorario,
  urlComoLlegar,
  urlWhatsApp,
} from "@/lib/barber/landing";
import { Boton, Duracion, Foto, IcoFlecha, IcoMapa, IcoWhatsApp, Pie, Poste, Precio, Redes } from "./pieces";
import { Sec, copia, logo, secciones, tieneSeccion, titulo, varsDeAcento } from "./helpers";
import type { BarberWebData } from "./types";

export function PlantillaMinimal({ data }: { data: BarberWebData }) {
  const { shop, config, servicios } = data;
  const secs = secciones(data);
  const dir = direccionCompleta(shop);
  const reservar = rutaReservaBarberia(shop.slug);
  const wa = urlWhatsApp(config.whatsapp, `Hola, quiero reservar en ${shop.name}`);
  const marca = logo(data);
  const conContacto = tieneSeccion(secs, "contacto");
  const conPrecios = tieneSeccion(secs, "servicios");

  return (
    <div className="dcbw dcbw-minimal" style={varsDeAcento(data)}>
      <Sec id="portada" className="dcbw-min-pantalla">
        <div className="dcbw-min-caja">
          {marca ? (
            <Foto src={marca} alt={shop.name} className="dcbw-min-logo" prioridad />
          ) : (
            <Poste className="dcbw-min-poste" />
          )}

          <h1 className="dcbw-h1">{shop.name}</h1>
          <p className="dcbw-kicker">{copia(data, "portada", "portada.eslogan")}</p>

          {conContacto && (
            <div className="dcbw-min-datos">
              {dir && (
                <p>
                  <IcoMapa size={15} /> {dir}
                </p>
              )}
              {tieneHorario(config) &&
                horarioAgrupado(config).map((l, i) => (
                  <p key={i} className="dcbw-min-horario">
                    {l}
                  </p>
                ))}
              {shop.phone && (
                <p>
                  <a href={`tel:${shop.phone}`} className="dcbw-tel">
                    {shop.phone}
                  </a>
                </p>
              )}
            </div>
          )}

          <Boton href={reservar} className="dcbw-min-cta">
            {copia(data, "portada", "portada.cta")} <IcoFlecha />
          </Boton>

          <div className="dcbw-min-secundarios">
            {wa && (
              <Boton href={wa} variante="fantasma" externo>
                <IcoWhatsApp size={16} /> {copia(data, "portada", "portada.whatsapp")}
              </Boton>
            )}
            {conContacto && urlComoLlegar(dir) && (
              <Boton href={urlComoLlegar(dir)!} variante="fantasma" externo>
                <IcoMapa size={16} /> {copia(data, "contacto", "contacto.comoLlegar")}
              </Boton>
            )}
          </div>

          <Redes config={config} conWhatsApp={false} size={19} className="dcbw-min-redes" />
          <p className="dcbw-min-nota">{copia(data, "portada", "portada.nota")}</p>
        </div>
      </Sec>

      {conPrecios && (
        <Sec id="servicios" className="dcbw-min-precios">
          <h2 className="dcbw-h2">{titulo(data, "servicios")}</h2>
          <ul>
            {servicios.map((sv) => (
              <li key={sv.id}>
                <span className="dcbw-carta-nombre">{sv.nombre}</span>
                <Duracion min={sv.duracionMin} />
                <Precio n={sv.precio} />
              </li>
            ))}
          </ul>
          <Boton href={reservar} variante="fantasma">
            {copia(data, "portada", "portada.cta")}
          </Boton>
        </Sec>
      )}

      <Pie nombre={shop.name} />
    </div>
  );
}
