"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";

/**
 * ConfirmDialog — modal accesible reutilizable que reemplaza
 * `window.confirm()` nativo del navegador. Usa Radix Dialog: focus
 * trap, Esc, click outside, portal, ARIA correcto out of the box.
 *
 * El componente vive como un singleton montado a nivel root via
 * <ConfirmProvider>. Cualquier componente del árbol llama
 * `useConfirm()` y obtiene una función que devuelve `Promise<boolean>`.
 *
 * Soporta opción `withReason` para mostrar un textarea opcional
 * (ej. "Cancelar cita con motivo"); en ese caso resuelve a un
 * objeto `{ confirmed, reason }` en vez de boolean.
 */

export type ConfirmVariant = "default" | "danger" | "warning";

export interface ConfirmOptions {
  title?: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  /** Si true, muestra textarea opcional dentro del modal. */
  withReason?: boolean;
  /** Placeholder del textarea cuando withReason=true. */
  reasonPlaceholder?: string;
  /** Label del textarea cuando withReason=true. */
  reasonLabel?: string;
}

export interface ConfirmResultWithReason {
  confirmed: boolean;
  reason?: string;
}

interface ConfirmContextValue {
  /** Sin reason: devuelve boolean. Con withReason=true: devuelve objeto. */
  confirm: (opts?: ConfirmOptions) => Promise<boolean>;
  confirmWithReason: (opts?: ConfirmOptions) => Promise<ConfirmResultWithReason>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (result: ConfirmResultWithReason) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [reason, setReason] = useState("");
  const resolverRef = useRef<((r: ConfirmResultWithReason) => void) | null>(null);

  const open = useCallback((options: ConfirmOptions) => {
    return new Promise<ConfirmResultWithReason>((resolve) => {
      resolverRef.current = resolve;
      setReason("");
      setPending({ options, resolve });
    });
  }, []);

  const confirm = useCallback(
    async (opts: ConfirmOptions = {}) => {
      const r = await open(opts);
      return r.confirmed;
    },
    [open],
  );

  const confirmWithReason = useCallback(
    async (opts: ConfirmOptions = {}) => {
      return open({ ...opts, withReason: true });
    },
    [open],
  );

  const handleResult = useCallback(
    (confirmed: boolean) => {
      const r = resolverRef.current;
      if (r) {
        r({ confirmed, reason: confirmed && reason ? reason : undefined });
      }
      resolverRef.current = null;
      setPending(null);
      setReason("");
    },
    [reason],
  );

