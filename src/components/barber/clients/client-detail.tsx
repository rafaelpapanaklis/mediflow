"use client";

import { mxTenDigits } from "@/lib/phone-mx";
import { ChatClienteLink } from "../wa-chat";
import { splitStoredPhone, telHref } from "@/lib/barber/telefono-panel";
import { TelefonoConPais } from "@/components/barber/telefono-con-pais";
import { WhatsAppGlyph } from "@/components/ui/whatsapp-glyph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  CalendarHeart,
  CalendarPlus,
  Check,
  Crown,
  History,
  ImageIcon,
  LayoutGrid,
  Mail,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Phone,
  Receipt,
  Scissors,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import type { BarberClientPreferences, BarberVisitPhotoView } from "@/lib/barber/clients";
import type { BarberClientDetail, BarberLoyaltyState } from "@/lib/barber/loyalty";
import type { BarberClientDTO } from "@/lib/barber/types";
import type { BarberMembershipPlanView } from "@/lib/barber/memberships-core";
import type { FichaMembershipPeriod } from "@/lib/barber/ficha";
import {
  fichaTabSearch,
  nextAppointmentOf,
  resolveFichaTab,
  stepFichaTab,
  visibleFichaTabs,
  type FichaTab,
} from "@/lib/barber/ficha-core";
import { SellMembershipModal } from "@/components/barber/memberships/sell-membership-modal";
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
import {
  HistorySection,
  LastLookCard,
  LastPaymentsCard,
  MembershipSection,
  NextVisitCard,
  PhotosSection,
  StarsMini,
  TabLink,
  dayKey,
} from "./ficha-secciones";
import {
  Field,
  Modal,
  clientStyles as s,
  formatDate,
  initials,
  prettyPhone,
  useBarberT,
  useToast,
} from "./ui";
import f from "./ficha.module.css";

/**
 * La ficha del cliente «A» (ws6-t3, elegida por Rafael el 16-nov): cabecera
 * fija con quién es y lo que se hace con él (Agendar cita, WhatsApp, Editar,
 * «⋯» con Llamar y Bloquear), y debajo pestañas:
 *
 *   Resumen · Corte · Pagos · Fotos · Historial · Membresía
 *
 * La pestaña vive en la dirección (?tab=pagos; #pagos sigue valiendo) para
 * enlazar desde la cita, Caja o Mensajes, y atrás/adelante del navegador la
 * cambian. Los seis paneles se montan una vez y se esconden (hidden): lo que
 * se escribe o se filtra en uno no se pierde al ir a otro.
 *
 * Todo lo que se ve aquí llegó ya resuelto del servidor y recortado a la
 * barbería de la sesión. El navegador no calcula nada que importe, y lo que
 * mueve dinero son los mismos diálogos y rutas de Caja.
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
  /** Cobros del cliente (null = sin permiso para ver importes: no hay pestaña Pagos). */
  sales?: ClientSalesPage | null;
  /** Sub-árbol barber.cobros. */
  cobrosDict?: Dictionary;
  /** cash.view: ver y reimprimir el ticket. */
  canPrintSales?: boolean;
  /** Plan con caja + cash.manage: «Nuevo cobro», «Por cobrar», cambiar método y cancelar. */
  canCharge?: boolean;
  /** agenda.edit + plan con agenda: «Agendar cita» lleva a la Agenda con el cliente puesto. */
  canBook?: boolean;
  /** agenda.view + plan con agenda: las citas del historial abren en la Agenda. */
  canOpenAgenda?: boolean;
  /** whatsapp.view + plan con bandeja (el destino lo decide ChatClienteLink). */
  canMessage?: boolean;
  /** Sub-árbol barber.caja (el TicketModal y los diálogos de Caja). */
  cajaDict?: Dictionary;
  /** Nombre de la barbería (texto del ticket por WhatsApp). */
  shopName?: string;
  /** «Ahora» del servidor: el mismo en el servidor y en el navegador (sin #418). */
  nowISO?: string;
  /** Periodos de membresía del cliente (más recientes primero). */
  membershipPeriods?: FichaMembershipPeriod[];
  /** Plan con membresías + memberships.sell. */
  canSellMembership?: boolean;
  membershipPlans?: BarberMembershipPlanView[];
  membershipStripeReady?: boolean;
  /** Sub-árbol barber.membresias (el diálogo «Vender membresía» de Membresías). */
  membresiasDict?: Dictionary;
}

