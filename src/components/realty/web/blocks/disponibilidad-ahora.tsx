/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: QUÉ ESTÁ DISPONIBLE AHORA (solo modo OWNER).

   Un TABLERO, no un catálogo. Lo primero que quiere saber quien busca
   renta es qué está libre HOY, y lo segundo cuánto cuesta. El dueño no
   necesita presentarse: necesita que se vea de un vistazo qué hay.

   Lo que está rentado se enseña igual, atenuado y sin liga: enseñar solo
   lo libre hace que una página con todo ocupado parezca abandonada,
   mientras que un tablero con seis departamentos y uno libre se lee como
   "esto se renta rápido, pregunta ya".
   ═══════════════════════════════════════════════════════════════════════ */

import { precioAnunciado, rutaInmuebleWeb, ubicacionPublica, type RealtyWebData } from "@/lib/realty/landing";
import { copia, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { IcoFlecha } from "@/components/realty/web/pieces";

const ID = "disponibilidad-ahora";

export function BloqueDisponibilidad({ data }: { data: RealtyWebData }) {
  const lista = data.inmuebles.slice(0, 12);
  if (lista.length === 0) return null;
  const v = variante(data, ID) || "tablero";

  const etiquetaDe = (estatus: string) => {
    if (estatus === "DISPONIBLE") return copia(data, ID, "disponibilidad.libre");
    if (estatus === "APARTADO") return copia(data, ID, "disponibilidad.apartado");
    return copia(data, ID, "disponibilidad.rentado");
  };
  const cta = copia(data, ID, "disponibilidad.cta");

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} />
      <ul className={`dcrw-tablero dcrw-tablero-${v}`}>
        {lista.map((inm) => {
          const libre = inm.status === "DISPONIBLE";
          const donde = ubicacionPublica(inm);
          return (
            <li
              key={inm.ref}
              className={`dcrw-tablero-fila ${libre ? "dcrw-tablero-libre" : "dcrw-tablero-ocupado"}`}
            >
              <span className={`dcrw-tablero-luz dcrw-tablero-luz-${inm.status.toLowerCase()}`} aria-hidden="true" />
              <span className="dcrw-tablero-estado">{etiquetaDe(inm.status)}</span>
              <span className="dcrw-tablero-titulo">{inm.titulo}</span>
              {donde ? <span className="dcrw-tablero-donde">{donde}</span> : null}
              <span className="dcrw-tablero-precio">{precioAnunciado(inm)}</span>
              {libre ? (
                <a className="dcrw-tablero-cta" href={rutaInmuebleWeb(data.cuenta.slug, inm.ref)}>
                  {cta} <IcoFlecha size={12} />
                </a>
              ) : (
                <span className="dcrw-tablero-cta dcrw-tablero-cta-off" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </Sec>
  );
}
