"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Btn } from "../team/admin-ui";
import { useWaT } from "./ui";
import {
  barberSignupFailureText,
  barberSignupWarnLine,
  decideBarberSignupStep,
  readBarberSignupMessage,
  type BarberSignupSession,
} from "@/lib/barber/wa-signup-core";

/**
 * A veces Meta entrega el evento FINISH (con la cuenta y el número) un poco
 * DESPUÉS de la respuesta de FB.login. Se le espera este rato antes de
 * mandar el código sin ellos (el servidor los buscaría igual).
 */
const FINISH_GRACE_MS = 1500;

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
  const session = useRef<BarberSignupSession>({});

  // Lo que avisa la ventana de Meta: FINISH (cuenta y número), CANCEL (en qué
  // paso se cerró) o ERROR. La lectura es pura (wa-signup-core.ts).
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (typeof ev.origin !== "string" || !ev.origin.endsWith("facebook.com")) return;
      const next = readBarberSignupMessage(session.current, ev.data);
      if (next) session.current = next;
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
        void finish(response?.authResponse?.code);
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

  /** Texto para la barbería: el de la llave, o el que mandó el servidor. */
  function failText(r: ReturnType<typeof barberSignupFailureText>): string {
    return "key" in r ? t(`signup.${r.key}`) : r.message;
  }

  async function finish(code: unknown) {
    try {
      // Hay código pero aún no el número: se le da un momento al FINISH.
      if (typeof code === "string" && (!session.current.wabaId || !session.current.phoneNumberId)) {
        const until = Date.now() + FINISH_GRACE_MS;
        while (Date.now() < until && (!session.current.wabaId || !session.current.phoneNumberId)) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const s = session.current;
      const step = decideBarberSignupStep(code, s);
      // Qué faltó, para quien revise la consola. Sin código, token ni ids.
      const warn = barberSignupWarnLine(step, s);
      if (warn) console.warn(warn);
      if (step.kind === "canceled") {
        onError(failText(barberSignupFailureText({ step })));
        return;
      }

      let res: Response;
      try {
        res = await fetch("/api/barber/whatsapp/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Sin cuenta o número, el servidor los busca con el token.
          body: JSON.stringify({ code, wabaId: s.wabaId ?? null, phoneNumberId: s.phoneNumberId ?? null }),
        });
      } catch {
        console.warn("[barber/whatsapp] Conectar WhatsApp: no hubo respuesta del servidor (red)");
        onError(failText(barberSignupFailureText({ network: true })));
        return;
      }
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        console.warn(
          `[barber/whatsapp] Conectar WhatsApp: el servidor respondió ${res.status}${d?.code ? ` (${d.code})` : ""}`,
        );
        onError(failText(barberSignupFailureText({ status: res.status, body: d })));
        return;
      }
      onDone({ displayName: d.displayName ?? null, verified: d.verified === true });
    } finally {
      setLoading(false);
    }
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
