"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MessageCircle } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const APP_ID    = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID;

/**
 * Botón "Conectar WhatsApp" con el Embedded Signup de Meta: la clínica entra
 * con su cuenta, elige/conecta su número en un popup (coexistence: conserva
 * el número en su celular) y queda conectada sin tocar la consola de
 * desarrollador. El `code` del popup se intercambia server-side en
 * /api/whatsapp/embedded/exchange.
 *
 * Si faltan NEXT_PUBLIC_META_APP_ID / NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID el
 * botón no se renderiza y queda el modo manual como única vía.
 */
export function EmbeddedSignupButton({ onConnected }: { onConnected?: () => void }) {
  const t = useT();
  const [sdkReady, setSdkReady] = useState(false);
  const [loading, setLoading]   = useState(false);
  const session = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // Captura los datos del WABA/número que emite el popup del Embedded Signup.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (typeof ev.origin !== "string" || !ev.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        // Coexistence emite FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING; el flujo
        // clásico emite FINISH — aceptamos ambos.
        if (data?.type === "WA_EMBEDDED_SIGNUP" && typeof data?.event === "string" && data.event.startsWith("FINISH")) {
          session.current = {
            wabaId: data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        }
      } catch {
        /* mensajes no-JSON del SDK: ignorar */
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Carga el SDK de Meta una sola vez.
  useEffect(() => {
    if (!APP_ID) return;
    if (window.FB) { setSdkReady(true); return; }
    window.fbAsyncInit = function () {
      window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v19.0" });
      setSdkReady(true);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const js = document.createElement("script");
      js.id = "facebook-jssdk";
      js.async = true;
      js.defer = true;
      js.crossOrigin = "anonymous";
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(js);
    }
  }, []);

  function connect() {
    if (!window.FB || !CONFIG_ID) { toast.error(t("inbox.whatsapp.esConfigMissing")); return; }
    setLoading(true);
    session.current = {};
    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        const { wabaId, phoneNumberId } = session.current;
        if (!code) { setLoading(false); toast.error(t("inbox.whatsapp.esCanceled")); return; }
        if (!wabaId || !phoneNumberId) {
          setLoading(false);
          toast.error(t("inbox.whatsapp.esNoNumber"));
          return;
        }
        fetch("/api/whatsapp/embedded/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, wabaId, phoneNumberId }),
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.error ?? t("inbox.whatsapp.esGenericError"));
            return d;
          })
          .then((d) => {
            toast.success(`${t("inbox.whatsapp.connectedToast")}${d.displayName ? ` — ${d.displayName}` : ""}`);
            onConnected?.();
          })
          .catch((e) => toast.error(e.message))
          .finally(() => setLoading(false));
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        // Coexistence: la clínica conecta su número EXISTENTE de la app de
        // WhatsApp Business y lo conserva en el celular. featureType
        // selecciona ese sub-flujo del Embedded Signup.
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  }

  if (!APP_ID || !CONFIG_ID) return null;

  return (
    <ButtonNew
      variant="primary"
      icon={<MessageCircle size={15} />}
      onClick={connect}
      disabled={!sdkReady || loading}
    >
      {loading ? t("inbox.whatsapp.esConnecting") : t("inbox.whatsapp.esConnectCta")}
    </ButtonNew>
  );
}
