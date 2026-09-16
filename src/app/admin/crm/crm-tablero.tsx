"use client";

// ═══════════════════════════════════════════════════════════════════════
// El tablero: una columna por etapa, las tarjetas se arrastran.
//
// Aquí SÓLO se arrastra y se pinta. Quién mueve de verdad es el padre
// (crm-client), que es el mismo que atiende el selector de etapa de la
// lista y de la ficha: así el cambio pasa siempre por el mismo camino —
// pintado optimista, acción, y reversión si el servidor dice que no.
//
// Arrastrar no puede ser el ÚNICO camino: no funciona con teclado ni bien
// en móvil. Por eso la vista de lista trae un selector de etapa que hace
// exactamente lo mismo.
//
// ── EL TABLERO NO PAGINA, Y POR ESO DICE LO QUE NO ENSEÑA ──────────────
// Repartir por columna necesita el conjunto, así que aquí no hay páginas:
// hay un tope (CRM_TABLERO_MAX) y, en cuanto se pasa, la pantalla lo dice
// con los números exactos y manda a la lista, que sí llega a todas. Las
// cuentas de cada columna vienen de la BASE (`totales`), no de contar las
// tarjetas pintadas: si salieran de las tarjetas, una columna con 400
// diría "12" y el embudo mentiría justo cuando más importa.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { crmEtapa, CRM_ETAPAS } from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import { CrmTarjeta, crmFmtMxn } from "./crm-ui";

/** Tope de tarjetas pintadas por columna: cientos de nodos traban el arrastre. */
const TOPE_POR_COLUMNA = 60;

/**
 * El color del tono de la etapa. Sirve para la línea de acento de cada
 * columna: sin ella las ocho columnas son ocho cajas grises iguales y hay
 * que leer el encabezado para saber dónde está uno. Es el MISMO tono que
 * ya usa la insignia de la etapa (CrmEtapaBadge), para que el color diga
 * lo mismo en el tablero, en la lista y en la ficha.
 */
const COLOR_TONO: Record<string, string> = {
  neutral: "var(--border-strong)",
  info: "var(--info)",
  brand: "var(--brand)",
  warning: "var(--warning)",
  success: "var(--success)",
  danger: "var(--danger)",
};

