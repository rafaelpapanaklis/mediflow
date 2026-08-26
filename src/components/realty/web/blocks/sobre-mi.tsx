/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: SOBRE MÍ (solo modo AGENT).

   El texto largo del asesor. Existe porque en modo AGENT el sujeto de la
   página ES la persona: el 70% de los compradores considera la reputación
   del asesor antes de decidir y el 90% investiga en línea antes de
   llamar. Esta es la parte de la página que se lee cuando ya vieron una
   casa que les gusta y están decidiendo si confían.

   Los saltos de línea se respetan (se guardan como "\n" y se pintan como
   párrafos): quien escribe su historia la escribe en párrafos.

   Variantes: `columna`, `editorial` (con retrato al lado) y la premium
   `reportaje` (editorial): SIN foto —el retrato ya manda en la portada—,
   el primer párrafo grande en serif con letra capital y el resto en una
   columna de lectura centrada.
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
  // `reportaje` no lleva foto: el retrato a sangre ya ocupó toda la portada
  // y repetirlo aquí sería enseñar la misma cara dos veces seguidas.
  const imagen = v === "reportaje" ? null : foto(data, v === "editorial" ? "retrato" : "portada");

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
            // La "entrada" es el primer párrafo del reportaje: grande, en
            // serif y con letra capital. Solo en esa variante lleva clase.
            <p key={i} className={v === "reportaje" && i === 0 ? "dcrw-historia-entrada" : undefined}>
              {p}
            </p>
          ))}
        </div>
      </div>
    </Sec>
  );
}
