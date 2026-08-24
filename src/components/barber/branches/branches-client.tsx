"use client";

import { useState } from "react";
import { ArrowRightLeft, CalendarClock, Crown, Pencil, Plus, Store } from "lucide-react";
import Link from "next/link";
import type { BarberBranchLimit, BarberBranchRow } from "@/lib/barber/branches";
import { switchBranchAndReload } from "../team/admin-nav";
import {
  adminStyles as s,
  apiCall,
  Banner,
  Btn,
  Chip,
  ErrorText,
  Field,
  Modal,
  Select,
  TextInput,
  useSaving,
  useT,
} from "../team/admin-ui";

// ═══════════════════════════════════════════════════════════════════════
// /barber/sucursales — sedes de la cadena (plan Profesional).
//
// El tope maxBranches y la feature multiBranch se validan en el SERVIDOR
// (src/lib/barber/branches.ts). Lo de aquí es solo el reflejo: si alguien
// llama la API a mano igual le rebota.
//
// Cambiar de sede recarga la página COMPLETA a propósito (ver
// switchBranchAndReload): así no queda ni un dato de la sede anterior.
// ═══════════════════════════════════════════════════════════════════════

const TIMEZONES = [
  "America/Mexico_City",
  "America/Monterrey",
  "America/Cancun",
  "America/Merida",
  "America/Chihuahua",
  "America/Mazatlan",
  "America/Hermosillo",
  "America/Tijuana",
];

type FormState = {
  id: string | null;
  isMainBranch: boolean;
  branchName: string;
  name: string;
  address: string;
  phone: string;
  city: string;
  state: string;
  timezone: string;
};

function emptyForm(timezone: string): FormState {
  return {
    id: null,
    isMainBranch: false,
    branchName: "",
    name: "",
    address: "",
    phone: "",
    city: "",
    state: "",
    timezone,
  };
}

function toForm(b: BarberBranchRow): FormState {
  return {
    id: b.id,
    isMainBranch: b.isMainBranch,
    branchName: b.branchName ?? "",
    name: b.name,
    address: b.address ?? "",
    phone: b.phone ?? "",
    city: b.city ?? "",
    state: b.state ?? "",
    timezone: b.timezone,
  };
}

