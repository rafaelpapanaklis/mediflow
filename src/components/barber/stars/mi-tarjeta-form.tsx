"use client";

import { useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { BarberCaptcha, type BarberCaptchaHandle } from "@/components/barber/captcha/barber-captcha";
import { TelefonoConPais } from "@/components/barber/telefono-con-pais";
import { BARBER_CAPTCHA_ACTIONS } from "@/lib/barber/captcha-core";
import { panelPhone } from "@/lib/barber/telefono-panel";

/* ═══════════════════════════════════════════════════════════════════════
   «Mi tarjeta» — el formulario del teléfono (ws6-t2).

   Este componente NUNCA sabe si el teléfono es de un cliente: el servidor
   contesta lo mismo en los dos casos y la pantalla siempre dice «si tu
   número está registrado, te llegó». La tarjeta no se pinta aquí jamás.

   Los textos llegan ya resueltos desde la página (servidor): así el
   diccionario entero del vertical no viaja en el paquete de esta pantalla.
   ═══════════════════════════════════════════════════════════════════════ */

export interface MiTarjetaLabels {
  title: string;
  sub: string;
  why: string;
  phone: string;
  country: string;
  placeholderMx: string;
  placeholderOther: string;
  send: string;
  sending: string;
  sentTitle: string;
  sent: string;
  sentHint: string;
  again: string;
  errorPhone: string;
  errorGeneric: string;
  errorNetwork: string;
  errorTooMany: string;
  captchaError: string;
  captchaRetry: string;
}

export function MiTarjetaForm({
  slug,
  locale,
  labels,
  captchaSiteKey = null,
  sinWhatsApp,
}: {
  slug: string;
  locale: string;
  labels: MiTarjetaLabels;
  /** Llave del SITIO de Turnstile (servidor). null = sin captcha. */
  captchaSiteKey?: string | null;
  /** Lo que se enseña si el servidor contesta que hoy no puede mandarla. */
  sinWhatsApp: React.ReactNode;
}) {
  const captcha = useRef<BarberCaptchaHandle>(null);
  const [iso, setIso] = useState("MX");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fase, setFase] = useState<"pedir" | "enviada" | "barberia">("pedir");

  const submit = async () => {
    setError(null);
    if (!panelPhone(iso, phone).ok) {
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
        body: JSON.stringify({ iso, phone, captchaToken, website }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; canal?: string; error?: string } | null;
      if (res.status === 429) {
        setError(labels.errorTooMany);
        return;
      }
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? labels.errorGeneric);
        return;
      }
      setFase(data.canal === "barberia" ? "barberia" : "enviada");
    } catch {
      setError(labels.errorNetwork);
    } finally {
      // Token de un solo uso: otro intento necesita uno nuevo.
      if (sentToken) captcha.current?.reset();
      setBusy(false);
    }
  };

  if (fase === "barberia") return <>{sinWhatsApp}</>;

  if (fase === "enviada") {
    return (
      <section className="dcb-card" style={{ marginTop: 18 }} aria-live="polite">
        <h1 className="dcb-title" style={{ marginTop: 0 }}>
          {labels.sentTitle}
        </h1>
        <p className="dcb-alert dcb-alert--info" role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <MessageCircle size={18} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
          <span>{labels.sent}</span>
        </p>
        <p className="dcb-sub">{labels.sentHint}</p>
        <button
          type="button"
          className="dcb-link"
          onClick={() => {
            setFase("pedir");
            setPhone("");
            setError(null);
          }}
        >
          {labels.again}
        </button>
      </section>
    );
  }

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
          void submit();
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
              <MessageCircle size={16} aria-hidden="true" />
              {labels.send}
            </>
          )}
        </button>
        <p className="dcb-sub" style={{ textAlign: "center", margin: "10px 0 0", fontSize: 13 }}>
          {labels.why}
        </p>
      </form>

      <BarberCaptcha
        ref={captcha}
        siteKey={captchaSiteKey}
        action={BARBER_CAPTCHA_ACTIONS.starsCard}
        locale={locale}
        labels={{ error: labels.captchaError, retry: labels.captchaRetry }}
        fallback={sinWhatsApp}
      />
    </section>
  );
}
