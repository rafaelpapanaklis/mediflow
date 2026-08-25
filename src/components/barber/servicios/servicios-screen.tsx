"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { BarberServiceRow, ServiceCatalog, ServiceUpdateResult } from "@/lib/barber/services";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtMoney } from "@/components/barber/cash/money";
import {
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Modal,
  apiCall,
  useSaving,
} from "@/components/barber/team/admin-ui";
import { ServiceFormModal, capitalizeCategory } from "./service-form-modal";
import s from "./servicios.module.css";

// ═══════════════════════════════════════════════════════════════════════
// /barber/servicios — el catálogo.
//
// i18n: el servidor baja el sub-árbol `barber.ajustes` ya recortado y aquí
// las llaves son cortas: t("servicios.title"). Mismo motor makeT del
// servidor vía makeBarberT (avisa en desarrollo si una llave no resuelve).
//
// El estado vive aquí (lista + modales); cada acción pega al API y, si sale
// bien, actualiza la lista con lo que el servidor devolvió (nunca con lo que
// el navegador supuso). El reordenado es optimista y se revierte si falla.
// ═══════════════════════════════════════════════════════════════════════

export interface SeedPreviewRow {
  name: string;
  durationMin: number;
  price: number;
  category: string;
}

type ModalState =
  | { kind: "none" }
  | { kind: "form"; service: BarberServiceRow | null }
  | { kind: "retire"; service: BarberServiceRow }
  | { kind: "delete"; service: BarberServiceRow };

