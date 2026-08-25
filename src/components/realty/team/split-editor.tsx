"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import {
  computeSplits,
  formatMoney,
  formatPct,
  templateToInputs,
  type RealtySplitInput,
  type RealtySplitTemplate,
} from "@/lib/realty/commissions";
import {
  REALTY_COMMISSION_PARTY_LABELS,
  type RealtyCommissionParty,
} from "@/lib/realty/types";
import type { RealtyDealRow } from "@/app/api/realty/deals/service";
import {
  apiCall,
  Banner,
  Btn,
  Chip,
  ErrorText,
  Modal,
  NumberInput,
  Select,
  styles as s,
  TextInput,
  useSaving,
} from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// EDITOR DE REPARTO — el corazón de Comisiones.
//
// 🔴 Los pesos se enseñan MIENTRAS se escribe, no solo el porcentaje. Un
// "40%" no le dice nada a nadie; "$60,000" sí. Y el reparto no se puede
// guardar hasta que la suma cierre EXACTAMENTE con la comisión.
//
// La aritmética es la MISMA función pura que corre el servidor
// (computeSplits en @/lib/realty/commissions), así que la pantalla nunca
// puede prometer un reparto que la API vaya a rechazar — ni al revés.
//
// Comisión típica en México: 3% a 8% de venta (lo normal 4-7%), y en
// franquicias 3% a 4.5% con una parte para la franquicia. Eso es contexto de
// la ayuda, no una regla: nadie queda bloqueado por salirse.
// ═══════════════════════════════════════════════════════════════════════

const PARTIES: RealtyCommissionParty[] = [
  "CAPTADOR",
  "COLOCADOR",
  "OFICINA",
  "FRANQUICIA",
  "EXTERNO",
];

const HOUSE: RealtyCommissionParty[] = ["OFICINA", "FRANQUICIA"];

type Row = RealtySplitInput & { key: string };

function fromDeal(deal: RealtyDealRow): Row[] {
  if (deal.splits.length === 0) return [];
  return deal.splits.map((sp, i) => ({
    key: `k${i}`,
    party: sp.party,
    realtyUserId: sp.realtyUserId,
    externalName: sp.externalName,
    mode: "PCT" as const,
    pct: sp.pct,
    amount: sp.amount,
  }));
}

