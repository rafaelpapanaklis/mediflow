"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Gift, Plus, Star } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { BonusKind, StarBonus } from "@/lib/barber/stars-core";
import { starsT } from "@/components/barber/stars/stars-card";
import { Field, Modal, clientStyles as s } from "./ui";

/**
 * Clientes → «Estrellas y bonos»: la barbería crea sus bonos.
 *
 * Cada bono: nombre, cuántas estrellas cuesta y qué da (servicio gratis de
 * su catálogo —o «el que elija en caja», como el premio de siempre—,
 * descuento en pesos, en %, u «otro» con texto libre), activo o inactivo.
 * No se borra ninguno: el que sobra se apaga.
 *
 * Todo se valida otra vez en el servidor (settings.edit, rangos, servicios
 * de ESTA barbería). Antes de pegar sql/barber_estrellas.sql solo se puede
 * editar el premio de siempre; la pantalla lo dice.
 */

interface Draft {
  key: string;
  id: string | null;
  name: string;
  cost: string;
  kind: BonusKind;
  serviceId: string;
  amount: string;
  percent: string;
  description: string;
  active: boolean;
}

interface EditorData {
  catalog: { bonuses: StarBonus[]; tableReady: boolean; legacy: boolean; rule: { enabled: boolean } };
  services: Array<{ id: string; name: string; price: number }>;
  maxBonuses: number;
}

let seq = 0;
const nextKey = () => `b${++seq}`;

function toDraft(b: StarBonus): Draft {
  return {
    key: nextKey(),
    id: b.id,
    name: b.name,
    cost: String(b.cost),
    kind: b.kind,
    serviceId: b.serviceId ?? "",
    amount: b.amount !== null ? String(b.amount) : "",
    percent: b.percent !== null ? String(b.percent) : "",
    description: b.description ?? "",
    active: b.active,
  };
}

const KINDS: BonusKind[] = ["service", "amount", "percent", "other"];