  // Esc / backdrop / X cierran como "cancelado".
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) handleResult(false);
    },
    [handleResult],
  );

  const opts = pending?.options ?? {};
  const variant: ConfirmVariant = opts.variant ?? "default";
  const tone = resolveTone(variant);

  return (
    <ConfirmContext.Provider value={{ confirm, confirmWithReason }}>
      {children}
      <Dialog.Root open={pending !== null} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(5,5,10,0.72)",
              WebkitBackdropFilter: "blur(6px)",
              backdropFilter: "blur(6px)",
              zIndex: 200,
              animation: "mfConfirmFade 0.18s ease-out",
            }}
          />
          <Dialog.Content
            role="alertdialog"
            aria-labelledby="mf-confirm-title"
            aria-describedby={opts.description ? "mf-confirm-desc" : undefined}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "calc(100vw - 32px)",
              maxWidth: 420,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-strong)",
              borderRadius: 14,
              boxShadow: "0 24px 60px -12px rgba(0,0,0,0.5)",
              zIndex: 201,
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              animation: "mfConfirmSlide 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "20px 22px 14px",
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: tone.iconBg,
                  border: `1px solid ${tone.iconBorder}`,
                  display: "grid",
                  placeItems: "center",
                  color: tone.iconColor,
                  flexShrink: 0,
                }}
              >
                <tone.Icon size={20} aria-hidden />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Dialog.Title
                  id="mf-confirm-title"
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text-1)",
                    margin: "2px 0 6px",
                    lineHeight: 1.35,
                  }}
                >
                  {opts.title ?? "¿Estás seguro?"}
                </Dialog.Title>
                {opts.description && (
                  <Dialog.Description
                    id="mf-confirm-desc"
                    style={{
                      fontSize: 13,
                      color: "var(--text-2)",
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {opts.description}
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Cerrar"
                  style={{
                    width: 28,
                    height: 28,
                    display: "grid",
                    placeItems: "center",
                    background: "transparent",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 7,
                    color: "var(--text-3)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <X size={13} aria-hidden />
                </button>
              </Dialog.Close>
            </div>

            {opts.withReason && (
              <div style={{ padding: "0 22px 8px" }}>
                <label
                  htmlFor="mf-confirm-reason"
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 6,
                  }}
                >
                  {opts.reasonLabel ?? "Motivo (opcional)"}
                </label>
                <textarea
                  id="mf-confirm-reason"
                  className="input-new"
                  placeholder={opts.reasonPlaceholder ?? "Agrega una nota…"}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  style={{ width: "100%", resize: "vertical", minHeight: 64 }}
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "14px 22px 18px",
                borderTop: "1px solid var(--border-soft)",
                marginTop: opts.withReason ? 6 : 8,
                background: "var(--bg-elev-2)",
                borderRadius: "0 0 14px 14px",
              }}
            >
              <button
                type="button"
                onClick={() => handleResult(false)}
                style={{
                  padding: "8px 14px",
                  background: "transparent",
                  color: "var(--text-2)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {opts.cancelText ?? "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => handleResult(true)}
                autoFocus
                style={{
                  padding: "8px 16px",
                  background: tone.confirmBg,
                  color: "#fff",
                  border: `1px solid ${tone.confirmBg}`,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: `0 6px 16px -6px ${tone.confirmShadow}`,
                }}
              >
                {opts.confirmText ?? defaultConfirmText(variant)}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {/* Animations — keyframes inline para no requerir CSS module. */}
      <style jsx global>{`
        @keyframes mfConfirmFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes mfConfirmSlide {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </ConfirmContext.Provider>
  );
}

function defaultConfirmText(variant: ConfirmVariant): string {
  if (variant === "danger") return "Eliminar";
  if (variant === "warning") return "Continuar";
  return "Confirmar";
}

function resolveTone(variant: ConfirmVariant) {
  if (variant === "danger") {
    return {
      Icon: AlertCircle,
      iconBg: "rgba(220, 38, 38, 0.10)",
      iconBorder: "rgba(220, 38, 38, 0.25)",
      iconColor: "#dc2626",
      confirmBg: "#dc2626",
      confirmShadow: "rgba(220, 38, 38, 0.45)",
    };
  }
  if (variant === "warning") {
    return {
      Icon: AlertTriangle,
      iconBg: "rgba(217, 119, 6, 0.10)",
      iconBorder: "rgba(217, 119, 6, 0.25)",
      iconColor: "#d97706",
      confirmBg: "#d97706",
      confirmShadow: "rgba(217, 119, 6, 0.45)",
    };
  }
  return {
    Icon: Info,
    iconBg: "var(--brand-softer)",
    iconBorder: "rgba(124, 58, 237, 0.25)",
    iconColor: "var(--brand)",
    confirmBg: "#7c3aed",
    confirmShadow: "rgba(124, 58, 237, 0.45)",
  };
}

/**
 * Hook para abrir el ConfirmDialog desde cualquier componente.
 *
 * Uso:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "¿Eliminar?", variant: "danger" }))) return;
 *   await deleteItem();
 *
 * Con razón:
 *   const confirmWithReason = useConfirmWithReason();
 *   const r = await confirmWithReason({ title: "¿Cancelar cita?", withReason: true });
 *   if (!r.confirmed) return;
 *   await cancelAppointment(id, r.reason);
 */
export function useConfirm(): (opts?: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return ctx.confirm;
}

export function useConfirmWithReason(): (opts?: ConfirmOptions) => Promise<ConfirmResultWithReason> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirmWithReason must be used inside <ConfirmProvider>");
  }
  return ctx.confirmWithReason;
}
