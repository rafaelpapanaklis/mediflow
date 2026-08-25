/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: ZONAS (solo modo AGENT).

   Las colonias que el asesor trabaja de verdad. Además de ser lo primero
   que pregunta un comprador, es el texto que hace que su página compita en
   búsquedas de zona ("asesor inmobiliario en Providencia") — y es
   exactamente por lo que en modo AGENCY cada asesor tiene subdirectorio
   propio: doce fichas hablando de las mismas colonias desde la MISMA
   página se canibalizan entre sí.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { Pastilla } from "@/components/realty/web/pieces";

const ID = "zonas";

export function BloqueZonas({ data }: { data: RealtyWebData }) {
  const { config } = data;
  if (config.zonas.length === 0) return null;
  const v = variante(data, ID) || "pastillas";

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} centrado={v === "pastillas"} />
      {v === "linea" ? (
        <p className="dcrw-zonas-linea">{config.zonas.join(" · ")}</p>
      ) : (
        <ul className="dcrw-zonas">
          {config.zonas.map((z) => (
            <li key={z}>
              <Pastilla>{z}</Pastilla>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}
