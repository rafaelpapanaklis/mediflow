"use client";

import { useState } from "react";
import type { TFunction } from "@/i18n/t";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  REALTY_CREDIT_KIND_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  type RealtyCreditKind,
  type RealtyOperation,
  type RealtyPropertyKind,
} from "@/lib/realty/types";
import type { RealtyLeadsCatalogs } from "@/lib/realty/leads";
import { Dialog, Field } from "./lead-bits";

const KINDS = Object.keys(REALTY_PROPERTY_KIND_LABELS) as RealtyPropertyKind[];
const CREDITS = Object.keys(REALTY_CREDIT_KIND_LABELS) as RealtyCreditKind[];

/**
 * Alta a mano de un prospecto.
 *
 * Captura el PERFIL DE BÚSQUEDA en el mismo paso a propósito: es lo que
 * alimenta el match automático, y si se deja "para después" nadie vuelve a
 * llenarlo y el motor se queda ciego.
 */
export function NewLeadDialog({
  t,
  catalogs,
  canAssign,
  onClose,
  onCreated,
}: {
  t: TFunction;
  catalogs: RealtyLeadsCatalogs;
  canAssign: boolean;
  onClose: () => void;
  onCreated: (info: { leadId: string; reusedContact: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [creditKind, setCreditKind] = useState<RealtyCreditKind>("NINGUNO");
  const [note, setNote] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");

  const [operation, setOperation] = useState<RealtyOperation>("VENTA");
  const [kinds, setKinds] = useState<RealtyPropertyKind[]>([]);
  const [zones, setZones] = useState("");
  const [bedroomsMin, setBedroomsMin] = useState("");
  const [notify, setNotify] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toNumber(v: string): number | null {
    const clean = v.replace(/[^0-9.]/g, "");
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  async function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError(t("new.nameRequired"));
      return;
    }
    // La misma regla que el servidor (mxTenDigits): si el navegador dijera
    // que sí y el servidor que no, el error saldría hasta el final.
    if (phone.trim() && !mxTenDigits(phone)) {
      setError(t("new.phoneInvalid"));
      return;
    }

    setSaving(true);
    try {
      const zoneList = zones
        .split(",")
        .map((z) => z.trim())
        .filter(Boolean);
      const res = await fetch("/api/realty/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          source: source.trim() || "manual",
          propertyId: propertyId || null,
          budgetMin: toNumber(budgetMin),
          budgetMax: toNumber(budgetMax),
          creditKind,
          note: note.trim() || null,
          assignedUserId: assignedUserId || null,
          search:
            kinds.length > 0 || zoneList.length > 0 || bedroomsMin || notify
              ? {
                  operation,
                  kinds,
                  zones: zoneList,
                  budgetMin: toNumber(budgetMin),
                  budgetMax: toNumber(budgetMax),
                  bedroomsMin: bedroomsMin ? Number(bedroomsMin) : null,
                  notifyByWhatsapp: notify,
                }
              : null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        leadId?: string;
        reusedContact?: boolean;
        error?: string;
      };
      if (!res.ok || !json.leadId) {
        setError(json.error ?? t("error"));
        return;
      }
      onCreated({ leadId: json.leadId, reusedContact: Boolean(json.reusedContact) });
    } catch {
      setError(t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={t("new.title")}
      onClose={onClose}
      wide
      closeLabel={t("actions.close")}
      footer={
        <>
          <button type="button" className="lead-btn" onClick={onClose} disabled={saving}>
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className="lead-btn realty-btn-primary"
            onClick={submit}
            disabled={saving}
          >
            {saving ? t("new.creating") : t("new.create")}
          </button>
        </>
      }
    >
      {error ? (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--danger)",
            background: "rgba(198, 40, 40, 0.10)",
            border: "1px solid rgba(198, 40, 40, 0.30)",
            borderRadius: 9,
            padding: "8px 10px",
          }}
        >
          {error}
        </p>
      ) : null}

      <div className="lead-dialog__grid">
        <Field label={t("new.name")} htmlFor="nl-name">
          <input
            id="nl-name"
            className="lead-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("new.namePlaceholder")}
            autoComplete="off"
          />
        </Field>
        <Field label={t("new.phone")} help={t("new.phoneHelp")} htmlFor="nl-phone">
          <input
            id="nl-phone"
            className="lead-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="off"
          />
        </Field>
        <Field label={t("new.email")} htmlFor="nl-email">
          <input
            id="nl-email"
            className="lead-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            autoComplete="off"
          />
        </Field>
        <Field label={t("new.source")} htmlFor="nl-source">
          <input
            id="nl-source"
            className="lead-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t("new.sourcePlaceholder")}
            list="nl-sources"
            autoComplete="off"
          />
          <datalist id="nl-sources">
            {catalogs.sources.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label={`${t("new.budget")} — ${t("filters.budgetMin")}`} htmlFor="nl-bmin">
          <input
            id="nl-bmin"
            className="lead-input"
            value={budgetMin}
            onChange={(e) => setBudgetMin(e.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label={`${t("new.budget")} — ${t("filters.budgetMax")}`} htmlFor="nl-bmax">
          <input
            id="nl-bmax"
            className="lead-input"
            value={budgetMax}
            onChange={(e) => setBudgetMax(e.target.value)}
            inputMode="numeric"
          />
        </Field>

        <Field label={t("new.credit")} htmlFor="nl-credit">
          <select
            id="nl-credit"
            className="lead-select"
            value={creditKind}
            onChange={(e) => setCreditKind(e.target.value as RealtyCreditKind)}
          >
            {CREDITS.map((c) => (
              <option key={c} value={c}>
                {t(`credit.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("new.property")} htmlFor="nl-prop">
          <select
            id="nl-prop"
            className="lead-select"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
          >
            <option value="">{t("card.noProperty")}</option>
            {catalogs.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>

        {canAssign ? (
          <Field label={t("new.agent")} htmlFor="nl-agent">
            <select
              id="nl-agent"
              className="lead-select"
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
            >
              <option value="">{t("new.agentAuto")}</option>
              {catalogs.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 11 }}>
        <p className="lead-panel__title">{t("new.wants")}</p>
        <div className="lead-dialog__grid" style={{ marginTop: 8 }}>
          <Field label={t("new.operation")} htmlFor="nl-op">
            <select
              id="nl-op"
              className="lead-select"
              value={operation}
              onChange={(e) => setOperation(e.target.value as RealtyOperation)}
            >
              <option value="VENTA">{t("operation.VENTA")}</option>
              <option value="RENTA">{t("operation.RENTA")}</option>
              <option value="AMBAS">{t("operation.AMBAS")}</option>
            </select>
          </Field>
          <Field label={t("new.bedrooms")} htmlFor="nl-bed">
            <input
              id="nl-bed"
              className="lead-input"
              value={bedroomsMin}
              onChange={(e) => setBedroomsMin(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
            />
          </Field>
        </div>

        <div style={{ marginTop: 10 }}>
          <span className="lead-label">{t("new.kinds")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
            {KINDS.map((k) => {
              const on = kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className="lead-btn lead-btn--sm"
                  aria-pressed={on}
                  onClick={() =>
                    setKinds((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))
                  }
                  style={
                    on
                      ? {
                          background: "var(--brand-soft)",
                          borderColor: "var(--border-brand)",
                          color: "var(--pine-700)",
                        }
                      : undefined
                  }
                >
                  {t(`kinds.${k}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <Field label={t("new.zones")} help={t("new.zonesPlaceholder")} htmlFor="nl-zones">
            <input
              id="nl-zones"
              className="lead-input"
              value={zones}
              onChange={(e) => setZones(e.target.value)}
              placeholder={t("new.zonesPlaceholder")}
              autoComplete="off"
            />
          </Field>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 11,
            fontSize: 12.5,
            color: "var(--text-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          {t("new.notify")}
        </label>
      </div>

      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 11 }}>
        <Field label={t("new.note")} htmlFor="nl-note">
          <textarea
            id="nl-note"
            className="lead-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("new.notePlaceholder")}
          />
        </Field>
      </div>
    </Dialog>
  );
}
