"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CalendarHeart,
  Check,
  Crown,
  Eye,
  EyeOff,
  Mail,
  Pencil,
  Phone,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRound,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { BarberClientPreferences, BarberVisitPhotoView } from "@/lib/barber/clients";
import type { BarberClientDetail, BarberLoyaltyState } from "@/lib/barber/loyalty";
import type { BarberClientDTO } from "@/lib/barber/types";
import { LoyaltyCard } from "./loyalty-card";
import { StarsPanel } from "./stars-panel";
import { ClientSales } from "./client-sales";
import { ClientChargeBridge } from "./client-charge-bridge";
import { ClientDrafts } from "./sale-drafts-list";
import type { SaleDraftRow } from "@/lib/barber/sale-drafts";
import type { ClientSalesPage } from "@/lib/barber/client-sales";
import type { StarsView } from "@/lib/barber/stars-core";
import { PhotoUploader, type UploadedPhoto } from "./photo-uploader";
import { PreferencesPanel } from "./preferences-panel";
import { VisitTimeline } from "./visit-timeline";
import {
  Badge,
  Field,
  Modal,
  clientStyles as s,
  formatDate,
  initials,
  prettyPhone,
  useBarberT,
  useToast,
} from "./ui";

/**
 * La ficha del cliente: quién es, CÓMO LE GUSTA EL CORTE (arriba del todo,
 * que es lo que se lee en voz alta con el cliente ya sentado), su tarjeta
 * de lealtad, las fotos de sus cortes y el historial completo.
 *
 * Todo lo que se ve aquí llegó ya resuelto del servidor y recortado a la
 * barbería de la sesión. El navegador no calcula nada que importe.
 */

export interface ClientDetailProps {
  dict: Dictionary;
  locale: string;
  detail: BarberClientDetail;
  canEdit: boolean;
  /** portal.manage — puede marcar fotos visibles para el cliente. */
  canPublish: boolean;
  /** Tarjeta de estrellas (null = no se pudo leer: se pinta la de sellos). */
  stars?: StarsView | null;
  /** Sub-árbol barber.estrellas. */
  starsDict?: Dictionary;
  /** cash.manage — dar/quitar estrella, entregar bono, enlace de la tarjeta. */
  canHandleStars?: boolean;
  timezone?: string;
  /** Cobros del cliente (null = sin permiso para ver importes: no se pinta). */
  sales?: ClientSalesPage | null;
  /** Sub-árbol barber.cobros. */
  cobrosDict?: Dictionary;
  /** cash.view: enlace al ticket imprimible. */
  canPrintSales?: boolean;
  /** Plan con caja + cash.manage: «Nuevo cobro» desde la ficha. */
  canCharge?: boolean;
  /** Sub-árbol barber.caja (el TicketModal de Caja). */
  cajaDict?: Dictionary;
}

