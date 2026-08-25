"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  BadgeCheck,
  Contact,
  Loader2,
  Mail,
  Phone,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  REALTY_PROPERTY_STATUS_UI,
} from "@/lib/realty/types";
import type { RealtyOwnerDetail, RealtyOwnerPage } from "@/lib/realty/properties-shared";
import { REALTY_EXCLUSIVE_WARN_DAYS } from "@/lib/realty/properties-shared";
import {
  apiCall,
  Badge,
  ErrorText,
  Field,
  formatDate,
  formatPrice,
  initials,
  Modal,
  prettyPhone,
  styles as s,
  useRealtyT,
  useSaving,
} from "./ui";

/**
 * /inmobiliaria/propietarios — la libreta de DUEÑOS de la cartera.
 *
 * En modo OWNER esta pantalla no existe: el propietario es la propia
 * cuenta. Eso lo recorta el contrato (REALTY_NAV_ITEMS.modes) y el redirect
 * de la página, no un if aquí dentro.
 */

export interface OwnersScreenProps {
  dict: Dictionary;
  locale: string;
  initial: RealtyOwnerPage;
  canEdit: boolean;
}

export function OwnersScreen({ dict, locale, initial, canEdit }: OwnersScreenProps) {
  const t = useRealtyT(dict);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RealtyOwnerPage>(initial);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);
  const firstRun = useRef(true);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 320);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (debounced) params.set("q", debounced);
      const json = await apiCall<RealtyOwnerPage>(`/api/realty/owners?${params.toString()}`);
      if (mine !== seq.current) return;
      setData(json);
    } catch (e) {
      if (mine === seq.current) toast.error(e instanceof Error ? e.message : t("errors.load"));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // Misma razon que en la cartera: una `t` inestable en las
    // dependencias reengancha `load` y dispara un bucle de peticiones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, page]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    void load();
  }, [load]);

  return (
    <>
      <div className={`realty-page ${s.page}`}>
        <header className={s.header}>
          <div className={s.headerInner}>
            <div className={s.headerText}>
              <h1 className={s.title}>{t("owners.title")}</h1>
              <p className={s.subtitle}>{t("owners.subtitle")}</p>
            </div>
            {canEdit ? (
              <div className={s.headerActions}>
                <button
                  type="button"
                  className={`${s.btn} realty-btn-primary`}
                  onClick={() => setCreating(true)}
                >
                  <Plus size={15} />
                  {t("owners.new")}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <section className={s.card}>
          <div className={`${s.cardPad} ${s.toolbar}`}>
            <div className={s.toolbarInner}>
              <div className={s.searchBox}>
                <span className={s.searchIcon}>
                  <Search size={15} />
                </span>
                <input
                  className={s.searchInput}
                  type="search"
                  value={q}
                  placeholder={t("owners.search")}
                  aria-label={t("owners.search")}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q ? (
                  <button
                    type="button"
                    className={s.searchClear}
                    onClick={() => setQ("")}
                    aria-label={t("search.clear")}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {loading ? (
            <div className={s.cardBody} aria-busy="true">
              <div style={{ display: "grid", gap: 10 }}>
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className={s.skeleton} />
                ))}
              </div>
            </div>
          ) : data.rows.length === 0 ? (
            <div className={s.empty}>
              <span className={s.emptyIcon}>
                <Contact size={22} />
              </span>
              <span className={s.emptyTitle}>
                {debounced ? t("owners.emptySearch") : t("owners.empty")}
              </span>
              {!debounced ? <span className={s.emptyBody}>{t("owners.emptyBody")}</span> : null}
            </div>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>{t("owners.name")}</th>
                    <th>{t("owners.phone")}</th>
                    <th>{t("owners.email")}</th>
                    <th className={s.num}>{t("owners.properties")}</th>
                    <th className={s.num}>{t("owners.exclusives")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/inmobiliaria/propietarios/${o.id}`} className={s.ownerName}>
                          <span className={s.avatar} aria-hidden="true">
                            {initials(o.name)}
                          </span>
                          <span className={s.cellTitleLink}>{o.name}</span>
                        </Link>
                      </td>
                      <td>
                        {o.phone ? (
                          <a className={s.contactLink} href={`tel:${o.phone}`}>
                            {prettyPhone(o.phone)}
                          </a>
                        ) : (
                          <span className={s.muted}>—</span>
                        )}
                      </td>
                      <td>
                        {o.email ? (
                          <a className={s.contactLink} href={`mailto:${o.email}`}>
                            {o.email}
                          </a>
                        ) : (
                          <span className={s.muted}>—</span>
                        )}
                      </td>
                      <td className={s.num}>{o.propertyCount}</td>
                      <td className={s.num}>
                        {o.activeExclusives > 0 ? (
                          <Badge tone="brand">{o.activeExclusives}</Badge>
                        ) : (
                          <span className={s.muted}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.pageCount > 1 ? (
            <div className={s.pager}>
              <button
                type="button"
                className={`${s.btn} ${s.btnSm}`}
                disabled={data.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("pager.prev")}
              </button>
              <span className={s.pagerText}>
                {t("pager.page", { page: data.page, pages: data.pageCount })}
              </span>
              <button
                type="button"
                className={`${s.btn} ${s.btnSm}`}
                disabled={data.page >= data.pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("pager.next")}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {creating ? (
        <OwnerFormModal
          t={t}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function OwnerFormModal({
  t,
  onClose,
  onDone,
}: {
  t: ReturnType<typeof useRealtyT>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", rfc: "", notes: "" });
  const { saving, error, setError, run } = useSaving();

  async function submit() {
    if (!form.name.trim()) {
      setError(t("owners.nameRequired"));
      return;
    }
    const ok = await run(async () => {
      await apiCall("/api/realty/owners", {
        method: "POST",
        json: {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          rfc: form.rfc.trim() || null,
          notes: form.notes.trim() || null,
        },
      });
    });
    if (ok) {
      toast.success(t("owners.created"));
      onDone();
    }
  }

  return (
    <Modal
      title={t("owners.new")}
      onClose={onClose}
      closeLabel={t("actions.cancel")}
      footer={
        <>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost}`}
            onClick={onClose}
            disabled={saving}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className={`${s.btn} realty-btn-primary`}
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? <Loader2 size={14} className={s.spin} /> : <Plus size={14} />}
            {saving ? t("owners.creating") : t("owners.create")}
          </button>
        </>
      }
    >
      <Field label={t("owners.name")} htmlFor="ow-name">
        <input
          id="ow-name"
          className={s.input}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>
      <Field label={t("owners.phone")} htmlFor="ow-phone">
        <input
          id="ow-phone"
          className={s.input}
          inputMode="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </Field>
      <Field label={t("owners.email")} htmlFor="ow-email">
        <input
          id="ow-email"
          className={s.input}
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </Field>
      <Field label={t("owners.rfc")} htmlFor="ow-rfc" hint={t("owners.rfcHint")}>
        <input
          id="ow-rfc"
          className={s.input}
          value={form.rfc}
          onChange={(e) => setForm((f) => ({ ...f, rfc: e.target.value.toUpperCase() }))}
        />
      </Field>
      <Field label={t("owners.notes")} htmlFor="ow-notes">
        <textarea
          id="ow-notes"
          className={s.textarea}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}

