/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: CREDENCIALES (modos AGENT y AGENCY).

   🔴 EL DIFERENCIADOR MÁS BARATO QUE EXISTE EN ESTE MERCADO.

   Solo el 10% de los asesores inmobiliarios mexicanos está capacitado y
   apenas el 15% pertenece a una asociación. Enseñar el EC0110.02, la AMPI o
   el registro estatal —ya obligatorio en Nuevo León y Durango— separa a
   quien lo tiene del resto sin gastar un peso. Y con los resúmenes de IA
   comiéndose los clics, E-E-A-T pesa cada vez más: una señal de
   experiencia verificable en la propia página es exactamente lo que esos
   sistemas buscan citar.

   La LICENCIA de la cuenta se pinta aparte y SOLO si sigue vigente
   (aCuentaPublica la deja en null cuando está vencida): presumir una
   licencia caducada es peor que no enseñar ninguna.

   Variantes: `tira`, `linea`, `sello` y la premium `prosa` (editorial): ni
   tarjetas ni iconos, un solo párrafo en serif cursiva con el título como
   kicker — las acreditaciones dichas, no enlistadas.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { copia, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { IcoCheck } from "@/components/realty/web/pieces";

const ID = "credenciales";

export function BloqueCredenciales({ data }: { data: RealtyWebData }) {
  const { config } = data;
  const licencia = data.cuenta.licencia;
  if (config.credenciales.length === 0 && !licencia) return null;

  const v = variante(data, ID) || "tira";

  if (v === "prosa") {
    // Una sola oración separada por " · ": la licencia primero (es la que
    // pesa legalmente) y después cada credencial con su folio y detalle
    // entre paréntesis. Sin Encabezado: el título va como kicker y la
    // bajada no cabe en una frase.
    const t = titulo(data, ID);
    const partes: string[] = [];
    if (licencia) {
      partes.push(
        `${copia(data, ID, "credenciales.licencia")} ${licencia.numero}${licencia.estado ? " · " + licencia.estado : ""}`,
      );
    }
    for (const c of config.credenciales) {
      partes.push(
        `${c.titulo}${c.folio ? ", " + copia(data, ID, "credenciales.folio") + " " + c.folio : ""}${c.detalle ? " (" + c.detalle + ")" : ""}`,
      );
    }
    return (
      <Sec id={ID} variante={v}>
        <div className="dcrw-credenciales-prosa">
          {t ? <p className="dcrw-kicker">{t}</p> : null}
          <p className="dcrw-credenciales-texto">{partes.join(" · ")}</p>
        </div>
      </Sec>
    );
  }

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} centrado={v !== "linea"} />
      <ul className={`dcrw-credenciales dcrw-credenciales-${v}`}>
        {licencia ? (
          <li className="dcrw-credencial dcrw-credencial-licencia">
            <IcoCheck />
            <div>
              <strong>{copia(data, ID, "credenciales.licencia")}</strong>
              <span>
                {licencia.numero}
                {licencia.estado ? ` · ${licencia.estado}` : ""}
              </span>
            </div>
          </li>
        ) : null}
        {config.credenciales.map((c) => (
          <li className="dcrw-credencial" key={`${c.titulo}-${c.folio ?? ""}`}>
            <IcoCheck />
            <div>
              <strong>{c.titulo}</strong>
              {c.folio ? (
                <span>
                  {copia(data, ID, "credenciales.folio")} {c.folio}
                </span>
              ) : null}
              {c.detalle ? <span>{c.detalle}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </Sec>
  );
}
