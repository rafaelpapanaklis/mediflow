"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarHeart,
  Check,
  Clock,
  Copy,
  Gift,
  Search,
  Settings2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type {
  BarberClientListFilter,
  BarberClientListItem,
  BarberClientListResult,
  BarberClientsConfig,
} from "@/lib/barber/clients";
import {
  Badge,
  Field,
  Modal,
  Stamps,
  clientStyles as s,
  initials,
  prettyPhone,
  relativeVisit,
  useBarberT,
  useToast,
} from "./ui";

/**
 * Lista de clientes de la barbería.
 *
 * El buscador va por TELÉFONO primero: en un mostrador nadie pregunta el
 * apellido, pregunta el número. También busca por nombre y por correo.
 *
 * Las pestañas no son adorno: "Premio listo", "Cumpleaños" y "No han vuelto"
 * son las tres razones por las que alguien abre esta pantalla.
 */

const FILTERS: BarberClientListFilter[] = ["all", "reward", "birthday", "inactive", "blocked"];

const TAB_ICON: Record<BarberClientListFilter, React.ComponentType<{ size?: number | string }>> = {
  all: Users,
  reward: Gift,
  birthday: CalendarHeart,
  inactive: Clock,
  blocked: Ban,
};

export interface ClientsScreenProps {
  dict: Dictionary;
  locale: string;
  initial: BarberClientListResult;
  canEdit: boolean;
  canEditSettings: boolean;
}