// ── Ficha del propietario ──────────────────────────────────────────────
export interface OwnerDetailProps {
  dict: Dictionary;
  locale: string;
  owner: RealtyOwnerDetail;
  canEdit: boolean;
}

export function OwnerDetailScreen({ dict, locale, owner, canEdit }: OwnerDetailProps) {
  const t = useRealtyT(dict);
  const router = useRouter();
  const initial = useMemo(
    () => ({
      name: owner.name,
      phone: owner.phone ?? "",
      email: owner.email ?? "",
      rfc: owner.rfc ?? "",
      notes: owner.notes ?? "",
    }),
    [owner],
  );
  const [form, setForm] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { saving, error, setError, run } = useSaving();

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(
    (k) => form[k] !== initial[k],
  );

  async function save() {
    if (!form.name.trim()) {
      setError(t("owners.nameRequired"));
      return;
    }
    const ok = await run(async () => {
      await apiCall(`/api/realty/owners/${owner.id}`, {
        method: "PATCH",
        json: {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          rfc: form.rfc.trim() || null,
          notes: form.notes.trim() || null,
        },
      });
    });
    if (ok) {
      toast.success(t("owners.saved"));
      router.refresh();
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await apiCall(`/api/realty/owners/${owner.id}`, { method: "DELETE" });
      toast.success(t("owners.deleted"));
      router.push("/inmobiliaria/propietarios");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <div className={`realty-page ${s.page}`}>
        <header className={s.detailHead}>
          <Link href="/inmobiliaria/propietarios" className={s.crumb}>
            <ArrowLeft size={13} />
            {t("owners.back")}
          </Link>
          <div className={s.detailTitleRow}>
            <div className={s.headerText}>
              <h1 className={s.title}>{owner.name}</h1>
              <div className={s.detailMeta}>
                <span>{t("owners.propertyCount", { count: owner.properties.length })}</span>
                {owner.phone ? (
                  <>
                    <span>·</span>
                    <a className={s.contactLink} href={`tel:${owner.phone}`}>
                      <Phone size={11} /> {prettyPhone(owner.phone)}
                    </a>
                  </>
                ) : null}
                {owner.email ? (
                  <>
                    <span>·</span>
                    <a className={s.contactLink} href={`mailto:${owner.email}`}>
                      <Mail size={11} /> {owner.email}
                    </a>
                  </>
                ) : null}
              </div>
            </div>
            {canEdit ? (
              <div className={s.headerActions}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSm} ${s.btnDanger}`}
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 size={13} />
                  {t("owners.delete")}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className={s.ownerGrid}>
          <section className={s.card}>
            <div className={s.cardHead}>
              <div className={s.cardHeadText}>
                <h2 className={s.cardTitle}>{t("owners.title")}</h2>
              </div>
            </div>
            <div className={`${s.cardBody} ${s.formGrid}`}>
              <div className={s.grid2}>
                <Field label={t("owners.name")} htmlFor="od-name" wide>
                  <input
                    id="od-name"
                    className={s.input}
                    value={form.name}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field label={t("owners.phone")} htmlFor="od-phone">
                  <input
                    id="od-phone"
                    className={s.input}
                    inputMode="tel"
                    value={form.phone}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </Field>
                <Field label={t("owners.email")} htmlFor="od-email">
                  <input
                    id="od-email"
                    className={s.input}
                    type="email"
                    value={form.email}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </Field>
                <Field label={t("owners.rfc")} htmlFor="od-rfc" hint={t("owners.rfcHint")} wide>
                  <input
                    id="od-rfc"
                    className={s.input}
                    value={form.rfc}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                  />
                </Field>
                <Field label={t("owners.notes")} htmlFor="od-notes" wide>
                  <textarea
                    id="od-notes"
                    className={s.textarea}
                    value={form.notes}
                    disabled={!canEdit}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </Field>
              </div>
            </div>
            {canEdit ? (
              <div className={s.cardFoot}>
                <ErrorText>{error}</ErrorText>
                <button
                  type="button"
                  className={`${s.btn} realty-btn-primary`}
                  onClick={() => void save()}
                  disabled={saving || !dirty}
                >
                  {saving ? <Loader2 size={14} className={s.spin} /> : <BadgeCheck size={14} />}
                  {saving ? t("form.saving") : t("owners.save")}
                </button>
              </div>
            ) : null}
          </section>

          <div className={s.col}>
            <section className={s.card}>
              <div className={s.cardHead}>
                <div className={s.cardHeadText}>
                  <h2 className={s.cardTitle}>{t("owners.properties")}</h2>
                </div>
              </div>
              {owner.properties.length === 0 ? (
                <div className={s.cardBody}>
                  <p className={s.hint}>{t("owners.noProperties")}</p>
                </div>
              ) : (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>{t("table.property")}</th>
                        <th>{t("table.operation")}</th>
                        <th className={s.num}>{t("table.price")}</th>
                        <th>{t("table.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {owner.properties.map((p) => {
                        const ui = REALTY_PROPERTY_STATUS_UI[p.status];
                        const amount = p.operation === "RENTA" ? p.rentPrice : p.price;
                        return (
                          <tr key={p.id}>
                            <td>
                              <Link
                                href={`/inmobiliaria/inmuebles/${p.id}`}
                                className={s.cellTitleLink}
                              >
                                {p.title}
                              </Link>
                              <span className={s.cellMeta}>
                                {REALTY_PROPERTY_KIND_LABELS[p.kind]}
                                {p.colonia ? ` · ${p.colonia}` : ""}
                              </span>
                            </td>
                            <td>{REALTY_OPERATION_LABELS[p.operation]}</td>
                            <td className={s.num}>
                              {amount !== null && amount > 0
                                ? formatPrice(amount, p.currency, locale)
                                : "—"}
                            </td>
                            <td>
                              <Badge tone={ui.tone}>{ui.label}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {owner.exclusives.length > 0 ? (
              <section className={s.card}>
                <div className={s.cardHead}>
                  <div className={s.cardHeadText}>
                    <h2 className={s.cardTitle}>{t("exclusive.title")}</h2>
                  </div>
                </div>
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>{t("table.property")}</th>
                        <th>{t("exclusive.endsAt")}</th>
                        <th className={s.num}>{t("exclusive.commissionPct")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {owner.exclusives.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <Link
                              href={`/inmobiliaria/inmuebles/${e.propertyId}`}
                              className={s.cellTitleLink}
                            >
                              {e.propertyTitle}
                            </Link>
                          </td>
                          <td>
                            {formatDate(e.endsAt, locale)}{" "}
                            {e.isActive ? (
                              e.daysLeft <= REALTY_EXCLUSIVE_WARN_DAYS ? (
                                <Badge tone="warning">
                                  {e.daysLeft <= 0
                                    ? t("exclusive.endsToday")
                                    : t("exclusive.daysLeft", { count: e.daysLeft })}
                                </Badge>
                              ) : (
                                <Badge tone="success">{t("exclusive.active")}</Badge>
                              )
                            ) : (
                              <Badge tone="neutral">
                                {e.daysLeft < 0 ? t("exclusive.expired") : t("exclusive.future")}
                              </Badge>
                            )}
                          </td>
                          <td className={s.num}>{e.commissionPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      {confirming ? (
        <Modal
          title={t("owners.confirmDelete")}
          subtitle={owner.name}
          onClose={() => setConfirming(false)}
          closeLabel={t("actions.cancel")}
          footer={
            <>
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost}`}
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnDanger}`}
                onClick={() => void remove()}
                disabled={deleting}
              >
                {deleting ? <Loader2 size={14} className={s.spin} /> : <Trash2 size={14} />}
                {t("owners.delete")}
              </button>
            </>
          }
        >
          <p className={s.hint}>
            {owner.properties.length > 0
              ? t("owners.cantDeleteProperties")
              : owner.exclusives.length > 0
                ? t("owners.cantDeleteExclusives")
                : t("owners.confirmDelete")}
          </p>
        </Modal>
      ) : null}
    </>
  );
}
