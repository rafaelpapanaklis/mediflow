"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { eduMoney } from "@/lib/edu/dinero-core";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import {
  eduFechaLarga,
  eduInstallmentsDueBetween,
  eduInstallmentsVencidas,
  eduPlanAddDaysISO,
  type EduInstallmentConPlan,
  type EduPlanFilters,
  type EduPlanRow,
  type EduPlanesPage,
} from "@/lib/edu/pagos-core";
import {
  EDU_INSTALLMENT_STATUS_LABELS,
  EDU_PAYMENT_METHODS,
  EDU_PAYMENT_METHOD_LABELS,
  EDU_PAYMENT_PLAN_STATUSES,
  EDU_PAYMENT_PLAN_STATUS_LABELS,
  type EduInstallmentStatus,
  type EduPaymentMethod,
  type EduPaymentPlanStatus,
} from "@/lib/edu/types";

/**
 * /instituto/caja/planes — PAGOS A MESES.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTA PANTALLA NO CALCULA NI UN ESTADO NI UN SALDO.
 *
 * Todo llega YA derivado del servidor (pagos.ts → pagos-core.ts): el
 * VENCIDA de cada mensualidad se calculó contra el hoy del INSTITUTO al
 * leer, y los números del plan salen de sus mensualidades. Lo único que
 * este componente arma en el cliente son las dos listas de urgencia
 * ("vencidas" y "vencen esta semana") — con las MISMAS funciones puras
 * que usaría el servidor, sobre los estados que él ya derivó.
 *
 * 🔴 Y NO SE TECLEA NI UN MONTO. Cobrar una mensualidad manda el método y
 * la referencia; el monto es el congelado de la fila y lo pone el
 * servidor. Un input de monto aquí sería la puerta a la caja que no
 * cuadra.
 * ═══════════════════════════════════════════════════════════════════════
 */

const TAG_BY_PLAN: Record<EduPaymentPlanStatus, string> = {
  ACTIVO: "edu-tag--info",
  LIQUIDADO: "edu-tag--ok",
  CANCELADO: "edu-tag--muted",
};

const TAG_BY_INSTALLMENT: Record<EduInstallmentStatus, string> = {
  PENDIENTE: "edu-tag--info",
  PAGADA: "edu-tag--ok",
  VENCIDA: "edu-tag--warn",
};

/** Cuántos días abarca "vencen esta semana": [hoy, hoy+7). */
const EDU_PLAN_SEMANA_DIAS = 7;

export interface EduPlanesScreenProps {
  page: EduPlanesPage;
  filters: EduPlanFilters;
  maxRows: number;
  canCharge: boolean;
  canRefund: boolean;
}

