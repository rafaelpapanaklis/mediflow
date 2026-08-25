"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/rentas — los contratos de arrendamiento.
//
// Pensada para el señor con diez casas que hoy las lleva en Excel: sin
// jerga, todo en dos clics y con el número que le importa (cuánto le deben)
// arriba de todo.
//
// i18n por CONVENCIÓN B: el servidor ya bajó el sub-árbol `realty.rentals`
// y aquí el prefijo va VACÍO. Anteponerlo otra vez pintaría las llaves
// crudas (ver src/lib/realty/i18n.ts).
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowRight, CalendarClock, Plus, Search } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  formatMoney,
  formatShortDate,
  monthKey,
  todayInTimezone,
} from "@/lib/realty/rent-charges";
import type { RealtyLeaseStatus } from "@/lib/realty/types";
import { Card, EmptyState, Kpi, Pill, Tabs } from "./ui";
import { LeaseForm, type ContactOption, type PropertyOption } from "./lease-form";
import "./rentals.css";

export interface LeaseRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyCity: string | null;
  tenantName: string;
  tenantPhone: string | null;
  startsAt: string;
  endsAt: string;
  rentAmount: number;
  currency: "MXN" | "USD";
  paymentDay: number;
  status: RealtyLeaseStatus;
  daysToEnd: number;
  expiryWindow: number | null;
  balance: number;
  overdueCount: number;
  chargeCount: number;
}

type StatusFilter = RealtyLeaseStatus | "TODOS";

const STATUS_TONE: Record<RealtyLeaseStatus, "success" | "warning" | "neutral"> = {
  BORRADOR: "neutral",
  ACTIVO: "success",
  VENCIDO: "warning",
  TERMINADO: "neutral",
};

