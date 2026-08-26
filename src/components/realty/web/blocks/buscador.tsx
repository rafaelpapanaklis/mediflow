/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: BUSCADOR.

   Un <form method="get"> que navega a /i/[slug]/propiedades. Sin JavaScript
   (ver buscador-form.tsx). Las opciones salen del INVENTARIO REAL de la
   cuenta: ofrecer un filtro que siempre devuelve cero es peor que no
   ofrecerlo.

   Variantes:
     · (vacía)   → sección normal con encabezado.
     · compacto  → menos campos, para la barra de la portada.
     · flotante  (AGENCY/galeria) → el MISMO JSX: la sección sale con
                  data-variante="flotante" (lo pone Sec) y el encabezado
                  es null porque la plantilla deja título y bajada vacíos.
                  Todo lo demás —subirlo sobre el borde de la portada de
                  cine, quitarle el aire y el fondo gris— es CSS en
                  blocks/inmuebles.css.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import type { RealtyOperation, RealtyPropertyKind } from "@/lib/realty/types";
import { copia, subtitulo, titulo, variante, Encabezado, Sec } from "@/components/realty/web/helpers";
import { BuscadorInmuebles, FILTROS_VACIOS } from "@/components/realty/web/buscador-form";

const ID = "buscador";

/** Zonas, tipos y operaciones que la cartera tiene de verdad. */
export function opcionesDelInventario(data: RealtyWebData) {
  const zonas = new Set<string>();
  const tipos = new Set<RealtyPropertyKind>();
  const operaciones = new Set<RealtyOperation>();
  for (const inm of data.inmuebles) {
    if (inm.colonia) zonas.add(inm.colonia);
    if (inm.ciudad) zonas.add(inm.ciudad);
    tipos.add(inm.kind);
    operaciones.add(inm.operation);
  }
  return {
    zonas: Array.from(zonas).sort((a, b) => a.localeCompare(b, "es-MX")),
    tipos: Array.from(tipos),
    operaciones: Array.from(operaciones),
  };
}

export function BloqueBuscador({ data }: { data: RealtyWebData }) {
  const v = variante(data, ID);
  const { zonas, tipos, operaciones } = opcionesDelInventario(data);

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} centrado />
      <BuscadorInmuebles
        slug={data.cuenta.slug}
        zonas={zonas}
        tipos={tipos}
        operaciones={operaciones}
        valores={FILTROS_VACIOS}
        compacto={v === "compacto"}
        etiquetas={{
          operacion: copia(data, ID, "buscador.operacion"),
          tipo: copia(data, ID, "buscador.tipo"),
          zona: copia(data, ID, "buscador.zona"),
          recamaras: copia(data, ID, "buscador.recamaras"),
          buscar: copia(data, ID, "buscador.buscar"),
          limpiar: copia(data, ID, "buscador.limpiar"),
        }}
      />
    </Sec>
  );
}
