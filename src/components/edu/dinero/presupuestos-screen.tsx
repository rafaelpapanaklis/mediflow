"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, FileText, Plus, Search, Trash2, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import {
  EDU_MAX_CHARGE_ITEMS,
  eduMoney,
  parseEduMoneyCents,
  type EduPrecioResuelto,
} from "@/lib/edu/dinero-core";
import {
  EDU_QUOTE_MAX_ITEMS,
  EDU_QUOTE_STATUSES,
  EDU_QUOTE_STATUS_DESCRIPTIONS,
  EDU_QUOTE_STATUS_LABELS,
  EDU_QUOTE_TRANSITIONS,
  eduQuoteLineTotal,
  eduQuoteTotales,
  type EduQuoteEstadoVisible,
  type EduQuoteRow,
  type EduQuotesPage,
  type EduQuoteStatus,
} from "@/lib/edu/presupuestos-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * /instituto/caja/presupuestos — LA FILA 26 DEL COMPARATIVO CON EL
 * DENTAL, ESCRITA EN EDU.
 *
 * «No hay `EduQuote`. Lo más parecido es la etapa de autorización PLAN,
 * que es un gate de firma sin partidas ni importe.» Hasta hoy el
 * instituto no podía decirle a un paciente cuánto va a costar su
 * tratamiento sin escribirlo en un papel aparte.
 *
 * 🔴 ESTA PANTALLA NO INVENTA NI UN PRECIO. Las partidas se eligen del
 * TARIFARIO —con la lista que le toque a ese paciente, resuelta por el
 * servidor en `/api/instituto/caja/tarifa`— y el precio unitario viene de
 * ahí. Lo único que se teclea es la cantidad, el descuento y, para una
 * partida libre, su importe: exactamente el mismo reparto que la caja.
 *
 * 🔴 Y LOS TOTALES LOS VUELVE A CALCULAR EL SERVIDOR. Lo que se pinta
 * aquí sale de `eduQuoteTotales`, la MISMA función pura que corre en
 * `presupuestos.ts`: la pantalla y la base no pueden discrepar porque no
 * hay dos aritméticas, hay una.
 *
 * 🔴 EL ESTADO MANDA SOBRE LOS BOTONES, y las transiciones son un DATO
 * (`EDU_QUOTE_TRANSITIONS`), no una cadena de `if`. Un aceptado no se
 * des-acepta ni aquí ni en el servidor, y por el mismo motivo escrito en
 * los dos sitios: dejaría un cobro colgando de una aceptación que ya no
 * existe.
 * ═══════════════════════════════════════════════════════════════════════
 */

const TAG_BY_ESTADO: Record<EduQuoteEstadoVisible, string> = {
  BORRADOR: "edu-tag--muted",
  PRESENTADO: "edu-tag--info",
  ACEPTADO: "edu-tag--ok",
  RECHAZADO: "edu-tag--danger",
  CANCELADO: "edu-tag--muted",
  VENCIDO: "edu-tag--warn",
};

const ESTADO_LABEL: Record<EduQuoteEstadoVisible, string> = {
  ...EDU_QUOTE_STATUS_LABELS,
  VENCIDO: "Vencido",
};

/** Retardo del buscador de pacientes. El mismo que usa la caja. */
const EDU_BUSQUEDA_RETARDO_MS = 300;

export interface EduPresupuestosScreenProps {
  page: EduQuotesPage;
  maxRows: number;
  canCharge: boolean;
  /** La sede no está elegida y hay varias: convertir a cobro rebotaría. */
  sedeAviso: string | null;
  /** El origen absoluto, para armar la liga pública que se copia. */
  origin: string;
}

