/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: SUCURSALES (solo modo AGENCY).

   Saber que existe un lugar físico al que ir es media venta cuando lo que
   se decide es entregar un enganche. Por eso la matriz va marcada y cada
   oficina lleva su "cómo llegar" — un enlace a Google Maps, NO un iframe:
   el mapa embebido vive en su propio bloque y solo se monta si alguien lo
   pide (ver mapa-cliente.tsx).
   ═══════════════════════════════════════════════════════════════════════ */

import { ligaMapaDireccion, type RealtyWebData } from "@/lib/realty/landing";
import { copia, foto, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { Foto, IcoMapa, Pastilla } from "@/components/realty/web/pieces";

const ID = "sucursales";

export function BloqueSucursales({ data }: { data: RealtyWebData }) {
  if (data.sucursales.length === 0) return null;
  const v = variante(data, ID) || "lista";
  const comoLlegar = copia(data, ID, "sucursales.comoLlegar");
  const etiquetaMatriz = copia(data, ID, "sucursales.matriz");
  const imagen = foto(data, "oficina");

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} />
      <ul className={`dcrw-sucursales dcrw-sucursales-${v}`}>
        {data.sucursales.map((s) => {
          const liga = ligaMapaDireccion(s.direccion);
          return (
            <li className="dcrw-sucursal" key={`${s.nombre}-${s.direccion ?? ""}`}>
              {v === "tarjetas" && imagen ? (
                <div className="dcrw-sucursal-foto">
                  <Foto url={imagen} alt={s.nombre} />
                </div>
              ) : null}
              <div className="dcrw-sucursal-cuerpo">
                <h3 className="dcrw-sucursal-nombre">
                  {s.nombre}
                  {s.esMatriz ? <Pastilla tono="brand">{etiquetaMatriz}</Pastilla> : null}
                </h3>
                {s.direccion ? <p className="dcrw-sucursal-dir">{s.direccion}</p> : null}
                {s.telefono ? (
                  <p className="dcrw-sucursal-tel">
                    <a href={`tel:${s.telefono}`}>{s.telefono}</a>
                  </p>
                ) : null}
                {liga ? (
                  <a
                    className="dcrw-sucursal-liga"
                    href={liga}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IcoMapa size={14} />
                    {comoLlegar}
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Sec>
  );
}