export function LeasesClient({
  dict,
  leases,
  properties,
  contacts,
  timezone,
  canEdit,
}: {
  dict: Dictionary;
  leases: LeaseRow[];
  properties: PropertyOption[];
  contacts: ContactOption[];
  timezone: string;
  canEdit: boolean;
}) {
  const t = makeRealtyT(dict);
  const router = useRouter();

  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [expiring, setExpiring] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const today = useMemo(() => todayInTimezone(timezone), [timezone]);
  const defaultMonth = useMemo(() => monthKey(today), [today]);

  // Los KPI se calculan sobre TODOS los contratos, no sobre los filtrados:
  // el saldo total no puede cambiar porque alguien escribió en el buscador.
  const kpi = useMemo(() => {
    let active = 0;
    let expiring90 = 0;
    let balance = 0;
    let overdue = 0;
    for (const l of leases) {
      if (l.status === "ACTIVO") active += 1;
      if (l.expiryWindow !== null && (l.status === "ACTIVO" || l.status === "VENCIDO")) {
        expiring90 += 1;
      }
      balance += l.balance;
      overdue += l.overdueCount;
    }
    return { active, expiring90, balance, overdue };
  }, [leases]);

  const counts = useMemo(() => {
    const map: Record<StatusFilter, number> = {
      TODOS: leases.length,
      BORRADOR: 0,
      ACTIVO: 0,
      VENCIDO: 0,
      TERMINADO: 0,
    };
    for (const l of leases) map[l.status] += 1;
    return map;
  }, [leases]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leases.filter((l) => {
      if (status !== "TODOS" && l.status !== status) return false;
      if (expiring !== null) {
        if (l.expiryWindow === null || l.expiryWindow > expiring) return false;
        if (l.status !== "ACTIVO" && l.status !== "VENCIDO") return false;
      }
      if (needle) {
        const hay = `${l.propertyTitle} ${l.tenantName} ${l.propertyCity ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [leases, status, expiring, q]);

  const filtered = status !== "TODOS" || expiring !== null || q.trim() !== "";

  function endsLabel(l: LeaseRow): string {
    if (l.daysToEnd === 0) return t("leases.detail.endsToday");
    if (l.daysToEnd < 0) return t("leases.detail.endedAgo", { count: Math.abs(l.daysToEnd) });
    return t("leases.detail.daysToEnd", { count: l.daysToEnd });
  }

  return (
    <div className="rnt">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{t("leases.title")}</h1>
            <p className="rnt-head__sub">{t("leases.subtitle")}</p>
          </div>
          {canEdit ? (
            <div className="rnt-head__actions">
              <button
                type="button"
                className="rnt-btn rnt-btn--primary"
                onClick={() => setFormOpen(true)}
              >
                <Plus size={15} />
                {t("leases.new")}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="rnt-kpis">
        <Kpi label={t("leases.kpi.active")} value={String(kpi.active)} hint={t("leases.kpi.activeHint")} />
        <Kpi
          label={t("leases.kpi.expiring")}
          value={String(kpi.expiring90)}
          hint={t("leases.kpi.expiringHint")}
        />
        <Kpi
          label={t("leases.kpi.balance")}
          value={formatMoney(kpi.balance)}
          hint={t("leases.kpi.balanceHint")}
          tone={kpi.balance > 0 ? "danger" : "good"}
        />
        <Kpi
          label={t("leases.kpi.overdue")}
          value={String(kpi.overdue)}
          hint={t("leases.kpi.overdueHint")}
          tone={kpi.overdue > 0 ? "danger" : undefined}
        />
      </div>

      <Card
        title={t("leases.expiring.title")}
        sub={t("leases.expiring.body")}
        action={
          <div className="rnt-toolbar">
            {[30, 60, 90].map((w) => (
              <button
                key={w}
                type="button"
                className={`rnt-btn rnt-btn--sm${expiring === w ? " rnt-btn--primary" : ""}`}
                aria-pressed={expiring === w}
                onClick={() => setExpiring(expiring === w ? null : w)}
              >
                <CalendarClock size={13} />
                {t(`leases.filter.expiring${w}`)}
              </button>
            ))}
          </div>
        }
      >
        {kpi.expiring90 === 0 ? (
          <p className="rnt-empty__body" style={{ margin: 0, color: "var(--text-3)" }}>
            {t("leases.expiring.none")}
          </p>
        ) : (
          <p className="rnt-empty__body" style={{ margin: 0, color: "var(--text-3)", maxWidth: "none" }}>
            {t("leases.kpi.expiringHint")}
          </p>
        )}
      </Card>

      <Card flush>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <Tabs<StatusFilter>
            label={t("leases.filter.status")}
            value={status}
            onChange={setStatus}
            tabs={[
              { key: "TODOS", label: t("common.all"), count: counts.TODOS },
              { key: "ACTIVO", label: t("leases.status.ACTIVO"), count: counts.ACTIVO },
              { key: "BORRADOR", label: t("leases.status.BORRADOR"), count: counts.BORRADOR },
              { key: "VENCIDO", label: t("leases.status.VENCIDO"), count: counts.VENCIDO },
              { key: "TERMINADO", label: t("leases.status.TERMINADO"), count: counts.TERMINADO },
            ]}
          />
          <div className="rnt-toolbar">
            <div className="rnt-toolbar__grow" style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-4)",
                  pointerEvents: "none",
                }}
              />
              <input
                className="rnt-input"
                style={{ paddingLeft: 30 }}
                placeholder={t("leases.filter.search")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={t("leases.filter.search")}
              />
            </div>
            {filtered ? (
              <button
                type="button"
                className="rnt-btn rnt-btn--sm"
                onClick={() => {
                  setStatus("TODOS");
                  setExpiring(null);
                  setQ("");
                }}
              >
                {t("leases.filter.clear")}
              </button>
            ) : null}
          </div>
        </div>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title={t("leases.emptyFiltered.title")}
              body={t("leases.emptyFiltered.body")}
            />
          ) : (
            <EmptyState
              title={t("leases.empty.title")}
              body={t("leases.empty.body")}
              action={
                canEdit ? (
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--primary"
                    onClick={() => setFormOpen(true)}
                  >
                    <Plus size={15} />
                    {t("leases.empty.cta")}
                  </button>
                ) : null
              }
            />
          )
        ) : (
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <thead>
                <tr>
                  <th>{t("leases.table.property")}</th>
                  <th className="rnt-hide-xs">{t("leases.table.tenant")}</th>
                  <th className="rnt-hide-sm">{t("leases.table.term")}</th>
                  <th className="num">{t("leases.table.rent")}</th>
                  <th className="num rnt-hide-sm">{t("leases.table.balance")}</th>
                  <th>{t("leases.table.status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="rnt-strong">{l.propertyTitle}</div>
                      {l.propertyCity ? <div className="rnt-muted">{l.propertyCity}</div> : null}
                    </td>
                    <td className="rnt-hide-xs">
                      <div>{l.tenantName}</div>
                      {l.tenantPhone ? <div className="rnt-muted">{l.tenantPhone}</div> : null}
                    </td>
                    <td className="rnt-hide-sm">
                      <div>
                        {formatShortDate(l.startsAt)} — {formatShortDate(l.endsAt)}
                      </div>
                      <div className="rnt-muted">{endsLabel(l)}</div>
                    </td>
                    <td className="num">
                      <div className="rnt-strong">{formatMoney(l.rentAmount, l.currency)}</div>
                      <div className="rnt-muted">
                        {t("leases.detail.paymentDay")} {l.paymentDay}
                      </div>
                    </td>
                    <td className="num rnt-hide-sm">
                      <span
                        style={{
                          fontWeight: 600,
                          color: l.balance > 0 ? "var(--danger)" : "var(--text-3)",
                        }}
                      >
                        {formatMoney(l.balance, l.currency)}
                      </span>
                      {l.overdueCount > 0 ? (
                        <div className="rnt-muted">
                          {t("leases.kpi.overdue")}: {l.overdueCount}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Pill tone={STATUS_TONE[l.status]} dot>
                        {t(`leases.status.${l.status}`)}
                      </Pill>
                    </td>
                    <td className="num">
                      <Link href={`/inmobiliaria/rentas/${l.id}`} className="rnt-btn rnt-btn--sm">
                        {t("leases.table.open")}
                        <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canEdit ? (
        <LeaseForm
          dict={dict}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          properties={properties}
          contacts={contacts}
          defaultMonth={defaultMonth}
          onSaved={(id) => {
            toast.success(t("leases.toast.created"));
            setFormOpen(false);
            router.push(`/inmobiliaria/rentas/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}
