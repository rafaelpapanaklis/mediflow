"use client";

// ═══════════════════════════════════════════════════════════════════════
// Página PÚBLICA de la fila (la del QR del mostrador). Sin sesión, sin
// cuenta, sin app: el cliente escanea, deja su nombre y ve su lugar.
//
// Lo que esta pantalla NUNCA muestra: nombres, teléfonos ni ids de los
// demás. Solo CUÁNTOS hay delante. La API pública tampoco los manda.
//
// El ticket se guarda en localStorage por barbería: volver a escanear el
// QR devuelve tu lugar en vez de formarte otra vez.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { Field, agendaCss } from "@/components/barber/agenda/agenda-ui";
import css from "./walkin.module.css";

interface PublicBarber {
  id: string;
  name: string;
  photoUrl: string | null;
}

interface MyTicket {
  ticketId: string;
  clientName: string;
  status: "WAITING" | "CALLED" | "SERVED" | "LEFT";
  barberId: string | null;
  joinedAt: string;
  calledAt: string | null;
  rank: number;
  ahead: number;
  etaMinutes: number;
  etaLabel: string;
}

interface PublicPayload {
  shop: { name: string; slug: string; logoUrl: string | null };
  waiting: number;
  chairs: number;
  avgServiceMin: number;
  barbers: PublicBarber[];
  me: MyTicket | null;
}

export interface WalkinPublicProps {
  dict: Dictionary;
  slug: string;
  shopName: string;
  logoUrl: string | null;
}

const POLL_MS = 15_000;

