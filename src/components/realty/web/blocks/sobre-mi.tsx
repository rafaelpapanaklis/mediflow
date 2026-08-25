/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: SOBRE MÍ (solo modo AGENT).

   El texto largo del asesor. Existe porque en modo AGENT el sujeto de la
   página ES la persona: el 70% de los compradores considera la reputación
   del asesor antes de decidir y el 90% investiga en línea antes de
   llamar. Esta es la parte de la página que se lee cuando ya vieron una
   casa que les gusta y están decidiendo si confían.

   Los saltos de línea se respetan (se guardan como "\n" y se pintan como
   párrafos): quien escribe su historia la escribe en párrafos.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { foto, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { Foto } from "@/components/realty/web/pieces";

const ID = "sobre-mi";

export function BloqueSobreMi({ data }: { data: RealtyWebData }) {
  const { config } = data;
  const parrafos = config.historia
    .split(/\n{1,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parrafos.length === 0) return null;

  const v = variante(data, ID);
  const imagen = foto(data, v === "editorial" ? "retrato" : "portada");

  return (
    <Sec id={ID} variante={v}>
      <div className={`dcrw-historia dcrw-historia-${v || "columna"}`}>
        {imagen ? (
          <div className="dcrw-historia-foto">
            <Foto url={imagen} alt={data.cuenta.nombre} />
          </div>
        ) : null}
        <div className="dcrw-historia-texto">
          <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} />
          {parrafos.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </Sec>
  );
}
