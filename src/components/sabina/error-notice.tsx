import Link from "next/link";
import { AlertTriangle, CloudOff, Hourglass, Wallet, LogIn, PowerOff, RotateCcw } from "lucide-react";
import { SABINA_ERROR_COPY, type SabinaErrorKind } from "./sabina-core";
import styles from "./sabina-widgets.module.css";

const ICON_BY_KIND: Record<SabinaErrorKind, typeof AlertTriangle> = {
  auth: LogIn,
  apagada: PowerOff,
  apagada_clinica: PowerOff,
  no_balance: Wallet,
  rate_limited: Hourglass,
  plan_limit: Hourglass,
  model_down: CloudOff,
  network: CloudOff,
  unknown: AlertTriangle,
};

/**
 * Estados de la regla "los que no se pueden olvidar" (402/429/503/auth/red).
 * ⚠️ "Sin permiso" NO tiene su propio kind: el contrato lo manda como texto
 * normal dentro de `respuesta` (CONTRATO.md, regla 3), así que se pinta como
 * un mensaje más de Sabina — este componente es solo para los fallos de la
 * PANTALLA, no para lo que Sabina decide contestar.
 *
 * `clases` (REDISEÑO, interruptor `menu-dos-niveles`): el juego de clases del
 * rediseño (`layout-rediseno/sabina.ts`). Sin él, las de siempre, tal cual.
 * Los textos salen de SABINA_ERROR_COPY en los dos casos: no cambia ninguno.
 */
export function SabinaErrorNotice({
  kind,
  retrying,
  onRetry,
  clases,
}: {
  kind: SabinaErrorKind;
  retrying?: boolean;
  onRetry?: () => void;
  clases?: Record<string, string>;
}) {
  const c: Record<string, string> = clases ?? styles;
  const copy = SABINA_ERROR_COPY[kind];
  const Icon = ICON_BY_KIND[kind];

  return (
    <div className={c.errorNotice} data-kind={kind} role="status">
      <div className={c.errorIcon}>
        <Icon size={16} aria-hidden />
      </div>
      <div className={c.errorBody}>
        <div className={c.errorTitle}>{copy.title}</div>
        <div className={c.errorMessage}>{copy.message}</div>
        <div className={c.errorActions}>
          {(kind === "no_balance" || kind === "apagada_clinica") && (
            <Link href="/dashboard/whatsapp/bot/saldo" className={c.errorLink}>
              <Wallet size={12} aria-hidden /> {kind === "no_balance" ? "Ir al monedero" : "Ir a Saldo de IA"}
            </Link>
          )}
          {copy.retryable && onRetry && (
            <button type="button" className={c.errorRetryBtn} onClick={onRetry} disabled={retrying}>
              <RotateCcw size={12} aria-hidden className={retrying ? c.spin : undefined} />
              {retrying ? "Reintentando…" : "Reintentar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