export function BarberClientsScreen({
  dict,
  locale,
  initial,
  canEdit,
  canEditSettings,
}: ClientsScreenProps) {
  const t = useBarberT(dict);
  const router = useRouter();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<BarberClientListFilter>("all");
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(new Date().getUTCMonth() + 1);

  const [data, setData] = useState<BarberClientListResult>(initial);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<BarberClientsConfig>(initial.config);

  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Secuencia de petición: si el barbero escribe rápido, la respuesta que
  // llega tarde NO puede pisar a la que llegó después.
  const seq = useRef(0);
  const firstRun = useRef(true);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter, page: String(page) });
      if (debounced) params.set("q", debounced);
      if (filter === "birthday") params.set("month", String(month));
      const res = await fetch(`/api/barber/clients?${params.toString()}`);
      if (mine !== seq.current) return;
      if (!res.ok) {
        toast.show(t("errors.load"));
        return;
      }
      const json = (await res.json()) as BarberClientListResult;
      if (mine !== seq.current) return;
      setData(json);
      setConfig(json.config);
    } catch {
      if (mine === seq.current) toast.show(t("errors.load"));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // toast.show y t son estables; se omiten a propósito para no recargar
    // la lista cada vez que cambia un mensaje efímero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, filter, page, month]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return; // la primera pintura ya viene del servidor
    }
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debounced, filter, month]);

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const monthName = t(`months.${month}`);

  async function copyPhones(kind: "birthday" | "inactive") {
    try {
      const params = new URLSearchParams({ kind });
      if (kind === "birthday") params.set("month", String(month));
      const res = await fetch(`/api/barber/clients/outreach?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(json?.error || t("errors.generic"));
        return;
      }
      const phones = (json.targets ?? []).map((x: { phone: string }) => x.phone).join("\n");
      await navigator.clipboard.writeText(phones);
      toast.show(t("outreach.copied"));
    } catch {
      toast.show(t("outreach.copyFailed"));
    }
  }

  return (
    <>
      <div className={s.page}>
        <header className={s.header}>
          <div className={s.headerInner}>
            <div className={s.headerText}>
              <h1 className={s.title}>{t("title")}</h1>
              <p className={s.subtitle}>{t("subtitle")}</p>
            </div>
            <div className={s.headerActions}>
              {canEditSettings ? (
                <button
                  type="button"
                  className={s.btn}
                  onClick={() => setShowSettings(true)}
                >
                  <Settings2 size={14} />
                  {t("settings.cta")}
                </button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className={`${s.btn} barber-btn-primary`}
                  onClick={() => setShowNew(true)}
                >
                  <UserPlus size={14} />
                  {t("new.cta")}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <section className={`${s.card} ${s.cardPad} ${s.toolbar}`}>
          <div className={s.toolbarInner}>
            <div className={s.searchRow}>
              <div className={s.searchBox}>
                <span className={s.searchIcon}>
                  <Search size={15} />
                </span>
                <input
                  className={s.searchInput}
                  type="search"
                  value={search}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.label")}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search ? (
                  <button
                    type="button"
                    className={s.searchClear}
                    onClick={() => setSearch("")}
                    aria-label={t("search.clear")}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className={s.tabs} role="tablist" aria-label={t("title")}>
              {FILTERS.map((key) => {
                const Icon = TAB_ICON[key];
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`${s.tab} ${active ? s.tabActive : ""}`}
                    onClick={() => setFilter(key)}
                  >
                    <Icon size={13} />
                    <span style={{ marginLeft: 5 }}>{t(`tabs.${key}`)}</span>
                    {active ? <span className={s.tabCount}>{data.total}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {filter === "birthday" || filter === "inactive" ? (
          <div className={s.notice}>
            {filter === "birthday" ? <CalendarHeart size={16} /> : <Clock size={16} />}
            <div className={s.noticeBody}>
              <p className={s.noticeTitle}>
                {filter === "birthday"
                  ? t("outreach.birthdayTitle", { month: monthName })
                  : t("outreach.inactiveTitle", { days: config.inactiveDays })}
              </p>
              <p className={s.noticeText}>
                {filter === "inactive" ? t("outreach.inactiveWhy") : t("outreach.whatsappSoon")}
              </p>
              <div className={s.noticeActions}>
                {filter === "birthday" ? (
                  <select
                    className={s.select}
                    style={{ width: "auto" }}
                    value={month}
                    aria-label={t("outreach.birthdayTitle", { month: monthName })}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {t(`months.${m}`)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSm}`}
                  onClick={() => copyPhones(filter === "birthday" ? "birthday" : "inactive")}
                >
                  <Copy size={13} />
                  {t("outreach.copyPhones")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className={`${s.card} ${s.listWrap}`}>
          {loading ? (
            <div className={s.list} aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className={s.skeleton} />
              ))}
            </div>
          ) : data.items.length === 0 ? (
            <div className={s.empty}>
              <span className={s.emptyIcon}>
                <Users size={20} />
              </span>
              <span>{debounced ? t("empty.search") : t(`empty.${filter}`)}</span>
            </div>
          ) : (
            <>
              <div className={s.list}>
                {data.items.map((item) => (
                  <ClientRow
                    key={item.id}
                    item={item}
                    config={config}
                    locale={locale}
                    t={t}
                    showBirthday={filter === "birthday"}
                  />
                ))}
              </div>
              {pages > 1 ? (
                <div className={s.pager}>
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSm}`}
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("pager.prev")}
                  </button>
                  <span className={s.pagerText}>{t("pager.page", { page, pages })}</span>
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSm}`}
                    disabled={page >= pages}
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  >
                    {t("pager.next")}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      {/* Los diálogos viven FUERA de .page: ningún ancestro con
          container-type puede atrapar su position: fixed. */}
      {showNew ? (
        <NewClientModal
          t={t}
          onClose={() => setShowNew(false)}
          onDone={(clientId, created) => {
            setShowNew(false);
            toast.show(created ? t("new.created") : t("new.linked"));
            router.push(`/barber/clientes/${clientId}`);
          }}
          onMessage={toast.show}
        />
      ) : null}

      {showSettings ? (
        <SettingsModal
          t={t}
          config={config}
          onClose={() => setShowSettings(false)}
          onSaved={(next) => {
            setConfig(next);
            setShowSettings(false);
            toast.show(t("settings.saved"));
            void load();
          }}
          onMessage={toast.show}
        />
      ) : null}

      {toast.node}
    </>
  );
}

