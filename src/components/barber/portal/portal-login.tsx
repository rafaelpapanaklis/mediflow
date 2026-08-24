"use client";

import { useMemo, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type { PortalShopDTO } from "@/lib/barber/client-portal";

/* ═══════════════════════════════════════════════════════════════════════
   Entrada al portal: teléfono + código de un solo uso. SIN contraseña.

   Este componente NUNCA sabe si el teléfono existe: el servidor contesta
   exactamente lo mismo en los dos casos, así que la pantalla siempre avanza
   a "escribe tu código". Es a propósito — es lo que impide usar el portal
   como directorio para averiguar quién es cliente de la barbería.
   ═══════════════════════════════════════════════════════════════════════ */

export function PortalLogin({
  slug,
  shop,
  codeTtlMin,
}: {
  slug: string;
  shop: PortalShopDTO;
  codeTtlMin: number;
}) {
  const t = useMemo(() => getBarberT(shop.locale), [shop.locale]);

  const [phase, setPhase] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  const askCode = async (resend = false) => {
    setError(null);
    setNotice(null);
    if (phone.replace(/\D/g, "").length < 10) {
      setError(t("barber.reserva.errores.telefonoInvalido"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/barber/portal/${slug}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? t("barber.reserva.errores.generico"));
        return;
      }
      setNotice(data?.message ?? null);
      setPhase("code");
      setCode("");
      if (!resend) window.setTimeout(() => codeRef.current?.focus(), 60);
    } catch {
      setError(t("barber.reserva.errores.sinRed"));
    } finally {
      setBusy(false);
    }
  };

  const enter = async () => {
    setError(null);
    if (code.replace(/\D/g, "").length !== 6) {
      setError(t("barber.reserva.portal.login.invalido"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/barber/portal/${slug}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? t("barber.reserva.portal.login.invalido"));
        setCode("");
        return;
      }
      // La sesión vive en una cookie httpOnly: solo el servidor puede leerla,
      // así que se recarga para que la página se pinte ya identificada.
      window.location.reload();
    } catch {
      setError(t("barber.reserva.errores.sinRed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dcb-card" style={{ marginTop: 18 }}>
      <h1 className="dcb-title" style={{ marginTop: 0 }}>
        {phase === "phone"
          ? t("barber.reserva.portal.login.title")
          : t("barber.reserva.portal.login.codigoTitle")}
      </h1>
      <p className="dcb-sub">
        {phase === "phone"
          ? t("barber.reserva.portal.login.sub")
          : t("barber.reserva.portal.login.codigoSub", { min: codeTtlMin })}
      </p>

      {error ? (
        <p className="dcb-alert dcb-alert--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice && phase === "code" ? <p className="dcb-alert dcb-alert--info">{notice}</p> : null}

      {phase === "phone" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void askCode();
          }}
        >
          <label className="dcb-field">
            <span className="dcb-label">{t("barber.reserva.portal.login.telefono")}</span>
            <input
              className="dcb-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              enterKeyHint="send"
              maxLength={20}
              placeholder={t("barber.reserva.portal.login.telefonoPlaceholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="dcb-btn dcb-btn--primary" disabled={busy}>
            {busy ? (
              <>
                <span className="dcb-spin" aria-hidden="true" />
                {t("barber.reserva.portal.login.enviando")}
              </>
            ) : (
              <>
                <MessageCircle size={16} />
                {t("barber.reserva.portal.login.pedirCodigo")}
              </>
            )}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enter();
          }}
        >
          <label className="dcb-field">
            <span className="dcb-sr">{t("barber.reserva.portal.login.codigo")}</span>
            <input
              ref={codeRef}
              className="dcb-input dcb-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="go"
              maxLength={6}
              placeholder="······"
              aria-label={t("barber.reserva.portal.login.codigo")}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </label>
          <button type="submit" className="dcb-btn dcb-btn--primary" disabled={busy}>
            {busy ? (
              <>
                <span className="dcb-spin" aria-hidden="true" />
                {t("barber.reserva.portal.login.entrando")}
              </>
            ) : (
              t("barber.reserva.portal.login.entrar")
            )}
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <button type="button" className="dcb-link" onClick={() => void askCode(true)} disabled={busy}>
              {t("barber.reserva.portal.login.reenviar")}
            </button>
            <button
              type="button"
              className="dcb-link"
              onClick={() => {
                setPhase("phone");
                setCode("");
                setError(null);
                setNotice(null);
              }}
            >
              {t("barber.reserva.portal.login.cambiarNumero")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
