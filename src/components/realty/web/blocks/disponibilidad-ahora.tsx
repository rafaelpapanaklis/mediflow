/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: QUÉ ESTÁ DISPONIBLE AHORA (solo modo OWNER).

   Un TABLERO, no un catálogo. Lo primero que quiere saber quien busca
   renta es qué está libre HOY, y lo segundo cuánto cuesta. El dueño no
   necesita presentarse: necesita que se vea de un vistazo qué hay.

   Lo que está rentado se enseña igual, atenuado y sin liga: enseñar solo
   lo libre hace que una página con todo ocupado parezca abandonada,
   mientras que un tablero con seis departamentos y uno libre se lee como
   "esto se renta rápido, pregunta ya".

   Variantes: `tablero` (filas) y la premium `fichas` (disponibilidad):
   rejilla de fichas con foto 4:3, la pastilla de estatus encima, el PRECIO
   primero y grande, la colonia, el título y desde cuándo está en línea.
   Lo ocupado sigue saliendo, atenuado y sin liga. Sin WhatsApp ni
   insignia de recorrido a propósito: este bloque solo pinta `inmuebles`.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  fotoPortada,
  precioAnunciado,
  rutaInmuebleWeb,
  ubicacionPublica,
  type RealtyWebData,
  type RealtyWebInmuebleDTO,
} from "@/lib/realty/landing";
import { REALTY_PROPERTY_KIND_LABELS } from "@/lib/realty/types";
import { copia, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { Foto, IcoFlecha, SinFoto } from "@/components/realty/web/pieces";

const ID = "disponibilidad-ahora";

/**
 * "agosto de 2026". Con zona horaria fija: la página es ISR y se genera en
 * un servidor en UTC, y un inmueble publicado el 1 a las 00:30 de México
 * NO es de "julio" porque en Londres ya era agosto.
 */
const MES_ANIO = new Intl.DateTimeFormat("es-MX", {
  month: "long",
  year: "numeric",
  timeZone: "America/Mexico_City",
});

/** El mes y año de publicación, o null si la fecha no se puede leer. */
function enLineaDesde(inm: Pick<RealtyWebInmuebleDTO, "publicadoEn">): string | null {
  const fecha = new Date(inm.publicadoEn);
  if (Number.isNaN(fecha.getTime())) return null;
  return MES_ANIO.format(fecha);
}

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

  if (v === "fichas") {
    const desde = copia(data, ID, "disponibilidad.desde");
    return (
      <Sec id={ID} variante={v}>
        <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} />
        <ul className="dcrw-dispo">
          {lista.map((inm, i) => {
            const libre = inm.status === "DISPONIBLE";
            const href = libre ? rutaInmuebleWeb(data.cuenta.slug, inm.ref) : null;
            const portada = fotoPortada(inm);
            const tipo = REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "Inmueble";
            const donde = ubicacionPublica(inm);
            const mes = enLineaDesde(inm);
            // Tres tonos y no cuatro: vendido y rentado son lo mismo para
            // quien busca renta — ya no está.
            const tono = libre ? "libre" : inm.status === "APARTADO" ? "apartado" : "ocupado";
            const foto = portada ? (
              <Foto url={portada.url} alt={inm.titulo} width={portada.width} height={portada.height} prioridad={i === 0} />
            ) : (
              <SinFoto etiqueta={tipo} />
            );
            const estatus = <span className={`dcrw-dispo-estatus dcrw-dispo-estatus-${tono}`}>{etiquetaDe(inm.status)}</span>;
            return (
              <li key={inm.ref} className={`dcrw-dispo-ficha ${libre ? "dcrw-dispo-libre" : "dcrw-dispo-ocupada"}`}>
                {href ? (
                  <a href={href} className="dcrw-dispo-foto" aria-label={inm.titulo}>
                    {foto}
                    {estatus}
                  </a>
                ) : (
                  <div className="dcrw-dispo-foto">
                    {foto}
                    {estatus}
                  </div>
                )}
                <p className="dcrw-precio">{precioAnunciado(inm)}</p>
                {donde ? <p className="dcrw-dispo-donde">{donde}</p> : null}
                <h3 className="dcrw-dispo-titulo">{href ? <a href={href}>{inm.titulo}</a> : inm.titulo}</h3>
                {mes ? (
                  <p className="dcrw-dispo-desde">
                    {desde} {mes}
                  </p>
                ) : null}
                {href ? (
                  <a className="dcrw-dispo-cta" href={href}>
                    {cta} <IcoFlecha size={12} />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Sec>
    );
  }

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
