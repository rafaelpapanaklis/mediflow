/* ═══════════════════════════════════════════════════════════════════════
   EL BUSCADOR — SIN UNA LÍNEA DE JAVASCRIPT.

   Es un <form method="get"> de toda la vida que navega a
   /i/[slug]/propiedades con los filtros en la query. Se pinta en el
   servidor, funciona con el JS apagado, no bloquea nada y no cuesta un solo
   kilobyte al PSI móvil. Un buscador con estado en el cliente habría sido
   más "moderno" y mucho peor: es lo primero que ve alguien que llegó de
   Google buscando casa, y ahí lo que importa es que aparezca YA.

   Filtrar del lado del servidor tiene además un premio de SEO: cada
   combinación es una URL propia que Google puede indexar
   ("casas en renta en Providencia").

   Las opciones de zona salen del INVENTARIO REAL de la cuenta, no de un
   catálogo nacional: ofrecer "Polanco" a una inmobiliaria de Mérida es
   ofrecer una búsqueda que siempre devuelve cero.
   ═══════════════════════════════════════════════════════════════════════ */

import { rutaPropiedadesWeb } from "@/lib/realty/landing";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  type RealtyOperation,
  type RealtyPropertyKind,
} from "@/lib/realty/types";

export interface FiltrosWeb {
  op: string;
  tipo: string;
  zona: string;
  rec: string;
}

export const FILTROS_VACIOS: FiltrosWeb = { op: "", tipo: "", zona: "", rec: "" };

/** Los filtros que traía la URL, ya saneados contra los catálogos. */
export function leerFiltros(sp: Record<string, string | string[] | undefined>): FiltrosWeb {
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const op = uno(sp.op).toUpperCase();
  const tipo = uno(sp.tipo).toUpperCase();
  const rec = uno(sp.rec).replace(/\D/g, "").slice(0, 1);
  return {
    op: op in REALTY_OPERATION_LABELS ? op : "",
    tipo: tipo in REALTY_PROPERTY_KIND_LABELS ? tipo : "",
    // La zona se compara contra el inventario más adelante; aquí solo se
    // acota el largo para que no viaje una novela en la query.
    zona: uno(sp.zona).trim().slice(0, 80),
    rec: rec && Number(rec) > 0 ? rec : "",
  };
}

export function hayFiltros(f: FiltrosWeb): boolean {
  return Boolean(f.op || f.tipo || f.zona || f.rec);
}

export interface BuscadorProps {
  slug: string;
  /** Zonas reales del inventario ("Providencia", "Guadalajara"). */
  zonas: string[];
  /** Tipos de inmueble que la cuenta tiene de verdad. */
  tipos: RealtyPropertyKind[];
  /** Operaciones presentes en el inventario. */
  operaciones: RealtyOperation[];
  valores: FiltrosWeb;
  etiquetas: {
    operacion: string;
    tipo: string;
    zona: string;
    recamaras: string;
    buscar: string;
    limpiar: string;
  };
  /** Menos campos, para la barra de la portada. */
  compacto?: boolean;
}

export function BuscadorInmuebles({
  slug,
  zonas,
  tipos,
  operaciones,
  valores,
  etiquetas,
  compacto,
}: BuscadorProps) {
  const destino = rutaPropiedadesWeb(slug);

  return (
    <form
      className={`dcrw-buscador ${compacto ? "dcrw-buscador-compacto" : ""}`.trim()}
      method="get"
      action={destino}
      role="search"
    >
      <label className="dcrw-buscador-campo">
        <span>{etiquetas.operacion}</span>
        <select name="op" defaultValue={valores.op}>
          <option value="">Todas</option>
          {operaciones.map((o) => (
            <option key={o} value={o}>
              {REALTY_OPERATION_LABELS[o]}
            </option>
          ))}
        </select>
      </label>

      <label className="dcrw-buscador-campo">
        <span>{etiquetas.tipo}</span>
        <select name="tipo" defaultValue={valores.tipo}>
          <option value="">Todos</option>
          {tipos.map((k) => (
            <option key={k} value={k}>
              {REALTY_PROPERTY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      <label className="dcrw-buscador-campo">
        <span>{etiquetas.zona}</span>
        <select name="zona" defaultValue={valores.zona}>
          <option value="">Todas</option>
          {zonas.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>

      {compacto ? null : (
        <label className="dcrw-buscador-campo">
          <span>{etiquetas.recamaras}</span>
          <select name="rec" defaultValue={valores.rec}>
            <option value="">Las que sean</option>
            <option value="1">1 o más</option>
            <option value="2">2 o más</option>
            <option value="3">3 o más</option>
            <option value="4">4 o más</option>
          </select>
        </label>
      )}

      <div className="dcrw-buscador-acciones">
        <button type="submit" className="dcrw-btn dcrw-btn-primario">
          {etiquetas.buscar}
        </button>
        {hayFiltros(valores) ? (
          <a className="dcrw-buscador-limpiar" href={destino}>
            {etiquetas.limpiar}
          </a>
        ) : null}
      </div>
    </form>
  );
}