export function EduPresupuestosScreen({
  page,
  maxRows,
  canCharge,
  sedeAviso,
  origin,
}: EduPresupuestosScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [q, setQ] = useState(page.filters.q ?? "");
  const [flash, setFlash] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const { rows, truncated, filters } = page;
  const detalle = detalleId ? (rows.find((r) => r.id === detalleId) ?? null) : null;
  const hayFiltros = Boolean(filters.q || filters.status || filters.patientId);

  function aplicar(next: { q?: string; estado?: string }) {
    const params = new URLSearchParams();
    const term = next.q ?? filters.q;
    const estado = next.estado ?? filters.status ?? "";
    if (term) params.set("q", term);
    if (estado) params.set("estado", estado);
    if (filters.patientId) params.set("paciente", filters.patientId);
    const qs = params.toString();
    startNav(() => router.replace(`/instituto/caja/presupuestos${qs ? `?${qs}` : ""}`, { scroll: false }));
  }

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setNuevo(false);
    setDetalleId(null);
    startNav(() => router.refresh());
  }

  // Los tres números que la dirección pregunta: cuánto hay propuesto sin
  // respuesta, cuánto se aceptó y cuánto se quedó sin convertir en cobro.
  const kpis = useMemo(() => {
    let presentadoCents = 0;
    let aceptadoCents = 0;
    let sinCobrar = 0;
    for (const r of rows) {
      if (r.estadoVisible === "PRESENTADO") presentadoCents += r.totalCents;
      if (r.status === "ACEPTADO") {
        aceptadoCents += r.totalCents;
        if (!r.chargeId) sinCobrar += 1;
      }
    }
    return { presentadoCents, aceptadoCents, sinCobrar };
  }, [rows]);

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-kpis">
        <div className="edu-kpi">
          <span className="edu-kpi__label">Presentado y sin respuesta</span>
          <span className="edu-kpi__value">{eduMoney(kpis.presentadoCents)}</span>
          <span className="edu-kpi__note">Lo que el paciente todavía no aceptó ni rechazó</span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Aceptado</span>
          <span className="edu-kpi__value">{eduMoney(kpis.aceptadoCents)}</span>
          <span className="edu-kpi__note">
            {/* 🔴 El número que se pierde sin esta pantalla: un presupuesto
                aceptado que nadie convirtió en cobro es trabajo dicho que
                sí y no facturado. */}
            {kpis.sinCobrar > 0
              ? `${kpis.sinCobrar} sin convertir todavía en cobro`
              : "Todos convertidos en cobro"}
          </span>
        </div>
      </div>

      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ q: q.trim() });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-presu-q">
            Buscar
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-presu-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Folio, título o nombre del paciente"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-presu-estado">
            Estado
          </label>
          <select
            id="edu-presu-estado"
            className="edu-input edu-input--sm"
            value={filters.status ?? ""}
            onChange={(e) => aplicar({ estado: e.target.value })}
          >
            <option value="">Todos</option>
            {EDU_QUOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_QUOTE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace("/instituto/caja/presupuestos", { scroll: false }));
            }}
          >
            <X size={15} />
            Limpiar
          </button>
        )}
      </form>

      {/* 🔴 QUÉ SE ESTÁ VIENDO, cuando se llega desde la ficha con
          `?paciente=`. Sin esta línea, la lista parece la del instituto
          entero y quien la mira cuenta mal: es el mismo error que la caja
          arregló diciendo con letras qué se listó de verdad. */}
      {filters.patientId && rows.length > 0 && (
        <p className="edu-note">
          Solo los presupuestos de <strong>{rows[0].patientName}</strong>. Quita el filtro con
          «Limpiar» para ver los del instituto.
        </p>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Buscando…"
            : `${rows.length} ${rows.length === 1 ? "presupuesto" : "presupuestos"}${
                truncated ? ` (se muestran los primeros ${maxRows})` : ""
              }`}
        </span>
        <span className="edu-actions">
          <Link href="/instituto/caja" className="edu-btn edu-btn--ghost edu-btn--sm">
            Volver a Caja
          </Link>
          {canCharge && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => {
                setFlash(null);
                setNuevo(true);
              }}
            >
              <Plus size={16} />
              Nuevo presupuesto
            </button>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {filters.patientId
              ? "Este paciente todavía no tiene presupuestos"
              : hayFiltros
                ? "Ningún presupuesto con esos filtros"
                : "Todavía no hay presupuestos"}
          </p>
          <p className="edu-empty__detail">
            Un presupuesto es lo que el paciente se lleva a su casa para decidir: las partidas salen
            del tarifario, se le manda una liga y él acepta desde su teléfono. Cuando lo acepta, se
            convierte en cobro con los precios que aceptó — no con los de ese día.
          </p>
        </div>
      ) : (
        <div className="edu-tablewrap">
          {/* `edu-tablewrap` no es decoración: es lo que hace que esta lista
             se mida a SÍ MISMA (`@container`) en vez de a la ventana, y lo
             que hace que se DESPLACE en vez de recortar si no cabe. Sin él,
             la forma renglón de esta tabla no se estrena nunca. */}
          <div className="edu-table edu-table--presupuestos">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Folio</span>
              <span>Paciente</span>
              <span>Concepto</span>
              <span>Total</span>
              <span>Estado</span>
              <span />
            </div>

            {rows.map((r) => (
              <div
                key={r.id}
                className={`edu-row ${
                  r.status === "CANCELADO" || r.status === "RECHAZADO" ? "edu-row--off" : ""
                }`}
              >
                <div className="edu-cell">
                  <span className="edu-cell__label">Folio</span>
                  <span className="edu-cell__value edu-cell__value--strong">{r.folio}</span>
                  {r.chargeId && (
                    <span className="edu-cell__sub">Ya convertido en cobro</span>
                  )}
                </div>

                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Paciente</span>
                  <span className="edu-cell__value">
                    <EduPersonaLink kind="paciente" id={r.patientId}>
                      {r.patientName}
                    </EduPersonaLink>
                  </span>
                  <span className="edu-cell__sub">{r.patientFolio}</span>
                </div>

                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Concepto</span>
                  <span className="edu-cell__value">{r.title}</span>
                  <span className="edu-cell__sub">
                    {r.items.length} {r.items.length === 1 ? "partida" : "partidas"}
                    {/* 🔴 OLA C·fin 2 · el DÍA lo escribe el servidor en la
                        zona del instituto. Recortar el ISO a diez
                        caracteres pinta el día en UTC, y el fin de un día
                        mexicano cae ya en el siguiente. */}
                    {r.validUntilDia ? ` · vale hasta el ${r.validUntilDia}` : ""}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Total</span>
                  <span className="edu-cell__value edu-precio">{eduMoney(r.totalCents)}</span>
                  {r.discountCents > 0 && (
                    <span className="edu-cell__sub">−{eduMoney(r.discountCents)} de descuento</span>
                  )}
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  <span className={`edu-tag ${TAG_BY_ESTADO[r.estadoVisible]}`}>
                    {ESTADO_LABEL[r.estadoVisible]}
                  </span>
                </div>

                <div className="edu-cell__actions">
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setDetalleId(r.id);
                    }}
                  >
                    <FileText size={15} />
                    Ver
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {nuevo && (
        <NuevoPresupuesto onClose={() => setNuevo(false)} onDone={recargar} />
      )}

      {detalle && (
        <DetallePresupuesto
          quote={detalle}
          canCharge={canCharge}
          sedeAviso={sedeAviso}
          origin={origin}
          onClose={() => setDetalleId(null)}
          onDone={recargar}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// NUEVO PRESUPUESTO
// ═══════════════════════════════════════════════════════════════════════

interface PacienteBusqueda {
  id: string;
  folio: string;
  name: string;
}

interface TarifaRespuesta {
  patientId: string;
  patientName: string;
  patientFolio: string;
  applied: { feeScheduleName: string; reason: string } | null;
  prices: EduPrecioResuelto[];
  manuales: { id: string; name: string; key: string }[];
}

interface Partida {
  procedureId: string | null;
  name: string;
  toothFdi: string;
  cantidad: string;
  precio: string;
  descuento: string;
  fase: string;
  notas: string;
}

function partidaVacia(): Partida {
  return {
    procedureId: null,
    name: "",
    toothFdi: "",
    cantidad: "1",
    precio: "",
    descuento: "",
    fase: "",
    notas: "",
  };
}

/** Centavos de un campo tecleado. El servidor vuelve a leerlo y a validar. */
function centavos(texto: string): number {
  const n = parseEduMoneyCents(texto);
  return n === null ? 0 : n;
}

function NuevoPresupuesto({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<PacienteBusqueda[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [tarifa, setTarifa] = useState<TarifaRespuesta | null>(null);
  const [lista, setLista] = useState("");

  const [titulo, setTitulo] = useState("");
  const [notas, setNotas] = useState("");
  const [vigencia, setVigencia] = useState("");
  const [descuentoPct, setDescuentoPct] = useState("");
  const [items, setItems] = useState<Partida[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El buscador con retardo y número de petición, igual que en Caja: sin el
  // retardo, "María Rodríguez" son quince consultas para pintar tres
  // resultados; sin el número, dos respuestas pueden volver al revés y
  // dejar en pantalla lo que ya no está escrito.
  const peticion = useRef(0);
  useEffect(() => {
    if (tarifa) return;
    const termino = q.trim();
    if (!termino) {
      setResultados(null);
      setBuscando(false);
      return;
    }
    const mio = ++peticion.current;
    setBuscando(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await eduRequest<{ rows: PacienteBusqueda[] }>(
          `/api/instituto/pacientes?q=${encodeURIComponent(termino)}`,
        );
        if (mio !== peticion.current) return;
        setResultados(res.rows.slice(0, 20));
        setError(null);
      } catch (err) {
        if (mio !== peticion.current) return;
        setError(err instanceof Error ? err.message : "No se pudo buscar.");
      } finally {
        if (mio === peticion.current) setBuscando(false);
      }
    }, EDU_BUSQUEDA_RETARDO_MS);
    return () => window.clearTimeout(t);
  }, [q, tarifa]);

  async function elegirPaciente(p: PacienteBusqueda, listaId = "") {
    setError(null);
    setBusy(true);
    try {
      // 🔴 AQUÍ SE PREGUNTA LA TARIFA. Esta pantalla no deduce precios: el
      // servidor dice qué lista le toca a ESTE paciente y cuánto vale cada
      // procedimiento para él.
      const res = await eduRequest<TarifaRespuesta>(
        `/api/instituto/caja/tarifa?paciente=${encodeURIComponent(p.id)}${
          listaId ? `&lista=${encodeURIComponent(listaId)}` : ""
        }`,
      );
      setTarifa(res);
      setResultados(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la tarifa.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 🔴 CAMBIAR DE LISTA VACÍA LAS PARTIDAS. Los precios ya puestos son de
   * la lista anterior, y mezclar dos tarifas en el mismo papel es
   * exactamente el "cotizar a ojo" que esta pantalla existe para impedir.
   */
  async function cambiarLista(listaId: string) {
    if (!tarifa) return;
    const paciente = { id: tarifa.patientId, folio: tarifa.patientFolio, name: tarifa.patientName };
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<TarifaRespuesta>(
        `/api/instituto/caja/tarifa?paciente=${encodeURIComponent(paciente.id)}${
          listaId ? `&lista=${encodeURIComponent(listaId)}` : ""
        }`,
      );
      setTarifa(res);
      setLista(listaId);
      setItems([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar de lista.");
    } finally {
      setBusy(false);
    }
  }

  function agregarDelTarifario(procedureId: string) {
    const p = tarifa?.prices.find((x) => x.procedureId === procedureId);
    if (!p) return;
    setItems((prev) => [
      ...prev,
      {
        ...partidaVacia(),
        procedureId: p.procedureId,
        name: p.name,
        precio: (p.priceCents / 100).toFixed(2),
      },
    ]);
  }

  const totales = useMemo(
    () =>
      eduQuoteTotales(
        items.map((i) => ({
          quantity: Number.parseInt(i.cantidad, 10) || 0,
          unitPriceCents: centavos(i.precio),
          discountCents: centavos(i.descuento),
        })),
        descuentoPct.trim() === "" ? null : Number.parseFloat(descuentoPct),
        0,
      ),
    [items, descuentoPct],
  );

  const listo = Boolean(tarifa) && titulo.trim().length >= 2 && items.length > 0;

  async function guardar() {
    if (!tarifa) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ folio: string; totalCents: number }>(
        "/api/instituto/presupuestos",
        {
          method: "POST",
          body: {
            patientId: tarifa.patientId,
            title: titulo.trim(),
            notes: notas.trim() || null,
            validUntil: vigencia || null,
            discountPct: descuentoPct.trim() === "" ? null : descuentoPct,
            items: items.map((i) => ({
              procedureId: i.procedureId,
              name: i.name.trim(),
              toothFdi: i.toothFdi.trim() || null,
              quantity: Number.parseInt(i.cantidad, 10) || 1,
              unitPriceCents: centavos(i.precio),
              discountCents: centavos(i.descuento),
              phase: i.fase.trim() === "" ? null : Number.parseInt(i.fase, 10),
              notes: i.notas.trim() || null,
            })),
          },
        },
      );
      onDone(
        `Presupuesto ${res.folio} creado por ${eduMoney(res.totalCents)}. Preséntalo para poder mandarle la liga al paciente.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el presupuesto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Nuevo presupuesto"
      subtitle="Las partidas salen del tarifario. Aquí no se teclean precios de catálogo."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy || !listo}
          >
            {busy ? "Guardando…" : `Crear por ${eduMoney(totales.totalCents)}`}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {!tarifa ? (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-presu-paciente">
              ¿Para quién es el presupuesto?
            </label>
            <input
              id="edu-presu-paciente"
              className="edu-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre o folio del paciente"
              autoComplete="off"
            />
            <span className="edu-field__hint">
              La lista de precios que se aplica la decide el servidor según quién trajo al paciente.
            </span>
          </div>
          {buscando && <p className="edu-note">Buscando…</p>}
          {resultados && resultados.length === 0 && (
            <p className="edu-note">Ningún paciente con ese nombre o folio.</p>
          )}
          {resultados && resultados.length > 0 && (
            /* `edu-picklist` / `edu-pick`: las mismas clases que el
               buscador de la caja. Un segundo estilo para la misma lista
               es la copia que un día se despeina sola. */
            <ul className="edu-picklist">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="edu-pick"
                    onClick={() => elegirPaciente(p)}
                    disabled={busy}
                  >
                    <span className="edu-pick__name">{p.name}</span>
                    <span className="edu-pick__sub">{p.folio}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="edu-banner">
            <div>
              <p className="edu-banner__title">
                {tarifa.patientName} · {tarifa.patientFolio}
              </p>
              <p className="edu-banner__detail">
                {tarifa.applied
                  ? `Lista aplicada: ${tarifa.applied.feeScheduleName}. ${tarifa.applied.reason}`
                  : "Este instituto no tiene ninguna lista de precios predeterminada: captura una en Tarifarios."}
              </p>
            </div>
          </div>

          {tarifa.manuales.length > 0 && (
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-presu-lista">
                Lista de precios
              </label>
              <select
                id="edu-presu-lista"
                className="edu-input"
                value={lista}
                onChange={(e) => cambiarLista(e.target.value)}
                disabled={busy}
              >
                <option value="">La que le toca por regla</option>
                {tarifa.manuales.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <span className="edu-field__hint">
                Cambiar de lista vacía las partidas: sus precios eran de la lista anterior.
              </span>
            </div>
          )}

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-presu-titulo">
              Título
            </label>
            <input
              id="edu-presu-titulo"
              className="edu-input"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Rehabilitación superior"
              autoComplete="off"
            />
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-presu-add">
              Añadir del tarifario
            </label>
            <select
              id="edu-presu-add"
              className="edu-input"
              value=""
              onChange={(e) => {
                if (e.target.value) agregarDelTarifario(e.target.value);
              }}
              disabled={items.length >= EDU_QUOTE_MAX_ITEMS}
            >
              <option value="">Elige un procedimiento…</option>
              {tarifa.prices.map((p) => (
                <option key={p.procedureId} value={p.procedureId}>
                  {p.code} · {p.name} · {eduMoney(p.priceCents)}
                  {p.fallback ? " (precio de la lista por defecto)" : ""}
                </option>
              ))}
            </select>
            <span className="edu-field__hint">
              {items.length >= EDU_QUOTE_MAX_ITEMS
                ? `Un presupuesto admite ${EDU_QUOTE_MAX_ITEMS} partidas como mucho.`
                : "O añade una partida libre para algo que no esté en el catálogo (un material, una placa)."}
            </span>
            {/* ⚠️ LOS DOS TOPES NO SON EL MISMO y se avisa AQUÍ, no al
                convertir: un presupuesto admite 60 partidas y un cobro 50
                conceptos. Enterarse al final —con el papel ya firmado y el
                paciente delante— es el peor momento posible. */}
            {items.length > EDU_MAX_CHARGE_ITEMS && (
              <span className="edu-field__hint">
                Con más de {EDU_MAX_CHARGE_ITEMS} partidas este presupuesto ya no se podrá convertir
                en UN cobro: pártelo en dos antes de presentárselo al paciente.
              </span>
            )}
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => setItems((prev) => [...prev, partidaVacia()])}
              disabled={items.length >= EDU_QUOTE_MAX_ITEMS}
            >
              <Plus size={15} />
              Partida libre
            </button>
          </div>

          {/* `edu-lineas` / `edu-linea`: la MISMA rejilla con la que la caja
             edita las líneas de un cobro. Apilada en móvil y en fila a
             partir de 560 px, con el nombre ocupando el renglón entero
             cuando no cabe (regla 8: la forma que no se puede romper va en
             la base, la de escritorio se PIDE). */}
          <div className="edu-lineas">
            {items.map((it, i) => (
              <div className="edu-linea" key={i}>
                <div className="edu-linea__desc">
                  {it.procedureId ? (
                    <>
                      <span className="edu-linea__name">{it.name}</span>
                      <span className="edu-linea__sub">
                        {eduMoney(centavos(it.precio))} c/u · del tarifario
                      </span>
                    </>
                  ) : (
                    <input
                      className="edu-input edu-input--sm"
                      value={it.name}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                      placeholder="Concepto (partida libre)"
                      aria-label={`Concepto de la partida ${i + 1}`}
                    />
                  )}
                  <span className="edu-linea__sub">
                    Importe:{" "}
                    {eduMoney(
                      eduQuoteLineTotal({
                        quantity: Number.parseInt(it.cantidad, 10) || 0,
                        unitPriceCents: centavos(it.precio),
                        discountCents: centavos(it.descuento),
                      }),
                    )}
                  </span>
                </div>

                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`edu-pq-${i}`}>
                    Cant.
                  </label>
                  <input
                    id={`edu-pq-${i}`}
                    className="edu-input edu-input--sm"
                    type="number"
                    min={1}
                    max={999}
                    value={it.cantidad}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, n) => (n === i ? { ...x, cantidad: e.target.value } : x)),
                      )
                    }
                  />
                </div>

                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`edu-pp-${i}`}>
                    Precio
                  </label>
                  {/* 🔴 EL PRECIO DEL CATÁLOGO NO SE TECLEA. Una partida que
                      salió del tarifario lleva el precio que puso el
                      servidor; para proponer otro importe hay dos caminos
                      honestos y los dos quedan escritos: el descuento de
                      la línea, o una partida libre. */}
                  <input
                    id={`edu-pp-${i}`}
                    className="edu-input edu-input--sm"
                    inputMode="decimal"
                    value={it.precio}
                    readOnly={it.procedureId !== null}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, n) => (n === i ? { ...x, precio: e.target.value } : x)),
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`edu-pd-${i}`}>
                    Descuento
                  </label>
                  <input
                    id={`edu-pd-${i}`}
                    className="edu-input edu-input--sm"
                    inputMode="decimal"
                    value={it.descuento}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, n) => (n === i ? { ...x, descuento: e.target.value } : x)),
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`edu-pt-${i}`}>
                    Dientes
                  </label>
                  <input
                    id={`edu-pt-${i}`}
                    className="edu-input edu-input--sm"
                    value={it.toothFdi}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, n) => (n === i ? { ...x, toothFdi: e.target.value } : x)),
                      )
                    }
                    placeholder="11,12"
                  />
                </div>

                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`edu-pf-${i}`}>
                    Fase
                  </label>
                  <input
                    id={`edu-pf-${i}`}
                    className="edu-input edu-input--sm"
                    inputMode="numeric"
                    value={it.fase}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, n) => (n === i ? { ...x, fase: e.target.value } : x)),
                      )
                    }
                    placeholder="—"
                  />
                </div>

                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => setItems((prev) => prev.filter((_, n) => n !== i))}
                  aria-label={`Quitar la partida ${i + 1}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="edu-linea">
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-presu-desc">
                Descuento global (%)
              </label>
              <input
                id="edu-presu-desc"
                className="edu-input"
                inputMode="decimal"
                value={descuentoPct}
                onChange={(e) => setDescuentoPct(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-presu-vig">
                Vale hasta
              </label>
              <input
                id="edu-presu-vig"
                className="edu-input"
                type="date"
                value={vigencia}
                onChange={(e) => setVigencia(e.target.value)}
              />
              <span className="edu-field__hint">
                Si lo dejas vacío, al presentarlo se le ponen 30 días.
              </span>
            </div>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-presu-notas">
              Notas (salen en el PDF)
            </label>
            <textarea
              id="edu-presu-notas"
              className="edu-input"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>

          <div className="edu-totales">
            <div className="edu-totales__fila">
              <span>Subtotal</span>
              <span className="edu-precio">{eduMoney(totales.subtotalCents)}</span>
            </div>
            {totales.discountCents > 0 && (
              <div className="edu-totales__fila">
                <span>Descuento</span>
                <span className="edu-precio">−{eduMoney(totales.discountCents)}</span>
              </div>
            )}
            <div className="edu-totales__fila edu-totales__fila--fuerte">
              <span>Total</span>
              <span className="edu-precio">{eduMoney(totales.totalCents)}</span>
            </div>
          </div>
        </>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DETALLE Y ACCIONES
// ═══════════════════════════════════════════════════════════════════════

function DetallePresupuesto({
  quote,
  canCharge,
  sedeAviso,
  origin,
  onClose,
  onDone,
}: {
  quote: EduQuoteRow;
  canCharge: boolean;
  sedeAviso: string | null;
  origin: string;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liga, setLiga] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [motivo, setMotivo] = useState("");
  // 🔴 QUIÉN ACEPTA EN EL MOSTRADOR. La liga pública exige el nombre
  // completo antes de aceptar y aquí no se pedía nada: el presupuesto
  // quedaba ACEPTADO sin decir quién dijo que sí. Va al servidor y acaba
  // dentro de `acceptedByName`, junto a ante quién se aceptó.
  const [aceptante, setAceptante] = useState("");
  const [meses, setMeses] = useState("3");

  // 🔴 LAS TRANSICIONES SON UN DATO, no una cadena de `if`: la misma tabla
  // que aplica el servidor. Si mañana cambia allí, aquí cambia sola.
  const puede = (destino: EduQuoteStatus) =>
    (EDU_QUOTE_TRANSITIONS[quote.status] ?? []).includes(destino);

  async function llamar(url: string, method: string, body?: unknown, mensaje?: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<Record<string, unknown>>(url, { method, body });
      if (mensaje) onDone(mensaje);
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function presentar() {
    const res = await llamar(`/api/instituto/presupuestos/${quote.id}/presentar`, "POST", {});
    if (res && typeof res.acceptToken === "string") {
      setLiga(`${origin}/instituto/presupuesto/${res.acceptToken}`);
    }
  }

  async function convertir(modo: "cobro" | "plan") {
    const res = await llamar(`/api/instituto/presupuestos/${quote.id}/convertir`, "POST", {
      modo,
      months: modo === "plan" ? meses : undefined,
    });
    if (!res) return;
    const folio = typeof res.chargeFolio === "string" ? res.chargeFolio : "";
    onDone(
      res.duplicado
        ? `Este presupuesto ya se había convertido en el cobro ${folio}: no se emitió otro.`
        : modo === "plan"
          ? `Cobro ${folio} creado y diferido a ${meses} meses. Está en Caja → Pagos a meses.`
          : `Cobro ${folio} creado con los precios que aceptó el paciente. Está en Caja.`,
    );
  }

  const yaConvertido = Boolean(quote.chargeId);
  const puedeConvertir = canCharge && quote.status === "ACEPTADO" && !yaConvertido;

  return (
    <EduModal
      title={`${quote.folio} · ${quote.title}`}
      subtitle={`${quote.patientName} · ${ESTADO_LABEL[quote.estadoVisible]}`}
      onClose={onClose}
      busy={busy}
      footer={
        <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
          Cerrar
        </button>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <p className="edu-note">{EDU_QUOTE_STATUS_DESCRIPTIONS[quote.status]}</p>

      <div className="edu-tablewrap">
        <div className="edu-table edu-table--partidas">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Concepto</span>
            <span>Cant.</span>
            <span>Precio</span>
            <span>Importe</span>
          </div>
          {quote.items.map((i) => (
            <div className="edu-row" key={i.id}>
              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Concepto</span>
                <span className="edu-cell__value">{i.name}</span>
                {(i.toothFdi || i.phase !== null) && (
                  <span className="edu-cell__sub">
                    {[i.toothFdi ? `Dientes ${i.toothFdi}` : null, i.phase !== null ? `Fase ${i.phase}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
              <div className="edu-cell">
                <span className="edu-cell__label">Cant.</span>
                <span className="edu-cell__value">{i.quantity}</span>
              </div>
              <div className="edu-cell">
                <span className="edu-cell__label">Precio</span>
                <span className="edu-cell__value edu-precio">{eduMoney(i.unitPriceCents)}</span>
              </div>
              <div className="edu-cell">
                <span className="edu-cell__label">Importe</span>
                <span className="edu-cell__value edu-precio">{eduMoney(i.lineTotalCents)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="edu-totales">
        <div className="edu-totales__fila">
          <span>Subtotal</span>
          <span className="edu-precio">{eduMoney(quote.subtotalCents)}</span>
        </div>
        {quote.discountCents > 0 && (
          <div className="edu-totales__fila">
            <span>Descuento{quote.discountPct !== null ? ` (${quote.discountPct} %)` : ""}</span>
            <span className="edu-precio">−{eduMoney(quote.discountCents)}</span>
          </div>
        )}
        <div className="edu-totales__fila edu-totales__fila--fuerte">
          <span>Total</span>
          <span className="edu-precio">{eduMoney(quote.totalCents)}</span>
        </div>
      </div>

      {quote.acceptedAt && (
        <p className="edu-note">
          Lo aceptó <strong>{quote.acceptedByName ?? "el paciente"}</strong> el{" "}
          {quote.acceptedAt.slice(0, 10)}.
        </p>
      )}

      {liga && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">Liga para el paciente</p>
            {/* 🔴 `overflow-wrap: anywhere`: una URL con token es UN solo
                token de 64 caracteres y sin esto fija el ancho mínimo del
                modal en un teléfono. */}
            <p className="edu-banner__detail" style={{ overflowWrap: "anywhere" }}>
              {liga}
            </p>
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(liga);
                  setCopiado(true);
                } catch {
                  // Sin permiso de portapapeles (o sin HTTPS) no se puede
                  // copiar: la liga está a la vista para seleccionarla a
                  // mano, que es lo que quedaba por hacer de todos modos.
                  setCopiado(false);
                }
              }}
            >
              <Copy size={15} />
              {copiado ? "Copiada" : "Copiar liga"}
            </button>
          </div>
        </div>
      )}

      <div className="edu-actions" style={{ flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {/* El PDF no cuelga de `canCharge`: quien puede VER un presupuesto
            puede imprimirlo, y el servidor exige `caja.view` igual. Un
            borrador no sale (lo dice el 409 con su porqué). */}
        {quote.status !== "BORRADOR" && (
          <a
            className="edu-btn edu-btn--ghost edu-btn--sm"
            href={`/api/instituto/presupuestos/${quote.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileText size={15} />
            PDF
          </a>
        )}

        {canCharge && puede("PRESENTADO") && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={presentar}
            disabled={busy}
          >
            {quote.presentedAt ? "Volver a presentar y ver la liga" : "Presentar y sacar liga"}
          </button>
        )}

        {canCharge && puede("RECHAZADO") && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() =>
              llamar(
                `/api/instituto/presupuestos/${quote.id}`,
                "PATCH",
                { status: "RECHAZADO" },
                "Presupuesto marcado como rechazado. No se borra: la propuesta existió.",
              )
            }
            disabled={busy}
          >
            El paciente dijo que no
          </button>
        )}

        {canCharge && puede("BORRADOR") && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() =>
              llamar(
                `/api/instituto/presupuestos/${quote.id}`,
                "PATCH",
                { status: "BORRADOR" },
                "Vuelve a borrador: ya se puede editar. La liga del paciente sigue siendo la misma.",
              )
            }
            disabled={busy}
          >
            Devolver a borrador
          </button>
        )}
      </div>

      {/* ── CONVERTIR ────────────────────────────────────────────────── */}
      {quote.status === "ACEPTADO" && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">Convertir en cobro</h2>
              <p className="edu-section__lead">
                {/* 🔴 La frase que explica todo el diseño de la conversión. */}
                El cobro sale con los precios que el paciente <strong>aceptó</strong>, no con los
                del tarifario de hoy. Y solo se puede convertir una vez: si vuelves a pulsar, se te
                devuelve el cobro que ya existe.
              </p>
            </div>
          </div>

          {yaConvertido ? (
            <p className="edu-note">
              Ya se convirtió en un cobro. Búscalo en Caja: lleva escrito de qué presupuesto viene.
            </p>
          ) : !canCharge ? (
            <p className="edu-note">
              Tu cuenta puede ver presupuestos pero no cobrar (`caja.charge`), así que convertir lo
              tiene que hacer caja o dirección.
            </p>
          ) : sedeAviso ? (
            // 🔴 DESHABILITADO **CON MOTIVO**: con varias sedes y ninguna
            // elegida, el servidor rebota porque un cobro ocurre en un
            // mostrador concreto. Se dice antes de que el clic falle.
            <p className="edu-note">{sedeAviso}</p>
          ) : (
            <div className="edu-actions" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => convertir("cobro")}
                disabled={busy}
              >
                Convertir en cobro
              </button>
              <label className="edu-field__label" htmlFor="edu-presu-meses">
                Meses
              </label>
              <input
                id="edu-presu-meses"
                className="edu-input edu-input--sm"
                inputMode="numeric"
                value={meses}
                onChange={(e) => setMeses(e.target.value)}
                style={{ maxWidth: 80 }}
              />
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => convertir("plan")}
                disabled={busy}
              >
                Convertir y diferir a meses
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── ACEPTAR EN EL MOSTRADOR ──────────────────────────────────── */}
      {canCharge && puede("ACEPTADO") && (
        <section className="edu-section">
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-presu-aceptante">
              Aceptar en el mostrador (pide quién lo acepta)
            </label>
            <input
              id="edu-presu-aceptante"
              className="edu-input"
              value={aceptante}
              onChange={(e) => setAceptante(e.target.value)}
              placeholder="Nombre completo de quien dice que sí"
              autoComplete="off"
            />
            <span className="edu-field__hint">
              {/* La liga pública pide el nombre antes de aceptar; el
                  mostrador tiene que dejar la misma evidencia, o el PDF
                  sale sin franja y dentro de un año nadie puede contestar
                  quién aceptó ese total. */}
              Queda con fecha, con tu nombre y con la huella del total aceptado — lo mismo que
              cuando el paciente acepta desde su liga. Un presupuesto vencido no se puede aceptar.
            </span>
          </div>
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() =>
              llamar(
                `/api/instituto/presupuestos/${quote.id}`,
                "PATCH",
                { status: "ACEPTADO", acceptedByName: aceptante.trim() },
                "Presupuesto aceptado, con su evidencia. Ya se puede convertir en cobro.",
              )
            }
            disabled={busy || aceptante.trim().length < 3}
          >
            Aceptar en el mostrador
          </button>
        </section>
      )}

      {/* ── CANCELAR ─────────────────────────────────────────────────── */}
      {canCharge && puede("CANCELADO") && (
        <section className="edu-section">
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-presu-motivo">
              Retirar este presupuesto (pide motivo)
            </label>
            <input
              id="edu-presu-motivo"
              className="edu-input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Se rehízo con otro plan de tratamiento."
              autoComplete="off"
            />
            <span className="edu-field__hint">
              No se borra: se marca como retirado con tu motivo. La propuesta existió.
            </span>
          </div>
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() =>
              llamar(
                `/api/instituto/presupuestos/${quote.id}`,
                "PATCH",
                { status: "CANCELADO", reason: motivo.trim() },
                "Presupuesto retirado con su motivo.",
              )
            }
            disabled={busy || motivo.trim().length < 3}
          >
            Retirar presupuesto
          </button>
        </section>
      )}
    </EduModal>
  );
}
