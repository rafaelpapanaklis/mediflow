"use client";

import { useCallback, useMemo, useState } from "react";
import { CalendarPlus, LogOut, MessageCircle } from "lucide-react";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type { PortalPayload, PortalShopDTO } from "@/lib/barber/client-portal";

/* ═══════════════════════════════════════════════════════════════════════
   El portal del cliente ya identificado.

   Todo lo que se pinta viene de loadPortalData(), que filtra SIEMPRE por
   (clientId de la cookie firmada + barbershopId del slug). Este componente
   no manda ningún id de cliente a ningún lado: no tiene forma de pedir los
   datos de otra persona ni de otra barbería.

   Las fotos que llegan aquí son SOLO las que la barbería marcó
   visibleToClient — el filtro está en la búsqueda, no en el render.
   ═══════════════════════════════════════════════════════════════════════ */

type TabId = "citas" | "visitas" | "pagos";

export function PortalClient({
  slug,
  shop,
  initial,
}: {
  slug: string;
  shop: PortalShopDTO;
  initial: PortalPayload;
}) {
  const t = useMemo(() => getBarberT(shop.locale), [shop.locale]);
  const locale = shop.locale === "en" ? "en-US" : "es-MX";

  const [data, setData] = useState<PortalPayload>(initial);
  const [tab, setTab] = useState<TabId>("citas");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
      }),
    [locale],
  );

  const fmtWhen = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: shop.timezone,
      }).format(new Date(iso)),
    [locale, shop.timezone],
  );

  const fmtDay = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: shop.timezone,
      }).format(new Date(iso)),
    [locale, shop.timezone],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/barber/portal/${slug}/data`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload(); // la sesión venció mientras estaba abierto
        return;
      }
      const fresh = await res.json().catch(() => null);
      if (res.ok && fresh) setData(fresh as PortalPayload);
    } catch {
      // Sin red: se queda con lo que ya tiene en pantalla.
    }
  }, [slug]);

  const act = async (id: string, accion: "cancelar" | "reagendar") => {
    setError(null);
    setNotice(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/barber/portal/${slug}/citas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? t("barber.reserva.errores.generico"));
        return;
      }
      if (accion === "reagendar") setNotice(t("barber.reserva.portal.citas.reagendarEnviado"));
      await refresh();
    } catch {
      setError(t("barber.reserva.errores.sinRed"));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const logout = async () => {
    try {
      await fetch(`/api/barber/portal/${slug}/session`, { method: "DELETE" });
    } catch {
      // Aunque falle la llamada, se recarga: la pantalla no puede quedarse
      // atorada en "cerrando sesión".
    }
    window.location.reload();
  };

  const waHref = shop.phone
    ? `https://wa.me/52${shop.phone.replace(/\D/g, "").slice(-10)}`
    : null;

  const stamps = Array.from({ length: data.client.loyaltyGoal }, (_, i) => i);

  return (
    <div>
      <header className="dcb-head" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="dcb-head__name">
            {t("barber.reserva.portal.hola", { nombre: data.client.name.split(" ")[0] })}
          </h1>
          <p className="dcb-head__meta">{shop.branchName ? `${shop.name} · ${shop.branchName}` : shop.name}</p>
        </div>
        <button type="button" className="dcb-btn dcb-btn--ghost dcb-btn--sm" onClick={() => void logout()}>
          <LogOut size={15} /> {t("barber.reserva.portal.nav.salir")}
        </button>
      </header>

      {error ? (
        <p className="dcb-alert dcb-alert--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="dcb-alert dcb-alert--ok">{notice}</p> : null}

      {/* ── Lealtad ─────────────────────────────────────────────────── */}
      <section className="dcb-loyalty">
        <p className="dcb-section" style={{ margin: 0 }}>
          {t("barber.reserva.portal.lealtad.title")}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 700 }}>
          {data.client.freeCutReady
            ? t("barber.reserva.portal.lealtad.listo")
            : t("barber.reserva.portal.lealtad.falta", {
                n: Math.max(0, data.client.loyaltyGoal - data.client.loyaltyCount),
              })}
        </p>
        <p className="dcb-help" style={{ margin: "4px 0 0" }}>
          {t("barber.reserva.portal.lealtad.progreso", {
            n: data.client.loyaltyCount,
            meta: data.client.loyaltyGoal,
          })}
          {data.client.freeCutReady ? ` · ${t("barber.reserva.portal.lealtad.comoFunciona")}` : ""}
        </p>
        <div className="dcb-loyalty__stamps" aria-hidden="true">
          {stamps.map((i) => (
            <span
              key={i}
              className={
                "dcb-loyalty__stamp" + (i < data.client.loyaltyCount ? " dcb-loyalty__stamp--on" : "")
              }
            />
          ))}
        </div>
      </section>

      {/* ── Membresía ───────────────────────────────────────────────── */}
      {data.membership ? (
        <section className="dcb-card" style={{ marginBottom: 18 }}>
          <p className="dcb-section" style={{ margin: "0 0 8px" }}>
            {t("barber.reserva.portal.membresia.title")}
          </p>
          <div className="dcb-kv">
            <span>{data.membership.name}</span>
            <b>{t("barber.reserva.portal.membresia.vigencia", { fecha: fmtDay(data.membership.endAt) })}</b>
          </div>
          <div className="dcb-kv">
            <span>
              {data.membership.cutsLeft === null
                ? t("barber.reserva.portal.membresia.cortesIlimitados")
                : t("barber.reserva.portal.membresia.cortes", { n: data.membership.cutsLeft })}
            </span>
            <b>{data.membership.status === "ACTIVE" ? "✓" : "—"}</b>
          </div>
        </section>
      ) : null}

      {/* ── Pestañas ────────────────────────────────────────────────── */}
      <div className="dcb-tabs" role="tablist">
        {(["citas", "visitas", "pagos"] as TabId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={"dcb-tab" + (tab === id ? " dcb-tab--on" : "")}
            onClick={() => setTab(id)}
          >
            {t(`barber.reserva.portal.nav.${id}`)}
          </button>
        ))}
      </div>

      {/* ── Próximas citas ──────────────────────────────────────────── */}
      {tab === "citas" ? (
        <section>
          {data.upcoming.length === 0 ? (
            <div className="dcb-empty">
              <p style={{ margin: "0 0 14px" }}>{t("barber.reserva.portal.citas.vacio")}</p>
              <a className="dcb-btn dcb-btn--primary" href={`/b/${slug}/reservar`}>
                <CalendarPlus size={16} /> {t("barber.reserva.portal.citas.reservar")}
              </a>
            </div>
          ) : (
            <>
              {data.upcoming.map((a) => (
                <article className="dcb-appt" key={a.id}>
                  <div className="dcb-appt__row">
                    <div>
                      <p className="dcb-appt__when">{fmtWhen(a.startAt)}</p>
                      <p className="dcb-appt__meta">
                        {a.barberName
                          ? t("barber.reserva.portal.citas.conBarbero", { barbero: a.barberName })
                          : t("barber.reserva.confirmacion.cualquierBarbero")}
                        {" · "}
                        {a.services.map((s) => s.name).join(" + ")}
                      </p>
                      {a.deposit ? (
                        <p className="dcb-appt__meta">
                          {t("barber.reserva.portal.citas.anticipo")}: {money.format(a.deposit.amount)}
                        </p>
                      ) : null}
                    </div>
                    <span style={{ textAlign: "right", flex: "0 0 auto" }}>
                      <span
                        className={
                          "dcb-badge " +
                          (a.status === "CONFIRMED" ? "dcb-badge--ok" : "dcb-badge--pending")
                        }
                      >
                        {t(`barber.reserva.portal.citas.estado.${a.status}`)}
                      </span>
                      <b style={{ display: "block", marginTop: 6, fontSize: 15 }}>
                        {money.format(a.total)}
                      </b>
                    </span>
                  </div>

                  <div className="dcb-appt__actions">
                    {a.canCancel ? (
                      confirmId === a.id ? (
                        <>
                          <button
                            type="button"
                            className="dcb-btn dcb-btn--primary dcb-btn--sm"
                            disabled={busyId === a.id}
                            onClick={() => void act(a.id, "cancelar")}
                          >
                            {busyId === a.id
                              ? t("barber.reserva.portal.citas.cancelando")
                              : t("barber.reserva.portal.citas.confirmarCancelar")}
                          </button>
                          <button
                            type="button"
                            className="dcb-btn dcb-btn--ghost dcb-btn--sm"
                            onClick={() => setConfirmId(null)}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="dcb-btn dcb-btn--ghost dcb-btn--sm"
                          onClick={() => setConfirmId(a.id)}
                        >
                          {t("barber.reserva.portal.citas.cancelar")}
                        </button>
                      )
                    ) : (
                      <span className="dcb-help">{t("barber.reserva.portal.citas.noSePuedeCancelar")}</span>
                    )}

                    <button
                      type="button"
                      className="dcb-btn dcb-btn--ghost dcb-btn--sm"
                      disabled={busyId === a.id}
                      onClick={() => void act(a.id, "reagendar")}
                    >
                      {t("barber.reserva.portal.citas.reagendar")}
                    </button>

                    {waHref ? (
                      <a
                        className="dcb-btn dcb-btn--ghost dcb-btn--sm"
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle size={15} /> {t("barber.reserva.portal.citas.escribirWhatsapp")}
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
              <a className="dcb-btn dcb-btn--primary" href={`/b/${slug}/reservar`} style={{ marginTop: 8 }}>
                <CalendarPlus size={16} /> {t("barber.reserva.portal.citas.reservar")}
              </a>
            </>
          )}
        </section>
      ) : null}

      {/* ── Historial de visitas ────────────────────────────────────── */}
      {tab === "visitas" ? (
        <section>
          {data.history.length === 0 && data.gallery.length === 0 ? (
            <p className="dcb-empty">{t("barber.reserva.portal.visitas.vacio")}</p>
          ) : null}

          {data.history.map((v) => (
            <article className="dcb-appt" key={v.id}>
              <div className="dcb-appt__row">
                <div>
                  <p className="dcb-appt__when">{fmtDay(v.startAt)}</p>
                  <p className="dcb-appt__meta">
                    {v.barberName
                      ? t("barber.reserva.portal.citas.conBarbero", { barbero: v.barberName })
                      : ""}
                    {v.barberName && v.services.length ? " · " : ""}
                    {v.services.map((s) => s.name).join(" + ")}
                  </p>
                </div>
                <span className="dcb-badge dcb-badge--neutral">{money.format(v.total)}</span>
              </div>
              {v.photos.length > 0 ? (
                <>
                  <p className="dcb-help" style={{ marginTop: 10 }}>
                    {t("barber.reserva.portal.visitas.fotos")}
                  </p>
                  <div className="dcb-photos">
                    {v.photos.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.id} src={p.url} alt="" loading="lazy" />
                    ))}
                  </div>
                </>
              ) : null}
            </article>
          ))}

          {data.gallery.length > 0 ? (
            <>
              <p className="dcb-section">{t("barber.reserva.portal.visitas.galeria")}</p>
              <div className="dcb-photos">
                {data.gallery.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.id} src={p.url} alt="" loading="lazy" />
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {/* ── Pagos ───────────────────────────────────────────────────── */}
      {tab === "pagos" ? (
        <section>
          {data.payments.length === 0 ? (
            <p className="dcb-empty">{t("barber.reserva.portal.pagos.vacio")}</p>
          ) : (
            data.payments.map((p) => (
              <article className="dcb-appt" key={p.id}>
                <div className="dcb-appt__row">
                  <p className="dcb-appt__when" style={{ textTransform: "none" }}>
                    {fmtDay(p.createdAt)}
                  </p>
                  <span className="dcb-badge dcb-badge--neutral">{money.format(p.total)}</span>
                </div>
                {p.items.map((it, i) => (
                  <div className="dcb-kv" key={`${p.id}-${i}`}>
                    <span>
                      {it.description}
                      {it.qty > 1 ? ` ×${it.qty}` : ""}
                    </span>
                    <b>{money.format(it.unitPrice * it.qty)}</b>
                  </div>
                ))}
                {p.tip > 0 ? (
                  <div className="dcb-kv">
                    <span>{t("barber.reserva.portal.pagos.propina")}</span>
                    <b>{money.format(p.tip)}</b>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : null}

      <p className="dcb-foot">
        {shop.address ? `${shop.address} · ` : ""}
        {data.client.phone}
      </p>
    </div>
  );
}