export function EduPlanesScreen({ page, filters, maxRows, canCharge, canRefund }: EduPlanesScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const [flash, setFlash] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const { rows, truncated, todayISO } = page;

  // Las dos listas de urgencia, con las funciones puras del vertical:
  // solo mensualidades SIN pagar de planes ACTIVOS.
  const vencidas = useMemo(() => eduInstallmentsVencidas(rows), [rows]);
  const semana = useMemo(() => {
    const hasta = eduPlanAddDaysISO(todayISO, EDU_PLAN_SEMANA_DIAS);
    return hasta ? eduInstallmentsDueBetween(rows, todayISO, hasta) : [];
  }, [rows, todayISO]);

  const activos = useMemo(() => rows.filter((p) => p.status === "ACTIVO"), [rows]);
  const porCobrarCents = activos.reduce((a, p) => a + p.pendingCents, 0);
  const vencidoCents = vencidas.reduce((a, x) => a + x.installment.amountCents, 0);
  const semanaCents = semana.reduce((a, x) => a + x.installment.amountCents, 0);

  const detalle = detalleId ? (rows.find((p) => p.id === detalleId) ?? null) : null;
  const hayFiltros = Boolean(filters.q || filters.status !== "ACTIVO");

  function aplicar(next: { estado?: string; q?: string }) {
    const params = new URLSearchParams();
    const estado = next.estado ?? (filters.status ?? "todos");
    // ACTIVO es el default: no ensucia la URL.
    if (estado && estado !== "ACTIVO") params.set("estado", estado);
    const term = next.q ?? (filters.q ?? "");
    if (term.trim()) params.set("q", term.trim());
    const qs = params.toString();
    startNav(() => {
      router.replace(qs ? `/instituto/caja/planes?${qs}` : "/instituto/caja/planes", {
        scroll: false,
      });
    });
  }

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setDetalleId(null);
    startNav(() => router.refresh());
  }

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ q });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-planes-q">
            Buscar
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-planes-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Paciente o folio del cobro"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-planes-estado">
            Estado
          </label>
          <select
            id="edu-planes-estado"
            className="edu-input edu-input--sm"
            value={filters.status ?? "todos"}
            onChange={(e) => aplicar({ estado: e.target.value })}
          >
            {EDU_PAYMENT_PLAN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "ACTIVO" ? "Activos" : `${EDU_PAYMENT_PLAN_STATUS_LABELS[s]}s`}
              </option>
            ))}
            <option value="todos">Todos</option>
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace("/instituto/caja/planes", { scroll: false }));
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
            : `${rows.length} ${rows.length === 1 ? "plan" : "planes"}${
                truncated ? ` (se muestran los primeros ${maxRows})` : ""
              }`}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="edu-kpis">
          <div className="edu-kpi">
            <span className="edu-kpi__label">Planes activos</span>
            <span className="edu-kpi__value">{activos.length}</span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Por cobrar a meses</span>
            <span className="edu-kpi__value">{eduMoney(porCobrarCents)}</span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Vencido</span>
            <span className="edu-kpi__value">
              {vencidas.length > 0 ? eduMoney(vencidoCents) : "—"}
            </span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Vencen en 7 días</span>
            <span className="edu-kpi__value">{semana.length > 0 ? eduMoney(semanaCents) : "—"}</span>
          </div>
        </div>
      )}

      {vencidas.length > 0 && (
        <UrgenciaLista
          titulo={`${vencidas.length} ${vencidas.length === 1 ? "mensualidad vencida" : "mensualidades vencidas"}`}
          detalle="Sin pagar y con la fecha pasada. Lo dice el calendario en cada lectura — no hay ningún proceso nocturno que se le pueda olvidar."
          items={vencidas}
          warn
          onVer={(planId) => {
            setFlash(null);
            setDetalleId(planId);
          }}
        />
      )}

      {semana.length > 0 && (
        <UrgenciaLista
          titulo={`${semana.length} ${semana.length === 1 ? "mensualidad vence" : "mensualidades vencen"} esta semana`}
          detalle="De hoy a siete días. Cobrarlas antes del corte evita que pasen a vencidas."
          items={semana}
          onVer={(planId) => {
            setFlash(null);
            setDetalleId(planId);
          }}
        />
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros ? "Ningún plan coincide" : "Todavía no hay pagos a meses"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros, o cambia el estado a “Todos”."
              : "Un cobro con saldo se difiere desde su recibo, en Caja: “Pagar a meses”. El sistema arma las mensualidades solo, con sus fechas."}
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--planes">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Cobro</span>
            <span>Paciente</span>
            <span>Mensualidad</span>
            <span>Avance</span>
            <span>Próxima</span>
            <span>Estado</span>
            <span />
          </div>

          {rows.map((p) => (
            <PlanFila
              key={p.id}
              plan={p}
              onVer={() => {
                setFlash(null);
                setDetalleId(p.id);
              }}
            />
          ))}
        </div>
      )}

      {detalle && (
        <PlanDetalle
          plan={detalle}
          canCharge={canCharge}
          canRefund={canRefund}
          onClose={() => setDetalleId(null)}
          onDone={recargar}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA FICHA DEL PACIENTE — sus mensualidades, lo que debe y cuándo
// ═══════════════════════════════════════════════════════════════════════

export interface EduPacientePagosProps {
  page: EduPlanesPage;
  canCharge: boolean;
  canRefund: boolean;
}

export function EduPacientePagos({ page, canCharge, canRefund }: EduPacientePagosProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const { rows, todayISO } = page;
  const vencidas = useMemo(() => eduInstallmentsVencidas(rows), [rows]);
  const activos = useMemo(() => rows.filter((p) => p.status === "ACTIVO"), [rows]);
  const debeCents = activos.reduce((a, p) => a + p.pendingCents, 0);
  const vencidoCents = vencidas.reduce((a, x) => a + x.installment.amountCents, 0);
  const proxima = activos
    .map((p) => p.nextDueISO)
    .filter((d): d is string => d !== null)
    .sort()[0];

  const detalle = detalleId ? (rows.find((p) => p.id === detalleId) ?? null) : null;

  if (rows.length === 0) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Este paciente no tiene pagos a meses</p>
        <p className="edu-empty__detail">
          Cuando un cobro suyo se difiera, aquí aparecerán sus mensualidades, lo que debe y
          cuándo. Se difiere desde el recibo del cobro, en Caja.
        </p>
      </div>
    );
  }

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
          <span className="edu-kpi__label">Debe a meses</span>
          <span className="edu-kpi__value">{eduMoney(debeCents)}</span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Vencido</span>
          <span className="edu-kpi__value">{vencidas.length > 0 ? eduMoney(vencidoCents) : "—"}</span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Próximo vencimiento</span>
          <span className="edu-kpi__value">{proxima ? eduFechaLarga(proxima) : "—"}</span>
        </div>
      </div>

      {vencidas.length > 0 && (
        <UrgenciaLista
          titulo={`${vencidas.length} ${vencidas.length === 1 ? "mensualidad vencida" : "mensualidades vencidas"}`}
          detalle="Sin pagar y con la fecha pasada."
          items={vencidas}
          warn
          onVer={(planId) => setDetalleId(planId)}
        />
      )}

      <div className="edu-table edu-table--planes">
        <div className="edu-rowhead" aria-hidden="true">
          <span>Cobro</span>
          <span>Paciente</span>
          <span>Mensualidad</span>
          <span>Avance</span>
          <span>Próxima</span>
          <span>Estado</span>
          <span />
        </div>
        {rows.map((p) => (
          <PlanFila
            key={p.id}
            plan={p}
            onVer={() => {
              setFlash(null);
              setDetalleId(p.id);
            }}
          />
        ))}
      </div>

      {detalle && (
        <PlanDetalle
          plan={detalle}
          canCharge={canCharge}
          canRefund={canRefund}
          onClose={() => setDetalleId(null)}
          onDone={(mensaje) => {
            setFlash(mensaje);
            setDetalleId(null);
            startNav(() => router.refresh());
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PIEZAS COMPARTIDAS
// ═══════════════════════════════════════════════════════════════════════

function UrgenciaLista({
  titulo,
  detalle,
  items,
  warn,
  onVer,
}: {
  titulo: string;
  detalle: string;
  items: EduInstallmentConPlan[];
  warn?: boolean;
  onVer: (planId: string) => void;
}) {
  return (
    <div className={`edu-banner ${warn ? "edu-banner--warn" : ""}`}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="edu-banner__title">{titulo}</p>
        <p className="edu-banner__detail">{detalle}</p>
        <div className="edu-stack edu-stack--tight" style={{ marginTop: 8 }}>
          {items.slice(0, 8).map(({ plan, installment }) => (
            <div className="edu-pago" key={installment.id}>
              <span className="edu-pago__q">
                <EduPersonaLink kind="paciente" id={plan.patientId}>
                  {plan.patientName}
                </EduPersonaLink>{" "}
                · {plan.chargeFolio} · mensualidad {installment.number} de{" "}
                {plan.months} · vence {eduFechaLarga(installment.dueDateISO)}
              </span>
              <span className="edu-precio">{eduMoney(installment.amountCents)}</span>
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => onVer(plan.id)}
              >
                Ver plan
              </button>
            </div>
          ))}
          {items.length > 8 && (
            <p className="edu-note">…y {items.length - 8} más. La lista completa está abajo.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanFila({ plan, onVer }: { plan: EduPlanRow; onVer: () => void }) {
  return (
    <div className={`edu-row ${plan.status === "CANCELADO" ? "edu-row--off" : ""}`}>
      <div className="edu-cell">
        <span className="edu-cell__label">Cobro</span>
        <span className="edu-cell__value edu-cell__value--strong">{plan.chargeFolio}</span>
      </div>

      <div className="edu-cell edu-cell--wide">
        <span className="edu-cell__label">Paciente</span>
        <span className="edu-cell__value edu-cell__value--strong">
          <EduPersonaLink kind="paciente" id={plan.patientId}>
            {plan.patientName}
          </EduPersonaLink>
        </span>
        <span className="edu-cell__sub">{plan.patientFolio}</span>
      </div>

      <div className="edu-cell">
        <span className="edu-cell__label">Mensualidad</span>
        <span className="edu-cell__value edu-precio">
          {eduMoney(plan.installmentCents)} × {plan.months}
        </span>
        {plan.installments[0] && plan.installments[0].amountCents !== plan.installmentCents && (
          <span className="edu-cell__sub">la 1ª de {eduMoney(plan.installments[0].amountCents)}</span>
        )}
      </div>

      <div className="edu-cell">
        <span className="edu-cell__label">Avance</span>
        <span className="edu-cell__value">
          {plan.paidCount} de {plan.months} pagadas
        </span>
        {plan.pendingCents > 0 && (
          <span className="edu-cell__sub">faltan {eduMoney(plan.pendingCents)}</span>
        )}
      </div>

      <div className="edu-cell">
        <span className="edu-cell__label">Próxima</span>
        <span className="edu-cell__value">
          {plan.status === "ACTIVO" && plan.nextDueISO ? eduFechaLarga(plan.nextDueISO) : "—"}
        </span>
        {plan.status === "ACTIVO" && plan.overdueCount > 0 && (
          <span className="edu-tag edu-tag--warn">
            {plan.overdueCount} {plan.overdueCount === 1 ? "vencida" : "vencidas"}
          </span>
        )}
      </div>

      <div className="edu-cell">
        <span className="edu-cell__label">Estado</span>
        <span className={`edu-tag ${TAG_BY_PLAN[plan.status]}`}>
          {EDU_PAYMENT_PLAN_STATUS_LABELS[plan.status]}
        </span>
      </div>

      <div className="edu-cell__actions">
        <button type="button" className="edu-btn edu-btn--ghost edu-btn--sm" onClick={onVer}>
          Ver plan
        </button>
        <Link
          className="edu-btn edu-btn--ghost edu-btn--sm"
          href={`/instituto/caja/planes/${plan.id}/recibo`}
        >
          Recibo
        </Link>
      </div>
    </div>
  );
}

/**
 * El detalle de un plan: el calendario completo y las dos acciones.
 *
 * Cobrar la siguiente mensualidad exige `caja.charge`; cancelar el plan,
 * `caja.refund`. Las mensualidades se cobran EN ORDEN — el botón solo
 * ofrece la más vieja sin pagar, que es lo que el servidor acepta.
 */
function PlanDetalle({
  plan,
  canCharge,
  canRefund,
  onClose,
  onDone,
}: {
  plan: EduPlanRow;
  canCharge: boolean;
  canRefund: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [modo, setModo] = useState<"ver" | "cobrar" | "cancelar">("ver");
  const [metodo, setMetodo] = useState<EduPaymentMethod>("CASH");
  const [referencia, setReferencia] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siguiente = plan.installments.find((i) => i.status !== "PAGADA") ?? null;

  async function cobrar() {
    if (!siguiente) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ number: number; months: number; planSettled: boolean }>(
        `/api/instituto/caja/mensualidades/${siguiente.id}/pagar`,
        { method: "POST", body: { method: metodo, reference: referencia.trim() || null } },
      );
      onDone(
        res.planSettled
          ? `Mensualidad ${res.number} de ${res.months} cobrada. El plan quedó liquidado.`
          : `Mensualidad ${res.number} de ${res.months} cobrada.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cobrar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/caja/planes/${plan.id}/cancelar`, {
        method: "POST",
        body: { reason: motivo.trim() || null },
      });
      onDone(
        `Plan del cobro ${plan.chargeFolio} cancelado. Lo pagado se queda pagado; el saldo vuelve a cobrarse normal.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Plan de pagos · ${plan.chargeFolio}`}
      subtitle={
        <>
          <EduPersonaLink kind="paciente" id={plan.patientId}>
            {plan.patientName}
          </EduPersonaLink>{" "}
          · {plan.patientFolio}
        </>
      }
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

      {plan.status === "CANCELADO" && (
        <div className="edu-banner edu-banner--warn">
          <div>
            <p className="edu-banner__title">Este plan está cancelado</p>
            <p className="edu-banner__detail">
              Lo pagado se quedó pagado; el saldo del cobro se cobra normal desde su recibo.
              {plan.cancelReason ? ` Motivo: ${plan.cancelReason}` : ""}
              {plan.cancelledByName ? ` Lo canceló ${plan.cancelledByName}.` : ""}
            </p>
          </div>
        </div>
      )}

      <div className="edu-kv edu-kv--2">
        <div>
          <span className="edu-kv__k">Se difirió</span>
          <span className="edu-kv__v edu-precio">{eduMoney(plan.planCents)}</span>
        </div>
        <div>
          <span className="edu-kv__k">Enganche y abonos previos</span>
          <span className="edu-kv__v edu-precio">
            {plan.downPaymentCents > 0 ? eduMoney(plan.downPaymentCents) : "—"}
          </span>
        </div>
        <div>
          <span className="edu-kv__k">Mensualidad</span>
          <span className="edu-kv__v">
            {eduMoney(plan.installmentCents)} × {plan.months}, día {plan.dueDay}
          </span>
        </div>
        <div>
          <span className="edu-kv__k">Lo armó</span>
          <span className="edu-kv__v">{plan.createdByName}</span>
        </div>
      </div>

      <div className="edu-lineas">
        {plan.installments.map((i) => (
          <div className="edu-linea edu-linea--recibo" key={i.id}>
            <div className="edu-linea__desc">
              <span className="edu-linea__name">
                Mensualidad {i.number} de {plan.months}
              </span>
              <span className="edu-linea__sub">
                Vence {eduFechaLarga(i.dueDateISO)}
                {i.status === "PAGADA" && i.method
                  ? ` · pagada con ${EDU_PAYMENT_METHOD_LABELS[i.method].toLowerCase()}${
                      i.receivedByName ? ` (recibió ${i.receivedByName})` : ""
                    }`
                  : ""}
              </span>
            </div>
            <span className={`edu-tag ${TAG_BY_INSTALLMENT[i.status]}`}>
              {EDU_INSTALLMENT_STATUS_LABELS[i.status]}
            </span>
            <span className="edu-linea__total edu-precio">{eduMoney(i.amountCents)}</span>
          </div>
        ))}
      </div>

      <div className="edu-totales">
        <div className="edu-totales__fila">
          <span>Pagadas</span>
          <span>
            {plan.paidCount} de {plan.months}
          </span>
        </div>
        {plan.overdueCount > 0 && plan.status === "ACTIVO" && (
          <div className="edu-totales__fila">
            <span>Vencido</span>
            <span className="edu-precio">{eduMoney(plan.overdueCents)}</span>
          </div>
        )}
        <div className="edu-totales__fila edu-totales__fila--fuerte">
          <span>Por pagar</span>
          <span className="edu-precio">{eduMoney(plan.status === "ACTIVO" ? plan.pendingCents : 0)}</span>
        </div>
      </div>

      {plan.status === "ACTIVO" && modo === "ver" && (
        <div className="edu-actions">
          {canCharge && siguiente && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => setModo("cobrar")}
            >
              Cobrar la {siguiente.number} de {plan.months} · {eduMoney(siguiente.amountCents)}
            </button>
          )}
          {canRefund && (
            <button
              type="button"
              className="edu-btn edu-btn--danger edu-btn--sm"
              onClick={() => setModo("cancelar")}
            >
              Cancelar plan
            </button>
          )}
        </div>
      )}

      {modo === "cobrar" && siguiente && (
        <div className="edu-formgrid edu-formgrid--2">
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-mens-metodo">
              Método
            </label>
            <select
              id="edu-mens-metodo"
              className="edu-input"
              value={metodo}
              onChange={(e) => setMetodo(e.target.value as EduPaymentMethod)}
            >
              {EDU_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {EDU_PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <span className="edu-field__hint">
              El monto no se teclea: se cobra exactamente {eduMoney(siguiente.amountCents)}, el de
              la mensualidad.
            </span>
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-mens-ref">
              Referencia (opcional)
            </label>
            <input
              id="edu-mens-ref"
              className="edu-input"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Autorización de la terminal"
              autoComplete="off"
            />
          </div>
          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={cobrar}
              disabled={busy}
            >
              {busy
                ? "Cobrando…"
                : `Cobrar ${eduMoney(siguiente.amountCents)} (mensualidad ${siguiente.number})`}
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
        </div>
      )}

      {modo === "cancelar" && (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-plan-motivo">
              Motivo de la cancelación
            </label>
            <input
              id="edu-plan-motivo"
              className="edu-input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="El paciente liquidará de contado"
              autoComplete="off"
            />
            <span className="edu-field__hint">
              El plan no se borra: queda cancelado, con quién y cuándo. Lo ya pagado se queda
              pagado — son pagos reales, están en su corte. El saldo del cobro vuelve a cobrarse
              normal desde su recibo, o se difiere en un plan nuevo.
            </span>
          </div>
          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--danger edu-btn--sm"
              onClick={cancelar}
              disabled={busy}
            >
              {busy ? "Cancelando…" : "Cancelar el plan"}
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