export function CrmTablero({
  filas,
  ahora,
  totales,
  mover,
  alVerLista,
  alEditar,
  alTextos,
}: {
  filas: CrmProspectoDTO[];
  ahora: Date;
  /**
   * Cuántos hay DE VERDAD en cada etapa con los filtros puestos, contado
   * en la base. Las tarjetas que llegan pueden ser menos (ver el tope de
   * arriba); el número de la columna sale siempre de aquí.
   */
  totales: Record<string, number>;
  mover: (id: string, etapa: string) => void;
  alVerLista: (etapa: string) => void;
  /** Abre el formulario EN SITIO, sin salir del tablero (ver crm-client). */
  alEditar: (p: CrmProspectoDTO) => void;
  alTextos?: (p: CrmProspectoDTO) => void;
}) {
  const [sobre, setSobre] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);

  const porEtapa = useMemo(() => {
    const mapa = new Map<string, CrmProspectoDTO[]>();
    for (const e of CRM_ETAPAS) mapa.set(e.id, []);
    for (const f of filas) {
      const id = crmEtapa(f.stage).id;
      // Una etapa que ya no está en el catálogo (edición a mano en la base)
      // se queda con su propia columna al final en vez de perder la fila.
      if (!mapa.has(id)) mapa.set(id, []);
      mapa.get(id)!.push(f);
    }
    return mapa;
  }, [filas]);

  // Las del catálogo, y detrás las huérfanas que hayan aparecido — tanto
  // en las tarjetas que llegaron como en las cuentas de la base, porque
  // una etapa fuera de catálogo puede tener 300 filas y ninguna en esta
  // tanda de tarjetas.
  const columnas = useMemo(() => {
    const conocidas = CRM_ETAPAS.map((e) => e.id);
    const extra = Array.from(
      new Set([...porEtapa.keys(), ...Object.keys(totales ?? {})]),
    ).filter((k) => conocidas.indexOf(k as any) === -1);
    return [...conocidas, ...extra];
  }, [porEtapa, totales]);

  function soltar(etapa: string, id: string | null) {
    setSobre(null);
    setArrastrando(null);
    if (!id) return;
    const p = filas.find((f) => f.id === id);
    if (!p || crmEtapa(p.stage).id === etapa) return;
    mover(id, etapa);
  }

  return (
    <div
      className="scrollbar-thin"
      style={{
        display: "flex",
        gap: 10,
        overflowX: "auto",
        paddingBottom: 8,
        alignItems: "flex-start",
      }}
    >
      {columnas.map((etapaId) => {
        const etapa = crmEtapa(etapaId);
        const lista = porEtapa.get(etapaId) ?? [];
        // El total manda sobre lo pintado. Si por lo que sea no llegó
        // (una etapa huérfana sin cuenta), se cae a lo que hay: nunca a 0.
        const total = totales?.[etapaId] ?? lista.length;
        const faltan = Math.max(0, total - Math.min(lista.length, TOPE_POR_COLUMNA));
        const valor = lista.reduce((s, p) => s + (Number(p.monthlyValue) || 0), 0);
        const activa = sobre === etapaId;
        return (
          <section
            key={etapaId}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (sobre !== etapaId) setSobre(etapaId);
            }}
            onDragLeave={() => setSobre((s) => (s === etapaId ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              soltar(etapaId, e.dataTransfer.getData("text/plain") || arrastrando);
            }}
            style={{
              width: 258,
              flexShrink: 0,
              background: activa ? "var(--brand-soft)" : "var(--bg-elev-2)",
              border: `1px solid ${activa ? "var(--brand)" : "var(--border-soft)"}`,
              borderRadius: 12,
              padding: 8,
              transition: "background .12s, border-color .12s",
            }}
          >
            <header style={{ padding: "4px 4px 10px" }}>
              {/* La línea de acento con el tono de la etapa: es lo que hace
                  que las ocho columnas se distingan sin leerlas. */}
              <div
                aria-hidden
                style={{
                  height: 3,
                  borderRadius: 99,
                  marginBottom: 8,
                  background: COLOR_TONO[etapa.tono] ?? COLOR_TONO.neutral,
                  opacity: etapa.terminal ? 0.55 : 1,
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: "var(--text-1)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {etapa.label}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-3)",
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 99,
                    padding: "1px 7px",
                  }}
                >
                  {total}
                </span>
              </div>
              <div
                style={{ fontSize: 10.5, color: "var(--text-4)", marginTop: 3, lineHeight: 1.3 }}
                title={etapa.ayuda}
              >
                {valor > 0 ? `${crmFmtMxn(valor)} al mes` : etapa.ayuda}
              </div>
            </header>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 60 }}>
              {lista.length === 0 && total === 0 && (
                <div
                  style={{
                    border: "1px dashed var(--border-soft)",
                    borderRadius: 9,
                    padding: "14px 8px",
                    textAlign: "center",
                    fontSize: 11,
                    color: "var(--text-4)",
                  }}
                >
                  Arrastra aquí
                </div>
              )}
              {lista.slice(0, TOPE_POR_COLUMNA).map((p) => (
                <CrmTarjeta
                  key={p.id}
                  p={p}
                  ahora={ahora}
                  arrastrable
                  alArrastrar={setArrastrando}
                  alEditar={alEditar}
                  alTextos={alTextos}
                />
              ))}
              {faltan > 0 && (
                <button
                  type="button"
                  onClick={() => alVerLista(etapaId)}
                  title={`Ver los ${total} de "${etapa.label}" en la lista, que sí llega a todos`}
                  style={{
                    border: "1px dashed var(--border-soft)",
                    background: "transparent",
                    borderRadius: 9,
                    padding: "10px 8px",
                    fontSize: 11.5,
                    color: "var(--text-2)",
                    cursor: "pointer",
                  }}
                >
                  y {faltan} más — verlos en la lista
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