export function ServiciosScreen({
  dict,
  initial,
  seedPreview,
  categorySuggestions,
}: {
  dict: Dictionary;
  initial: ServiceCatalog;
  /** Los 9 sugeridos (BARBER_DEFAULT_SERVICES), para enseñarlos con el catálogo vacío. */
  seedPreview: SeedPreviewRow[];
  categorySuggestions: string[];
}) {
  const t = useBarberT(dict);
  const [services, setServices] = useState<BarberServiceRow[]>(initial.services);
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = services.filter(
    (sv) =>
      (showInactive || sv.isActive) &&
      (!q || sv.name.toLowerCase().includes(q) || sv.category.toLowerCase().includes(q)),
  );
  const activeCount = services.filter((sv) => sv.isActive).length;
  const inactiveCount = services.length - activeCount;
  const categoriesInUse = uniq(services.filter((sv) => sv.isActive).map((sv) => sv.category));
  const categoryOptions = uniq([...categorySuggestions, ...services.map((sv) => sv.category)]);
  // Con una búsqueda activa el orden que se ve no es el real: no se reordena.
  const canReorder = q === "";

  const close = () => setModal({ kind: "none" });

  function replaceRow(row: BarberServiceRow) {
    setServices((list) => list.map((sv) => (sv.id === row.id ? row : sv)));
  }

  function onFormDone(row: BarberServiceRow, created: boolean) {
    if (created) setServices((list) => [...list, row]);
    else replaceRow(row);
    toast.success(created ? t("servicios.toast.created") : t("servicios.toast.saved"));
    close();
  }

  async function setActive(sv: BarberServiceRow, isActive: boolean) {
    setBusyId(sv.id);
    setListError(null);
    try {
      const r = await apiCall<ServiceUpdateResult>(`/api/barber/services/${sv.id}`, {
        method: "PATCH",
        json: { isActive },
      });
      replaceRow(r.service);
      toast.success(isActive ? t("servicios.toast.reactivated") : t("servicios.toast.retired"));
      close();
    } catch (err) {
      setListError(err instanceof Error ? err.message : t("common.genericError"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(sv: BarberServiceRow) {
    setBusyId(sv.id);
    setListError(null);
    try {
      await apiCall<{ ok: true }>(`/api/barber/services/${sv.id}`, { method: "DELETE" });
      setServices((list) => list.filter((x) => x.id !== sv.id));
      toast.success(t("servicios.toast.deleted"));
      close();
    } catch (err) {
      setListError(err instanceof Error ? err.message : t("common.genericError"));
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, delta: number) {
    const target = index + delta;
    if (!canReorder || target < 0 || target >= visible.length) return;
    const nextVisible = visible.slice();
    const [moved] = nextVisible.splice(index, 1);
    nextVisible.splice(target, 0, moved);
    // Los que no se ven (retirados ocultos) se van al final: a ningún
    // consumidor le importa el orden de un servicio retirado.
    const shown = new Set(nextVisible.map((sv) => sv.id));
    const hidden = services.filter((sv) => !shown.has(sv.id));
    const previous = services;
    setServices([...nextVisible, ...hidden]);
    setListError(null);
    try {
      const catalog = await apiCall<ServiceCatalog>("/api/barber/services/reorder", {
        method: "POST",
        json: { ids: nextVisible.map((sv) => sv.id) },
      });
      setServices(catalog.services);
    } catch (err) {
      setServices(previous);
      setListError(err instanceof Error ? err.message : t("common.genericError"));
    }
  }

  const seed = useSaving();
  async function reseed() {
    const ok = await seed.run(async () => {
      const catalog = await apiCall<ServiceCatalog>("/api/barber/services/reseed", { method: "POST" });
      setServices(catalog.services);
    });
    if (ok) toast.success(t("servicios.toast.seeded"));
  }

  function usageText(sv: BarberServiceRow): string[] {
    if (sv.appointmentsCount === 0 && sv.salesCount === 0) return [t("servicios.usage.none")];
    const parts: string[] = [];
    if (sv.appointmentsCount > 0) parts.push(t("servicios.usage.appointments", { count: sv.appointmentsCount }));
    if (sv.upcomingCount > 0) parts.push(t("servicios.usage.upcoming", { count: sv.upcomingCount }));
    if (sv.salesCount > 0) parts.push(t("servicios.usage.sales", { count: sv.salesCount }));
    return parts;
  }

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>{t("servicios.title")}</h1>
          <p className={s.subtitle}>{t("servicios.subtitle")}</p>
        </div>
        <div className={s.headerActions}>
          <Btn variant="primary" onClick={() => setModal({ kind: "form", service: null })}>
            <Plus size={15} />
            {t("servicios.new")}
          </Btn>
        </div>
      </header>

      {services.length === 0 ? (
        <div className={s.card}>
          <EmptyState
            icon={<Scissors size={22} />}
            title={t("servicios.empty.title")}
            body={t("servicios.empty.body")}
            action={
              <div style={{ width: "100%", maxWidth: 520 }}>
                <table className={s.seedTable}>
                  <thead>
                    <tr>
                      <th>{t("servicios.col.name")}</th>
                      <th>{t("servicios.col.category")}</th>
                      <th className={s.num}>{t("servicios.col.duration")}</th>
                      <th className={s.num}>{t("servicios.col.price")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seedPreview.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{capitalizeCategory(row.category)}</td>
                        <td className={s.num}>{t("common.minutes", { count: row.durationMin })}</td>
                        <td className={s.num}>{fmtMoney(row.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ErrorText>{seed.error}</ErrorText>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <Btn variant="primary" onClick={reseed} disabled={seed.saving}>
                    <Sparkles size={15} />
                    {seed.saving ? t("common.saving") : t("servicios.empty.seed", { count: seedPreview.length })}
                  </Btn>
                  <Btn onClick={() => setModal({ kind: "form", service: null })} disabled={seed.saving}>
                    <Plus size={15} />
                    {t("servicios.empty.create")}
                  </Btn>
                </div>
                <p className={s.hint} style={{ marginTop: 8 }}>{t("servicios.empty.seedHint")}</p>
              </div>
            }
          />
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            <div className={s.stats}>
              <Chip tone="brand">{t("servicios.stats.active", { count: activeCount })}</Chip>
              {inactiveCount > 0 ? <Chip tone="muted">{t("servicios.stats.inactive", { count: inactiveCount })}</Chip> : null}
              <Chip>{t("servicios.stats.categories", { count: categoriesInUse.length })}</Chip>
            </div>
            <input
              type="search"
              className={s.search}
              placeholder={t("servicios.search")}
              aria-label={t("servicios.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {inactiveCount > 0 ? (
              <label className={s.toggle}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                {t("servicios.showInactive")}
              </label>
            ) : null}
          </div>

          <p className={s.hint}>{t("servicios.orderHint")}</p>
          <ErrorText>{listError}</ErrorText>

          {visible.length === 0 ? (
            <div className={s.card}>
              <EmptyState icon={<Scissors size={22} />} title={t("servicios.emptyFiltered")} />
            </div>
          ) : (
            <div className={s.list}>
              {visible.map((sv, i) => {
                const busy = busyId === sv.id;
                return (
                  <article key={sv.id} className={[s.row, sv.isActive ? "" : s.rowMuted].filter(Boolean).join(" ")}>
                    <div className={s.order}>
                      <Btn
                        size="sm"
                        variant="ghost"
                        aria-label={t("common.moveUp")}
                        title={t("common.moveUp")}
                        disabled={!canReorder || i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={14} />
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        aria-label={t("common.moveDown")}
                        title={t("common.moveDown")}
                        disabled={!canReorder || i === visible.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={14} />
                      </Btn>
                    </div>

                    <div className={s.main}>
                      <div className={s.name}>
                        <span className={s.nameText}>{sv.name}</span>
                        <Chip tone="brand">{capitalizeCategory(sv.category)}</Chip>
                        {!sv.isActive ? <Chip tone="muted">{t("servicios.inactive")}</Chip> : null}
                      </div>
                      {sv.description ? <p className={s.desc}>{sv.description}</p> : null}
                      <div className={s.usage}>
                        {usageText(sv).map((txt) => (
                          <span key={txt}>{txt}</span>
                        ))}
                      </div>
                    </div>

                    <div className={s.meta}>
                      <span className={s.duration}>
                        <Clock size={12} />
                        {t("common.minutes", { count: sv.durationMin })}
                      </span>
                      <span className={s.price}>{fmtMoney(sv.price)}</span>
                    </div>

                    <div className={s.actions}>
                      <Btn size="sm" onClick={() => setModal({ kind: "form", service: sv })} disabled={busy}>
                        <Pencil size={13} />
                        {t("servicios.actions.edit")}
                      </Btn>
                      {sv.isActive ? (
                        <Btn size="sm" variant="ghost" onClick={() => setModal({ kind: "retire", service: sv })} disabled={busy}>
                          <EyeOff size={13} />
                          {t("servicios.actions.retire")}
                        </Btn>
                      ) : (
                        <Btn size="sm" variant="ghost" onClick={() => setActive(sv, true)} disabled={busy}>
                          <Eye size={13} />
                          {t("servicios.actions.reactivate")}
                        </Btn>
                      )}
                      {sv.deletable ? (
                        <Btn size="sm" variant="danger" onClick={() => setModal({ kind: "delete", service: sv })} disabled={busy}>
                          <Trash2 size={13} />
                          {t("servicios.actions.delete")}
                        </Btn>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {modal.kind === "form" ? (
        <ServiceFormModal
          dict={dict}
          service={modal.service}
          categories={categoryOptions}
          onClose={close}
          onDone={onFormDone}
        />
      ) : null}

      {modal.kind === "retire" ? (
        <Modal
          title={t("servicios.retire.title", { name: modal.service.name })}
          onClose={close}
          footer={
            <>
              <Btn variant="ghost" onClick={close} disabled={busyId === modal.service.id}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="primary" onClick={() => setActive(modal.service, false)} disabled={busyId === modal.service.id}>
                {busyId === modal.service.id ? t("common.saving") : t("servicios.retire.confirm")}
              </Btn>
            </>
          }
        >
          <p className={s.confirmBody}>{t("servicios.retire.body")}</p>
          <ErrorText>{listError}</ErrorText>
        </Modal>
      ) : null}

      {modal.kind === "delete" ? (
        <Modal
          title={t("servicios.delete.title", { name: modal.service.name })}
          onClose={close}
          footer={
            <>
              <Btn variant="ghost" onClick={close} disabled={busyId === modal.service.id}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="danger" onClick={() => remove(modal.service)} disabled={busyId === modal.service.id}>
                {busyId === modal.service.id ? t("common.saving") : t("servicios.delete.confirm")}
              </Btn>
            </>
          }
        >
          <p className={s.confirmBody}>{t("servicios.delete.body")}</p>
          <ErrorText>{listError}</ErrorText>
        </Modal>
      ) : null}
    </div>
  );
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = (v || "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