function sortPhotos(list: BarberVisitPhotoView[]): BarberVisitPhotoView[] {
  return list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const TAB_ICON: Record<FichaTab, typeof LayoutGrid> = {
  resumen: LayoutGrid,
  corte: Scissors,
  pagos: Receipt,
  fotos: ImageIcon,
  historial: History,
  membresia: Crown,
};

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
  canBook = false,
  canOpenAgenda = false,
  cajaDict,
  shopName = "",
  nowISO,
  membershipPeriods = [],
  canSellMembership = false,
  membershipPlans = [],
  membershipStripeReady = false,
  membresiasDict,
}: ClientDetailProps) {
  const t = useBarberT(dict);
  const cobrosT = useBarberT(cobrosDict ?? {});
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  // Llegó desde el alta con un teléfono que ya tenía ficha (?ya=1&intento=<lo escrito>).
  const searchParams = useSearchParams();
  const [linkedOpen, setLinkedOpen] = useState(searchParams.get("ya") === "1");
  const typedName = (searchParams.get("intento") ?? "").trim();
  const [now] = useState(() => nowISO ?? new Date().toISOString());

  const [client, setClient] = useState<BarberClientDTO>(detail.client);
  const [preferences, setPreferences] = useState<BarberClientPreferences>(detail.preferences);
  const [loyalty, setLoyalty] = useState<BarberLoyaltyState>(detail.loyalty);
  const [block, setBlock] = useState(detail.block);
  const [starsView, setStarsView] = useState<StarsView | null>(stars);
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
  const [drafts, setDrafts] = useState<SaleDraftRow[] | null>(null);
  const [salesReload, setSalesReload] = useState(0);
  const chargeEnabled = canCharge && Boolean(cajaDict && cobrosDict) && !client.blockedAt;
  const [showBlock, setShowBlock] = useState(false);
  const [lightbox, setLightbox] = useState<BarberVisitPhotoView | null>(null);
  const [selling, setSelling] = useState<{ planId: string | null } | null>(null);
  const [historySeg, setHistorySeg] = useState<"visits" | "stars">(() =>
    searchParams.get("tab") === "estrellas" || searchParams.get("ver") === "estrellas" ? "stars" : "visits",
  );

  // Los datos que el servidor vuelve a mandar (router.refresh tras cobrar,
  // dar una estrella o vender una membresía) actualizan la ficha.
  useEffect(() => setStarsView(stars), [stars]);

  const entries = useMemo(
    () =>
      detail.history.entries.map((e) =>
        e.kind === "appointment"
          ? { ...e, photos: photos.filter((p) => p.appointmentId === e.id) }
          : e,
      ),
    [detail.history.entries, photos],
  );

  const blocked = Boolean(client.blockedAt);
  const todayKey = dayKey(now, timezone);
  const next = useMemo(() => nextAppointmentOf(entries, new Date(now)), [entries, now]);
  const last = useMemo(
    () =>
      entries.find(
        (e) => Date.parse(e.at) <= Date.parse(now) && (e.kind !== "appointment" || e.status === "DONE" || e.status === "IN_PROGRESS"),
      ) ?? null,
    [entries, now],
  );

  // ── Pestañas y dirección ──────────────────────────────────────────────
  const tabs = useMemo(
    () =>
      visibleFichaTabs({
        canSeePayments: Boolean(sales && cobrosDict),
        hasMembership: Boolean(detail.membership) || membershipPeriods.length > 0,
        canSellMembership: canSellMembership && Boolean(membresiasDict),
      }),
    [sales, cobrosDict, detail.membership, membershipPeriods.length, canSellMembership, membresiasDict],
  );
  // El #ancla no viaja al servidor: se lee al montar y en cada atrás/adelante.
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setHash(window.location.hash || null);
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);
  const tab = resolveFichaTab({ tab: searchParams.get("tab"), hash }, tabs);
  const tabHref = (k: FichaTab) => `${pathname}${fichaTabSearch(searchParams.toString(), k)}`;

  const pageRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<FichaTab, HTMLAnchorElement | null>>>({});

  const goTab = useCallback(
    (k: FichaTab, opts: { focus?: boolean } = {}) => {
      // pushState nativo: Next lo integra con useSearchParams sin pedir la
      // página otra vez al servidor, y atrás/adelante vuelve a la pestaña.
      const url = `${pathname}${fichaTabSearch(window.location.search, k)}`;
      window.history.pushState(null, "", url);
      setHash(null);
      if (opts.focus) tabRefs.current[k]?.focus();
      // Si ya se había bajado, que la pestaña nueva empiece arriba.
      const tabsBottom = stickRef.current?.getBoundingClientRect().bottom ?? 0;
      const top = pageRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 && tabsBottom > 0) pageRef.current?.scrollIntoView({ block: "start" });
    },
    [pathname],
  );

  // La pestaña activa, a la vista dentro de la barra (celular).
  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  function onTabsKey(e: React.KeyboardEvent) {
    let target: FichaTab | null = null;
    if (e.key === "ArrowRight") target = stepFichaTab(tabs, tab, 1);
    else if (e.key === "ArrowLeft") target = stepFichaTab(tabs, tab, -1);
    else if (e.key === "Home") target = tabs[0];
    else if (e.key === "End") target = tabs[tabs.length - 1];
    if (!target) return;
    e.preventDefault();
    goTab(target, { focus: true });
  }

  // ── Menú «⋯» ──────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  // Solo los visibles: «Editar datos» del menú existe en el DOM pero se esconde en escritorio.
  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []).filter((el) => el.offsetParent !== null);
  useEffect(() => {
    if (!menuOpen) return;
    menuItems()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !menuBtnRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = menuItems();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const nextItem = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    nextItem?.focus();
  }

  // ── Acciones de siempre ───────────────────────────────────────────────
  async function setBlocked(nextBlocked: boolean, reason?: string) {
    setShowBlock(false);
    try {
      const res = await fetch(`/api/barber/clients/${client.id}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: nextBlocked, reason }),
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

  function openCharge(draft: SaleDraftRow | null) {
    setChargeDraft(draft);
    setCharging(true);
  }

  const money = useMemo(
    () => new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", { style: "currency", currency: "MXN" }),
    [locale],
  );
  const whenShort = useCallback(
    (iso: string) => {
      if (dayKey(iso, timezone) === todayKey) {
        try {
          const h = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: timezone,
          }).format(new Date(iso));
          return `${t("ficha.today").replace(/^./, (c) => c.toUpperCase())}, ${h}`;
        } catch {
          /* cae a la fecha */
        }
      }
      return formatDate(iso, locale, timezone);
    },
    [locale, timezone, todayKey, t],
  );
  const membresiasT = useMemo(
    () => (membresiasDict ? makeBarberT({ barber: { membresias: membresiasDict } } as Dictionary) : null),
    [membresiasDict],
  );

  const pendingDrafts = drafts
    ? {
        count: drafts.length,
        total: drafts.reduce((acc, d) => acc + d.estimate, 0),
        summary: drafts
          .flatMap((d) => d.lines.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ""}${l.name}`))
          .slice(0, 3)
          .join(" · "),
      }
    : null;

  const phone10 = mxTenDigits(client.phone);
  const hasMenuNarrowEdit = canEdit;
  const lastVisitText = client.lastVisitAt
    ? dayKey(client.lastVisitAt, timezone) === todayKey
      ? t("ficha.today")
      : formatDate(client.lastVisitAt, locale, timezone)
    : null;

  const tabPanelProps = (k: FichaTab) => ({
    id: `ficha-panel-${k}`,
    role: "tabpanel" as const,
    "aria-labelledby": `ficha-tab-${k}`,
    hidden: tab !== k,
    tabIndex: -1,
    className: f.panel,
    "data-panel": k,
  });

  return (
    <>
      <div className={f.page} ref={pageRef} data-ficha-a>
        {/* ── Cabecera fija ── */}
        <div className={f.stick} ref={stickRef}>
          <div className={`${f.idRow} ${f.idHead}`}>
            <span className={f.avatar} aria-hidden="true">
              {initials(client.name)}
            </span>
            <div className={f.who}>
              <div className={f.nameLine}>
                <h1 className={f.name}>{client.name}</h1>
                {detail.membership ? (
                  <span className={`${f.chip} ${f.chipOk}`}>
                    <Crown size={12} aria-hidden="true" /> {detail.membership.name}
                  </span>
                ) : null}
                {client.portalEnabled ? (
                  <span className={f.chip}>
                    <ShieldCheck size={12} aria-hidden="true" /> {t("badges.portal")}
                  </span>
                ) : null}
                {blocked ? (
                  <span className={`${f.chip} ${f.chipDanger}`}>
                    <Ban size={12} aria-hidden="true" /> {t("badges.blocked")}
                  </span>
                ) : null}
              </div>
              <div className={f.metaLine}>
                <a className={f.phone} href={telHref(client.phone)} data-telefono>
                  {prettyPhone(client.phone)}
                </a>
                <span>
                  {lastVisitText ? (
                    <>
                      {t("ficha.lastVisitShort")} <strong>{lastVisitText}</strong>
                    </>
                  ) : (
                    t("detail.neverVisited")
                  )}
                </span>
                <span>
                  <strong>{client.totalVisits}</strong>{" "}
                  {t("detail.visits", { count: client.totalVisits }).replace(/^\s*\d+\s*/, "")}
                </span>
                <StarsMini stars={starsView} loyalty={loyalty} t={t} />
              </div>
            </div>

            <div className={f.actions}>
              {canBook ? (
                <Link
                  href={`/barber/agenda?nueva=${encodeURIComponent(client.id)}`}
                  className={`${f.btn} ${f.btnPrimary} ${f.grow}`}
                  data-accion="agendar"
                >
                  <CalendarPlus size={15} aria-hidden="true" />
                  {t("detail.book")}
                </Link>
              ) : null}
              {phone10 ? (
                // Una sola regla para escribirle (ws6-t8, wa-chat): SU chat en
                // Mensajes (o uno nuevo con su nombre) si hay WhatsApp conectado
                // y permiso; si no, wa.me. Rafael, 16-nov: se llama «WhatsApp».
                <ChatClienteLink className={`${f.btn} ${f.grow}`} phone={client.phone} data-accion="whatsapp">
                  <WhatsAppGlyph size={15} />
                  {t("detail.whatsapp")}
                </ChatClienteLink>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className={`${f.btn} ${f.onlyWide}`}
                  onClick={() => setShowEdit(true)}
                  data-accion="editar-datos"
                >
                  <Pencil size={14} aria-hidden="true" />
                  {t("detail.edit")}
                </button>
              ) : null}
              <div className={f.menuWrap}>
                <button
                  ref={menuBtnRef}
                  type="button"
                  className={`${f.btn} ${f.btnIcon}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={t("ficha.more")}
                  title={t("ficha.more")}
                  onClick={() => setMenuOpen((o) => !o)}
                  data-accion="mas"
                >
                  <MoreHorizontal size={18} aria-hidden="true" />
                </button>
                {menuOpen ? (
                  <div ref={menuRef} className={f.menu} role="menu" aria-label={t("ficha.more")} onKeyDown={onMenuKey}>
                    {hasMenuNarrowEdit ? (
                      <button
                        type="button"
                        role="menuitem"
                        className={`${f.menuItem} ${f.onlyNarrow}`}
                        onClick={() => {
                          setMenuOpen(false);
                          setShowEdit(true);
                        }}
                      >
                        <Pencil size={15} aria-hidden="true" /> {t("detail.edit")}
                      </button>
                    ) : null}
                    <a role="menuitem" className={f.menuItem} href={telHref(client.phone)} onClick={() => setMenuOpen(false)}>
                      <Phone size={15} aria-hidden="true" /> {t("detail.call")}
                    </a>
                    {canEdit ? (
                      <>
                        <span className={f.menuSep} role="separator" />
                        <button
                          type="button"
                          role="menuitem"
                          className={`${f.menuItem} ${blocked ? "" : f.menuItemDanger}`}
                          onClick={() => {
                            setMenuOpen(false);
                            if (blocked) void setBlocked(false);
                            else setShowBlock(true);
                          }}
                          data-accion="bloquear"
                        >
                          <Ban size={15} aria-hidden="true" />
                          {blocked ? t("block.unblock") : t("block.block")}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className={f.tabs} role="tablist" aria-label={t("ficha.tabsLabel")} onKeyDown={onTabsKey}>
            {tabs.map((k) => {
              const Icon = TAB_ICON[k];
              const on = tab === k;
              return (
                <a
                  key={k}
                  ref={(el) => {
                    tabRefs.current[k] = el;
                  }}
                  href={tabHref(k)}
                  role="tab"
                  id={`ficha-tab-${k}`}
                  aria-selected={on}
                  aria-controls={`ficha-panel-${k}`}
                  tabIndex={on ? 0 : -1}
                  className={`${f.tab} ${on ? f.tabOn : ""}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    if (!on) goTab(k);
                  }}
                  data-tab={k}
                >
                  <Icon size={16} aria-hidden="true" />
                  {t(`ficha.tabs.${k}`)}
                  {k === "pagos" && pendingDrafts && pendingDrafts.count > 0 ? (
                    <span className={f.tabBadge} aria-label={t("ficha.draftsBanner", { count: pendingDrafts.count })}>
                      {pendingDrafts.count}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </div>
        </div>

        {linkedOpen ? (
          <div role="status" className={f.notice}>
            <span style={{ flex: "1 1 240px" }}>
              {typedName && typedName.toLowerCase() !== client.name.trim().toLowerCase()
                ? t("new.existingDiff", { name: client.name, typed: typedName })
                : t("new.existing", { name: client.name })}
            </span>
            {typedName ? (
              <button
                type="button"
                className={`${f.btn} ${f.btnSm}`}
                onClick={() => router.push(`/barber/clientes?alta=1&nombre=${encodeURIComponent(typedName)}`)}
              >
                {t("new.notSame")}
              </button>
            ) : null}
            <button
              type="button"
              className={`${f.btn} ${f.btnSm}`}
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
          <div className={`${f.notice} ${f.noticeDanger}`} role="status">
            <TriangleAlert size={17} aria-hidden="true" />
            <div>
              <p>
                <strong>{t("block.warning")}</strong>
                {block?.at ? ` ${t("block.blockedOn", { date: formatDate(block.at, locale, timezone) })}.` : ""}
              </p>
              {block?.reason ? <p>{t("block.blockedBecause", { reason: block.reason })}</p> : null}
            </div>
          </div>
        ) : null}

        {/* ── Resumen ── */}
        <div {...tabPanelProps("resumen")}>
          <div className={f.cols}>
            <div className={f.colMain}>
              <PreferencesPanel
                clientId={client.id}
                preferences={preferences}
                barbers={detail.barbers}
                canEdit={false}
                t={t}
                onSaved={setPreferences}
                onMessage={toast.show}
                variant="summary"
                seeAllHref={tabHref("corte")}
                onSeeAll={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  goTab("corte");
                }}
              />
              <NextVisitCard
                next={next}
                last={last}
                locale={locale}
                timezone={timezone}
                t={t}
                canOpenAgenda={canOpenAgenda}
                historyHref={tabHref("historial")}
                onHistory={() => {
                  setHistorySeg("visits");
                  goTab("historial");
                }}
                todayKey={todayKey}
              />
              {sales && cobrosDict ? (
                <LastPaymentsCard
                  rows={sales.rows}
                  count={sales.totals?.all ?? sales.count}
                  money={money}
                  when={whenShort}
                  t={t}
                  cobrosT={cobrosT}
                  href={tabHref("pagos")}
                  onGo={() => goTab("pagos")}
                  drafts={pendingDrafts}
                  onChargeDrafts={
                    chargeEnabled && drafts && drafts.length > 0
                      ? () => (drafts.length === 1 && drafts[0].clientId ? openCharge(drafts[0]) : goTab("pagos"))
                      : null
                  }
                />
              ) : null}
            </div>
            <div className={f.colSide}>
              {starsView && starsDict ? (
                <StarsPanel
                  clientId={client.id}
                  clientName={client.name}
                  initial={starsView}
                  dict={starsDict}
                  locale={locale}
                  timezone={timezone}
                  canHandle={canHandleStars}
                  onMessage={toast.show}
                  onChanged={(v) => {
                    setStarsView(v);
                    router.refresh();
                  }}
                  hideHistory
                  historyLink={
                    <TabLink
                      href={`${tabHref("historial")}&ver=estrellas`}
                      onGo={() => {
                        setHistorySeg("stars");
                        goTab("historial");
                      }}
                      className={f.btnLink}
                      data-accion="historial-estrellas"
                    >
                      {t("ficha.starsHistoryLink")}
                    </TabLink>
                  }
                />
              ) : (
                <LoyaltyCard
                  clientId={client.id}
                  state={loyalty}
                  canRedeem={canEdit}
                  t={t}
                  onRedeemed={(nextLoyalty) => {
                    setLoyalty(nextLoyalty);
                    router.refresh();
                  }}
                  onMessage={toast.show}
                />
              )}
              <LastLookCard
                photos={photos}
                entries={entries}
                locale={locale}
                timezone={timezone}
                t={t}
                href={tabHref("fotos")}
                onGo={() => goTab("fotos")}
                onOpen={setLightbox}
              />
              <section className={`${f.card} ${f.cardPad}`} aria-label={t("detail.notesTitle")} data-notas>
                <div className={f.cardHead}>
                  <h2 className={f.cardTitle}>
                    <NotebookPen size={16} aria-hidden="true" /> {t("detail.notesTitle")}
                  </h2>
                  {canEdit ? (
                    <button type="button" className={f.btnLink} onClick={() => setShowEdit(true)}>
                      <Pencil size={13} aria-hidden="true" /> {t("preferences.edit")}
                    </button>
                  ) : null}
                </div>
                <p className={f.hint} style={{ whiteSpace: "pre-wrap", color: "var(--text-2)", fontSize: 13.5 }}>
                  {client.notes || t("detail.notesEmpty")}
                </p>
                {client.email || client.birthday ? (
                  <div className={f.lastRow} style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                    {client.email ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 0 }}>
                        <Mail size={13} aria-hidden="true" /> {client.email}
                      </span>
                    ) : null}
                    {client.birthday ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 0 }}>
                        <CalendarHeart size={13} aria-hidden="true" />
                        {t("detail.birthdayOn", {
                          day: new Date(client.birthday).getUTCDate(),
                          month: t(`months.${new Date(client.birthday).getUTCMonth() + 1}`),
                        })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </div>

        {/* ── Corte ── */}
        <div {...tabPanelProps("corte")}>
          <div className={f.panelHead}>
            <div>
              <h2 className={f.panelTitle}>{t("preferences.title")}</h2>
              <p className={f.panelSub}>{t("ficha.cutSubtitle")}</p>
            </div>
          </div>
          <div className={f.cols}>
            <div className={f.colMain}>
              <PreferencesPanel
                clientId={client.id}
                preferences={preferences}
                barbers={detail.barbers}
                canEdit={canEdit}
                t={t}
                onSaved={setPreferences}
                onMessage={toast.show}
              />
            </div>
            <div className={f.colSide}>
              <LastLookCard
                photos={photos}
                entries={entries}
                locale={locale}
                timezone={timezone}
                t={t}
                href={tabHref("fotos")}
                onGo={() => goTab("fotos")}
                onOpen={setLightbox}
              />
            </div>
          </div>
        </div>

        {/* ── Pagos ── */}
        {sales && cobrosDict ? (
          <div {...tabPanelProps("pagos")}>
            <ClientSales
              clientId={client.id}
              clientPhone={client.phone}
              shopName={shopName}
              initial={sales}
              dict={cobrosDict}
              cajaDict={cajaDict}
              locale={locale}
              timezone={timezone}
              canPrint={canPrintSales}
              canManage={canCharge}
              reloadKey={salesReload}
              pending={pendingDrafts}
              onChanged={() => router.refresh()}
              beforeList={
                chargeEnabled ? (
                  <ClientDrafts
                    clientId={client.id}
                    dict={cobrosDict}
                    locale={locale}
                    timezone={timezone}
                    canManage={chargeEnabled}
                    reloadKey={salesReload}
                    onCharge={(d) => openCharge(d)}
                    onLoaded={setDrafts}
                  />
                ) : null
              }
              headerAction={
                chargeEnabled ? (
                  <button
                    type="button"
                    className={`${f.btn} ${f.btnPrimary}`}
                    onClick={() => openCharge(null)}
                    data-accion="nuevo-cobro"
                  >
                    <Wallet size={15} aria-hidden="true" />
                    {(cobrosDict as Record<string, unknown>).newCharge as string}
                  </button>
                ) : null
              }
            />
          </div>
        ) : null}

        {/* ── Fotos ── */}
        <div {...tabPanelProps("fotos")}>
          <PhotosSection
            photos={photos}
            entries={entries}
            locale={locale}
            timezone={timezone}
            t={t}
            canEdit={canEdit}
            canPublish={canPublish}
            canOpenAgenda={canOpenAgenda}
            onOpen={setLightbox}
            onToggleVisible={(p) => void toggleVisible(p)}
            onRemove={(p) => void removePhoto(p)}
            uploader={
              canEdit ? (
                <PhotoUploader
                  clientId={client.id}
                  canPublish={canPublish}
                  t={t}
                  onUploaded={(photo: UploadedPhoto) =>
                    setPhotos((list) => sortPhotos(list.concat(photo as BarberVisitPhotoView)))
                  }
                  onMessage={toast.show}
                />
              ) : null
            }
          />
        </div>

        {/* ── Historial ── */}
        <div {...tabPanelProps("historial")}>
          <HistorySection
            entries={entries}
            totalVisits={client.totalVisits}
            locale={locale}
            timezone={timezone}
            t={t}
            canOpenAgenda={canOpenAgenda}
            onOpenPhoto={setLightbox}
            stars={starsView}
            starsDict={starsDict}
            seg={historySeg}
            onSeg={setHistorySeg}
          />
        </div>

        {/* ── Membresía ── */}
        {tabs.includes("membresia") ? (
          <div {...tabPanelProps("membresia")}>
            <MembershipSection
              current={detail.membership}
              periods={membershipPeriods}
              nowISO={now}
              locale={locale}
              timezone={timezone}
              t={t}
              membresiasT={membresiasT}
              money={money}
              showMoney={Boolean(sales) || canSellMembership}
              canSell={canSellMembership && Boolean(membresiasT) && membershipPlans.some((p) => p.isActive)}
              onSell={(planId) => setSelling({ planId })}
            />
          </div>
        ) : null}
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
      {selling && membresiasT ? (
        <SellMembershipModal
          t={membresiasT}
          locale={locale}
          plans={membershipPlans}
          stripeReady={membershipStripeReady}
          open
          initial={{
            client: { id: client.id, name: client.name, phone: client.phone, activeMembership: null },
            // El plan de su última membresía si sigue a la venta; si no, el primero que se vende
            // (un id vacío haría decir al diálogo «El plan «» ya no se vende»).
            planId:
              membershipPlans.find((p) => p.isActive && p.id === (selling.planId ?? membershipPeriods[0]?.membershipId))?.id ??
              membershipPlans.find((p) => p.isActive)?.id ??
              "",
          }}
          onClose={() => setSelling(null)}
          onSold={() => router.refresh()}
        />
      ) : null}
      {showEdit ? (
        <EditClientModal
          client={client}
          t={t}
          onClose={() => setShowEdit(false)}
          onSaved={(nextClient) => {
            setClient(nextClient);
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
    // Lo guardado, partido en país + número local (+34612345678 → ES · 612345678).
    phone: splitStoredPhone(client.phone).local,
    phoneCountry: splitStoredPhone(client.phone).iso || "MX",
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
        <TelefonoConPais
          inputId="ed-phone"
          iso={form.phoneCountry}
          onIsoChange={(iso) => setForm((f) => ({ ...f, phoneCountry: iso }))}
          value={form.phone}
          onValueChange={(phone) => setForm((f) => ({ ...f, phone }))}
          selectClassName={s.select}
          inputClassName={s.input}
          countryLabel={t("form.phoneCountry")}
          placeholderMx={t("form.phonePlaceholder")}
          placeholderOther={t("form.phonePlaceholderOther")}
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