function sortPhotos(list: BarberVisitPhotoView[]): BarberVisitPhotoView[] {
  return list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function BarberClientDetailScreen({
  dict,
  locale,
  detail,
  canEdit,
  canPublish,
  stars = null,
  starsDict,
  canHandleStars = false,
  timezone = "America/Mexico_City",
  sales = null,
  cobrosDict,
  canPrintSales = false,
  canCharge = false,
  cajaDict,
}: ClientDetailProps) {
  const t = useBarberT(dict);
  const toast = useToast();
  const router = useRouter();
  // Llegó desde el alta con un teléfono que ya tenía ficha (?ya=1&intento=<lo escrito>).
  const searchParams = useSearchParams();
  const [linkedOpen, setLinkedOpen] = useState(searchParams.get("ya") === "1");
  const typedName = (searchParams.get("intento") ?? "").trim();

  const [client, setClient] = useState<BarberClientDTO>(detail.client);
  const [preferences, setPreferences] = useState<BarberClientPreferences>(detail.preferences);
  const [loyalty, setLoyalty] = useState<BarberLoyaltyState>(detail.loyalty);
  const [block, setBlock] = useState(detail.block);
  const [photos, setPhotos] = useState<BarberVisitPhotoView[]>(() =>
    sortPhotos(
      detail.history.entries
        .reduce<BarberVisitPhotoView[]>((acc, e) => acc.concat(e.photos), [])
        .concat(detail.history.loosePhotos),
    ),
  );

  const [showEdit, setShowEdit] = useState(false);
  const [charging, setCharging] = useState(false);
  const [chargeDraft, setChargeDraft] = useState<SaleDraftRow | null>(null);
  const [salesReload, setSalesReload] = useState(0);
  const chargeEnabled = canCharge && Boolean(cajaDict && cobrosDict) && !client.blockedAt;
  const [showBlock, setShowBlock] = useState(false);
  const [lightbox, setLightbox] = useState<BarberVisitPhotoView | null>(null);

  const entries = useMemo(
    () =>
      detail.history.entries.map((e) =>
        e.kind === "appointment"
          ? { ...e, photos: photos.filter((p) => p.appointmentId === e.id) }
          : e,
      ),
    [detail.history.entries, photos],
  );

  const latest = photos[0] ?? null;
  const blocked = Boolean(client.blockedAt);

  async function setBlocked(next: boolean, reason?: string) {
    setShowBlock(false);
    try {
      const res = await fetch(`/api/barber/clients/${client.id}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: next, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data?.error || t("errors.generic"));
        return;
      }
      setClient(data.client as BarberClientDTO);
      setBlock(data.block ?? null);
    } catch {
      toast.show(t("errors.generic"));
    }
  }


  async function toggleVisible(photo: BarberVisitPhotoView) {
    const res = await fetch(`/api/barber/clients/${client.id}/photos/${photo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibleToClient: !photo.visibleToClient }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.show(data?.error || t("errors.generic"));
      return;
    }
    setPhotos((list) =>
      list.map((p) => (p.id === photo.id ? { ...p, ...(data.photo as BarberVisitPhotoView) } : p)),
    );
    toast.show(data.photo?.visibleToClient ? t("photos.visibleOn") : t("photos.visibleOff"));
  }

  async function removePhoto(photo: BarberVisitPhotoView) {
    if (!window.confirm(t("photos.deleteConfirm"))) return;
    const res = await fetch(`/api/barber/clients/${client.id}/photos/${photo.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.show(t("errors.generic"));
      return;
    }
    setPhotos((list) => list.filter((p) => p.id !== photo.id));
    if (lightbox?.id === photo.id) setLightbox(null);
  }

  return (
    <>
      <div className={s.page}>
        <div className={s.headerActions}>
          <Link href="/barber/clientes" className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}>
            <ArrowLeft size={14} />
            {t("detail.back")}
          </Link>
        </div>

        {linkedOpen ? (
          <div
            role="status"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 12,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              fontSize: 13.5,
              color: "var(--text-2)",
            }}
          >
            <span style={{ flex: "1 1 240px" }}>
              {typedName && typedName.toLowerCase() !== client.name.trim().toLowerCase()
                ? t("new.existingDiff", { name: client.name, typed: typedName })
                : t("new.existing", { name: client.name })}
            </span>
            {typedName ? (
              <button
                type="button"
                className={`${s.btn} ${s.btnSm}`}
                onClick={() => router.push(`/barber/clientes?alta=1&nombre=${encodeURIComponent(typedName)}`)}
              >
                {t("new.notSame")}
              </button>
            ) : null}
            <button
              type="button"
              className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
              onClick={() => {
                setLinkedOpen(false);
                router.replace(`/barber/clientes/${client.id}`);
              }}
            >
              {t("new.sameOk")}
            </button>
          </div>
        ) : null}

        {blocked ? (
          <div className={s.blockWarn} role="status">
            <TriangleAlert size={17} />
            <div>
              <p className={s.blockWarnText}>
                <strong>{t("block.warning")}</strong>
                {block?.at ? ` ${t("block.blockedOn", { date: formatDate(block.at, locale, timezone) })}.` : ""}
              </p>
              {block?.reason ? (
                <p className={s.blockWarnText}>
                  {t("block.blockedBecause", { reason: block.reason })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className={s.detail}>
          <div className={s.detailGrid}>
            {/* ── Columna de identidad ── */}
            <div className={s.detailCol}>
              <section className={`${s.card} ${s.cardPad} ${s.identity}`}>
                <div className={s.identityTop}>
                  <span className={s.avatarBig} aria-hidden="true">
                    {initials(client.name)}
                  </span>
                  <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <h1 className={s.detailName}>{client.name}</h1>
                    <a className={s.detailPhone} href={`tel:+52${client.phone}`}>
                      {prettyPhone(client.phone)}
                    </a>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {detail.membership ? (
                    <Badge tone="success">
                      <Crown size={11} /> {detail.membership.name}
                    </Badge>
                  ) : null}
                  {client.portalEnabled ? (
                    <Badge>
                      <ShieldCheck size={11} /> {t("badges.portal")}
                    </Badge>
                  ) : null}
                  {blocked ? (
                    <Badge tone="danger">
                      <Ban size={11} /> {t("badges.blocked")}
                    </Badge>
                  ) : null}
                </div>

                <div className={s.metaList}>
                  <span className={s.metaItem}>
                    <span className={s.metaIcon}>
                      <UserRound size={13} />
                    </span>
                    {client.lastVisitAt
                      ? t("detail.lastVisit", { date: formatDate(client.lastVisitAt, locale, timezone) })
                      : t("detail.neverVisited")}
                    {" · "}
                    {t("detail.visits", { count: client.totalVisits })}
                  </span>

                  {client.email ? (
                    <span className={s.metaItem}>
                      <span className={s.metaIcon}>
                        <Mail size={13} />
                      </span>
                      {client.email}
                    </span>
                  ) : null}

                  {client.birthday ? (
                    <span className={s.metaItem}>
                      <span className={s.metaIcon}>
                        <CalendarHeart size={13} />
                      </span>
                      {t("detail.birthdayOn", {
                        day: new Date(client.birthday).getUTCDate(),
                        month: t(`months.${new Date(client.birthday).getUTCMonth() + 1}`),
                      })}
                    </span>
                  ) : null}

                  {detail.membership ? (
                    <span className={s.metaItem}>
                      <span className={s.metaIcon}>
                        <Crown size={13} />
                      </span>
                      {t("detail.membershipUntil", {
                        name: detail.membership.name,
                        date: formatDate(detail.membership.endAt, locale, timezone),
                      })}
                      {detail.membership.includedCuts !== null
                        ? ` · ${t("detail.membershipCutsLeft", {
                            left: Math.max(detail.membership.includedCuts - detail.membership.cutsUsed, 0),
                            total: detail.membership.includedCuts,
                          })}`
                        : ""}
                      {detail.membership.nextPeriods && detail.membership.nextPeriods.length > 0
                        ? ` · ${t("detail.membershipNext", {
                            date: formatDate(detail.membership.nextPeriods[0].startAt, locale),
                            until: formatDate(detail.membership.nextPeriods[detail.membership.nextPeriods.length - 1].endAt, locale),
                          })}`
                        : ""}
                    </span>
                  ) : null}
                </div>

                {canEdit ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                    <button
                      type="button"
                      className={`${s.btn} ${s.btnSm}`}
                      onClick={() => setShowEdit(true)}
                    >
                      <Pencil size={13} />
                      {t("detail.edit")}
                    </button>
                    <button
                      type="button"
                      className={`${s.btn} ${s.btnSm} ${blocked ? "" : s.btnDanger}`}
                      onClick={() => {
                        if (blocked) void setBlocked(false);
                        else setShowBlock(true);
                      }}
                    >
                      <Ban size={13} />
                      {blocked ? t("block.unblock") : t("block.block")}
                    </button>
                  </div>
                ) : null}
              </section>

              {stars && starsDict ? (
                <StarsPanel
                  clientId={client.id}
                  clientName={client.name}
                  initial={stars}
                  dict={starsDict}
                  locale={locale}
                  timezone={timezone}
                  canHandle={canHandleStars}
                  onMessage={toast.show}
                  onChanged={() => router.refresh()}
                />
              ) : (
              <LoyaltyCard
                clientId={client.id}
                state={loyalty}
                canRedeem={canEdit}
                t={t}
                onRedeemed={(next) => {
                  setLoyalty(next);
                  router.refresh();
                }}
                onMessage={toast.show}
              />
              )}

              <section className={`${s.card} ${s.cardPad}`}>
                <h2 className={s.sectionTitle}>{t("detail.notesTitle")}</h2>
                <p className={s.sectionSub} style={{ whiteSpace: "pre-wrap" }}>
                  {client.notes || t("detail.notesEmpty")}
                </p>
              </section>
            </div>

            {/* ── Columna de trabajo ── */}
            <div className={s.detailCol}>
              <PreferencesPanel
                clientId={client.id}
                preferences={preferences}
                barbers={detail.barbers}
                canEdit={canEdit}
                t={t}
                onSaved={setPreferences}
                onMessage={toast.show}
              />

              <section className={`${s.card} ${s.cardPad} ${s.photos}`}>
                <h2 className={s.sectionTitle}>{t("photos.title")}</h2>
                <p className={s.sectionSub} style={{ marginBottom: 12 }}>
                  {t("photos.subtitle")}
                </p>

                {latest ? (
                  <button
                    type="button"
                    className={s.photoHero}
                    onClick={() => setLightbox(latest)}
                    aria-label={t("photos.openFull")}
                    style={{ border: "none", padding: 0, cursor: "pointer", marginBottom: 12 }}
                  >
                    {latest.signedUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={latest.signedUrl} alt="" decoding="async" />
                    ) : null}
                    <span className={s.photoTag}>{t("photos.latest")}</span>
                  </button>
                ) : null}

                {canEdit ? (
                  <PhotoUploader
                    clientId={client.id}
                    canPublish={canPublish}
                    t={t}
                    onUploaded={(photo: UploadedPhoto) =>
                      setPhotos((list) => sortPhotos(list.concat(photo as BarberVisitPhotoView)))
                    }
                    onMessage={toast.show}
                  />
                ) : null}

                {photos.length === 0 ? (
                  <p className={s.sectionSub} style={{ marginTop: 12 }}>
                    {t("photos.empty")}
                  </p>
                ) : (
                  <div className={s.photoGrid} style={{ marginTop: 12 }}>
                    {photos.map((photo) => (
                      <div key={photo.id} className={s.photoTile}>
                        <button
                          type="button"
                          onClick={() => setLightbox(photo)}
                          aria-label={t("photos.openFull")}
                          style={{
                            border: "none",
                            padding: 0,
                            background: "none",
                            cursor: "pointer",
                            width: "100%",
                            height: "100%",
                          }}
                        >
                          {photo.signedUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={photo.signedUrl} alt="" loading="lazy" decoding="async" />
                          ) : null}
                        </button>
                        <span className={s.photoTag}>
                          {photo.kind === "BEFORE"
                            ? t("photos.kindBefore")
                            : photo.kind === "AFTER"
                              ? t("photos.kindAfter")
                              : t("photos.kindReference")}
                        </span>
                        {canEdit ? (
                          <span className={s.photoTools}>
                            {canPublish ? (
                              <button
                                type="button"
                                className={`${s.photoToolBtn} ${photo.visibleToClient ? s.photoToolOn : ""}`}
                                onClick={() => void toggleVisible(photo)}
                                title={t("photos.visibleHelp")}
                              >
                                {photo.visibleToClient ? <Eye size={11} /> : <EyeOff size={11} />}
                              </button>
                            ) : (
                              <span />
                            )}
                            <button
                              type="button"
                              className={s.photoToolBtn}
                              onClick={() => void removePhoto(photo)}
                              aria-label={t("photos.delete")}
                            >
                              <Trash2 size={11} />
                            </button>
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className={`${s.card} ${s.cardPad}`}>
                <h2 className={s.sectionTitle} style={{ marginBottom: 12 }}>
                  {t("history.title")}
                </h2>
                <VisitTimeline
                  entries={entries}
                  locale={locale}
                  timezone={timezone}
                  t={t}
                  onOpenPhoto={setLightbox}
                />
              </section>

              {sales && cobrosDict ? (
                <ClientSales
                  clientId={client.id}
                  initial={sales}
                  dict={cobrosDict}
                  locale={locale}
                  timezone={timezone}
                  canPrint={canPrintSales}
                  reloadKey={salesReload}
                  beforeList={
                    chargeEnabled && cobrosDict ? (
                      <ClientDrafts
                        clientId={client.id}
                        dict={cobrosDict}
                        locale={locale}
                        timezone={timezone}
                        canManage={chargeEnabled}
                        reloadKey={salesReload}
                        onCharge={(d) => {
                          setChargeDraft(d);
                          setCharging(true);
                        }}
                      />
                    ) : null
                  }
                  headerAction={
                    chargeEnabled ? (
                      <button
                        type="button"
                        className={`${s.btn} barber-btn-primary`}
                        onClick={() => {
                          setChargeDraft(null);
                          setCharging(true);
                        }}
                        data-accion="nuevo-cobro"
                      >
                        <Wallet size={14} />
                        {(cobrosDict as Record<string, unknown>).newCharge as string}
                      </button>
                    ) : null
                  }
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Diálogos: hermanos de la página, jamás dentro de un container-type. */}
      {charging && cajaDict && cobrosDict ? (
        <ClientChargeBridge
          clientId={client.id}
          clientName={client.name}
          cajaDict={cajaDict}
          starsDict={starsDict}
          cobrosDict={cobrosDict}
          locale={locale}
          timezone={timezone}
          canOpenSession={canCharge}
          draft={chargeDraft}
          onDraftSaved={() => setSalesReload((n) => n + 1)}
          onClose={() => {
            setCharging(false);
            setChargeDraft(null);
            setSalesReload((n) => n + 1);
            router.refresh();
          }}
          onCharged={() => {
            setSalesReload((n) => n + 1);
            router.refresh();
          }}
        />
      ) : null}
      {showEdit ? (
        <EditClientModal
          client={client}
          t={t}
          onClose={() => setShowEdit(false)}
          onSaved={(next) => {
            setClient(next);
            setShowEdit(false);
            toast.show(t("form.saved"));
          }}
          onMessage={toast.show}
        />
      ) : null}

      {showBlock ? (
        <BlockModal
          name={client.name}
          t={t}
          onClose={() => setShowBlock(false)}
          onConfirm={(reason) => void setBlocked(true, reason)}
        />
      ) : null}

      {lightbox ? (
        <Modal
          title={t("photos.openFull")}
          wide
          onClose={() => setLightbox(null)}
          closeLabel={t("form.cancel")}
        >
          {lightbox.signedUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={lightbox.signedUrl}
              alt=""
              style={{ width: "100%", borderRadius: 12, display: "block" }}
            />
          ) : null}
          <span className={s.hint}>
            {lightbox.visibleToClient ? t("photos.visibleOn") : t("photos.visibleOff")}
          </span>
        </Modal>
      ) : null}

      {toast.node}
    </>
  );

}

// ── Editar datos ───────────────────────────────────────────────────────

function EditClientModal({
  client,
  t,
  onClose,
  onSaved,
  onMessage,
}: {
  client: BarberClientDTO;
  t: ReturnType<typeof useBarberT>;
  onClose: () => void;
  onSaved: (next: BarberClientDTO) => void;
  onMessage: (text: string) => void;
}) {
  const [form, setForm] = useState({
    name: client.name,
    phone: client.phone,
    email: client.email ?? "",
    // El cumpleaños se ancla a mediodía UTC en el servidor, así que se
    // formatea con los getters UTC o el día se corre uno hacia atrás.
    birthday: client.birthday ? client.birthday.slice(0, 10) : "",
    notes: client.notes ?? "",
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/barber/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ field: data?.field, message: data?.error || t("errors.generic") });
        return;
      }
      onSaved(data.client as BarberClientDTO);
    } catch {
      onMessage(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  const err = (field: string) => (error?.field === field ? error.message : null);

  return (
    <Modal
      title={t("detail.edit")}
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
            {busy ? t("form.saving") : t("form.save")}
          </button>
        </>
      }
    >
      <Field label={t("form.name")} htmlFor="ed-name" error={err("name")}>
        <input
          id="ed-name"
          className={s.input}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>

      <Field label={t("form.phone")} htmlFor="ed-phone" error={err("phone")}>
        <input
          id="ed-phone"
          className={s.input}
          inputMode="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </Field>

      <Field label={t("form.email")} htmlFor="ed-email" error={err("email")}>
        <input
          id="ed-email"
          className={s.input}
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </Field>

      <Field label={t("form.birthday")} htmlFor="ed-birthday" error={err("birthday")}>
        <input
          id="ed-birthday"
          className={s.input}
          type="date"
          value={form.birthday}
          onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))}
        />
      </Field>

      <Field label={t("form.notes")} htmlFor="ed-notes">
        <textarea
          id="ed-notes"
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

// ── Bloquear ───────────────────────────────────────────────────────────

function BlockModal({
  name,
  t,
  onClose,
  onConfirm,
}: {
  name: string;
  t: ReturnType<typeof useBarberT>;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Modal
      title={t("block.title", { name })}
      onClose={onClose}
      closeLabel={t("form.cancel")}
      footer={
        <>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose}>
            {t("form.cancel")}
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnDanger}`}
            onClick={() => onConfirm(reason)}
          >
            <Ban size={14} />
            {t("block.confirm")}
          </button>
        </>
      }
    >
      <p className={s.sectionSub}>{t("block.why")}</p>
      <Field label={t("block.reason")} htmlFor="blk-reason">
        <textarea
          id="blk-reason"
          className={s.textarea}
          value={reason}
          placeholder={t("block.reasonPlaceholder")}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