export function SplitEditor({
  deal,
  agents,
  templates,
  onClose,
  onSaved,
}: {
  deal: RealtyDealRow;
  agents: { id: string; name: string; active: boolean }[];
  templates: RealtySplitTemplate[];
  onClose: () => void;
  onSaved: (next: RealtyDealRow) => void;
}) {
  const { saving, error, run } = useSaving();
  const [rows, setRows] = useState<Row[]>(() => fromDeal(deal));
  const [seq, setSeq] = useState(rows.length);

  const result = useMemo(() => computeSplits(deal.commissionAmount, rows), [deal.commissionAmount, rows]);

  function patch(key: string, next: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  function addRow(party: RealtyCommissionParty = "COLOCADOR") {
    setRows((prev) =>
      prev.concat({
        key: `k${seq}`,
        party,
        realtyUserId: null,
        externalName: null,
        mode: "PCT",
        pct: "",
        amount: "",
      }),
    );
    setSeq((n) => n + 1);
  }

  function applyTemplate(t: RealtySplitTemplate) {
    const next = templateToInputs(t).map((r, i) => ({ ...r, key: `t${seq + i}` }));
    setRows(next as Row[]);
    setSeq((n) => n + next.length);
  }

  async function save() {
    const ok = await run(async () => {
      const { deal: next } = await apiCall<{ deal: RealtyDealRow }>(
        `/api/realty/deals/${deal.id}/splits`,
        {
          method: "PUT",
          json: {
            splits: rows.map((r) => ({
              party: r.party,
              realtyUserId: r.realtyUserId,
              externalName: r.externalName,
              mode: r.mode,
              pct: r.pct,
              amount: r.amount,
            })),
          },
        },
      );
      onSaved(next);
    });
    if (ok) onClose();
  }

  const problemByIndex = new Map<number, string>();
  for (const p of result.problems) {
    if (p.index !== null && !problemByIndex.has(p.index)) problemByIndex.set(p.index, p.message);
  }
  const globalProblems = result.problems.filter((p) => p.index === null);

  return (
    <Modal
      wide
      title={`Repartir la comisión de ${deal.propertyTitle}`}
      subtitle={`Comisión a repartir: ${formatMoney(deal.commissionAmount)}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Btn>
          <Btn variant="primary" onClick={save} disabled={saving || !result.valid}>
            {saving ? "Guardando…" : "Guardar el reparto"}
          </Btn>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>

      {deal.paid > 0 ? (
        <Banner tone="warn" title="Ya hay partes pagadas" icon={<TriangleAlert size={16} />}>
          De esta comisión ya salieron {formatMoney(deal.paid)}. Para cambiar el reparto hay que
          desmarcar primero esos pagos: reescribir un importe que ya se entregó es cambiar el
          pasado.
        </Banner>
      ) : null}

      {/* Plantillas — las de la cuenta primero (deducidas de lo que ya usó). */}
      {templates.length > 0 ? (
        <div>
          <div className={s.sectionTitle}>
            <Sparkles size={14} /> Repartos que ya usas
          </div>
          <div className={s.templateRow}>
            {templates.map((t) => (
              <Btn key={t.id} size="sm" onClick={() => applyTemplate(t)} disabled={saving}>
                {t.label}
                {t.timesUsed > 0 ? (
                  <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
                    · {t.timesUsed} {t.timesUsed === 1 ? "vez" : "veces"}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-3)", fontWeight: 500 }}>· sugerido</span>
                )}
              </Btn>
            ))}
          </div>
          <p className={s.hint} style={{ marginTop: 6 }}>
            Salen de tus propias operaciones: entre más repartas igual, más arriba aparece.
          </p>
        </div>
      ) : null}

      {/* Filas */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => {
          const computed = result.rows[i];
          const isHouse = HOUSE.includes(r.party);
          const problem = problemByIndex.get(i);
          return (
            <div key={r.key}>
              <div className={[s.splitRow, problem ? s.splitRowBad : ""].filter(Boolean).join(" ")}>
                <Select
                  value={r.party}
                  aria-label="Quién cobra esta parte"
                  disabled={saving}
                  onChange={(e) => {
                    const party = e.target.value as RealtyCommissionParty;
                    patch(r.key, {
                      party,
                      // Las partes de la casa no llevan persona detrás.
                      realtyUserId: HOUSE.includes(party) ? null : r.realtyUserId,
                    });
                  }}
                >
                  {PARTIES.map((p) => (
                    <option key={p} value={p}>
                      {REALTY_COMMISSION_PARTY_LABELS[p]}
                    </option>
                  ))}
                </Select>

                {isHouse ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-3)", padding: "0 4px" }}>
                    Se queda en la {r.party === "OFICINA" ? "oficina" : "franquicia"}
                  </div>
                ) : r.party === "EXTERNO" ? (
                  <TextInput
                    value={r.externalName ?? ""}
                    placeholder="Nombre del asesor o la inmobiliaria"
                    maxLength={80}
                    disabled={saving}
                    aria-label="Nombre de la contraparte"
                    onChange={(e) => patch(r.key, { externalName: e.target.value })}
                  />
                ) : (
                  <Select
                    value={r.realtyUserId ?? ""}
                    aria-label="Quién de tu equipo"
                    disabled={saving}
                    onChange={(e) => patch(r.key, { realtyUserId: e.target.value || null })}
                  >
                    <option value="">Elige a quién</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.active ? "" : " (dado de baja)"}
                      </option>
                    ))}
                  </Select>
                )}

                <Select
                  value={r.mode}
                  aria-label="Por porcentaje o por monto"
                  disabled={saving}
                  onChange={(e) => patch(r.key, { mode: e.target.value === "AMOUNT" ? "AMOUNT" : "PCT" })}
                >
                  <option value="PCT">Porcentaje</option>
                  <option value="AMOUNT">Monto fijo</option>
                </Select>

                <NumberInput
                  value={String((r.mode === "PCT" ? r.pct : r.amount) ?? "")}
                  placeholder={r.mode === "PCT" ? "40" : "0.00"}
                  disabled={saving}
                  aria-label={r.mode === "PCT" ? "Porcentaje" : "Monto"}
                  onChange={(e) =>
                    patch(r.key, r.mode === "PCT" ? { pct: e.target.value } : { amount: e.target.value })
                  }
                />

                <Btn
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label="Quitar esta parte"
                  disabled={saving}
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                >
                  <Trash2 size={14} />
                </Btn>
              </div>

              {/* 🔴 El resultado EN PESOS, debajo de cada fila. */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "4px 10px 0",
                  fontSize: 12,
                  color: problem ? "#B3261E" : "var(--text-3)",
                }}
              >
                <span>{problem ?? ""}</span>
                {computed ? (
                  <strong style={{ color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>
                    {formatMoney(computed.amount)}
                    <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
                      {" "}
                      · {formatPct(computed.pct)}
                    </span>
                  </strong>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className={s.templateRow}>
        <Btn size="sm" onClick={() => addRow("CAPTADOR")} disabled={saving}>
          <Plus size={13} /> Quien captó
        </Btn>
        <Btn size="sm" onClick={() => addRow("COLOCADOR")} disabled={saving}>
          <Plus size={13} /> Quien colocó
        </Btn>
        <Btn size="sm" onClick={() => addRow("OFICINA")} disabled={saving}>
          <Plus size={13} /> La oficina
        </Btn>
        <Btn size="sm" onClick={() => addRow("EXTERNO")} disabled={saving}>
          <Plus size={13} /> Alguien de fuera
        </Btn>
      </div>

      {/* Totales: el veredicto en pesos Y en porcentaje. */}
      <div
        className={[
          s.splitTotal,
          result.differenceCents === 0 && rows.length > 0 ? s.splitTotalOk : "",
          result.differenceCents !== 0 && rows.length > 0 ? s.splitTotalBad : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)" }}>
            Repartido
          </span>
          <span className={s.splitTotalValue}>
            {formatMoney(result.assignedCents / 100)}
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-3)" }}>
              {" "}de {formatMoney(deal.commissionAmount)} · {formatPct(result.totalBps / 100)}
            </span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {rows.length === 0 ? (
            <Chip tone="muted">Agrega a quién le toca</Chip>
          ) : result.differenceCents === 0 ? (
            <Chip tone="ok">
              <Check size={13} /> Cierra al 100%
            </Chip>
          ) : result.differenceCents > 0 ? (
            <Chip tone="danger">Faltan {formatMoney(result.differenceCents / 100)}</Chip>
          ) : (
            <Chip tone="danger">Sobran {formatMoney(-result.differenceCents / 100)}</Chip>
          )}
        </div>
      </div>

      {globalProblems.length > 0 && rows.length > 0 ? (
        <p className={s.hint} style={{ color: "#B3261E" }}>
          {globalProblems[0].message}
        </p>
      ) : null}
    </Modal>
  );
}