export function WalkinPublic(props: WalkinPublicProps) {
  const t = useMemo(() => makeBarberT(props.dict), [props.dict]);
  const storageKey = `dc:barber:fila:${props.slug}`;

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [data, setData] = useState<PublicPayload | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [barberId, setBarberId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  // localStorage puede tronar (modo privado, cookies bloqueadas). Nunca
  // debe tumbar la página: sin ticket guardado simplemente vuelve a pedir
  // el nombre.
  useEffect(() => {
    try {
      setTicketId(window.localStorage.getItem(storageKey));
    } catch {
      setTicketId(null);
    }
  }, [storageKey]);

  const ticketRef = useRef<string | null>(null);
  ticketRef.current = ticketId;

  const load = useCallback(async () => {
    try {
      const ticket = ticketRef.current;
      const res = await fetch(
        `/api/barber/walkins/public?slug=${encodeURIComponent(props.slug)}${
          ticket ? `&ticket=${encodeURIComponent(ticket)}` : ""
        }`,
        { cache: "no-store" },
      );
      if (res.status === 404) {
        setClosed(true);
        return;
      }
      if (!res.ok) return;
      const payload = (await res.json()) as PublicPayload;
      setData(payload);
      // El ticket dejó de existir (lo borró el mostrador): se limpia.
      if (ticket && !payload.me) forgetTicket();
    } catch {
      /* sin red: se queda con lo último que vio */
    }
  }, [props.slug]);

  useEffect(() => {
    void load();
  }, [load, ticketId]);

  // Se actualiza sola mientras la pantalla esté a la vista. Con la pestaña
  // en segundo plano no tiene caso: nadie la está mirando y el celular
  // agradece la batería.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const rememberTicket = (id: string) => {
    try {
      window.localStorage.setItem(storageKey, id);
    } catch {
      /* sin almacenamiento: el ticket vive solo mientras la pestaña esté abierta */
    }
    setTicketId(id);
  };

  const forgetTicket = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* nada que limpiar */
    }
    setTicketId(null);
  };

  const join = async () => {
    setError(null);
    if (name.trim().length < 2) return setError(t("barber.agenda.public.errors.name"));
    if (phone.replace(/\D/g, "").length < 10) {
      return setError(t("barber.agenda.public.errors.phone"));
    }
    setBusy(true);
    try {
      const res = await fetch("/api/barber/walkins/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: props.slug,
          name: name.trim(),
          phone: phone.trim(),
          barberId: barberId || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : t("barber.agenda.public.errors.generic"));
        return;
      }
      rememberTicket(body.ticketId as string);
      await load();
    } catch {
      setError(t("barber.agenda.public.errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const me = data?.me ?? null;
  const shopName = data?.shop.name ?? props.shopName;
  const logoUrl = data?.shop.logoUrl ?? props.logoUrl;

  if (closed) {
    return (
      <div className={css.public}>
        <div className={css.publicCard}>
          <div className={css.publicHead}>
            <span className={css.publicKicker}>{t("barber.agenda.public.kicker")}</span>
            <h1 className={css.publicShop}>{t("barber.agenda.public.closedTitle")}</h1>
          </div>
          <div className={css.publicBody}>
            <p className={agendaCss.hint}>{t("barber.agenda.public.closedBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={css.public}>
      <div className={css.publicCard}>
        <div className={css.publicHead}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={css.publicLogo} src={logoUrl} alt="" />
          ) : null}
          <span className={css.publicKicker}>{t("barber.agenda.public.kicker")}</span>
          <h1 className={css.publicShop}>{shopName}</h1>
          <p className={css.publicSub}>
            {me ? t("barber.agenda.public.subtitle") : t("barber.agenda.public.title")}
          </p>
        </div>

        <div className={css.publicBody}>
          {me && (me.status === "WAITING" || me.status === "CALLED") ? (
            <>
              {me.status === "CALLED" ? (
                <div className={css.called}>
                  <p className={css.calledTitle}>{t("barber.agenda.public.called")}</p>
                  <p style={{ margin: 0 }}>{t("barber.agenda.public.calledBody")}</p>
                </div>
              ) : (
                <div className={css.spot}>
                  <span className={css.spotLabel}>{t("barber.agenda.public.yourSpot")}</span>
                  <div className={css.spotNumber}>{me.rank}</div>
                  <div className={css.spotAhead}>
                    {me.ahead === 0
                      ? t("barber.agenda.public.noneAhead")
                      : t("barber.agenda.public.ahead", { count: me.ahead })}
                  </div>
                  <div className={css.spotEta}>
                    <span className={css.spotLabel}>{t("barber.agenda.public.eta")}</span>
                    <div className={css.spotEtaValue}>
                      {me.etaMinutes <= 0 ? t("barber.agenda.public.noneAhead") : me.etaLabel}
                    </div>
                  </div>
                </div>
              )}

              <p className={agendaCss.hint} style={{ textAlign: "center" }}>
                {t("barber.agenda.public.etaNote")}
              </p>

              <div className={css.liveNote}>
                <span className={css.liveDot} />
                {t("barber.agenda.public.live")}
              </div>

              <button type="button" className={agendaCss.btn} onClick={() => void load()}>
                {t("barber.agenda.public.refresh")}
              </button>
            </>
          ) : me && me.status === "SERVED" ? (
            <>
              <p className={agendaCss.hint} style={{ textAlign: "center", fontSize: 15 }}>
                {t("barber.agenda.public.served")}
              </p>
              <button type="button" className={agendaCss.btn} onClick={forgetTicket}>
                {t("barber.agenda.public.join")}
              </button>
            </>
          ) : me && me.status === "LEFT" ? (
            <>
              <p className={agendaCss.hint} style={{ textAlign: "center" }}>
                {t("barber.agenda.public.left")}
              </p>
              <button type="button" className={agendaCss.btn} onClick={forgetTicket}>
                {t("barber.agenda.public.join")}
              </button>
            </>
          ) : (
            <>
              <p className={agendaCss.hint} style={{ textAlign: "center" }}>
                {data && data.waiting > 0
                  ? t("barber.agenda.public.waitingNow", { count: data.waiting })
                  : t("barber.agenda.public.empty")}
              </p>

              {error ? <div className={agendaCss.errorBox}>{error}</div> : null}

              <Field label={t("barber.agenda.public.name")}>
                <input
                  className={agendaCss.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("barber.agenda.public.namePlaceholder")}
                  autoComplete="given-name"
                  maxLength={60}
                />
              </Field>

              <Field label={t("barber.agenda.public.phone")} hint={t("barber.agenda.public.phoneHint")}>
                <input
                  className={agendaCss.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("barber.agenda.public.phonePlaceholder")}
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={20}
                />
              </Field>

              {data && data.barbers.length > 1 ? (
                <Field label={t("barber.agenda.public.barber")}>
                  <select
                    className={agendaCss.select}
                    value={barberId}
                    onChange={(e) => setBarberId(e.target.value)}
                  >
                    <option value="">{t("barber.agenda.public.anyBarber")}</option>
                    {data.barbers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <button
                type="button"
                className={`${agendaCss.btn} ${agendaCss.btnPrimary}`}
                style={{ height: 46, fontSize: 15 }}
                onClick={join}
                disabled={busy}
              >
                {busy ? t("barber.agenda.public.joining") : t("barber.agenda.public.join")}
              </button>
            </>
          )}
        </div>
      </div>

      <p className={css.footerNote}>DaleControl Barber</p>
    </div>
  );
}