export function BonosModal({
  dict,
  onClose,
  onSaved,
  onMessage,
}: {
  /** Sub-árbol barber.estrellas. */
  dict: Dictionary;
  onClose: () => void;
  onSaved: () => void;
  onMessage: (text: string) => void;
}) {
  const t = useMemo(() => starsT(dict), [dict]);
  const [data, setData] = useState<EditorData | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/barber/clients/bonos", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as EditorData | null;
        if (!alive) return;
        if (!res.ok || !body) {
          setError(t("staff.error"));
          return;
        }
        setData(body);
        setDrafts(body.catalog.bonuses.map(toDraft));
      } catch {
        if (alive) setError(t("staff.error"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [t]);

  const locked = Boolean(data && !data.catalog.tableReady);

  function patch(key: string, change: Partial<Draft>) {
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...change } : d)));
  }

  function add() {
    setDrafts((list) => [
      ...list,
      {
        key: nextKey(), id: null, name: "", cost: "10", kind: "service", serviceId: "", amount: "", percent: "",
        description: "", active: true,
      },
    ]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/barber/clients/bonos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bonuses: drafts.map((d) => ({
            id: d.id,
            name: d.name,
            cost: Number(d.cost),
            kind: d.kind,
            serviceId: d.kind === "service" ? d.serviceId || null : null,
            amount: d.kind === "amount" ? Number(d.amount.replace(",", ".")) : null,
            percent: d.kind === "percent" ? Number(d.percent) : null,
            description: d.kind === "other" ? d.description : null,
            active: d.active,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as EditorData & { error?: string };
      if (!res.ok) {
        setError(body.error || t("staff.error"));
        return;
      }
      setData(body);
      setDrafts(body.catalog.bonuses.map(toDraft));
      onMessage(t("bonos.saved"));
      onSaved();
    } catch {
      setError(t("staff.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("bonos.title")}
      onClose={onClose}
      closeLabel={t("staff.cancel")}
      wide
      footer={
        <>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose} disabled={busy}>
            {t("staff.cancel")}
          </button>
          <button
            type="button"
            className={`${s.btn} barber-btn-primary`}
            onClick={save}
            disabled={busy || !data}
            data-accion="guardar-bonos"
          >
            <Check size={14} />
            {busy ? t("bonos.saving") : t("bonos.save")}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: "var(--brand-softer)",
            border: "1px solid var(--border-brand)",
          }}
        >
          <p className={s.sectionTitle} style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <Star size={14} /> {t("bonos.ruleTitle")}
          </p>
          <p className={s.sectionSub} style={{ margin: "4px 0 0" }}>{t("bonos.rule")}</p>
        </div>

        {error ? <p className={s.errorText} role="alert">{error}</p> : null}
        {!data && !error ? <p className={s.hint}>{t("staff.loading")}</p> : null}
        {locked ? <p className={s.errorText}>{t("bonos.sqlPending")}</p> : null}
        {data?.catalog.legacy && !locked ? <p className={s.hint}>{t("bonos.legacy")}</p> : null}

        {data ? (
          <div>
            <p className={s.sectionTitle} style={{ margin: 0 }}>{t("bonos.listTitle")}</p>
            <p className={s.hint} style={{ margin: "2px 0 10px" }}>{t("bonos.listHint")}</p>

            <div style={{ display: "grid", gap: 10 }}>
              {drafts.map((d, i) => (
                <fieldset
                  key={d.key}
                  data-bono={i}
                  style={{
                    margin: 0,
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev)",
                    opacity: d.active ? 1 : 0.65,
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    minWidth: 0,
                  }}
                >
                  <Field label={t("bonos.name")} htmlFor={`bono-name-${d.key}`}>
                    <input
                      id={`bono-name-${d.key}`}
                      className={s.input}
                      value={d.name}
                      maxLength={60}
                      placeholder={t("bonos.namePlaceholder")}
                      onChange={(e) => patch(d.key, { name: e.target.value })}
                    />
                  </Field>
                  <Field label={t("bonos.cost")} htmlFor={`bono-cost-${d.key}`}>
                    <input
                      id={`bono-cost-${d.key}`}
                      className={s.input}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      value={d.cost}
                      onChange={(e) => patch(d.key, { cost: e.target.value })}
                    />
                  </Field>
                  <Field label={t("bonos.kind")} htmlFor={`bono-kind-${d.key}`}>
                    <select
                      id={`bono-kind-${d.key}`}
                      className={s.select}
                      value={d.kind}
                      disabled={locked}
                      onChange={(e) => patch(d.key, { kind: e.target.value as BonusKind })}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>{t(`bonos.kinds.${k}`)}</option>
                      ))}
                    </select>
                  </Field>

                  {d.kind === "service" ? (
                    <Field label={t("bonos.service")} htmlFor={`bono-svc-${d.key}`}>
                      <select
                        id={`bono-svc-${d.key}`}
                        className={s.select}
                        value={d.serviceId}
                        disabled={locked}
                        onChange={(e) => patch(d.key, { serviceId: e.target.value })}
                      >
                        <option value="">{t("bonos.serviceAny")}</option>
                        {data.services.map((sv) => (
                          <option key={sv.id} value={sv.id}>{sv.name}</option>
                        ))}
                      </select>
                    </Field>
                  ) : d.kind === "amount" ? (
                    <Field label={t("bonos.amount")} htmlFor={`bono-amt-${d.key}`}>
                      <input
                        id={`bono-amt-${d.key}`}
                        className={s.input}
                        inputMode="decimal"
                        value={d.amount}
                        placeholder="50"
                        onChange={(e) => patch(d.key, { amount: e.target.value })}
                      />
                    </Field>
                  ) : d.kind === "percent" ? (
                    <Field label={t("bonos.percent")} htmlFor={`bono-pct-${d.key}`}>
                      <input
                        id={`bono-pct-${d.key}`}
                        className={s.input}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={100}
                        value={d.percent}
                        placeholder="15"
                        onChange={(e) => patch(d.key, { percent: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <Field label={t("bonos.text")} htmlFor={`bono-txt-${d.key}`}>
                      <input
                        id={`bono-txt-${d.key}`}
                        className={s.input}
                        value={d.description}
                        maxLength={140}
                        placeholder={t("bonos.textPlaceholder")}
                        onChange={(e) => patch(d.key, { description: e.target.value })}
                      />
                    </Field>
                  )}

                  <label className={s.checkRow} style={{ alignSelf: "end" }}>
                    <input
                      type="checkbox"
                      checked={d.active}
                      disabled={locked}
                      onChange={(e) => patch(d.key, { active: e.target.checked })}
                    />
                    {d.active ? t("bonos.active") : t("bonos.inactive")}
                  </label>
                </fieldset>
              ))}
            </div>

            {!locked && drafts.length < data.maxBonuses ? (
              <button type="button" className={`${s.btn} ${s.btnSm}`} style={{ marginTop: 10 }} onClick={add} data-accion="agregar-bono">
                <Plus size={13} /> {t("bonos.add")}
              </button>
            ) : !locked ? (
              <p className={s.hint} style={{ marginTop: 8 }}>
                <Gift size={12} /> {t("bonos.max", { count: data.maxBonuses })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
