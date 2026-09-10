import Link from "next/link";
import { AlertTriangle, CloudOff, Hourglass, Wallet, LogIn, RotateCcw } from "lucide-react";
import { SABINA_ERROR_COPY, type SabinaErrorKind } from "./sabina-core";
import styles from "./sabina-widgets.module.css";

const ICON_BY_KIND: Record<SabinaErrorKind, typeof AlertTriangle> = {
  auth: LogIn,
  no_balance: Wallet,
  rate_limited: Hourglass,
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
 */
export function SabinaErrorNotice({
  kind,
  retrying,
  onRetry,
}: {
  kind: SabinaErrorKind;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const copy = SABINA_ERROR_COPY[kind];
  const Icon = ICON_BY_KIND[kind];

  return (
    <div className={styles.errorNotice} data-kind={kind} role="status">
      <div className={styles.errorIcon}>
        <Icon size={16} aria-hidden />
      </div>
      <div className={styles.errorBody}>
        <div className={styles.errorTitle}>{copy.title}</div>
        <div className={styles.errorMessage}>{copy.message}</div>
        <div className={styles.errorActions}>
          {kind === "no_balance" && (
            <Link href="/dashboard/whatsapp/bot/saldo" className={styles.errorLink}>
              <Wallet size={12} aria-hidden /> Ir al monedero
            </Link>
          )}
          {copy.retryable && onRetry && (
            <button type="button" className={styles.errorRetryBtn} onClick={onRetry} disabled={retrying}>
              <RotateCcw size={12} aria-hidden className={retrying ? styles.spin : undefined} />
              {retrying ? "Reintentando…" : "Reintentar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
