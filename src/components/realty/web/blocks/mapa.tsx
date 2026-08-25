/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: MAPA.

   Dónde está la oficina. Se prefiere la MATRIZ de la lista de sucursales;
   si la cuenta no capturó ninguna, cae a la dirección de la cuenta.

   El iframe no se monta con la página: ver mapa-cliente.tsx.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  embedMapaDireccion,
  ligaMapaDireccion,
  type RealtyWebData,
} from "@/lib/realty/landing";
import { copia, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { MapaBajoDemanda } from "@/components/realty/web/mapa-cliente";

const ID = "mapa";

export function BloqueMapa({ data }: { data: RealtyWebData }) {
  const v = variante(data, ID);
  const matriz = data.sucursales.find((s) => s.esMatriz) ?? data.sucursales[0] ?? null;
  // Una OFICINA es una dirección comercial y se enseña con zoom de calle. La
  // dirección de la CUENTA no: en modo OWNER el titular es un particular y
  // puede ser su casa, y ahí no hay ningún interruptor equivalente al
  // showExactAddress del inmueble. Sin oficina capturada se baja el zoom y se
  // avisa de que la ubicación es aproximada.
  const esOficina = Boolean(matriz?.direccion);
  const direccion =
    matriz?.direccion ??
    [data.cuenta.direccion, data.cuenta.ciudad, data.cuenta.estado].filter(Boolean).join(", ");
  if (!direccion) return null;

  const src = embedMapaDireccion(direccion, esOficina ? 16 : 13);
  if (!src) return null;

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} />
      <MapaBajoDemanda
        src={src}
        titulo={`Ubicación de ${data.cuenta.nombre}`}
        ubicacion={direccion}
        etiquetaAbrir={copia(data, ID, "mapa.abrir")}
        etiquetaComoLlegar={copia(data, ID, "mapa.comoLlegar")}
        ligaComoLlegar={ligaMapaDireccion(direccion)}
        aviso={esOficina ? null : copia(data, ID, "mapa.aproximado") || null}
      />
    </Sec>
  );
}
