/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: INMUEBLES.

   El catálogo. Cuatro maquetados que SÍ cambian la lectura:
     · rejilla    → tres columnas. El inventario de una inmobiliaria.
     · filas      → una por renglón, foto chica. Lista para hojear rápido.
     · escaparate → una por fila a lo ancho, foto enorme. Pocas y caras.
     · preventa   → rejilla con el ESTATUS comercial muy visible
                    (disponible / apartado / vendido), que es lo que
                    pregunta quien compra en preventa.

   La insignia de "Recorrido virtual" la decide ESTE bloque y se la pasa a
   la tarjeta: es un argumento de venta y quien lo tiene quiere que se vea
   desde el listado, no al abrir la ficha.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  tieneRecorrido,
  type RealtyWebData,
} from "@/lib/realty/landing";
import { REALTY_PROPERTY_STATUS_UI } from "@/lib/realty/types";
import { copia, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { TarjetaInmueble } from "@/components/realty/web/pieces";

const ID = "inmuebles";

/** Cuántos se enseñan en la portada según el maquetado. */
const TOPE: Record<string, number> = {
  rejilla: 6,
  filas: 8,
  escaparate: 3,
  preventa: 6,
};

export function BloqueInmuebles({ data }: { data: RealtyWebData }) {
  const v = variante(data, ID) || "rejilla";
  const lista = data.inmuebles.slice(0, TOPE[v] ?? 6);
  if (lista.length === 0) return null;

  const cta = copia(data, ID, "inmuebles.cta");
  const etiquetaRecorrido = copia(data, ID, "inmuebles.recorrido");
  const verTodos = copia(data, ID, "inmuebles.todos");
  const conEstatus = v === "preventa";

  return (
    <Sec id={ID} variante={v}>
      <Encabezado
        kicker={copia(data, ID, "inmuebles.kicker")}
        titulo={titulo(data, ID)}
        subtitulo={subtitulo(data, ID)}
      />
      <div className={`dcrw-lista dcrw-lista-${v}`}>
        {lista.map((inm, i) => (
          <TarjetaInmueble
            key={inm.ref}
            inm={inm}
            href={rutaInmuebleWeb(data.cuenta.slug, inm.ref)}
            cta={cta}
            recorrido={tieneRecorrido(inm)}
            etiquetaRecorrido={etiquetaRecorrido}
            forma={v}
            prioridad={i === 0}
            estatus={conEstatus ? (REALTY_PROPERTY_STATUS_UI[inm.status]?.label ?? null) : null}
          />
        ))}
      </div>
      {data.totalInmuebles > lista.length ? (
        <p className="dcrw-lista-mas">
          <a className="dcrw-btn dcrw-btn-secundario" href={rutaPropiedadesWeb(data.cuenta.slug)}>
            {verTodos}
          </a>
        </p>
      ) : null}
    </Sec>
  );
}
