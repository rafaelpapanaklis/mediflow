"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EduFormasPago,
  eduNuevoPagoDraft,
  eduSerializarPagos,
  eduValidarPagos,
  type EduPagoDraft,
} from "@/components/edu/dinero/formas-pago";
import { PlanAMeses, type EduPlanDatos } from "@/components/edu/dinero/plan-a-meses";
import {
  eduChargeTotals,
  eduLineTotalCents,
  eduMoney,
  eduMoneyInputValue,
  type EduChargeFilters,
  type EduChargeRow,
  type EduChargesPage,
  type EduPrecioResuelto,
  type EduTarifaMatch,
} from "@/lib/edu/dinero-core";
import {
  EDU_PLAN_MAX_MONTHS,
  EDU_PLAN_MIN_MONTHS,
  eduFechaCorta,
  eduFechaLarga,
  eduPlanCalendario,
  type EduPlanCalendarioFila,
} from "@/lib/edu/pagos-core";
import {
  EDU_CHARGE_STATUSES,
  EDU_CHARGE_STATUS_LABELS,
  EDU_INSTALLMENT_STATUS_LABELS,
  EDU_PAYMENT_METHODS_COBRABLES,
  EDU_PAYMENT_METHOD_LABELS,
  EDU_PAYMENT_METHOD_SHORT,
  type EduChargeStatus,
  type EduPaymentMethod,
} from "@/lib/edu/types";

/**
 * /instituto/caja — COBRAR.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NI UN PRECIO ESCRITO EN ESTA PANTALLA.
 *
 * Al elegir al paciente, la pantalla PREGUNTA al servidor
 * (/api/instituto/caja/tarifa) qué lista le toca, por qué, y cuánto cuesta
 * cada procedimiento PARA ÉL. Aquí no hay un número de precio, ni una
 * regla de "si es de alumno entonces…", ni un descuento calculado: si el
 * navegador supiera calcular un precio, sabría calcular uno más barato.
 *
 * Lo único que se calcula en el cliente es la SUMA de lo que ya cotizó el
 * servidor, para que el total se mueva mientras se teclea. El servidor la
 * vuelve a calcular al emitir con SUS precios, y ésa es la que vale: si
 * las dos discreparan, gana la del servidor y el recibo lo dice.
 *
 * 🔴 Y el precio que este componente manda en cada línea se DESCARTA en el
 * servidor cuando la línea trae `procedureId`. Va en el cuerpo solo para
 * que el servidor pueda detectar —y registrar— que la caché de precios del
 * navegador estaba vieja.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduCajaScreenProps {
  page: EduChargesPage;
  filters: EduChargeFilters;
  maxRows: number;
  /** El turno abierto, si hay. Sin turno se cobra igual: el corte no es un peaje. */
  turnoAbierto: { id: string; openedAtLabel: string } | null;
  canCharge: boolean;
  canRefund: boolean;
  canCorte: boolean;
  /**
   * Ola 10. true = esta persona puede facturar ("facturacion.emit").
   * El botón lleva a /instituto/facturacion con el cobro puesto: el
   * modal de timbrado vive allá y no se duplica aquí — dos copias del
   * mismo formulario fiscal es cómo una de las dos se queda vieja.
   */
  canInvoice: boolean;
  /**
   * Ola 12. El botón "Cobrar" de la ficha llega con ?cobrar=<id> y el
   * SERVIDOR resuelve al paciente (caja/page.tsx): el modal de cobro se
   * abre solo, con él ya elegido, y se salta la búsqueda. `null` = caja
   * normal. Solo llega cuando canCharge — sin el permiso no viaja nada.
   */
  cobrarPreseleccion: { id: string; folio: string; name: string } | null;
  /**
   * 🔴 EL HOY DEL INSTITUTO, "AAAA-MM-DD", calculado en el SERVIDOR.
   *
   * Con él se arma la vista previa del calendario del plan (qué día cae
   * cada mensualidad) y el día de corte que se propone. Si se tomara del
   * navegador, una recepción con la hora del equipo mal puesta —o
   * simplemente en otro huso— vería un calendario distinto del que va a
   * emitir el servidor, y el papel del paciente diría otras fechas.
   */
  todayISO: string;
}

/**
 * Cuánto se espera antes de buscar mientras se teclea.
 *
 * 250 ms es lo que tarda una pausa entre palabras: corto para que el
 * mostrador no perciba retraso, largo para que "María Rodríguez" no se
 * convierta en quince consultas a Postgres. Vive con nombre y no como un
 * número suelto dentro del efecto porque es la clase de valor que alguien
 * va a querer ajustar.
 */
const EDU_BUSQUEDA_RETARDO_MS = 250;

/** Un enlace que acompaña al aviso de éxito ("Imprimir calendario"). */
interface EduFlashEnlace {
  href: string;
  label: string;
}

const TAG_BY_STATUS: Record<EduChargeStatus, string> = {
  PENDING: "edu-tag--warn",
  PARTIAL: "edu-tag--info",
  PAID: "edu-tag--ok",
  REFUNDED: "edu-tag--muted",
  CANCELLED: "edu-tag--muted",
};