export function BranchesClient({
  initialBranches,
  limit,
  activeBranchId,
  isConsolidated,
  publicBase,
}: {
  initialBranches: BarberBranchRow[];
  limit: BarberBranchLimit;
  activeBranchId: string | null;
  isConsolidated: boolean;
  publicBase: string;
}) {
  const t = useT();
  const [branches, setBranches] = useState(initialBranches);
  const [form, setForm] = useState<FormState | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const { saving, error, setError, run } = useSaving();

  const defaultTz = branches[0]?.timezone ?? TIMEZONES[0];
  const limitText = limit.unlimited
    ? t("branches.limitUnlimited", { used: limit.used, plan: limit.planName })
    : t("branches.limit", { used: limit.used, max: limit.max, plan: limit.planName });

  const totals = branches.reduce(
    (acc, b) => ({
      barbers: acc.barbers + b.barbersCount,
      users: acc.users + b.usersCount,
    }),
    { barbers: 0, users: 0 },
  );

  function patch(next: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...next } : f));
  }

  async function save() {
    if (!form) return;
    const payload = {
      branchName: form.branchName,
      name: form.name,
      address: form.address,
      phone: form.phone,
      city: form.city,
      state: form.state,
      timezone: form.timezone,
    };
    const ok = await run(async () => {
      if (form.id) {
        const { branch } = await apiCall<{ branch: BarberBranchRow }>(
          `/api/barber/branches/${form.id}`,
          { method: "PATCH", json: payload },
        );
        setBranches((list) => list.map((b) => (b.id === branch.id ? branch : b)));
      } else {
        const { branch } = await apiCall<{ branch: BarberBranchRow }>("/api/barber/branches", {
          method: "POST",
          json: payload,
        });
        setBranches((list) => [...list, branch]);
      }
    });
    if (ok) setForm(null);
  }

  async function toggleOpen(branch: BarberBranchRow) {
    setListError(null);
    const next = !branch.isActive;
    if (!next && !window.confirm(t("branches.confirmClose", { name: branch.branchName || branch.name }))) {
      return;
    }
    try {
      await apiCall(`/api/barber/branches/${branch.id}`, {
        method: "PATCH",
        json: { isActive: next },
      });
      setBranches((list) =>
        list.map((b) => (b.id === branch.id ? { ...b, isActive: next } : b)),
      );
    } catch (err) {
      setListError(err instanceof Error ? err.message : t("common.genericError"));
    }
  }

  async function workHere(branchId: string) {
    if (switching) return;
    setSwitching(true);
    await switchBranchAndReload(branchId);
  }

  return (
    <>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>{t("branches.title")}</h1>
          <p className={s.subtitle}>{t("branches.subtitle")}</p>
        </div>
        <div className={s.headerActions}>
          {limit.featureOn ? (
            <Chip tone={limit.canCreate ? undefined : "warn"}>{limitText}</Chip>
          ) : null}
          <Btn
            variant="primary"
            disabled={!limit.canCreate}
            onClick={() => setForm(emptyForm(defaultTz))}
          >
            <Plus size={15} />
            {t("branches.new")}
          </Btn>
        </div>
      </header>

      {!limit.featureOn ? (
        <Banner
          title={t("branches.lockedTitle")}
          icon={<Crown size={16} />}
          action={
            <Link href="/barber/suscripcion" className={[s.btn, s.btnSm].join(" ")}>
              {t("branches.lockedCta")}
            </Link>
          }
        >
          {t("branches.lockedBody")}
        </Banner>
      ) : null}

      {limit.featureOn && !limit.canCreate ? (
        <Banner tone="danger">{t("branches.limitFull", { plan: limit.planName })}</Banner>
      ) : null}

      {listError ? <ErrorText>{listError}</ErrorText> : null}

      {branches.length > 1 ? (
        <div className={[s.card, s.cardPad].join(" ")}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-1)" }}>
            {t("branches.consolidatedTitle")}
          </div>
          <p className={s.hint} style={{ marginTop: 4 }}>
            {t("branches.consolidatedBody", {
              branches: branches.length,
              barbers: totals.barbers,
              users: totals.users,
            })}
          </p>
          {!isConsolidated ? (
            <div style={{ marginTop: 10 }}>
              <Btn size="sm" onClick={() => workHere("all")} disabled={switching}>
                <ArrowRightLeft size={13} />
                {t("branches.consolidatedCta")}
              </Btn>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <Chip tone="brand">{t("branch.consolidated")}</Chip>
            </div>
          )}
        </div>
      ) : null}

      <div className={s.grid}>
        {branches.map((b) => {
          const isCurrent = !isConsolidated && b.id === activeBranchId;
          return (
            <article
              key={b.id}
              className={[
                s.rowCard,
                b.isActive ? "" : s.rowCardMuted,
                isCurrent ? s.rowCardCurrent : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className={s.avatar} aria-hidden="true">
                <Store size={20} />
              </div>
              <div className={s.rowMain}>
                <div className={s.rowTitle}>
                  <span className={s.truncate}>{b.branchName || b.name}</span>
                  {b.isMainBranch ? <Chip tone="brand">{t("branches.mainBranch")}</Chip> : null}
                  {isCurrent ? <Chip tone="brand">{t("branches.current")}</Chip> : null}
                  {!b.isActive ? <Chip tone="muted">{t("branch.closed")}</Chip> : null}
                </div>
                <div className={s.rowMeta}>
                  {b.address ? <span className={s.truncate}>{b.address}</span> : null}
                  {b.city ? <span>{b.city}</span> : null}
                  {b.phone ? <span>{b.phone}</span> : null}
                </div>
                <div className={s.rowMeta}>
                  <Chip tone="muted">{t("branches.barbersCount", { count: b.barbersCount })}</Chip>
                  <Chip tone="muted">{t("branches.usersCount", { count: b.usersCount })}</Chip>
                  <Chip tone="muted">{b.timezone}</Chip>
                </div>
                <div className={s.rowMeta}>
                  <a
                    href={`${publicBase}/${b.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className={s.truncate}
                    style={{ color: "var(--brand)", textDecoration: "none" }}
                  >
                    {t("branches.publicUrl")}: {publicBase}/{b.slug}
                  </a>
                </div>
                <div className={s.rowActions}>
                  {limit.featureOn ? (
                    <Btn size="sm" onClick={() => setForm(toForm(b))}>
                      <Pencil size={13} />
                      {t("common.edit")}
                    </Btn>
                  ) : null}
                  {!isCurrent ? (
                    <Btn size="sm" onClick={() => workHere(b.id)} disabled={switching}>
                      <ArrowRightLeft size={13} />
                      {t("branches.switchHere")}
                    </Btn>
                  ) : null}
                  {!b.isMainBranch ? (
                    <Btn
                      size="sm"
                      variant={b.isActive ? "danger" : "default"}
                      onClick={() => toggleOpen(b)}
                    >
                      {b.isActive ? t("branches.closeBranch") : t("branches.openBranch")}
                    </Btn>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <Banner
        title={t("branches.hoursTitle")}
        icon={<CalendarClock size={16} />}
        action={
          <Link href="/barber/agenda/horarios" className={[s.btn, s.btnSm].join(" ")}>
            {t("branches.hoursLink")}
          </Link>
        }
      >
        {t("branches.hoursBody")}
      </Banner>

      {form ? (
        <Modal
          title={form.id ? t("branches.formEdit") : t("branches.formNew")}
          onClose={() => {
            setForm(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setForm(null)} disabled={saving}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="primary" onClick={save} disabled={saving}>
                {saving ? t("common.saving") : t("common.save")}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <div className={s.formGrid}>
            <Field label={t("branches.nameShort")} hint={t("branches.nameShortHint")} full>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.branchName}
                  maxLength={60}
                  placeholder={t("branches.nameShortPlaceholder")}
                  onChange={(e) => patch({ branchName: e.target.value })}
                />
              )}
            </Field>
            <Field
              label={t("branches.fullName")}
              hint={
                form.isMainBranch ? t("branches.fullNameLockedMain") : t("branches.fullNameHint")
              }
              full
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={form.name}
                  maxLength={120}
                  disabled={form.isMainBranch}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("branches.address")} full>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.address}
                  maxLength={200}
                  onChange={(e) => patch({ address: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("branches.phone")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.phone}
                  maxLength={20}
                  inputMode="tel"
                  onChange={(e) => patch({ phone: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("branches.city")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.city}
                  maxLength={80}
                  onChange={(e) => patch({ city: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("branches.state")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={form.state}
                  maxLength={80}
                  onChange={(e) => patch({ state: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("branches.timezone")} hint={t("branches.timezoneHint")}>
              {(id) => (
                <Select
                  id={id}
                  value={form.timezone}
                  onChange={(e) => patch({ timezone: e.target.value })}
                >
                  {(TIMEZONES.includes(form.timezone)
                    ? TIMEZONES
                    : [form.timezone].concat(TIMEZONES)
                  ).map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
