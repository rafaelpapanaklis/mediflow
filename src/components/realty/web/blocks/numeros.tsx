/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: NÚMEROS DE LA EMPRESA (solo modo AGENCY).

   "18 años", "430 operaciones cerradas", "2 400 familias". Es texto libre a
   propósito: cada empresa presume lo suyo y nada de esto se puede calcular
   desde la base sin mentir. Por eso NO va al JSON-LD — un dato que solo
   afirma el interesado no es una señal estructurada, es publicidad.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";

const ID = "numeros";

export function BloqueNumeros({ data }: { data: RealtyWebData }) {
  const { config } = data;
  if (config.numeros.length === 0) return null;
  const v = variante(data, ID) || "tira";

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} centrado />
      <ul className={`dcrw-numeros dcrw-numeros-${v}`}>
        {config.numeros.map((n) => (
          <li key={`${n.valor}-${n.etiqueta}`}>
            <strong className="dcrw-numero-valor">{n.valor}</strong>
            <span className="dcrw-numero-etiqueta">{n.etiqueta}</span>
          </li>
        ))}
      </ul>
    </Sec>
  );
}
