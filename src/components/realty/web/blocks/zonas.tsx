/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: ZONAS (solo modo AGENT).

   Las colonias que el asesor trabaja de verdad. Además de ser lo primero
   que pregunta un comprador, es el texto que hace que su página compita en
   búsquedas de zona ("asesor inmobiliario en Providencia") — y es
   exactamente por lo que en modo AGENCY cada asesor tiene subdirectorio
   propio: doce fichas hablando de las mismas colonias desde la MISMA
   página se canibalizan entre sí.

   Variantes: `pastillas`, `linea` y la premium `frase` (editorial): una
   sola oración en serif —"Trabajo en Providencia, Chapalita y Andares."—
   con el título como rótulo en versalitas, sin encabezado aparte.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { Pastilla } from "@/components/realty/web/pieces";

const ID = "zonas";

/**
 * "A, B y C". Con una sola zona, solo esa. La conjunción se vuelve "e"
 * delante de una zona que empieza con i/hi ("Chapalita e Italia", "Centro
 * e Hidalgo") — salvo "hie", que conserva la "y" ("y Hierbabuena").
 */
function enFrase(zonas: string[]): string {
  if (zonas.length <= 1) return zonas[0] ?? "";
  const ultima = zonas[zonas.length - 1];
  const conjuncion = /^h?i(?!e)/i.test(ultima) ? "e" : "y";
  return `${zonas.slice(0, -1).join(", ")} ${conjuncion} ${ultima}`;
}

export function BloqueZonas({ data }: { data: RealtyWebData }) {
  const { config } = data;
  if (config.zonas.length === 0) return null;
  const v = variante(data, ID) || "pastillas";

  return (
    <Sec id={ID} variante={v}>
      {v !== "frase" ? (
        <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} centrado={v === "pastillas"} />
      ) : null}
      {v === "frase" ? (
        <p className="dcrw-zonas-frase">
          <span className="dcrw-zonas-frase-rotulo dcrw-kicker">{titulo(data, ID)}</span>{" "}
          {enFrase(config.zonas)}.
        </p>
      ) : v === "linea" ? (
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
