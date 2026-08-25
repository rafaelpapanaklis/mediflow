"use client";

import { useState } from "react";
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Handshake,
  Percent,
  Plus,
  Receipt,
  TriangleAlert,
  Trophy,
  Undo2,
} from "lucide-react";
import type { DealsScreen, RealtyDealRow } from "@/app/api/realty/deals/service";
import {
  formatMinutes,
  formatMoney,
  formatPct,
  formatPeriod,
  shiftPeriodKey,
} from "@/lib/realty/commissions";
import {
  REALTY_COMMISSION_PARTY_LABELS,
  REALTY_DEAL_KIND_LABELS,
  REALTY_DEAL_STATUS_UI,
} from "@/lib/realty/types";
import { SplitEditor } from "./split-editor";
import {
  apiCall,
  Banner,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  fmtDate,
  Kpi,
  Modal,
  NumberInput,
  plural,
  Select,
  styles as s,
  TextArea,
  TextInput,
  useSaving,
} from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/comisiones — operaciones cerradas, reparto, recibo por
// periodo y el tablero de avance.
//
// Un asesor (solo commissions.view) ve ÚNICAMENTE las operaciones donde
// tiene parte: ese recorte lo hace el servidor, no esta pantalla.
// ═══════════════════════════════════════════════════════════════════════

type Tab = "operaciones" | "recibo" | "tablero";

type DealDraft = {
  id: string | null;
  propertyId: string;
  kind: "VENTA" | "RENTA";
  contactId: string;
  amount: string;
  commissionAmount: string;
  commissionPct: string;
  closedAt: string;
  status: "EN_PROCESO" | "CERRADO" | "CANCELADO";
  notes: string;
};

function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyDeal(): DealDraft {
  return {
    id: null,
    propertyId: "",
    kind: "VENTA",
    contactId: "",
    amount: "",
    commissionAmount: "",
    commissionPct: "5",
    closedAt: todayInput(),
    status: "CERRADO",
    notes: "",
  };
}

