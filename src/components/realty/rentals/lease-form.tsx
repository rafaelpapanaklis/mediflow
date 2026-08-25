"use client";

// ═══════════════════════════════════════════════════════════════════════
// Alta y edición de un contrato de arrendamiento.
//
// Dos decisiones que valen la pena explicar:
//
// 1. El INQUILINO se puede capturar aquí mismo. El dueño de diez casas
//    llega con la persona ya escogida, no con un contacto dado de alta la
//    semana pasada; mandarlo a otra pantalla a crearlo es justo donde
//    abandona el flujo. Si ya existe en la libreta, se escoge de la lista.
//
// 2. La vista previa dice CUÁNTOS COBROS se van a generar antes de guardar.
//    Es la única forma de que alguien note a tiempo que puso 2027 donde iba
//    2026: un contrato de cien años no se ve raro hasta que enseña
//    "1 200 cobros".
//
// i18n CONVENCIÓN B: sub-árbol ya recortado, prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { UserPlus, Users } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { buildChargeSchedule, formatMoney } from "@/lib/realty/rent-charges";
import type {
  RealtyCurrency,
  RealtyIncreaseRule,
  RealtyLeasePartyRole,
} from "@/lib/realty/types";
import { Field, Modal, Note } from "./ui";

export interface PropertyOption {
  id: string;
  title: string;
  city: string | null;
  rentPrice: number | null;
  /** Para avisar del tope de la CDMX desde el formulario. */
  cdmx: boolean;
}

export interface ContactOption {
  id: string;
  name: string;
  phone: string | null;
}

export interface LeaseFormValue {
  id?: string;
  propertyId: string;
  startsAt: string;
  endsAt: string;
  rentAmount: string;
  currency: RealtyCurrency;
  paymentDay: string;
  depositAmount: string;
  increaseRule: RealtyIncreaseRule;
  increasePct: string;
  signedDocUrl: string;
  notes: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  tenantEmail: string;
  guarantorId: string;
  guarantorName: string;
  guarantorPhone: string;
  guarantorRole: RealtyLeasePartyRole;
}

function emptyValue(): LeaseFormValue {
  return {
    propertyId: "",
    startsAt: "",
    endsAt: "",
    rentAmount: "",
    currency: "MXN",
    paymentDay: "1",
    depositAmount: "",
    increaseRule: "INPC",
    increasePct: "",
    signedDocUrl: "",
    notes: "",
    tenantId: "",
    tenantName: "",
    tenantPhone: "",
    tenantEmail: "",
    guarantorId: "",
    guarantorName: "",
    guarantorPhone: "",
    guarantorRole: "AVAL",
  };
}

