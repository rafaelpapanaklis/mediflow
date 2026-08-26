/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: REQUISITOS PARA RENTAR (solo modo OWNER).

   Aval, comprobantes, depósito, póliza jurídica. Ponerlos ANTES de que
   alguien se ilusione es lo más amable que puede hacer un rentista: filtra
   a quien no califica sin hacerle perder el viaje, y le ahorra al dueño
   veinte mensajes que terminan en nada. En la plantilla "catálogo" van
   incluso arriba del listado, por eso mismo.

   Variantes: `lista`, `tarjeta`, `linea` y la premium `columnas`
   (disponibilidad): la misma lista con check, en dos o tres columnas
   dentro de una caja suave — el CSS vive en secundarios.css.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { IcoCheck } from "@/components/realty/web/pieces";

const ID = "requisitos-para-rentar";

export function BloqueRequisitos({ data }: { data: RealtyWebData }) {
  const { config } = data;
  if (config.requisitos.length === 0) return null;
  const v = variante(data, ID) || "lista";

  if (v === "linea") {
    return (
      <Sec id={ID} variante={v}>
        <p className="dcrw-requisitos-linea">
          <strong>{titulo(data, ID)}:</strong> {config.requisitos.join(" · ")}
        </p>
      </Sec>
    );
  }

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} />
      <ul className={`dcrw-requisitos dcrw-requisitos-${v}`}>
        {config.requisitos.map((r) => (
          <li key={r}>
            <IcoCheck />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Sec>
  );
}
