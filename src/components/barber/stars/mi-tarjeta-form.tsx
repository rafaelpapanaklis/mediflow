"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { BarberCaptcha, type BarberCaptchaHandle } from "@/components/barber/captcha/barber-captcha";
import { TelefonoConPais } from "@/components/barber/telefono-con-pais";
import { InstalarTarjeta, type InstalarLabels } from "@/components/barber/stars/instalar-tarjeta";
import { StarsCard, StarsDetails, starsT } from "@/components/barber/stars/stars-card";
import { BARBER_CAPTCHA_ACTIONS } from "@/lib/barber/captcha-core";
// `import type`: se borra al compilar, no arrastra nada del servidor.
import type { StarsView } from "@/lib/barber/stars-core";
import { panelPhone } from "@/lib/barber/telefono-panel";
import {
  claveNumeroRecordado,
  leerNumeroRecordado,
  serializarNumeroRecordado,
  type NumeroRecordado,
} from "@/lib/barber/tarjeta-web-core";

/* ═══════════════════════════════════════════════════════════════════════
   «Mi tarjeta» — el cliente escribe su teléfono y ve su tarjeta de estrellas
   ahí mismo (ws6-t2; decisión de Rafael, 16-nov).

   Lo que llega del servidor es SOLO la tarjeta (nombre de pila, estrellas,
   bonos e historial de estrellas) y su enlace personal. El teléfono que
   tecleó nunca vuelve del servidor.

   Con la tarjeta a la vista:
     · «Guárdala en tu inicio» (el aviso de instalar, con el manifest de SU
       tarjeta puesto en ese momento);
     · su enlace personal, para volver sin teclear;
     · «No soy yo»: borra el número recordado y regresa al formulario.

   El número se recuerda en ESTE navegador (localStorage, por barbería) solo
   si deja marcada la casilla; la siguiente vez la tarjeta aparece sola.

   Los textos llegan resueltos desde la página (servidor).
   ═══════════════════════════════════════════════════════════════════════ */

export interface MiTarjetaLabels {
  title: string;
  sub: string;
  phone: string;
  country: string;
  placeholderMx: string;
  placeholderOther: string;
  remember: string;
  send: string;
  sending: string;
  /** Con `{name}`. */
  hello: string;
  cardSub: string;
  notMe: string;
  linkTitle: string;
  linkBody: string;
  linkOpen: string;
  linkCopy: string;
  linkCopied: string;
  notFoundTitle: string;
  notFoundBody: string;
  tryAgain: string;
  errorPhone: string;
  errorGeneric: string;
  errorNetwork: string;
  errorTooMany: string;
  captchaError: string;
  captchaRetry: string;
}

type Fase = "pedir" | "tarjeta" | "no";

