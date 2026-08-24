"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Btn } from "../team/admin-ui";
import { useWaT } from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// Botón "Conectar mi WhatsApp" con el Embedded Signup de Meta.
//
// Es el MISMO patrón que el dental ya tiene aprobado por Meta
// (src/app/dashboard/whatsapp/embedded-signup-button.tsx), copiado y no
// importado: aquel archivo es del producto que está vivo en producción y no
// se toca. Lo único que comparten es el App ID (la app de Meta es la misma);
// el config_id del flujo es PROPIO del vertical barber.
//
// COEXISTENCE: featureType "whatsapp_business_app_onboarding" conecta el
// número que el dueño YA usa en la app de WhatsApp Business de su celular y
// se lo deja ahí. Es lo que espera cualquier barbería: no perder su número.
//
// Sin NEXT_PUBLIC_META_APP_ID / NEXT_PUBLIC_BARBER_WHATSAPP_ES_CONFIG_ID el
// botón no se pinta y la pantalla explica que falta configurarlo.
// ═══════════════════════════════════════════════════════════════════════

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_BARBER_WHATSAPP_ES_CONFIG_ID;

export function BarberEmbeddedSignupButton({
  label,
  onDone,
  onError,
}: {
  label?: string;
  onDone: (result: { displayName: string | null; verified: boolean }) => void;
  onError: (message: string) => void;
}) {
  const t = useWaT();
  const [sdkReady, setSdkReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const session = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // Datos del WABA/número que emite el popup del Embedded Signup.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (typeof ev.origin !== "string" || !ev.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        // Coexistence emite FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING; el flujo
        // clásico emite FINISH — se aceptan los dos.
        if (
          data?.type === "WA_EMBEDDED_SIGNUP" &&
          typeof data?.event === "string" &&
          data.event.startsWith("FINISH")
        ) {
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

  // El SDK de Meta se carga una sola vez y es compartido con el dental (mismo
  // id de script): si ya está, no se vuelve a inyectar.
  useEffect(() => {
    if (!APP_ID) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
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
    if (!window.FB || !CONFIG_ID) {
      onError(t("connection.unavailable"));
      return;
    }
    setLoading(true);
    session.current = {};
    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        const { wabaId, phoneNumberId } = session.current;
        if (!code || !wabaId || !phoneNumberId) {
          setLoading(false);
          onError(t("errors.generic"));
          return;
        }
        fetch("/api/barber/whatsapp/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, wabaId, phoneNumberId }),
        })
          .then(async (r) => {
            const d = await r.json().catch(() => null);
            if (!r.ok || !d?.ok) throw new Error(d?.error ?? t("errors.generic"));
            return d;
          })
          .then((d) => onDone({ displayName: d.displayName ?? null, verified: d.verified === true }))
          .catch((e: Error) => onError(e.message))
          .finally(() => setLoading(false));
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  if (!APP_ID || !CONFIG_ID) return null;

  return (
    <Btn variant="primary" onClick={connect} disabled={!sdkReady || loading}>
      <MessageCircle size={15} />
      {loading ? t("connection.connecting") : (label ?? t("connection.connect"))}
    </Btn>
  );
}

/** ¿Se puede pintar el botón en este despliegue? */
export const embeddedSignupConfigured = Boolean(APP_ID && CONFIG_ID);
