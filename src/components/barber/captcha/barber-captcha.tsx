"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { RotateCw } from "lucide-react";
import { TURNSTILE_SCRIPT_URL, type BarberCaptchaAction } from "@/lib/barber/captcha-core";

/* ═══════════════════════════════════════════════════════════════════════
   El captcha de las puertas públicas de barber (Cloudflare Turnstile).

   Una sola pieza para la reserva, la fila virtual, el código de «mi cuenta»
   y el alta de barberías. Casi nunca se ve: con apariencia
   `interaction-only` Cloudflare decide solo y únicamente pinta una casilla
   cuando duda. Mientras tanto el formulario se llena como siempre.

   Sin `siteKey` (variables sin poner) no pinta NADA y `getToken()` contesta
   al instante con token null: el formulario funciona igual que antes.

   Uso:
     const captcha = useRef<BarberCaptchaHandle>(null);
     …
     const c = await captcha.current?.getToken();
     if (c && !c.ok) return;   // el aviso con «Reintentar» ya lo pinta el captcha
     fetch(…, { body: JSON.stringify({ …, captchaToken: c?.token ?? null }) });
     captcha.current?.reset();   // el token es de UN solo uso
     …
     <BarberCaptcha ref={captcha} siteKey={siteKey} action="barber-booking" locale="es"
                    labels={{ error: t("…captcha.error"), retry: t("…captcha.reintentar") }} />

   Los textos y las clases los pone cada formulario (cada uno tiene su
   diccionario y su estilo): esta pieza no arrastra diccionarios al bundle.
   ═══════════════════════════════════════════════════════════════════════ */

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  appearance?: "always" | "execute" | "interaction-only";
  language?: string;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "flexible" | "compact";
  retry?: "auto" | "never";
  "refresh-expired"?: "auto" | "manual" | "never";
  "response-field"?: boolean;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (code?: string) => boolean | void;
  "timeout-callback"?: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Cuánto espera el envío a que Cloudflare entregue el token. */
const TOKEN_WAIT_MS = 15_000;

// ── El script se carga UNA vez por página, aunque haya dos formularios. ──
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("sin navegador"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile no quedó cargado"));
    };
    script.onerror = () => reject(new Error("no se pudo cargar turnstile"));
    document.head.appendChild(script);
  }).catch((err) => {
    // Sin red o bloqueado: que el siguiente intento vuelva a probar.
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

export type BarberCaptchaResult = { ok: true; token: string | null } | { ok: false };

export interface BarberCaptchaHandle {
  /**
   * El token para mandar al servidor. Espera a Cloudflare hasta 15 s.
   * `{ ok: true, token: null }` = captcha apagado: se manda sin token.
   * `{ ok: false }` = no se pudo verificar (ya se ve el aviso con «Reintentar»).
   */
  getToken: () => Promise<BarberCaptchaResult>;
  /** Pide un token nuevo. Llamarlo después de CADA envío (son de un solo uso). */
  reset: () => void;
}

export interface BarberCaptchaProps {
  siteKey: string | null;
  action: BarberCaptchaAction;
  /** Idioma del widget de Cloudflare (es / en). */
  locale?: string | null;
  /** «No pudimos comprobar…» y «Reintentar», ya traducidos. */
  labels: { error: string; retry: string };
  className?: string;
  /** Clase del aviso de error (por defecto, la de la reserva pública). */
  textClassName?: string;
  /** Clase del botón «Reintentar» (por defecto, la de la reserva pública). */
  buttonClassName?: string;
  /** Estilo del botón, para formularios sin clases propias (el alta). */
  buttonStyle?: CSSProperties;
}

type Status = "off" | "loading" | "ready" | "error";

export const BarberCaptcha = forwardRef<BarberCaptchaHandle, BarberCaptchaProps>(function BarberCaptcha(
  { siteKey, action, locale, labels, className, textClassName, buttonClassName, buttonStyle },
  ref,
) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const waitersRef = useRef<Array<(token: string | null) => void>>([]);
  const [status, setStatus] = useState<Status>(siteKey ? "loading" : "off");
  // Cambiarlo vuelve a montar el widget desde cero (botón «Reintentar»).
  const [attempt, setAttempt] = useState(0);

  const settle = useCallback((token: string | null) => {
    tokenRef.current = token;
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const w of waiters) w(token);
  }, []);

  useEffect(() => {
    if (!siteKey) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    tokenRef.current = null;

    loadTurnstile()
      .then((api) => {
        if (cancelled || !boxRef.current) return;
        const id = api.render(boxRef.current, {
          sitekey: siteKey,
          action,
          appearance: "interaction-only",
          language: locale === "en" ? "en" : "es",
          theme: "auto",
          size: "flexible",
          retry: "auto",
          "refresh-expired": "auto",
          // Nada de <input> escondido dentro del formulario: el token viaja
          // en el JSON, como el resto de los campos.
          "response-field": false,
          callback: (token) => {
            if (cancelled) return;
            setStatus("ready");
            settle(token);
          },
          "expired-callback": () => {
            tokenRef.current = null;
          },
          "error-callback": () => {
            if (cancelled) return true;
            tokenRef.current = null;
            setStatus("error");
            settle(null);
            // true = lo atendimos nosotros (Cloudflare no lanza al aire).
            return true;
          },
          "timeout-callback": () => {
            tokenRef.current = null;
          },
        });
        widgetRef.current = id ?? null;
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        settle(null);
      });

    return () => {
      cancelled = true;
      const id = widgetRef.current;
      widgetRef.current = null;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          /* ya no estaba */
        }
      }
    };
  }, [siteKey, action, locale, attempt, settle]);

  const reset = useCallback(() => {
    tokenRef.current = null;
    const id = widgetRef.current;
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id);
        setStatus("loading");
        return;
      } catch {
        /* se vuelve a montar abajo */
      }
    }
    setAttempt((n) => n + 1);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reset,
      getToken: () => {
        if (!siteKey) return Promise.resolve({ ok: true, token: null } as BarberCaptchaResult);
        if (tokenRef.current) {
          return Promise.resolve({ ok: true, token: tokenRef.current } as BarberCaptchaResult);
        }
        // Falló antes: se intenta de nuevo ya, y se espera al resultado.
        if (status === "error") setAttempt((n) => n + 1);
        return new Promise<BarberCaptchaResult>((resolve) => {
          const timer = setTimeout(() => {
            waitersRef.current = waitersRef.current.filter((w) => w !== onToken);
            setStatus("error");
            resolve({ ok: false });
          }, TOKEN_WAIT_MS);
          const onToken = (token: string | null) => {
            clearTimeout(timer);
            resolve(token ? { ok: true, token } : { ok: false });
          };
          waitersRef.current.push(onToken);
        });
      },
    }),
    [reset, siteKey, status],
  );

  if (!siteKey) return null;

  return (
    <div className={className} style={{ margin: "4px 0 12px" }}>
      {/* Aquí pinta Cloudflare la casilla, SOLO cuando duda. */}
      <div ref={boxRef} />
      {status === "error" ? (
        <p
          className={textClassName ?? "dcb-help"}
          role="alert"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
        >
          <span>{labels.error}</span>
          <button
            type="button"
            className={buttonClassName ?? "dcb-btn dcb-btn--ghost dcb-btn--sm"}
            style={buttonStyle}
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCw size={14} aria-hidden="true" /> {labels.retry}
          </button>
        </p>
      ) : null}
    </div>
  );
});