export function LeaseForm({
  dict,
  open,
  onClose,
  properties,
  contacts,
  initial,
  defaultMonth,
  onSaved,
}: {
  dict: Dictionary;
  open: boolean;
  onClose: () => void;
  properties: PropertyOption[];
  contacts: ContactOption[];
  initial?: LeaseFormValue | null;
  defaultMonth: string;
  onSaved: (id: string) => void;
}) {
  const t = makeRealtyT(dict);
  const [v, setV] = useState<LeaseFormValue>(initial ?? emptyValue());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTenant, setNewTenant] = useState(contacts.length === 0);
  const [withGuarantor, setWithGuarantor] = useState(false);

  useEffect(() => {
    if (!open) return;
    setV(initial ?? emptyValue());
    setError(null);
    setNewTenant(contacts.length === 0 || Boolean(initial?.tenantName && !initial?.tenantId));
    setWithGuarantor(Boolean(initial?.guarantorId || initial?.guarantorName));
  }, [open, initial, contacts.length]);

  function set<K extends keyof LeaseFormValue>(key: K, value: LeaseFormValue[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  const property = properties.find((p) => p.id === v.propertyId) ?? null;

  // La vista previa se calcula con el MISMO módulo que usa el servidor, así
  // que lo que anuncia es exactamente lo que se va a insertar.
  const preview = useMemo(() => {
    if (!v.startsAt || !v.endsAt) return null;
    const rows = buildChargeSchedule({
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      paymentDay: parseInt(v.paymentDay, 10) || 1,
      rentAmount: v.rentAmount || 0,
    });
    return rows;
  }, [v.startsAt, v.endsAt, v.paymentDay, v.rentAmount]);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const parties: Array<Record<string, unknown>> = [];
      if (newTenant) {
        parties.push({
          role: "INQUILINO",
          newContact: { name: v.tenantName, phone: v.tenantPhone, email: v.tenantEmail },
        });
      } else if (v.tenantId) {
        parties.push({ role: "INQUILINO", contactId: v.tenantId });
      }
      if (withGuarantor) {
        if (v.guarantorId) parties.push({ role: v.guarantorRole, contactId: v.guarantorId });
        else if (v.guarantorName.trim()) {
          parties.push({
            role: v.guarantorRole,
            newContact: { name: v.guarantorName, phone: v.guarantorPhone },
          });
        }
      }

      const payload = {
        propertyId: v.propertyId,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        rentAmount: v.rentAmount,
        currency: v.currency,
        paymentDay: parseInt(v.paymentDay, 10) || 1,
        depositAmount: v.depositAmount || 0,
        increaseRule: v.increaseRule,
        increasePct: v.increaseRule === "FIJO" ? Number(v.increasePct) : null,
        signedDocUrl: v.signedDocUrl.trim() || null,
        notes: v.notes.trim() || null,
        parties,
      };

      const res = await fetch(v.id ? `/api/realty/leases/${v.id}` : "/api/realty/leases", {
        method: v.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? t("common.genericError"));
        setBusy(false);
        return;
      }
      onSaved(String(data?.id ?? v.id ?? ""));
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      closeLabel={t("common.close")}
      title={v.id ? t("leases.editTitle") : t("leases.newTitle")}
      sub={t("leases.subtitle")}
      footer={
        <>
          <button type="button" className="rnt-btn" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className="rnt-btn rnt-btn--primary" onClick={submit} disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </>
      }
    >
      {error ? <Note tone="danger">{error}</Note> : null}

      <Field label={t("leases.form.property")} hint={t("leases.form.propertyHint")}>
        <select
          className="rnt-select"
          value={v.propertyId}
          onChange={(e) => {
            const id = e.target.value;
            set("propertyId", id);
            // La renta del inmueble se propone sola: en una cartera de diez
            // casas, teclearla otra vez es una fuente de errores gratuita.
            const p = properties.find((x) => x.id === id);
            if (p?.rentPrice && !v.rentAmount) set("rentAmount", String(p.rentPrice));
          }}
        >
          <option value="">{t("leases.form.pickProperty")}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.city ? ` — ${p.city}` : ""}
            </option>
          ))}
        </select>
      </Field>

      {property?.cdmx ? <Note tone="brand">{t("increase.capLaw")}</Note> : null}

      <div className="rnt-grid">
        <Field label={t("leases.form.startsAt")}>
          <input
            className="rnt-input"
            type="date"
            value={v.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </Field>
        <Field label={t("leases.form.endsAt")}>
          <input
            className="rnt-input"
            type="date"
            value={v.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
          />
        </Field>
      </div>

      <div className="rnt-grid">
        <Field label={t("leases.form.rent")}>
          <input
            className="rnt-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={v.rentAmount}
            onChange={(e) => set("rentAmount", e.target.value)}
          />
        </Field>
        <Field label={t("leases.form.paymentDay")} hint={t("leases.form.paymentDayHint")}>
          <select
            className="rnt-select"
            value={v.paymentDay}
            onChange={(e) => set("paymentDay", e.target.value)}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {preview ? (
        <Note tone={preview.length === 0 ? "warning" : "info"}>
          {preview.length === 0
            ? t("leases.form.previewNone")
            : t("leases.form.preview", { count: preview.length })}
        </Note>
      ) : null}

      <div className="rnt-grid">
        <Field label={t("leases.form.deposit")} hint={t("leases.form.depositHint")}>
          <input
            className="rnt-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={v.depositAmount}
            onChange={(e) => set("depositAmount", e.target.value)}
          />
        </Field>
        <Field label={t("leases.form.currency")}>
          <select
            className="rnt-select"
            value={v.currency}
            onChange={(e) => set("currency", e.target.value as RealtyCurrency)}
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>
        </Field>
      </div>

      <div className="rnt-grid">
        <Field label={t("leases.form.increaseRule")}>
          <select
            className="rnt-select"
            value={v.increaseRule}
            onChange={(e) => set("increaseRule", e.target.value as RealtyIncreaseRule)}
          >
            <option value="INPC">{t("leases.increaseRule.INPC")}</option>
            <option value="FIJO">{t("leases.increaseRule.FIJO")}</option>
            <option value="NINGUNO">{t("leases.increaseRule.NINGUNO")}</option>
          </select>
        </Field>
        {v.increaseRule === "FIJO" ? (
          <Field label={t("leases.form.increasePct")}>
            <input
              className="rnt-input"
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.01"
              value={v.increasePct}
              onChange={(e) => set("increasePct", e.target.value)}
            />
          </Field>
        ) : (
          <div />
        )}
      </div>

      {/* ── Quién firma ─────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
        <div className="rnt-toolbar" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 13, color: "var(--text-1)" }}>{t("leases.form.tenant")}</strong>
          {contacts.length > 0 ? (
            <button
              type="button"
              className="rnt-btn rnt-btn--sm"
              onClick={() => setNewTenant((x) => !x)}
            >
              {newTenant ? <Users size={13} /> : <UserPlus size={13} />}
              {newTenant ? t("leases.form.pickContact") : t("common.add")}
            </button>
          ) : null}
        </div>

        {newTenant ? (
          <div className="rnt-grid">
            <Field label={t("leases.form.tenant")} hint={t("leases.form.tenantHint")}>
              <input
                className="rnt-input"
                value={v.tenantName}
                onChange={(e) => set("tenantName", e.target.value)}
              />
            </Field>
            <Field label="WhatsApp">
              <input
                className="rnt-input"
                inputMode="tel"
                value={v.tenantPhone}
                onChange={(e) => set("tenantPhone", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                className="rnt-input"
                type="email"
                value={v.tenantEmail}
                onChange={(e) => set("tenantEmail", e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <Field label={t("leases.form.tenant")} hint={t("leases.form.tenantHint")}>
            <select
              className="rnt-select"
              value={v.tenantId}
              onChange={(e) => set("tenantId", e.target.value)}
            >
              <option value="">{t("leases.form.pickContact")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` — ${c.phone}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={withGuarantor}
            onChange={(e) => setWithGuarantor(e.target.checked)}
          />
          <span>{t("leases.form.addParty")}</span>
        </label>
        {withGuarantor ? (
          <div className="rnt-grid" style={{ marginTop: 10 }}>
            <Field label={t("leases.form.role")}>
              <select
                className="rnt-select"
                value={v.guarantorRole}
                onChange={(e) => set("guarantorRole", e.target.value as RealtyLeasePartyRole)}
              >
                <option value="AVAL">{t("leases.role.AVAL")}</option>
                <option value="FIADOR">{t("leases.role.FIADOR")}</option>
              </select>
            </Field>
            <Field label={t("leases.form.guarantor")} hint={t("leases.form.guarantorHint")}>
              <input
                className="rnt-input"
                value={v.guarantorName}
                onChange={(e) => {
                  set("guarantorName", e.target.value);
                  set("guarantorId", "");
                }}
              />
            </Field>
            <Field label="WhatsApp">
              <input
                className="rnt-input"
                inputMode="tel"
                value={v.guarantorPhone}
                onChange={(e) => set("guarantorPhone", e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <Field label={t("leases.form.signedDocUrl")}>
        <input
          className="rnt-input"
          value={v.signedDocUrl}
          onChange={(e) => set("signedDocUrl", e.target.value)}
          placeholder="https://"
        />
      </Field>

      <Field label={t("leases.form.notes")} hint={t("leases.form.notesHint")}>
        <textarea
          className="rnt-textarea"
          value={v.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      {preview && preview.length > 0 && v.rentAmount ? (
        <Note tone="brand">
          {t("leases.form.preview", { count: preview.length })}{" "}
          {formatMoney(v.rentAmount, v.currency)} · {t("leases.detail.paymentDay")} {v.paymentDay}
        </Note>
      ) : null}
    </Modal>
  );
}

/** Atajo para los toast de error de las pantallas del área. */
export function toastError(message: string) {
  toast.error(message);
}