// ── Fila ───────────────────────────────────────────────────────────────

function ClientRow({
  item,
  config,
  locale,
  t,
  showBirthday,
}: {
  item: BarberClientListItem;
  config: BarberClientsConfig;
  locale: string;
  t: ReturnType<typeof useBarberT>;
  showBirthday: boolean;
}) {
  return (
    <Link href={`/barber/clientes/${item.id}`} className={s.rowLink} aria-label={t("table.open")}>
      <div className={s.row}>
        <div className={s.rowIdentity}>
          <span className={`${s.avatar} ${item.blockedAt ? s.avatarMuted : ""}`} aria-hidden="true">
            {initials(item.name)}
          </span>
          <span className={s.rowNames}>
            <span className={s.rowName}>{item.name}</span>
            <span className={s.rowPhone}>{prettyPhone(item.phone)}</span>
          </span>
        </div>

        <div className={s.rowStats}>
          <span className={s.stat}>
            <span className={s.statLabel}>
              {showBirthday ? t("table.birthdayDay", { day: item.birthdayDay ?? "" }) : t("table.lastVisit")}
            </span>
            <span className={s.statValue}>{relativeVisit(item.lastVisitAt, t, locale)}</span>
          </span>
          <span className={s.stat}>
            <span className={s.statLabel}>{t("table.visits")}</span>
            <span className={s.statValue}>{item.totalVisits}</span>
          </span>
          {config.loyaltyEnabled ? (
            <span className={s.stat}>
              <span className={s.statLabel}>{t("table.loyalty")}</span>
              <Stamps
                filled={item.loyaltyCount}
                total={config.loyaltyThreshold}
                label={t("loyalty.stamps", {
                  count: Math.min(item.loyaltyCount, config.loyaltyThreshold),
                  total: config.loyaltyThreshold,
                })}
              />
            </span>
          ) : null}
        </div>

        <div className={s.rowBadges}>
          {item.rewardAvailable ? (
            <Badge tone="brand">
              <Gift size={11} /> {t("badges.reward")}
            </Badge>
          ) : null}
          {item.hasMembership ? <Badge tone="success">{t("badges.membership")}</Badge> : null}
          {item.blockedAt ? (
            <Badge tone="danger">
              <Ban size={11} /> {t("badges.blocked")}
            </Badge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

// ── Alta ───────────────────────────────────────────────────────────────

function NewClientModal({
  t,
  onClose,
  onDone,
  onMessage,
}: {
  t: ReturnType<typeof useBarberT>;
  onClose: () => void;
  onDone: (clientId: string, created: boolean) => void;
  onMessage: (text: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    birthday: "",
    notes: "",
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/barber/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ field: data?.field, message: data?.error || t("errors.generic") });
        return;
      }
      onDone(data.client.id, Boolean(data.created));
    } catch {
      onMessage(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  const err = (field: string) => (error?.field === field ? error.message : null);

  return (
    <Modal
      title={t("new.title")}
      onClose={onClose}
      closeLabel={t("form.cancel")}
      footer={
        <>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost}`}
            onClick={onClose}
            disabled={busy}
          >
            {t("form.cancel")}
          </button>
          <button
            type="button"
            className={`${s.btn} barber-btn-primary`}
            onClick={submit}
            disabled={busy}
          >
            <Check size={14} />
            {busy ? t("form.saving") : t("new.save")}
          </button>
        </>
      }
    >
      <Field label={t("form.name")} htmlFor="nc-name" error={err("name")}>
        <input
          id="nc-name"
          className={s.input}
          value={form.name}
          placeholder={t("form.namePlaceholder")}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>

      <Field
        label={t("form.phone")}
        htmlFor="nc-phone"
        hint={t("search.hint")}
        error={err("phone")}
      >
        <input
          id="nc-phone"
          className={s.input}
          value={form.phone}
          inputMode="tel"
          placeholder={t("form.phonePlaceholder")}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </Field>

      <Field label={t("form.email")} htmlFor="nc-email" error={err("email")}>
        <input
          id="nc-email"
          className={s.input}
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </Field>

      <Field label={t("form.birthday")} htmlFor="nc-birthday" error={err("birthday")}>
        <input
          id="nc-birthday"
          className={s.input}
          type="date"
          value={form.birthday}
          onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))}
        />
      </Field>

      <Field label={t("form.notes")} htmlFor="nc-notes">
        <textarea
          id="nc-notes"
          className={s.textarea}
          value={form.notes}
          placeholder={t("form.notesPlaceholder")}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </Field>

      {error && !error.field ? <span className={s.errorText}>{error.message}</span> : null}
    </Modal>
  );
}

// ── Ajustes de fidelidad ───────────────────────────────────────────────

function SettingsModal({
  t,
  config,
  onClose,
  onSaved,
  onMessage,
}: {
  t: ReturnType<typeof useBarberT>;
  config: BarberClientsConfig;
  onClose: () => void;
  onSaved: (next: BarberClientsConfig) => void;
  onMessage: (text: string) => void;
}) {
  const [draft, setDraft] = useState({
    loyaltyEnabled: config.loyaltyEnabled,
    loyaltyThreshold: String(config.loyaltyThreshold),
    loyaltyReward: config.loyaltyReward,
    inactiveDays: String(config.inactiveDays),
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/barber/clients/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loyaltyEnabled: draft.loyaltyEnabled,
          loyaltyThreshold: Number(draft.loyaltyThreshold),
          loyaltyReward: draft.loyaltyReward,
          inactiveDays: Number(draft.inactiveDays),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onMessage(data?.error || t("errors.generic"));
        return;
      }
      onSaved(data.config as BarberClientsConfig);
    } catch {
      onMessage(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("settings.title")}
      onClose={onClose}
      closeLabel={t("form.cancel")}
      footer={
        <>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost}`}
            onClick={onClose}
            disabled={busy}
          >
            {t("form.cancel")}
          </button>
          <button
            type="button"
            className={`${s.btn} barber-btn-primary`}
            onClick={save}
            disabled={busy}
          >
            <Check size={14} />
            {busy ? t("form.saving") : t("settings.save")}
          </button>
        </>
      }
    >
      {!config.persisted ? (
        <p className={s.errorText}>
          {t("settings.pending", {
            threshold: config.loyaltyThreshold,
            days: config.inactiveDays,
          })}
        </p>
      ) : null}

      <label className={s.checkRow}>
        <input
          type="checkbox"
          checked={draft.loyaltyEnabled}
          onChange={(e) => setDraft((d) => ({ ...d, loyaltyEnabled: e.target.checked }))}
        />
        {t("settings.enabled")}
      </label>

      <Field
        label={t("settings.threshold")}
        htmlFor="set-threshold"
        hint={t("settings.thresholdHint", { min: 1, max: 100 })}
      >
        <input
          id="set-threshold"
          className={s.input}
          type="number"
          min={1}
          max={100}
          value={draft.loyaltyThreshold}
          onChange={(e) => setDraft((d) => ({ ...d, loyaltyThreshold: e.target.value }))}
        />
      </Field>

      <Field label={t("settings.reward")} htmlFor="set-reward">
        <input
          id="set-reward"
          className={s.input}
          value={draft.loyaltyReward}
          placeholder={t("settings.rewardPlaceholder")}
          onChange={(e) => setDraft((d) => ({ ...d, loyaltyReward: e.target.value }))}
        />
      </Field>

      <Field
        label={t("settings.inactiveDays")}
        htmlFor="set-inactive"
        hint={t("settings.inactiveDaysHint", { min: 7, max: 730 })}
      >
        <input
          id="set-inactive"
          className={s.input}
          type="number"
          min={7}
          max={730}
          value={draft.inactiveDays}
          onChange={(e) => setDraft((d) => ({ ...d, inactiveDays: e.target.value }))}
        />
      </Field>
    </Modal>
  );
}
