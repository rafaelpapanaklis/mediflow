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
