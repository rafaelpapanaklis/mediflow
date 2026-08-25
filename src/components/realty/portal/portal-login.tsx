"use client";

import { useMemo, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   Entrada al portal: WhatsApp + código de un solo uso. SIN contraseña.

   🔴 ESTA PANTALLA NUNCA SABE SI EL TELÉFONO EXISTE. El servidor contesta
   exactamente lo mismo en los dos casos, así que la pantalla SIEMPRE
   avanza a "escribe tu código". Es a propósito: es lo que impide usar el
   portal como directorio para averiguar quién le renta a quién.

   Un teléfono mal escrito sí se avisa (400): eso no revela membresía, y
   sin el aviso la persona se queda esperando un código que nunca pidió
   bien.
   ═══════════════════════════════════════════════════════════════════════ */

export function PortalLogin({
  telInicial,
  codeTtlMin,
}: {
  /** Prellenado desde la liga de WhatsApp (?tel=...). Nunca es un secreto. */
  telInicial: string;
  codeTtlMin: number;
}) {
  const t = useMemo(() => portalT(), []);

  const [fase, setFase] = useState<"telefono" | "codigo">("telefono");
  const [telefono, setTelefono] = useState(telInicial);
  const [codigo, setCodigo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const codigoRef = useRef<HTMLInputElement | null>(null);

  const pedirCodigo = async (reenvio = false) => {
    setError(null);
    setAviso(null);
    if (telefono.replace(/\D/g, "").length < 10) {
      setError(t("login.telefonoInvalido"));
      return;
    }
    setOcupado(true);
    try {
      const res = await fetch("/api/realty/portal/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: telefono }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? t("login.generico"));
        return;
      }
      setAviso(data?.message ?? null);
      setFase("codigo");
      setCodigo("");
      if (!reenvio) window.setTimeout(() => codigoRef.current?.focus(), 60);
    } catch {
      setError(t("login.sinRed"));
    } finally {
      setOcupado(false);
    }
  };

  const entrar = async () => {
    setError(null);
    if (codigo.replace(/\D/g, "").length !== 6) {
      setError(t("login.invalido"));
      return;
    }
    setOcupado(true);
    try {
      const res = await fetch("/api/realty/portal/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: telefono, code: codigo }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; next?: string; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.next) {
        setError(data?.error ?? t("login.invalido"));
        setCodigo("");
        return;
      }
      // La sesión vive en una cookie httpOnly: solo el servidor la lee, así
      // que se navega DURO para que la siguiente pantalla se pinte ya
      // identificada y sin un parpadeo de "cargando".
      window.location.href = data.next;
    } catch {
      setError(t("login.sinRed"));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="dcr-card">
      <h1 className="dcr-h1" style={{ marginTop: 0 }}>
        {fase === "telefono" ? t("login.title") : t("login.codigoTitle")}
      </h1>
      <p className="dcr-sub">
        {fase === "telefono" ? t("login.sub") : t("login.codigoSub", { min: codeTtlMin })}
      </p>

      {error ? (
        <p className="dcr-alert dcr-alert--error" role="alert">
          {error}
        </p>
      ) : null}
      {aviso && fase === "codigo" ? <p className="dcr-alert dcr-alert--info">{aviso}</p> : null}

      {fase === "telefono" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void pedirCodigo();
          }}
        >
          <label className="dcr-field">
            <span className="dcr-label">{t("login.telefono")}</span>
            <input
              className="dcr-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              enterKeyHint="send"
              maxLength={20}
              placeholder={t("login.telefonoPlaceholder")}
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="dcr-btn dcr-btn--primary dcr-btn--block" disabled={ocupado}>
            {ocupado ? (
              <>
                <span className="dcr-spin" aria-hidden="true" />
                {t("login.enviando")}
              </>
            ) : (
              <>
                <MessageCircle size={17} aria-hidden="true" />
                {t("login.pedirCodigo")}
              </>
            )}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void entrar();
          }}
        >
          <label className="dcr-field">
            <span className="dcr-sr">{t("login.codigo")}</span>
            <input
              ref={codigoRef}
              className="dcr-input dcr-code"
              type="text"
              inputMode="numeric"
              /* one-time-code: iOS y Android ofrecen el código del mensaje
                 sin que la persona tenga que cambiar de app y volver. */
              autoComplete="one-time-code"
              enterKeyHint="go"
              maxLength={6}
              placeholder="······"
              aria-label={t("login.codigo")}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </label>
          <button type="submit" className="dcr-btn dcr-btn--primary dcr-btn--block" disabled={ocupado}>
            {ocupado ? (
              <>
                <span className="dcr-spin" aria-hidden="true" />
                {t("login.entrando")}
              </>
            ) : (
              t("login.entrar")
            )}
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="dcr-link"
              onClick={() => void pedirCodigo(true)}
              disabled={ocupado}
            >
              {t("login.reenviar")}
            </button>
            <button
              type="button"
              className="dcr-link"
              onClick={() => {
                setFase("telefono");
                setCodigo("");
                setError(null);
                setAviso(null);
              }}
            >
              {t("login.cambiarNumero")}
            </button>
          </div>
        </form>
      )}

      <p className="dcr-alert dcr-alert--note" style={{ margin: "16px 0 0" }}>
        {t("login.pie")}
      </p>
    </section>
  );
}