export function EduCajaScreen({
  page,
  filters,
  maxRows,
  turnoAbierto,
  canCharge,
  canRefund,
  canCorte,
  canInvoice,
  cobrarPreseleccion,
  todayISO,
}: EduCajaScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  // Con preselección (el "Cobrar" de la ficha) el modal llega ABIERTO.
  // Solo el estado inicial: cerrar y volver a abrir queda en manos de la
  // persona, como siempre.
  const [cobrando, setCobrando] = useState(Boolean(cobrarPreseleccion && canCharge));
  const [recibo, setRecibo] = useState<EduChargeRow | null>(null);
  // El aviso de éxito, con un enlace opcional: al emitir a meses lleva a
  // "Imprimir calendario", que es lo que se le entrega al paciente.
  const [flash, setFlash] = useState<{ text: string; enlace?: EduFlashEnlace } | null>(null);

  const { rows, truncated, totals, applied } = page;
  // El selector cuenta como filtro cuando la persona LO TOCÓ. Si contara
  // también la caída al histórico por no haber turno, el botón "Limpiar"
  // aparecería en una pantalla que nadie filtró.
  const hayFiltros = Boolean(filters.status || filters.q || filters.turnoExplicito);

  function aplicar(next: Record<string, string>) {
    const actual: Record<string, string> = {};
    if (filters.status) actual.estado = filters.status;
    if (filters.q) actual.q = filters.q;
    // 🔴 "turno" viaja EXPLÍCITO en la URL, no como ausencia del
    // parámetro. Es lo que distingue "lo pidió una persona" de "es el
    // default", y de esa distinción depende que un cobro recién emitido se
    // vea cuando no hay ningún turno abierto.
    if (filters.turnoExplicito) actual.ver = filters.soloTurno ? "turno" : "todos";

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...actual, ...next })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startNav(() => {
      router.replace(qs ? `/instituto/caja?${qs}` : "/instituto/caja", { scroll: false });
    });
  }

  function recargar(mensaje: string, enlace?: EduFlashEnlace) {
    setFlash({ text: mensaje, enlace });
    startNav(() => router.refresh());
  }

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash.text}</p>
          </div>
          {flash.enlace && (
            <Link href={flash.enlace.href} className="edu-btn edu-btn--ghost edu-btn--sm">
              {flash.enlace.label}
            </Link>
          )}
        </div>
      )}

      {/* ── El turno ────────────────────────────────────────────────
          Sin turno abierto SE PUEDE COBRAR. El corte es una herramienta
          para cuadrar el cajón, no un peaje para atender a un paciente que
          ya está en el mostrador. Lo que pasa es que esos cobros no entran
          en ningún corte, y eso se dice aquí en vez de descubrirse al
          cerrar. */}
      <div className={`edu-banner ${turnoAbierto ? "" : "edu-banner--warn"}`}>
        <div>
          <p className="edu-banner__title">
            {turnoAbierto ? `Turno abierto desde ${turnoAbierto.openedAtLabel}` : "No hay turno de caja abierto"}
          </p>
          <p className="edu-banner__detail">
            {turnoAbierto
              ? "Todo lo que se cobre y se pague ahora entra en este corte."
              : applied.fallbackSinTurno
                ? "Puedes cobrar igual, pero esos cobros no entrarán en ningún corte hasta que se abra un turno. Como no hay turno, abajo se lista TODO el histórico: así ves lo que acabas de cobrar."
                : "Puedes cobrar igual, pero esos cobros no entrarán en ningún corte hasta que se abra un turno."}
          </p>
        </div>
        {canCorte && (
          <Link href="/instituto/caja/corte" className="edu-btn edu-btn--ghost edu-btn--sm">
            {turnoAbierto ? "Ver el corte" : "Abrir turno"}
          </Link>
        )}
      </div>

      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ q: q.trim() });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-caja-q">
            Buscar
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-caja-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Folio del cobro o del paciente, o su nombre"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-caja-estado">
            Estado
          </label>
          <select
            id="edu-caja-estado"
            className="edu-input edu-input--sm"
            value={filters.status ?? ""}
            onChange={(e) => aplicar({ estado: e.target.value })}
          >
            <option value="">Todos</option>
            {EDU_CHARGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_CHARGE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-caja-ver">
            Qué se lista
          </label>
          <select
            id="edu-caja-ver"
            className="edu-input edu-input--sm"
            // 🔴 Lee lo APLICADO, no lo pedido: si dijera "solo el turno
            // abierto" mientras la tabla enseña el histórico, nadie
            // entendería qué está viendo.
            value={applied.soloTurno ? "turno" : "todos"}
            onChange={(e) => aplicar({ ver: e.target.value === "todos" ? "todos" : "turno" })}
          >
            <option value="turno">Solo el turno abierto</option>
            <option value="todos">Todo el histórico</option>
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace("/instituto/caja", { scroll: false }));
            }}
          >
            <X size={15} />
            Limpiar
          </button>
        )}
      </form>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Buscando…"
            : `${rows.length} ${rows.length === 1 ? "cobro" : "cobros"}${
                truncated ? ` (se muestran los primeros ${maxRows})` : ""
              }`}
        </span>
        <span className="edu-actions">
          <Link href="/instituto/caja/planes" className="edu-btn edu-btn--ghost edu-btn--sm">
            Pagos a meses
          </Link>
          {canCharge && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => {
                setFlash(null);
                setCobrando(true);
              }}
            >
              <Plus size={16} />
              Cobrar
            </button>
          )}
        </span>
      </div>

      {rows.length > 0 && (
        // 🔴 Los cancelados NO están en estas sumas. Un cobro anulado no es
        // dinero de la escuela ni deuda del paciente, y contarlo es
        // exactamente el bug que el producto dental ya pagó.
        <div className="edu-kpis">
          <div className="edu-kpi">
            <span className="edu-kpi__label">Cobrado</span>
            <span className="edu-kpi__value">{eduMoney(totals.totalCents)}</span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Pagado</span>
            <span className="edu-kpi__value">{eduMoney(totals.paidCents)}</span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Por cobrar</span>
            <span className="edu-kpi__value">{eduMoney(totals.balanceCents)}</span>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {applied.soloTurno && !turnoAbierto
              ? "No hay turno de caja abierto"
              : hayFiltros
                ? "Ningún cobro coincide"
                : "Todavía no se ha cobrado nada"}
          </p>
          <p className="edu-empty__detail">
            {applied.soloTurno && !turnoAbierto
              ? // Solo se llega aquí si la persona ELIGIÓ "solo el turno
                // abierto" a mano: el default ya se cayó al histórico.
                "Elegiste ver solo el turno abierto y no hay ninguno. Abre uno, o cambia a “Todo el histórico”."
              : hayFiltros
                ? "Prueba con menos filtros, o cambia a “Todo el histórico”."
                : "Aquí aparecen los cobros conforme se emiten. Elige al paciente y el sistema pone su tarifa: tú no tecleas precios."}
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--cobros">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Folio</span>
            <span>Paciente</span>
            <span>Tarifa</span>
            <span>Total</span>
            <span>Saldo</span>
            <span>Pago</span>
            <span>Estado</span>
            <span />
          </div>

          {rows.map((c) => (
            <div key={c.id} className={`edu-row ${c.status === "CANCELLED" ? "edu-row--off" : ""}`}>
              <div className="edu-cell">
                <span className="edu-cell__label">Folio</span>
                <span className="edu-cell__value edu-cell__value--strong">{c.folio}</span>
              </div>

              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Paciente</span>
                <span className="edu-cell__value edu-cell__value--strong">{c.patientName}</span>
                <span className="edu-cell__sub">{c.patientFolio}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Tarifa</span>
                <span className="edu-cell__value">{c.feeScheduleLabel ?? "—"}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Total</span>
                <span className="edu-cell__value edu-precio">{eduMoney(c.totalCents)}</span>
                {c.discountCents > 0 && (
                  <span className="edu-cell__sub">−{eduMoney(c.discountCents)} de descuento</span>
                )}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Saldo</span>
                <span className="edu-cell__value edu-precio">{eduMoney(c.balanceCents)}</span>
              </div>

              {/* ── CON QUÉ SE PAGÓ, o el plan a meses ────────────────
                  Con un plan activo, la fila dice cuántas van y cuándo
                  vence la siguiente: era la queja del mostrador ("no se
                  sabe cada cuándo paga"), y el dato ya venía derivado del
                  servidor sin pintarse. Sin plan, los métodos: "Efectivo",
                  "Efectivo + Crédito". */}
              <div className="edu-cell">
                <span className="edu-cell__label">Pago</span>
                {c.plan ? (
                  <>
                    <span
                      className={`edu-tag ${c.plan.overdueCount > 0 ? "edu-tag--warn" : "edu-tag--info"}`}
                    >
                      A meses · {c.plan.paidCount}/{c.plan.months}
                      {c.plan.nextDueISO ? ` · próx. ${eduFechaCorta(c.plan.nextDueISO)}` : ""}
                    </span>
                    {c.plan.overdueCount > 0 && (
                      <span className="edu-cell__sub">
                        {c.plan.overdueCount}{" "}
                        {c.plan.overdueCount === 1 ? "vencida" : "vencidas"}
                      </span>
                    )}
                  </>
                ) : c.methods.length > 0 ? (
                  <span className="edu-cell__value">
                    {c.methods.map((m) => EDU_PAYMENT_METHOD_SHORT[m]).join(" + ")}
                  </span>
                ) : (
                  <span className="edu-cell__value">—</span>
                )}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Estado</span>
                {/* Un cobro con plan activo NO es "Por cobrar": se está
                    cobrando, mes a mes. Se deriva aquí, en la UI, y no con
                    un estado nuevo en el enum — el estado del cobro sigue
                    siendo (total, pagado, cancelado) y nada más. */}
                <span
                  className={`edu-tag ${c.plan ? "edu-tag--info" : TAG_BY_STATUS[c.status]}`}
                >
                  {c.plan ? "A meses" : EDU_CHARGE_STATUS_LABELS[c.status]}
                </span>
              </div>

              <div className="edu-cell__actions">
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => {
                    setFlash(null);
                    setRecibo(c);
                  }}
                >
                  Recibo
                </button>
                {/* Ola 10. Un cobro CANCELADO no se factura, así que ni
                    se ofrece: un botón que siempre contesta que no es
                    peor que no tenerlo. */}
                {canInvoice && c.status !== "CANCELLED" && (
                  <Link
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    href={`/instituto/facturacion?cobro=${c.id}`}
                  >
                    Facturar
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {cobrando && (
        <Cobrar
          preseleccion={cobrarPreseleccion}
          todayISO={todayISO}
          onClose={() => {
            setCobrando(false);
            // Si el modal llegó abierto por ?cobrar=, se limpia la URL: un
            // refresh del teléfono no debe volver a abrirlo.
            if (cobrarPreseleccion) {
              startNav(() => router.replace("/instituto/caja", { scroll: false }));
            }
          }}
          onDone={(mensaje, enlace) => {
            setCobrando(false);
            if (cobrarPreseleccion) {
              startNav(() => router.replace("/instituto/caja", { scroll: false }));
            }
            recargar(mensaje, enlace);
          }}
        />
      )}

      {recibo && (
        <Recibo
          charge={recibo}
          todayISO={todayISO}
          canCharge={canCharge}
          canRefund={canRefund}
          onClose={() => setRecibo(null)}
          onDone={(mensaje, enlace) => {
            setRecibo(null);
            recargar(mensaje, enlace);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COBRAR — paciente → tarifa del servidor → conceptos → recibo
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
  applied: EduTarifaMatch | null;
  prices: EduPrecioResuelto[];
  sinPrecio: { id: string; code: string; name: string }[];
}

interface LineaUI {
  key: string;
  procedureId: string | null;
  description: string;
  /** Congelado de lo que dijo el servidor. Nunca se edita en pantalla. */
  unitPriceCents: number;
  quantity: string;
  discount: string;
  fromLabel: string | null;
  fallback: boolean;
}

function Cobrar({
  preseleccion,
  todayISO,
  onClose,
  onDone,
}: {
  /** Ola 12: el paciente que ya viene decidido desde la ficha, o null. */
  preseleccion: PacienteBusqueda | null;
  /** El hoy del INSTITUTO: con él se arma el calendario del plan. */
  todayISO: string;
  onClose: () => void;
  /** El mensaje ya escrito: este modal sabe si emitió simple o a meses. */
  onDone: (mensaje: string, enlace?: EduFlashEnlace) => void;
}) {
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<PacienteBusqueda[] | null>(null);
  const [tarifa, setTarifa] = useState<TarifaRespuesta | null>(null);
  const [lineas, setLineas] = useState<LineaUI[]>([]);
  const [elegido, setElegido] = useState("");
  const [libre, setLibre] = useState(false);
  const [libreDesc, setLibreDesc] = useState("");
  const [librePrecio, setLibrePrecio] = useState("");
  // "ahora" = el pago inmediato de siempre; "despues" = queda con saldo;
  // "meses" = se emite y se difiere el saldo en un plan de pagos.
  const [pagoModo, setPagoModo] = useState<"ahora" | "despues" | "meses">("ahora");
  // 🔴 Las formas de pago del cobro inmediato: de una a tres filas, cada
  // una con su método y su monto. Las valida <EduFormasPago/> con la
  // MISMA función que el servidor.
  const [pagos, setPagos] = useState<EduPagoDraft[]>(() => [eduNuevoPagoDraft(0)]);
  const [pagosTocados, setPagosTocados] = useState(false);
  const [notas, setNotas] = useState("");
  // El plan a meses lo arma <PlanAMeses/> y lo deja aquí YA validado —o
  // null mientras no cuadre—, con su calendario de fechas y montos.
  const [planDatos, setPlanDatos] = useState<EduPlanDatos | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Un contador para la key de React: dos líneas del mismo procedimiento
  // son dos renglones distintos y con el procedureId de key la segunda
  // reusaría el estado de la primera.
  const contador = useRef(0);

  const totals = useMemo(
    () =>
      eduChargeTotals(
        lineas.map((l) => ({
          quantity: Number(l.quantity) || 0,
          unitPriceCents: l.unitPriceCents,
          discountCents: centavosDe(l.discount),
        })),
      ),
    [lineas],
  );

  // El monto de la ÚNICA forma se propone igual al total mientras nadie
  // toque el bloque a mano. Es lo que pasa en el 90 % de los mostradores;
  // en cuanto se divide en dos formas, esto se aparta.
  useEffect(() => {
    if (pagosTocados) return;
    setPagos((ps) =>
      ps.length === 1 ? [{ ...ps[0], monto: eduMoneyInputValue(totals.totalCents) }] : ps,
    );
  }, [totals.totalCents, pagosTocados]);

  // La MISMA validación que hará el servidor, sobre lo MISMO que se va a
  // mandar. Si aquí no hay error, allá no rebota.
  const errorPagos =
    pagoModo === "ahora" && totals.totalCents > 0
      ? eduValidarPagos(pagos, totals.totalCents, false)
      : null;

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 EL BUSCADOR FILTRA MIENTRAS SE TECLEA.
  //
  // Antes exigía apretar "Buscar" (o Enter), y lo que pasaba en el
  // mostrador es lo que tenía que pasar: recepción escribía el nombre del
  // paciente y se quedaba esperando sin que ocurriera nada. El botón
  // seguía ahí, pero nadie mira un botón mientras teclea un nombre.
  //
  // Con RETARDO y no en cada tecla: sin él, "María Rodríguez" son quince
  // consultas a Postgres para pintar una lista de tres. El retardo se
  // reinicia en cada pulsación, así que solo viaja la última.
  //
  // Y con NÚMERO DE PETICIÓN: dos búsquedas en vuelo pueden volver al
  // revés (la de "mar" después de la de "maria") y dejar en pantalla los
  // resultados de lo que ya no está escrito. Solo se pinta la respuesta de
  // la última que salió.
  // ═══════════════════════════════════════════════════════════════════
  const peticion = useRef(0);

  useEffect(() => {
    // Con el paciente ya elegido esta pantalla ya no busca: se pasó a
    // cotizar, y una consulta más solo gastaría una petición.
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
        const res = await eduRequest<{ rows: { id: string; folio: string; name: string }[] }>(
          `/api/instituto/pacientes?q=${encodeURIComponent(termino)}`,
        );
        if (mio !== peticion.current) return;
        setResultados(
          res.rows.slice(0, 20).map((p) => ({ id: p.id, folio: p.folio, name: p.name })),
        );
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

  async function elegirPaciente(p: PacienteBusqueda) {
    setError(null);
    setBusy(true);
    try {
      // 🔴 AQUÍ SE PREGUNTA LA TARIFA. La pantalla no la deduce.
      const res = await eduRequest<TarifaRespuesta>(
        `/api/instituto/caja/tarifa?paciente=${encodeURIComponent(p.id)}`,
      );
      setTarifa(res);
      setResultados(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la tarifa.");
    } finally {
      setBusy(false);
    }
  }

  // Ola 12 · el paciente preseleccionado (el "Cobrar" de la ficha) se
  // elige SOLO, una vez, al montar: la tarifa se pregunta igual que si lo
  // hubiera tocado la persona — la preselección se salta la búsqueda, no
  // la cotización del servidor.
  const preseleccionAplicada = useRef(false);
  useEffect(() => {
    if (!preseleccion || preseleccionAplicada.current) return;
    preseleccionAplicada.current = true;
    void elegirPaciente(preseleccion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preseleccion]);

  function agregar(procedureId: string) {
    const precio = tarifa?.prices.find((p) => p.procedureId === procedureId);
    if (!precio) return;
    contador.current += 1;
    setLineas((ls) => [
      ...ls,
      {
        key: `l${contador.current}`,
        procedureId: precio.procedureId,
        description: precio.name,
        unitPriceCents: precio.priceCents,
        quantity: "1",
        discount: "",
        fromLabel: precio.fromFeeScheduleName,
        fallback: precio.fallback,
      },
    ]);
    setElegido("");
  }

  function agregarLibre() {
    const cents = centavosDe(librePrecio);
    if (!libreDesc.trim() || cents <= 0) return;
    contador.current += 1;
    setLineas((ls) => [
      ...ls,
      {
        key: `l${contador.current}`,
        procedureId: null,
        description: libreDesc.trim(),
        unitPriceCents: cents,
        quantity: "1",
        discount: "",
        fromLabel: null,
        fallback: false,
      },
    ]);
    setLibreDesc("");
    setLibrePrecio("");
    setLibre(false);
  }

  // ── 🔴 P2-10 · LA CLAVE DE IDEMPOTENCIA ──────────────────────────────
  // Una por APERTURA del diálogo, estable mientras viva: si el POST sale y
  // la respuesta se pierde (red), el reintento manda LA MISMA clave y el
  // servidor devuelve el cobro que ya emitió en vez de emitir otro. Un
  // diálogo nuevo es una intención nueva y estrena clave. `randomUUID` no
  // existe en http sin certificado — ahí se arma una equivalente a mano.
  const [idemKey] = useState(() => {
    try {
      // Acceso defensivo: el tipo Crypto de un lib.dom viejo no declara
      // randomUUID, y en http sin certificado tampoco existe en runtime.
      const uuid = (
        globalThis.crypto as { randomUUID?: () => string } | undefined
      )?.randomUUID?.();
      if (uuid) return uuid;
    } catch {
      /* cae al método de abajo */
    }
    return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
  });

  async function cobrar() {
    if (!tarifa) return;
    if (pagoModo === "meses" && !planDatos) return;
    if (pagoModo === "ahora" && errorPagos) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ id: string; folio: string; descartados: number }>(
        "/api/instituto/caja/cobros",
        {
          method: "POST",
          body: {
            patientId: tarifa.patientId,
            idempotencyKey: idemKey,
            notes: notas.trim() || null,
            items: lineas.map((l) => ({
              procedureId: l.procedureId ?? undefined,
              description: l.procedureId ? undefined : l.description,
              quantity: Number(l.quantity) || 1,
              // 🔴 Va, y el servidor lo DESCARTA cuando hay procedureId.
              // Se manda para que pueda detectar que esta pantalla tenía
              // un precio viejo, no para que lo use.
              unitPriceCents: eduMoneyInputValue(l.unitPriceCents),
              discountCents: l.discount.trim() || undefined,
            })),
            // 🔴 UNA ENTRADA POR FORMA DE PAGO. El servidor crea una fila
            // por cada una, en la misma transacción que el cobro.
            payments:
              pagoModo === "ahora" && totals.totalCents > 0
                ? eduSerializarPagos(pagos)
                : undefined,
          },
        },
      );
      const aviso =
        (res.descartados ?? 0) > 0
          ? ` Ojo: ${res.descartados} ${res.descartados === 1 ? "concepto salió" : "conceptos salieron"} con el precio del servidor porque el de la pantalla estaba viejo.`
          : "";

      if (pagoModo === "meses" && planDatos) {
        // 🔴 EL PLAN, EN UNA SEGUNDA PETICIÓN. El enganche viaja DENTRO
        // del plan para que enganche + calendario sean UNA transacción en
        // el servidor. Si esta segunda llamada falla, el cobro ya existe
        // (con su clave de idempotencia): volver a apretar "Cobrar" NO lo
        // duplica — el servidor devuelve el mismo folio y solo reintenta
        // el plan.
        try {
          const plan = await eduRequest<{
            id: string;
            months: number;
            installmentCents: number;
            firstCents: number;
          }>(`/api/instituto/caja/cobros/${res.id}/plan`, {
            method: "POST",
            body: {
              months: planDatos.months,
              dueDay: planDatos.dueDay,
              // El enganche viaja como LISTA de formas: se puede pagar
              // mitad en efectivo y mitad con tarjeta, como cualquier otro
              // pago del mostrador.
              enganche: planDatos.enganchePayments ?? undefined,
            },
          });
          // 🔴 EL AVISO DICE LA FECHA. "Emitido a 3 meses" no le sirve a
          // nadie en el mostrador: la pregunta del paciente es cuándo
          // paga, y la respuesta estaba a dos clics de distancia.
          onDone(
            `Cobro ${res.folio} emitido a ${plan.months} meses: la primera mensualidad vence el ${eduFechaLarga(
              planDatos.calendario[0].dueDateISO,
            )}.${aviso}`,
            { href: `/instituto/caja/planes/${plan.id}/recibo`, label: "Imprimir calendario" },
          );
        } catch (err) {
          setError(
            `El cobro ${res.folio} quedó emitido, pero el plan no: ${
              err instanceof Error ? err.message : "no se pudo crear."
            } Vuelve a apretar "Emitir" (no se duplica el cobro) o ábrelo después desde su recibo → "Pagar a meses".`,
          );
        }
        return;
      }

      onDone(`Cobro ${res.folio} emitido.${aviso}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cobrar.");
    } finally {
      setBusy(false);
    }
  }

  const listo =
    Boolean(tarifa) &&
    lineas.length > 0 &&
    (pagoModo !== "meses" || planDatos !== null) &&
    (pagoModo !== "ahora" || errorPagos === null);

  return (
    <EduModal
      title="Cobrar"
      subtitle="Elige al paciente: el sistema pone su tarifa. Tú no tecleas precios."
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
            onClick={cobrar}
            disabled={busy || !listo}
          >
            {busy
              ? "Cobrando…"
              : pagoModo === "meses"
                ? planDatos
                  ? `Emitir a ${planDatos.months} meses · primera el ${eduFechaLarga(
                      planDatos.calendario[0].dueDateISO,
                    )}`
                  : "Emitir a meses"
                : `Cobrar ${eduMoney(totals.totalCents)}`}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {/* ── 1 · El paciente ─────────────────────────────────────────── */}
      {!tarifa ? (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-cobro-q">
              Paciente
            </label>
            <div className="edu-input-wrap">
              <input
                id="edu-cobro-q"
                className="edu-input"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nombre, folio o teléfono"
                autoComplete="off"
                autoFocus
              />
              {/* La lupa se queda como PISTA de qué es este campo, no como
                  botón: ya no hay nada que apretar. */}
              <span className="edu-reveal edu-reveal--pista" aria-hidden="true">
                <Search size={17} />
              </span>
            </div>
            <p className="edu-field__hint">
              Escribe y la lista se va filtrando sola. Se busca por nombre, folio y teléfono, sin
              importar los acentos.
            </p>
          </div>

          {buscando && <p className="edu-note">Buscando…</p>}

          {!buscando && resultados !== null && resultados.length === 0 && (
            <p className="edu-note">
              Ningún paciente coincide con “{q.trim()}”. Se busca por nombre, folio y teléfono.
            </p>
          )}

          {resultados !== null && resultados.length > 0 && (
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
          {/* ── 2 · La tarifa, dicha con su nombre ────────────────── */}
          <div className="edu-tarifa">
            <p className="edu-tarifa__quien">
              {tarifa.patientName} <span className="edu-tarifa__folio">{tarifa.patientFolio}</span>
            </p>
            {tarifa.applied ? (
              <p className="edu-tarifa__lista">
                <span className="edu-tag edu-tag--info">{tarifa.applied.feeScheduleName}</span>{" "}
                {tarifa.applied.reason}
              </p>
            ) : (
              <p className="edu-tarifa__lista edu-tarifa__lista--falta">
                No hay ninguna lista de precios predeterminada. Márcala en Tarifarios antes de
                cobrar.
              </p>
            )}
            <button
              type="button"
              className="edu-btn edu-btn--quiet edu-btn--sm"
              onClick={() => {
                setTarifa(null);
                setLineas([]);
                setResultados(null);
              }}
              disabled={busy}
            >
              Cambiar de paciente
            </button>
          </div>

          {/* ── 3 · Los conceptos ──────────────────────────────────── */}
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-cobro-proc">
              Agregar concepto
            </label>
            <select
              id="edu-cobro-proc"
              className="edu-input"
              value={elegido}
              onChange={(e) => {
                if (e.target.value) agregar(e.target.value);
              }}
            >
              <option value="">Elige un procedimiento…</option>
              {tarifa.prices.map((p) => (
                <option key={p.procedureId} value={p.procedureId}>
                  {p.code} · {p.name} — {eduMoney(p.priceCents)}
                  {p.fallback ? ` (${p.fromFeeScheduleName})` : ""}
                </option>
              ))}
            </select>
            <span className="edu-field__hint">
              Los precios los pone el servidor con la tarifa de este paciente. No se pueden editar
              aquí — y si se editaran, el servidor los volvería a poner.
            </span>
          </div>

          {tarifa.sinPrecio.length > 0 && (
            <p className="edu-note">
              {tarifa.sinPrecio.length}{" "}
              {tarifa.sinPrecio.length === 1
                ? "procedimiento no aparece porque no tiene precio en ninguna lista"
                : "procedimientos no aparecen porque no tienen precio en ninguna lista"}
              : {tarifa.sinPrecio.map((p) => p.code).join(", ")}. Captúralos en Tarifarios.
            </p>
          )}

          {lineas.length === 0 ? (
            <p className="edu-note">Todavía no hay conceptos en este cobro.</p>
          ) : (
            <div className="edu-lineas">
              {lineas.map((l) => (
                <div className="edu-linea" key={l.key}>
                  <div className="edu-linea__desc">
                    <span className="edu-linea__name">{l.description}</span>
                    <span className="edu-linea__sub">
                      {eduMoney(l.unitPriceCents)} c/u
                      {l.procedureId === null ? " · línea libre" : ""}
                      {l.fallback ? ` · precio de ${l.fromLabel}` : ""}
                    </span>
                  </div>

                  <div className="edu-field">
                    <label className="edu-field__label" htmlFor={`edu-cant-${l.key}`}>
                      Cant.
                    </label>
                    <input
                      id={`edu-cant-${l.key}`}
                      className="edu-input edu-input--sm"
                      type="number"
                      min={1}
                      max={99}
                      value={l.quantity}
                      onChange={(e) =>
                        setLineas((ls) =>
                          ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)),
                        )
                      }
                    />
                  </div>

                  <div className="edu-field">
                    <label className="edu-field__label" htmlFor={`edu-desc-${l.key}`}>
                      Descuento
                    </label>
                    <input
                      id={`edu-desc-${l.key}`}
                      className="edu-input edu-input--sm"
                      inputMode="decimal"
                      value={l.discount}
                      onChange={(e) =>
                        setLineas((ls) =>
                          ls.map((x) => (x.key === l.key ? { ...x, discount: e.target.value } : x)),
                        )
                      }
                      placeholder="0.00"
                    />
                  </div>

                  <span className="edu-linea__total edu-precio">
                    {eduMoney(
                      eduLineTotalCents({
                        quantity: Number(l.quantity) || 0,
                        unitPriceCents: l.unitPriceCents,
                        discountCents: centavosDe(l.discount),
                      }),
                    )}
                  </span>

                  <button
                    type="button"
                    className="edu-assign__x"
                    aria-label={`Quitar ${l.description}`}
                    onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Línea libre: un material, una placa. El servidor no tiene
              opinión sobre algo que no está en el catálogo, así que aquí sí
              se teclea el precio — y queda marcada como línea libre en el
              recibo y en el corte. */}
          {libre ? (
            <div className="edu-formgrid edu-formgrid--2">
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-libre-desc">
                  Concepto libre
                </label>
                <input
                  id="edu-libre-desc"
                  className="edu-input"
                  value={libreDesc}
                  onChange={(e) => setLibreDesc(e.target.value)}
                  placeholder="Material de laboratorio"
                  autoComplete="off"
                />
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-libre-precio">
                  Precio
                </label>
                <input
                  id="edu-libre-precio"
                  className="edu-input"
                  inputMode="decimal"
                  value={librePrecio}
                  onChange={(e) => setLibrePrecio(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="edu-actions">
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={agregarLibre}
                  disabled={!libreDesc.trim() || centavosDe(librePrecio) <= 0}
                >
                  Agregar
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet edu-btn--sm"
                  onClick={() => setLibre(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="edu-btn edu-btn--quiet edu-btn--sm"
              onClick={() => setLibre(true)}
            >
              Agregar concepto libre (material, placa…)
            </button>
          )}

          {/* ── 4 · El total y el pago ─────────────────────────────── */}
          {lineas.length > 0 && (
            <>
              <div className="edu-totales">
                <div className="edu-totales__fila">
                  <span>Subtotal</span>
                  <span className="edu-precio">{eduMoney(totals.subtotalCents)}</span>
                </div>
                {totals.discountCents > 0 && (
                  <div className="edu-totales__fila">
                    <span>Descuento</span>
                    <span className="edu-precio">−{eduMoney(totals.discountCents)}</span>
                  </div>
                )}
                <div className="edu-totales__fila edu-totales__fila--fuerte">
                  <span>Total</span>
                  <span className="edu-precio">{eduMoney(totals.totalCents)}</span>
                </div>
              </div>

              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-pago-modo">
                  ¿Cómo paga?
                </label>
                <select
                  id="edu-pago-modo"
                  className="edu-input"
                  value={pagoModo}
                  onChange={(e) => setPagoModo(e.target.value as "ahora" | "despues" | "meses")}
                >
                  <option value="ahora">Paga ahora</option>
                  <option value="despues">Queda a deber (paga después)</option>
                  <option value="meses">A meses (plan de pagos)</option>
                </select>
                {pagoModo === "despues" && (
                  <span className="edu-field__hint">
                    El cobro queda con saldo y se liquida desde su recibo — o se difiere a meses
                    más tarde.
                  </span>
                )}
              </div>

              {pagoModo === "ahora" && (
                <>
                  <EduFormasPago
                    objetivoCents={totals.totalCents}
                    exacto={false}
                    value={pagos}
                    onChange={(next) => {
                      setPagosTocados(true);
                      setPagos(next);
                    }}
                    idPrefix="edu-cobro-fp"
                    disabled={busy}
                  />
                  {errorPagos && <p className="edu-note">{errorPagos}</p>}
                </>
              )}

              {pagoModo === "meses" && (
                <PlanAMeses
                  idPrefix="edu-cobro-plan"
                  todayISO={todayISO}
                  disponibleCents={totals.totalCents}
                  queEs="el total"
                  disabled={busy}
                  onChange={setPlanDatos}
                />
              )}

              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-cobro-notas">
                  Nota del cobro (opcional)
                </label>
                <input
                  id="edu-cobro-notas"
                  className="edu-input"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          )}
        </>
      )}
    </EduModal>
  );
}

/**
 * Centavos de lo que hay en un input, para la SUMA que se pinta mientras se
 * teclea. Devuelve 0 ante cualquier cosa rara: es aritmética de pantalla, y
 * el servidor vuelve a validar y a sumar al emitir. La versión que decide
 * de verdad es `parseEduMoneyCents` en el servidor.
 */
function centavosDe(texto: string): number {
  const limpio = texto.replace(/[^\d.]/g, "");
  if (!limpio) return 0;
  const [ent, dec = ""] = limpio.split(".");
  const n = Number(ent || "0") * 100 + Number((dec + "00").slice(0, 2));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ═══════════════════════════════════════════════════════════════════════
// EL RECIBO — y lo que se puede hacer desde él
// ═══════════════════════════════════════════════════════════════════════

function Recibo({
  charge,
  todayISO,
  canCharge,
  canRefund,
  onClose,
  onDone,
}: {
  charge: EduChargeRow;
  todayISO: string;
  canCharge: boolean;
  canRefund: boolean;
  onClose: () => void;
  onDone: (mensaje: string, enlace?: EduFlashEnlace) => void;
}) {
  const [modo, setModo] = useState<
    "ver" | "pago" | "devolucion" | "cancelar" | "plan" | "mensualidad"
  >("ver");
  // El pago suelto: hasta tres formas, como en el mostrador.
  const [pagos, setPagos] = useState<EduPagoDraft[]>(() => [
    eduNuevoPagoDraft(charge.balanceCents),
  ]);
  // 🔴 La DEVOLUCIÓN es UN movimiento y no se divide: mantiene su método
  // y su monto sueltos. Partir un reembolso en tres formas haría
  // imposible cuadrarlo contra el pago que revierte.
  const [metodo, setMetodo] = useState<EduPaymentMethod>("CASH");
  const [monto, setMonto] = useState(eduMoneyInputValue(charge.paidCents));
  const [referencia, setReferencia] = useState("");
  // El motivo de una devolución con método "Otro": el servidor lo EXIGE
  // (una beca o un vale sin explicar es un agujero en el arqueo), así que
  // la pantalla tiene que ofrecer dónde escribirlo.
  const [devNotas, setDevNotas] = useState("");
  const [motivo, setMotivo] = useState("");
  // Cobrar la siguiente mensualidad del plan, desde este mismo recibo.
  const [mensPagos, setMensPagos] = useState<EduPagoDraft[]>([]);
  // Pagar a meses, desde un cobro YA emitido con saldo.
  const [planDatos, setPlanDatos] = useState<EduPlanDatos | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelado = charge.status === "CANCELLED";
  const liquidado = charge.balanceCents <= 0;
  // El cobro ya tiene su plan: los pagos van por sus mensualidades y este
  // recibo solo enlaza. El servidor rebota los pagos sueltos igual — esto
  // evita ofrecer un botón que siempre contesta que no.
  const conPlan = charge.activePlanId !== null && !cancelado;

  // La siguiente mensualidad sin pagar del plan activo, si hay plan.
  const siguiente = charge.plan
    ? (charge.plan.installments.find((i) => i.status !== "PAGADA") ?? null)
    : null;

  const errorPagos =
    modo === "pago" ? eduValidarPagos(pagos, charge.balanceCents, false) : null;
  const errorMens =
    modo === "mensualidad" && siguiente
      ? eduValidarPagos(mensPagos, siguiente.amountCents, true)
      : null;

  async function pagarAMeses() {
    if (!planDatos) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ id: string; months: number }>(
        `/api/instituto/caja/cobros/${charge.id}/plan`,
        {
          method: "POST",
          body: {
            months: planDatos.months,
            dueDay: planDatos.dueDay,
            enganche: planDatos.enganchePayments ?? undefined,
          },
        },
      );
      onDone(
        `Cobro ${charge.folio} diferido a ${res.months} meses: la primera mensualidad vence el ${eduFechaLarga(
          planDatos.calendario[0].dueDateISO,
        )}.`,
        { href: `/instituto/caja/planes/${res.id}/recibo`, label: "Imprimir calendario" },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el plan.");
    } finally {
      setBusy(false);
    }
  }

  /** Cobrar la siguiente mensualidad SIN salir del recibo. */
  async function cobrarMensualidad() {
    if (!siguiente || errorMens) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ number: number; months: number; planSettled: boolean }>(
        `/api/instituto/caja/mensualidades/${siguiente.id}/pagar`,
        { method: "POST", body: { payments: eduSerializarPagos(mensPagos) } },
      );
      onDone(
        res.planSettled
          ? `Mensualidad ${res.number} de ${res.months} cobrada. El plan quedó liquidado.`
          : `Mensualidad ${res.number} de ${res.months} cobrada.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cobrar la mensualidad.");
    } finally {
      setBusy(false);
    }
  }

  async function registrar(isRefund: boolean) {
    if (!isRefund && errorPagos) return;
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/caja/cobros/${charge.id}/pagos`, {
        method: "POST",
        // El pago admite varias formas; la devolución, una sola.
        body: isRefund
          ? {
              method: metodo,
              amountCents: monto,
              reference: referencia.trim() || null,
              notes: devNotas.trim() || null,
              isRefund: true,
            }
          : { payments: eduSerializarPagos(pagos) },
      });
      onDone(isRefund ? "Devolución registrada." : "Pago registrado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/caja/cobros/${charge.id}`, {
        method: "PATCH",
        body: { reason: motivo.trim() || null },
      });
      onDone(`Cobro ${charge.folio} cancelado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Recibo ${charge.folio}`}
      subtitle={`${charge.patientName} · ${charge.patientFolio}`}
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

      {cancelado && (
        <div className="edu-banner edu-banner--warn">
          <div>
            <p className="edu-banner__title">Este cobro está cancelado</p>
            <p className="edu-banner__detail">
              No se le debe nada a nadie y no cuenta en ninguna suma.
              {charge.cancelReason ? ` Motivo: ${charge.cancelReason}` : ""}
              {charge.cancelledByName ? ` Lo canceló ${charge.cancelledByName}.` : ""}
            </p>
          </div>
        </div>
      )}

      <div className="edu-kv edu-kv--2">
        <div>
          <span className="edu-kv__k">Tarifa aplicada</span>
          <span className="edu-kv__v">{charge.feeScheduleLabel ?? "—"}</span>
        </div>
        <div>
          <span className="edu-kv__k">Cobró</span>
          <span className="edu-kv__v">{charge.chargedByName}</span>
        </div>
      </div>

      <div className="edu-lineas">
        {charge.items.map((i) => (
          <div className="edu-linea edu-linea--recibo" key={i.id}>
            <div className="edu-linea__desc">
              <span className="edu-linea__name">{i.description}</span>
              <span className="edu-linea__sub">
                {i.quantity} × {eduMoney(i.unitPriceCents)}
                {i.discountCents > 0 ? ` · −${eduMoney(i.discountCents)}` : ""}
                {i.procedureId === null ? " · línea libre" : ""}
              </span>
              {/* 🔴 El rastro del antifraude, a la vista de quien puede
                  verlo. Si la pantalla mandó un precio distinto al del
                  servidor, se dice aquí — no se esconde en un log. */}
              {i.clientPriceCents !== null && (
                <span className="edu-linea__aviso">
                  La pantalla mandó {eduMoney(i.clientPriceCents)} y se aplicó el precio del
                  servidor.
                </span>
              )}
            </div>
            <span className="edu-linea__total edu-precio">{eduMoney(i.totalCents)}</span>
          </div>
        ))}
      </div>

      <div className="edu-totales">
        <div className="edu-totales__fila">
          <span>Subtotal</span>
          <span className="edu-precio">{eduMoney(charge.subtotalCents)}</span>
        </div>
        {charge.discountCents > 0 && (
          <div className="edu-totales__fila">
            <span>Descuento</span>
            <span className="edu-precio">−{eduMoney(charge.discountCents)}</span>
          </div>
        )}
        <div className="edu-totales__fila edu-totales__fila--fuerte">
          <span>Total</span>
          <span className="edu-precio">{eduMoney(charge.totalCents)}</span>
        </div>
        <div className="edu-totales__fila">
          <span>Pagado</span>
          <span className="edu-precio">{eduMoney(charge.paidCents)}</span>
        </div>
        <div className="edu-totales__fila edu-totales__fila--fuerte">
          <span>Saldo</span>
          <span className="edu-precio">{eduMoney(charge.balanceCents)}</span>
        </div>
      </div>

      {charge.payments.length > 0 && (
        <div className="edu-stack edu-stack--tight">
          {charge.payments.map((p) => (
            <div className="edu-pago" key={p.id}>
              <span className="edu-pago__q">
                {p.isRefund ? "Devolución" : "Pago"} · {EDU_PAYMENT_METHOD_LABELS[p.method]}
                {p.msiMonths ? ` · ${p.msiMonths} MSI` : ""}
                {p.installmentNumber
                  ? ` · Mensualidad ${p.installmentNumber} de ${p.installmentMonths}`
                  : ""}
                {p.reference ? ` · ${p.reference}` : ""}
                {p.notes ? ` · ${p.notes}` : ""}
              </span>
              <span className={`edu-precio ${p.isRefund ? "edu-precio--menos" : ""}`}>
                {p.isRefund ? "−" : ""}
                {eduMoney(p.amountCents)}
              </span>
              {/* La FECHA la escribió el servidor en la zona del instituto:
                  formatearla aquí pintaría la del navegador. */}
              <span className="edu-pago__sub">
                {p.paidAtLabel} · {p.receivedByName}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── EL PLAN, AQUÍ MISMO ────────────────────────────────────
          Antes esto era un banner con un enlace, y el calendario quedaba
          dos clics más lejos: quien preguntaba "¿cuándo paga?" no tenía
          respuesta a la vista. Ahora las mensualidades están en el recibo,
          con su fecha, su monto y su estado, y la siguiente se cobra sin
          salir de aquí. */}
      {conPlan && charge.plan && (
        <>
          <div className="edu-banner">
            <div>
              <p className="edu-banner__title">
                Este cobro se paga a meses · {charge.plan.paidCount} de {charge.plan.months}{" "}
                pagadas
              </p>
              <p className="edu-banner__detail">
                Se cobra por mensualidades, no con pagos sueltos. Para moverlo libre, cancela
                primero el plan (permiso caja.refund).
              </p>
            </div>
            <Link
              href={`/instituto/caja/planes/${charge.plan.id}/recibo`}
              className="edu-btn edu-btn--ghost edu-btn--sm"
            >
              Imprimir calendario
            </Link>
          </div>

          <ul className="edu-calendario">
            {charge.plan.installments.map((i) => (
              <li
                className={`edu-calendario__fila ${
                  i.status === "VENCIDA" ? "edu-calendario__fila--vencida" : ""
                }`}
                key={i.id}
              >
                <span className="edu-calendario__n">{i.number}</span>
                <span className="edu-calendario__fecha">
                  {eduFechaLarga(i.dueDateISO)}
                  <span className="edu-calendario__nota">
                    {EDU_INSTALLMENT_STATUS_LABELS[i.status]}
                  </span>
                </span>
                <span className="edu-calendario__monto">{eduMoney(i.amountCents)}</span>
              </li>
            ))}
            <li className="edu-calendario__pie">
              <span>Por pagar</span>
              <span className="edu-precio">{eduMoney(charge.plan.pendingCents)}</span>
            </li>
          </ul>

          {canCharge && siguiente && modo === "ver" && (
            <div className="edu-actions">
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => {
                  setMensPagos([eduNuevoPagoDraft(siguiente.amountCents)]);
                  setModo("mensualidad");
                }}
              >
                Cobrar la {siguiente.number} de {charge.plan.months} ·{" "}
                {eduMoney(siguiente.amountCents)}
              </button>
            </div>
          )}

          {modo === "mensualidad" && siguiente && (
            <>
              <p className="edu-note">
                Se cobra EXACTAMENTE {eduMoney(siguiente.amountCents)}, el monto de la mensualidad{" "}
                {siguiente.number} de {charge.plan.months} (vence el{" "}
                {eduFechaLarga(siguiente.dueDateISO)}). Se puede dividir entre formas de pago,
                nunca entre meses.
              </p>
              <EduFormasPago
                objetivoCents={siguiente.amountCents}
                exacto
                value={mensPagos}
                onChange={setMensPagos}
                idPrefix="edu-rec-mens"
                disabled={busy}
              />
              {errorMens && <p className="edu-note">{errorMens}</p>}
              <div className="edu-actions">
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  onClick={cobrarMensualidad}
                  disabled={busy || Boolean(errorMens)}
                >
                  {busy ? "Cobrando…" : `Cobrar ${eduMoney(siguiente.amountCents)}`}
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet edu-btn--sm"
                  onClick={() => setModo("ver")}
                  disabled={busy}
                >
                  Volver
                </button>
              </div>
            </>
          )}
        </>
      )}

      {!cancelado && !conPlan && modo === "ver" && (
        <div className="edu-actions">
          {canCharge && !liquidado && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => {
                setPagos([eduNuevoPagoDraft(charge.balanceCents)]);
                setModo("pago");
              }}
            >
              Registrar pago
            </button>
          )}
          {canCharge && !liquidado && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => setModo("plan")}
            >
              Pagar a meses
            </button>
          )}
          {canRefund && charge.paidCents > 0 && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => {
                setMonto(eduMoneyInputValue(charge.paidCents));
                setModo("devolucion");
              }}
            >
              Devolver dinero
            </button>
          )}

          {canRefund && charge.paidCents === 0 && (
            <button
              type="button"
              className="edu-btn edu-btn--danger edu-btn--sm"
              onClick={() => setModo("cancelar")}
            >
              Cancelar cobro
            </button>
          )}
        </div>
      )}

      {modo === "plan" && (
        <>
          {/* 🔴 EL MISMO bloque que en Cobrar → "A meses": mismos chips,
              mismo día de pago y el MISMO calendario con fechas. Un solo
              componente para que las dos pantallas no puedan discrepar. */}
          <PlanAMeses
            idPrefix="edu-rec-plan"
            todayISO={todayISO}
            disponibleCents={charge.balanceCents}
            queEs="el saldo"
            disabled={busy}
            onChange={setPlanDatos}
          />

          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={pagarAMeses}
              disabled={busy || !planDatos}
            >
              {busy
                ? "Creando el plan…"
                : planDatos
                  ? `Diferir a ${planDatos.months} meses · primera el ${eduFechaLarga(
                      planDatos.calendario[0].dueDateISO,
                    )}`
                  : "Diferir a meses"}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--quiet edu-btn--sm"
              onClick={() => setModo("ver")}
              disabled={busy}
            >
              Volver
            </button>
          </div>
        </>
      )}

      {modo === "pago" && (
        <>
          <EduFormasPago
            objetivoCents={charge.balanceCents}
            exacto={false}
            value={pagos}
            onChange={setPagos}
            idPrefix="edu-rec-fp"
            disabled={busy}
          />
          {errorPagos && <p className="edu-note">{errorPagos}</p>}
          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => registrar(false)}
              disabled={busy || Boolean(errorPagos)}
            >
              {busy ? "Guardando…" : "Registrar pago"}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--quiet edu-btn--sm"
              onClick={() => setModo("ver")}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </>
      )}

      {/* 🔴 La DEVOLUCIÓN no se divide: un método y un monto. Repartir un
          reembolso en tres formas haría imposible cuadrarlo contra el pago
          que revierte. */}
      {modo === "devolucion" && (
        <div className="edu-formgrid edu-formgrid--2">
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-rec-metodo">
              Por dónde sale el dinero
            </label>
            <select
              id="edu-rec-metodo"
              className="edu-input"
              value={metodo}
              onChange={(e) => setMetodo(e.target.value as EduPaymentMethod)}
            >
              {EDU_PAYMENT_METHODS_COBRABLES.map((m) => (
                <option key={m} value={m}>
                  {EDU_PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-rec-monto">
              Monto
            </label>
            <input
              id="edu-rec-monto"
              className="edu-input"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
            <span className="edu-field__hint">
              Como mucho lo pagado: {eduMoney(charge.paidCents)}.
            </span>
          </div>
          {/* 🔴 El campo contextual, igual que en el bloque de formas de
              pago: un cheque SIN número no se puede rastrear y un "Otro"
              sin motivo es un agujero en el arqueo. El servidor exige los
              dos, así que la pantalla tiene que ofrecerlos —y decir que
              son obligatorios— en vez de rebotar con un 400. */}
          {metodo === "OTHER" ? (
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-rec-mot">
                Motivo (beca, vale, cortesía)
              </label>
              <input
                id="edu-rec-mot"
                className="edu-input"
                value={devNotas}
                onChange={(e) => setDevNotas(e.target.value)}
                placeholder="Cortesía de la dirección"
                autoComplete="off"
              />
              <span className="edu-field__hint">
                Obligatorio: al menos 3 letras. Es lo que explica el movimiento en el corte.
              </span>
            </div>
          ) : (
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-rec-ref">
                {metodo === "CHECK" ? "Número de cheque y banco" : "Referencia (opcional)"}
              </label>
              <input
                id="edu-rec-ref"
                className="edu-input"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                autoComplete="off"
              />
              {metodo === "CHECK" && (
                <span className="edu-field__hint">
                  Obligatorio: sin él, un cheque devuelto no se puede rastrear.
                </span>
              )}
            </div>
          )}
          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => registrar(true)}
              disabled={
                busy ||
                (metodo === "OTHER" && devNotas.trim().length < 3) ||
                (metodo === "CHECK" && referencia.trim() === "")
              }
            >
              {busy ? "Guardando…" : "Registrar devolución"}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--quiet edu-btn--sm"
              onClick={() => setModo("ver")}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {modo === "cancelar" && (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-rec-motivo">
              Motivo de la cancelación
            </label>
            <input
              id="edu-rec-motivo"
              className="edu-input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Se cobró al paciente equivocado"
              autoComplete="off"
            />
            <span className="edu-field__hint">
              El cobro no se borra: queda cancelado, con quién lo canceló y cuándo, y deja de contar
              en toda suma de dinero.
            </span>
          </div>
          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--danger edu-btn--sm"
              onClick={cancelar}
              disabled={busy}
            >
              {busy ? "Cancelando…" : "Cancelar el cobro"}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--quiet edu-btn--sm"
              onClick={() => setModo("ver")}
              disabled={busy}
            >
              Volver
            </button>
          </div>
        </>
      )}
    </EduModal>
  );
}