export function ComisionesClient({ initial }: { initial: DealsScreen }) {
  const [screen, setScreen] = useState(initial);
  const [tab, setTab] = useState<Tab>("operaciones");
  const [draft, setDraft] = useState<DealDraft | null>(null);
  const [splitFor, setSplitFor] = useState<RealtyDealRow | null>(null);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const { saving, error, setError, run } = useSaving();

  async function goToPeriod(periodKey: string) {
    setLoadingPeriod(true);
    try {
      setScreen(await apiCall<DealsScreen>(`/api/realty/deals?period=${periodKey}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar ese periodo.");
    } finally {
      setLoadingPeriod(false);
    }
  }

  async function refresh() {
    setScreen(await apiCall<DealsScreen>(`/api/realty/deals?period=${screen.periodKey}`));
  }

  async function saveDeal() {
    if (!draft) return;
    const ok = await run(async () => {
      const body = {
        propertyId: draft.propertyId,
        kind: draft.kind,
        contactId: draft.contactId || null,
        amount: draft.amount,
        commissionAmount: draft.commissionAmount,
        closedAt: draft.closedAt,
        status: draft.status,
        notes: draft.notes,
      };
      if (draft.id) {
        await apiCall(`/api/realty/deals/${draft.id}`, { method: "PATCH", json: body });
      } else {
        await apiCall("/api/realty/deals", { method: "POST", json: body });
      }
      await refresh();
    });
    if (ok) setDraft(null);
  }

  async function togglePaid(splitId: string, paid: boolean) {
    await run(async () => {
      await apiCall(`/api/realty/commissions/${splitId}`, { method: "PATCH", json: { paid } });
      await refresh();
    });
  }

  async function payAll(realtyUserId: string | null, party: string | null, externalName: string) {
    await run(async () => {
      await apiCall("/api/realty/commissions", {
        method: "POST",
        // externalName identifica a la contraparte de fuera: sin él, "pagar
        // todo" marcaría las partes de TODOS los externos del periodo.
        json: { realtyUserId, party, externalName, periodKey: screen.periodKey },
      });
      await refresh();
    });
  }

  // Al escribir el % se calcula la comisión, y al escribir la comisión se
  // recalcula el %. Los dos números viven siempre sincronizados: quien cobra
  // "5%" y quien cobra "$150,000" están diciendo lo mismo.
  function setAmount(next: string) {
    if (!draft) return;
    const amount = Number(next.replace(/[^0-9.]/g, "")) || 0;
    const pct = Number(draft.commissionPct) || 0;
    setDraft({
      ...draft,
      amount: next,
      commissionAmount: amount > 0 && pct > 0 ? ((amount * pct) / 100).toFixed(2) : draft.commissionAmount,
    });
  }
  function setPct(next: string) {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/[^0-9.]/g, "")) || 0;
    const pct = Number(next.replace(/[^0-9.]/g, "")) || 0;
    setDraft({
      ...draft,
      commissionPct: next,
      commissionAmount: amount > 0 ? ((amount * pct) / 100).toFixed(2) : draft.commissionAmount,
    });
  }
  function setCommission(next: string) {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/[^0-9.]/g, "")) || 0;
    const commission = Number(next.replace(/[^0-9.]/g, "")) || 0;
    setDraft({
      ...draft,
      commissionAmount: next,
      commissionPct: amount > 0 ? ((commission / amount) * 100).toFixed(2) : draft.commissionPct,
    });
  }

  const t = screen.totals;

  return (
    <div className={s.root}>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>Comisiones</h1>
          <p className={s.subtitle}>
            Las operaciones cerradas y el reparto: captador, colocador, oficina y quién ya cobró.
          </p>
        </div>
        <div className={s.headerActions}>
          <Btn
            size="sm"
            iconOnly
            aria-label="Mes anterior"
            disabled={loadingPeriod}
            onClick={() => goToPeriod(shiftPeriodKey(screen.periodKey, -1))}
          >
            <ChevronLeft size={15} />
          </Btn>
          <Chip tone="brand">
            <span style={{ textTransform: "capitalize" }}>{formatPeriod(screen.periodKey)}</span>
          </Chip>
          <Btn
            size="sm"
            iconOnly
            aria-label="Mes siguiente"
            disabled={loadingPeriod}
            onClick={() => goToPeriod(shiftPeriodKey(screen.periodKey, 1))}
          >
            <ChevronRight size={15} />
          </Btn>
          {screen.canRegister ? (
            <Btn variant="primary" onClick={() => setDraft(emptyDeal())}>
              <Plus size={15} /> Registrar operación
            </Btn>
          ) : null}
        </div>
      </header>

      <div className={s.tabs} role="tablist">
        <TabBtn active={tab === "operaciones"} onClick={() => setTab("operaciones")}>
          <Handshake size={15} /> Operaciones
          <span className={s.tabBadge}>{screen.deals.length}</span>
        </TabBtn>
        <TabBtn active={tab === "recibo"} onClick={() => setTab("recibo")}>
          <Receipt size={15} /> Recibo del periodo
        </TabBtn>
        <TabBtn active={tab === "tablero"} onClick={() => setTab("tablero")}>
          <Trophy size={15} /> Metas y ranking
        </TabBtn>
      </div>

      <div className={s.content}>
        <ErrorText>{!draft ? error : null}</ErrorText>

        {screen.selfOnly ? (
          <Banner icon={<Percent size={16} />}>
            Estás viendo solo las operaciones donde tienes parte. Para ver las de todo el equipo
            hace falta el permiso de repartir comisiones.
          </Banner>
        ) : null}

        <div className={s.kpis}>
          <Kpi label="Cerradas" value={String(t.closedDeals)} hero hint={`${formatMoney(t.volume)} de volumen`} />
          <Kpi label="Comisión del periodo" value={formatMoney(t.commission)} />
          <Kpi label="Ya pagado" value={formatMoney(t.paid)} />
          <Kpi
            label="Por pagar"
            value={formatMoney(t.pending)}
            hint={t.inProgress > 0 ? `${formatMoney(t.inProgress)} más en proceso` : undefined}
          />
        </div>

        {t.unbalanced > 0 ? (
          <Banner tone="warn" title="Hay repartos sin cerrar" icon={<TriangleAlert size={16} />}>
            {plural(t.unbalanced, "operación cerrada no tiene", "operaciones cerradas no tienen")} su
            comisión repartida al 100%. Mientras no cierre, ese dinero no le aparece a nadie en su
            recibo.
          </Banner>
        ) : null}

        {tab === "operaciones" ? (
          screen.deals.length === 0 ? (
            <div className={s.card}>
              <EmptyState
                icon={<Handshake size={22} />}
                title="Sin operaciones en este mes"
                body="Cuando cierres una venta o una renta, regístrala aquí: el inmueble pasa a vendido o rentado y se reparte la comisión."
              />
            </div>
          ) : (
            <div className={s.grid} style={{ gridTemplateColumns: "1fr" }}>
              {screen.deals.map((d) => {
                const ui = REALTY_DEAL_STATUS_UI[d.status];
                return (
                  <article key={d.id} className={s.rowCard}>
                    <div className={s.avatar}>
                      <Handshake size={18} />
                    </div>
                    <div className={s.rowMain}>
                      <div className={s.rowTitle}>
                        <span className={s.truncate}>{d.propertyTitle}</span>
                        <Chip tone={ui.tone === "success" ? "ok" : ui.tone === "warning" ? "warn" : "muted"}>
                          {ui.label}
                        </Chip>
                        <Chip tone="muted">{REALTY_DEAL_KIND_LABELS[d.kind]}</Chip>
                      </div>
                      <div className={s.rowMeta}>
                        <strong style={{ color: "var(--text-1)", fontSize: 14 }}>
                          {formatMoney(d.amount)}
                        </strong>
                        <span>
                          comisión {formatMoney(d.commissionAmount)}
                          {d.commissionPct !== null ? ` · ${formatPct(d.commissionPct)}` : ""}
                        </span>
                        {d.closedAt ? <span>· cerró el {fmtDate(d.closedAt, screen.timezone)}</span> : null}
                        {d.contactName ? <span>· {d.contactName}</span> : null}
                      </div>

                      {d.splits.length === 0 ? (
                        <div className={s.rowMeta}>
                          <Chip tone="danger">Sin repartir</Chip>
                        </div>
                      ) : (
                        <div className={s.rowMeta}>
                          {d.splits.map((sp) => (
                            <Chip key={sp.id} tone={sp.paidAt ? "ok" : "muted"}>
                              {sp.paidAt ? <Check size={12} /> : null}
                              {sp.beneficiary} · {formatMoney(sp.amount)} ({formatPct(sp.pct)})
                            </Chip>
                          ))}
                          {!d.balanced ? <Chip tone="danger">No cierra al 100%</Chip> : null}
                        </div>
                      )}

                      <div className={s.rowActions}>
                        {screen.canManage ? (
                          <Btn size="sm" onClick={() => setSplitFor(d)}>
                            <Percent size={13} /> {d.splits.length === 0 ? "Repartir" : "Editar reparto"}
                          </Btn>
                        ) : null}
                        {screen.canRegister ? (
                          <Btn
                            size="sm"
                            onClick={() =>
                              setDraft({
                                id: d.id,
                                propertyId: d.propertyId,
                                kind: d.kind,
                                contactId: d.contactId ?? "",
                                amount: String(d.amount),
                                commissionAmount: String(d.commissionAmount),
                                commissionPct: d.commissionPct === null ? "" : String(d.commissionPct),
                                closedAt: d.closedAt ? d.closedAt.slice(0, 10) : todayInput(),
                                status: d.status,
                                notes: d.notes ?? "",
                              })
                            }
                          >
                            Editar
                          </Btn>
                        ) : null}
                        {screen.canManage
                          ? d.splits
                              .filter((sp) => d.status === "CERRADO")
                              .map((sp) => (
                                <Btn
                                  key={`pay-${sp.id}`}
                                  size="sm"
                                  variant={sp.paidAt ? "ghost" : "default"}
                                  disabled={saving}
                                  onClick={() => togglePaid(sp.id, !sp.paidAt)}
                                >
                                  {sp.paidAt ? <Undo2 size={13} /> : <Check size={13} />}
                                  {sp.paidAt ? `Desmarcar a ${sp.beneficiary}` : `Pagar a ${sp.beneficiary}`}
                                </Btn>
                              ))
                          : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "recibo" ? (
          screen.receipt.lines.length === 0 ? (
            <div className={s.card}>
              <EmptyState
                icon={<Receipt size={22} />}
                title="Nada que cobrar en este mes"
                body="Aquí sale, por persona, lo que ya se ganó (operaciones cerradas) y lo que ya se pagó."
              />
            </div>
          ) : (
            <>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Quién cobra</th>
                      <th>Papel</th>
                      <th className={s.num}>Operaciones</th>
                      <th className={s.num}>Devengado</th>
                      <th className={s.num}>Pagado</th>
                      <th className={s.num}>Se le debe</th>
                      <th className={s.num}>En proceso</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {screen.receipt.lines.map((line) => (
                      <tr key={line.beneficiaryId}>
                        <td>{line.beneficiary}</td>
                        <td style={{ color: "var(--text-3)" }}>
                          {REALTY_COMMISSION_PARTY_LABELS[line.party]}
                        </td>
                        <td className={s.num}>{line.operations}</td>
                        <td className={s.num}>{formatMoney(line.earned)}</td>
                        <td className={s.num}>{formatMoney(line.paid)}</td>
                        <td className={s.num}>
                          <strong>{formatMoney(line.pending)}</strong>
                        </td>
                        <td className={s.num} style={{ color: "var(--text-3)" }}>
                          {line.inProgress > 0 ? formatMoney(line.inProgress) : "—"}
                        </td>
                        <td className={s.num}>
                          {screen.canManage && line.pending > 0 ? (
                            <Btn
                              size="sm"
                              disabled={saving}
                              onClick={() =>
                                payAll(
                                  line.realtyUserId,
                                  line.realtyUserId ? null : line.party,
                                  line.beneficiary,
                                )
                              }
                            >
                              <Check size={13} /> Pagar todo
                            </Btn>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 700 }}>
                        Total del periodo
                      </td>
                      <td className={s.num} style={{ fontWeight: 700 }}>
                        {formatMoney(screen.receipt.totalEarned)}
                      </td>
                      <td className={s.num} style={{ fontWeight: 700 }}>
                        {formatMoney(screen.receipt.totalPaid)}
                      </td>
                      <td className={s.num} style={{ fontWeight: 700 }}>
                        {formatMoney(screen.receipt.totalPending)}
                      </td>
                      <td className={s.num} style={{ fontWeight: 700, color: "var(--text-3)" }}>
                        {formatMoney(screen.receipt.totalInProgress)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className={s.hint}>
                <strong>Devengado</strong> es lo que ya se ganó porque la operación está cerrada.{" "}
                <strong>En proceso</strong> todavía no se gana: esa operación se puede caer. Una
                operación cancelada no suma en ninguna columna.
              </p>
            </>
          )
        ) : null}

        {tab === "tablero" ? <Tablero screen={screen} /> : null}
      </div>

      {/* ── Modales ── */}
      {draft ? (
        <Modal
          title={draft.id ? "Editar la operación" : "Registrar una operación cerrada"}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancelar
              </Btn>
              <Btn variant="primary" onClick={saveDeal} disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <div className={s.formGrid}>
            <Field label="Inmueble" full>
              {(id) => (
                <Select
                  id={id}
                  value={draft.propertyId}
                  disabled={saving || Boolean(draft.id)}
                  onChange={(e) => setDraft({ ...draft, propertyId: e.target.value })}
                >
                  <option value="">Elige el inmueble</option>
                  {screen.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Tipo de operación">
              {(id) => (
                <Select
                  id={id}
                  value={draft.kind}
                  disabled={saving}
                  onChange={(e) =>
                    setDraft({ ...draft, kind: e.target.value === "RENTA" ? "RENTA" : "VENTA" })
                  }
                >
                  <option value="VENTA">Venta</option>
                  <option value="RENTA">Renta</option>
                </Select>
              )}
            </Field>
            <Field label="Cliente">
              {(id) => (
                <Select
                  id={id}
                  value={draft.contactId}
                  disabled={saving}
                  onChange={(e) => setDraft({ ...draft, contactId: e.target.value })}
                >
                  <option value="">Sin cliente capturado</option>
                  {screen.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="¿En cuánto se cerró?" full>
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.amount}
                  disabled={saving}
                  placeholder="3000000"
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            <Field label="% de comisión" hint="En México va de 3% a 8%; lo normal, 4% a 7%.">
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.commissionPct}
                  disabled={saving}
                  onChange={(e) => setPct(e.target.value)}
                />
              )}
            </Field>
            <Field label="Comisión cobrada" hint="Es lo que se va a repartir.">
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.commissionAmount}
                  disabled={saving}
                  onChange={(e) => setCommission(e.target.value)}
                />
              )}
            </Field>
            <Field label="Estatus">
              {(id) => (
                <Select
                  id={id}
                  value={draft.status}
                  disabled={saving}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value as DealDraft["status"] })
                  }
                >
                  <option value="CERRADO">Cerrada</option>
                  <option value="EN_PROCESO">En proceso</option>
                  <option value="CANCELADO">Cancelada</option>
                </Select>
              )}
            </Field>
            <Field label="Fecha de cierre">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={draft.closedAt}
                  disabled={saving || draft.status !== "CERRADO"}
                  onChange={(e) => setDraft({ ...draft, closedAt: e.target.value })}
                />
              )}
            </Field>
            <Field label="Notas" full>
              {(id) => (
                <TextArea
                  id={id}
                  value={draft.notes}
                  rows={3}
                  maxLength={2000}
                  disabled={saving}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              )}
            </Field>
          </div>
          {draft.status === "CERRADO" ? (
            <p className={s.hint}>
              Al guardarla como cerrada, el inmueble pasa a{" "}
              <strong>{draft.kind === "VENTA" ? "vendido" : "rentado"}</strong>. Eso es lo que
              dispara la despublicación en los portales.
            </p>
          ) : null}
        </Modal>
      ) : null}

      {splitFor ? (
        <SplitEditor
          deal={splitFor}
          agents={screen.agents}
          templates={screen.templates}
          onClose={() => setSplitFor(null)}
          onSaved={() => {
            setSplitFor(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={[s.tab, active ? s.tabActive : ""].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Tablero de avance: cerrado, en proceso, tiempo de primera respuesta y
 * conversión del embudo, por asesor.
 *
 * 🔴 La META por asesor todavía no se puede guardar: el schema del vertical
 * no tiene tabla de metas y esta ola no lo toca. Para no inventar un número,
 * la barra compara contra el MEJOR del periodo — que es una referencia real
 * de la propia inmobiliaria y no una cifra sacada del aire.
 */
function Tablero({ screen }: { screen: DealsScreen }) {
  const rows = screen.ranking;
  if (rows.length === 0) {
    return (
      <div className={s.card}>
        <EmptyState
          icon={<BarChart3 size={22} />}
          title="Todavía no hay números"
          body="Cuando tu equipo cierre operaciones y atienda prospectos, aquí sale quién va adelante y cuánto tarda en contestar."
        />
      </div>
    );
  }

  const best = Math.max(...rows.map((r) => r.earnedCommission), 0);
  const teamLeads = rows.reduce((a, r) => a + r.leads, 0);
  const teamWon = rows.reduce((a, r) => a + r.leadsWon, 0);
  const answered = rows.filter((r) => r.medianResponseMinutes !== null);
  const teamMedian =
    answered.length > 0
      ? Math.round(
          answered.reduce((a, r) => a + (r.medianResponseMinutes ?? 0), 0) / answered.length,
        )
      : null;

  return (
    <>
      <div className={s.kpis}>
        <Kpi
          label="Conversión del equipo"
          value={teamLeads > 0 ? `${Math.round((teamWon / teamLeads) * 1000) / 10}%` : "—"}
          hint={`${teamWon} de ${teamLeads} prospectos`}
          hero
        />
        <Kpi
          label="Primera respuesta"
          value={formatMinutes(teamMedian)}
          hint="Mediana del equipo. En bienes raíces gana quien contesta primero."
        />
        <Kpi label="Sin contestar" value={String(rows.reduce((a, r) => a + r.unanswered, 0))} />
        <Kpi label="En proceso" value={String(rows.reduce((a, r) => a + r.inProgressDeals, 0))} />
      </div>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Asesor</th>
              <th className={s.num}>Cerradas</th>
              <th className={s.num}>Volumen</th>
              <th className={s.num}>Su comisión</th>
              <th style={{ minWidth: 110 }}>Avance</th>
              <th className={s.num}>En proceso</th>
              <th className={s.num}>Conversión</th>
              <th className={s.num}>1ª respuesta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.realtyUserId}>
                <td style={{ color: "var(--text-3)", fontWeight: 700 }}>{r.rank}</td>
                <td>
                  {r.name}
                  {r.active ? "" : " · dado de baja"}
                </td>
                <td className={s.num}>{r.closedDeals}</td>
                <td className={s.num}>{formatMoney(r.closedVolume)}</td>
                <td className={s.num}>
                  <strong>{formatMoney(r.earnedCommission)}</strong>
                </td>
                <td>
                  <div className={s.bar}>
                    <span
                      className={s.barFill}
                      style={{
                        width: best > 0 ? `${Math.round((r.earnedCommission / best) * 100)}%` : "0%",
                      }}
                    />
                  </div>
                </td>
                <td className={s.num} style={{ color: "var(--text-3)" }}>
                  {r.inProgressDeals > 0
                    ? `${r.inProgressDeals} · ${formatMoney(r.inProgressCommission)}`
                    : "—"}
                </td>
                <td className={s.num}>
                  {r.leads > 0 ? `${r.conversionPct}%` : "—"}
                  {r.unanswered > 0 ? (
                    <span style={{ color: "#B3261E" }}> · {r.unanswered} sin contestar</span>
                  ) : null}
                </td>
                <td className={s.num}>{formatMinutes(r.medianResponseMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={s.hint}>
        La barra de avance compara contra el mejor del periodo, no contra una meta escrita: por
        ahora el sistema no guarda metas por asesor. El tiempo de primera respuesta es la{" "}
        <strong>mediana</strong>, no el promedio — un prospecto contestado tres días después
        desviaría la media y taparía el resto.
      </p>
    </>
  );
}