export function MiTarjetaForm({
  slug,
  locale,
  timezone,
  labels,
  instalar,
  starsDict,
  iconHref,
  captchaSiteKey = null,
  salidas,
}: {
  slug: string;
  locale: string;
  timezone: string;
  labels: MiTarjetaLabels;
  instalar: InstalarLabels;
  /** El sub-árbol `barber.estrellas` del diccionario (lo que pinta la tarjeta). */
  starsDict: Dictionary;
  /** Ícono de la barbería para iPhone (apple-touch-icon). */
  iconHref: string;
  /** Llave del SITIO de Turnstile (servidor). null = sin captcha. */
  captchaSiteKey?: string | null;
  /** Botones de «no encontramos tu número»: reservar, WhatsApp, llamar. */
  salidas: React.ReactNode;
}) {
  const t = useMemo(() => starsT(starsDict), [starsDict]);
  const captcha = useRef<BarberCaptchaHandle>(null);
  const [iso, setIso] = useState("MX");
  const [phone, setPhone] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>("pedir");
  const [view, setView] = useState<StarsView | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const buscar = useCallback(
    async (n: NumeroRecordado, guardar: boolean) => {
      setError(null);
      if (!panelPhone(n.iso, n.phone).ok) {
        setError(labels.errorPhone);
        return;
      }
      setBusy(true);
      let sentToken = false;
      try {
        const check = await captcha.current?.getToken();
        // Sin token: el aviso con «Reintentar» lo pinta el propio captcha.
        if (check && !check.ok) return;
        const captchaToken = check?.ok ? check.token : null;
        sentToken = !!captchaToken;
        const res = await fetch(`/api/barber/public/tarjeta/${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          referrerPolicy: "no-referrer",
          cache: "no-store",
          body: JSON.stringify({ iso: n.iso, phone: n.phone, captchaToken, website }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          found?: boolean;
          view?: StarsView;
          link?: string;
          error?: string;
        } | null;
        if (res.status === 429) {
          setError(data?.error ?? labels.errorTooMany);
          return;
        }
        if (!res.ok || !data?.ok) {
          setError(data?.error ?? labels.errorGeneric);
          return;
        }
        if (data.found && data.view && data.link) {
          setView(data.view);
          setLink(data.link);
          setFase("tarjeta");
          escribirRecordado(slug, guardar ? n : null);
        } else {
          // Un número que no aparece no se queda recordado.
          escribirRecordado(slug, null);
          setFase("no");
        }
      } catch {
        setError(labels.errorNetwork);
      } finally {
        // Token de un solo uso: otro intento necesita uno nuevo.
        if (sentToken) captcha.current?.reset();
        setBusy(false);
      }
    },
    [slug, website, labels.errorPhone, labels.errorTooMany, labels.errorGeneric, labels.errorNetwork],
  );

  // Si este navegador recuerda un número, la tarjeta aparece sola (una vez).
  const arrancado = useRef(false);
  useEffect(() => {
    if (arrancado.current) return;
    arrancado.current = true;
    const n = leerRecordado(slug);
    if (!n) return;
    setIso(n.iso);
    setPhone(n.phone);
    void buscar(n, true);
  }, [slug, buscar]);

  const noSoyYo = () => {
    escribirRecordado(slug, null);
    setView(null);
    setLink(null);
    setPhone("");
    setIso("MX");
    setError(null);
    setCopiado(false);
    setFase("pedir");
  };

  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(new URL(link, window.location.origin).toString());
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* sin permiso de portapapeles: queda el botón de abrir */
    }
  };

  // ── La tarjeta ───────────────────────────────────────────────────────
  if (fase === "tarjeta" && view && link) {
    return (
      <div aria-live="polite">
        <div className="dcb-piel__saludo">
          <div>
            <h1 className="dcb-piel__hola">{view.firstName ? labels.hello.replace("{name}", view.firstName) : labels.title}</h1>
            <p className="dcb-piel__sub">{labels.cardSub}</p>
          </div>
          <button type="button" className="dcb-link dcb-piel__nosoy" onClick={noSoyYo}>
            {labels.notMe}
          </button>
        </div>

        <StarsCard view={view} t={t} audience="client" locale={locale} />

        <InstalarTarjeta slug={slug} labels={instalar} manifestHref={`${link}/manifest.webmanifest`} iconHref={iconHref} />

        <StarsDetails view={view} t={t} audience="client" locale={locale} timezone={timezone} />

        <section className="dcb-card dcb-piel__enlace">
          <p className="dcb-piel__enlace-titulo">{labels.linkTitle}</p>
          <p className="dcb-sub" style={{ margin: "2px 0 12px" }}>
            {labels.linkBody}
          </p>
          <div className="dcb-piel__enlace-botones">
            <a className="dcb-btn dcb-btn--primary" href={link} referrerPolicy="no-referrer">
              {labels.linkOpen}
            </a>
            <button type="button" className="dcb-btn dcb-btn--ghost" onClick={() => void copiar()}>
              {copiado ? labels.linkCopied : labels.linkCopy}
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── «No encontramos ese número» ──────────────────────────────────────
  if (fase === "no") {
    return (
      <section className="dcb-card" style={{ marginTop: 18 }} aria-live="polite">
        <h1 className="dcb-title" style={{ marginTop: 0 }}>
          {labels.notFoundTitle}
        </h1>
        <p className="dcb-sub">{labels.notFoundBody}</p>
        {salidas}
        <p style={{ margin: "14px 0 0", textAlign: "center" }}>
          <button
            type="button"
            className="dcb-link"
            onClick={() => {
              setFase("pedir");
              setError(null);
            }}
          >
            {labels.tryAgain}
          </button>
        </p>
      </section>
    );
  }

  // ── El teléfono ──────────────────────────────────────────────────────
  return (
    <section className="dcb-card" style={{ marginTop: 18 }}>
      <h1 className="dcb-title" style={{ marginTop: 0 }}>
        {labels.title}
      </h1>
      <p className="dcb-sub">{labels.sub}</p>

      {error ? (
        <p className="dcb-alert dcb-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void buscar({ iso, phone }, recordar);
        }}
      >
        <div className="dcb-field">
          <label className="dcb-label" htmlFor="dcb-mi-tarjeta-tel">
            {labels.phone}
          </label>
          <TelefonoConPais
            iso={iso}
            onIsoChange={(v) => {
              setIso(v);
              setError(null);
            }}
            value={phone}
            onValueChange={(v) => {
              setPhone(v);
              // El aviso se va en cuanto corrige: no se queda rojo con el número ya bien.
              setError(null);
            }}
            selectClassName="dcb-input"
            inputClassName="dcb-input"
            countryLabel={labels.country}
            placeholderMx={labels.placeholderMx}
            placeholderOther={labels.placeholderOther}
            inputId="dcb-mi-tarjeta-tel"
          />
        </div>

        <label className="dcb-piel__recordar">
          <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
          <span>{labels.remember}</span>
        </label>

        {/* Campo trampa: invisible para una persona, irresistible para un bot. */}
        <div className="dcb-honey" aria-hidden="true">
          <label>
            Sitio web
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <button type="submit" className="dcb-btn dcb-btn--primary" disabled={busy}>
          {busy ? (
            <>
              <span className="dcb-spin" aria-hidden="true" />
              {labels.sending}
            </>
          ) : (
            <>
              <Star size={16} aria-hidden="true" />
              {labels.send}
            </>
          )}
        </button>
      </form>

      <BarberCaptcha
        ref={captcha}
        siteKey={captchaSiteKey}
        action={BARBER_CAPTCHA_ACTIONS.starsCard}
        locale={locale}
        labels={{ error: labels.captchaError, retry: labels.captchaRetry }}
        fallback={salidas}
      />
    </section>
  );
}

function leerRecordado(slug: string): NumeroRecordado | null {
  try {
    return leerNumeroRecordado(window.localStorage.getItem(claveNumeroRecordado(slug)));
  } catch {
    return null;
  }
}

function escribirRecordado(slug: string, n: NumeroRecordado | null) {
  try {
    if (n) window.localStorage.setItem(claveNumeroRecordado(slug), serializarNumeroRecordado(n));
    else window.localStorage.removeItem(claveNumeroRecordado(slug));
  } catch {
    /* modo privado: no se recuerda, y no pasa nada */
  }
}
