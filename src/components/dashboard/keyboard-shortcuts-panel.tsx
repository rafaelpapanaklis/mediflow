"use client";
import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { vestidor, type AparienciaTopbar } from "@/components/dashboard/topbar-rediseno/apariencia";
import c from "@/components/dashboard/topbar-rediseno/piezas-topbar.module.css";

interface ShortcutRow {
  keys: string[];
  /** Translation key resolved via t() at render time. */
  labelKey: string;
}

interface ShortcutSection {
  /** Translation key resolved via t() at render time. */
  titleKey: string;
  rows: ShortcutRow[];
}

const SECTIONS: ShortcutSection[] = [
  {
    titleKey: "shell.shortcuts.secGeneral",
    rows: [
      { keys: ["⌘", "K"], labelKey: "shell.shortcuts.openSearch" },
      { keys: ["?"], labelKey: "shell.shortcuts.openThisPanel" },
      { keys: ["esc"], labelKey: "shell.shortcuts.closeModal" },
    ],
  },
  {
    titleKey: "shell.shortcuts.secGoTo",
    rows: [
      { keys: ["G", "H"], labelKey: "shell.shortcuts.goHome" },
      { keys: ["G", "A"], labelKey: "shell.shortcuts.goAgenda" },
      { keys: ["G", "P"], labelKey: "shell.shortcuts.goPatients" },
      { keys: ["G", "M"], labelKey: "shell.shortcuts.goMessages" },
      { keys: ["G", "F"], labelKey: "shell.shortcuts.goBilling" },
      { keys: ["G", "R"], labelKey: "shell.shortcuts.goXrays" },
      { keys: ["G", "I"], labelKey: "shell.shortcuts.goAiAssistant" },
      { keys: ["G", "S"], labelKey: "shell.shortcuts.goSettings" },
    ],
  },
  {
    titleKey: "shell.shortcuts.secCreate",
    rows: [
      { keys: ["C"], labelKey: "shell.shortcuts.newAppointment" },
      { keys: ["N"], labelKey: "shell.shortcuts.newPatient" },
      { keys: ["I"], labelKey: "shell.shortcuts.newInvoice" },
      { keys: ["S"], labelKey: "shell.shortcuts.soapNote" },
    ],
  },
  {
    titleKey: "shell.shortcuts.secSystem",
    rows: [
      { keys: ["T"], labelKey: "shell.shortcuts.toggleTheme" },
    ],
  },
];

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * La ropa (topbar-rediseno/apariencia.ts). Sin ella —la barra de siempre—
   * cada elemento recibe EXACTAMENTE los `style` de antes; con "nueva" —la
   * barra del menú de dos niveles— el portal monta CLASES_MENU y se pinta
   * con las clases del rediseño.
   */
  apariencia?: AparienciaTopbar;
}

export function KeyboardShortcutsPanel({ open, onOpenChange, apariencia }: KeyboardShortcutsPanelProps) {
  const t = useT();
  const nueva = apariencia === "nueva";
  const vestir = vestidor(apariencia);
  useEffect(() => {
    const isTypingContext = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const handler = (e: KeyboardEvent) => {
      if (isTypingContext()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  useEffect(() => {
    const openHandler = () => onOpenChange(true);
    window.addEventListener("mf:open-shortcuts-panel", openHandler);
    return () => window.removeEventListener("mf:open-shortcuts-panel", openHandler);
  }, [onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={nueva ? `fixed inset-0 z-50 ${c.velo}` : "fixed inset-0 z-50"}
          style={nueva ? undefined : {
            background: "rgba(5,5,10,0.72)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        />
        <Dialog.Content
          aria-labelledby="shortcuts-title"
          className={nueva ? `fixed z-50 ${CLASES_MENU} ${c.piel} ${c.dialogo}` : "fixed z-50"}
          style={nueva ? undefined : {
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(520px, 92vw)",
            maxHeight: "85vh",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            boxShadow: "0 24px 60px -12px rgba(0,0,0,0.4)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <header
            {...vestir({
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              padding: "18px 22px 14px",
              borderBottom: "1px solid var(--border-soft)",
            }, c.dialogoCabeza)}
          >
            <div {...vestir(undefined, c.dialogoTextos)}>
              <Dialog.Title
                id="shortcuts-title"
                {...vestir({
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  fontFamily: "var(--font-sans, system-ui, sans-serif)",
                  margin: 0,
                }, c.dialogoTitulo)}
              >
                {t("shell.shortcuts.title")}
              </Dialog.Title>
              <Dialog.Description
                {...vestir({ fontSize: 11, color: "var(--text-2)", marginTop: 4 }, c.dialogoSub)}
              >
                {t("shell.shortcuts.subtitle")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("common.close")}
              {...vestir({
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                color: "var(--text-2)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }, c.cerrar)}
            >
              <X size={14} />
            </Dialog.Close>
          </header>

          <div
            style={nueva ? undefined : { flex: 1, overflowY: "auto", padding: "8px 22px 20px" }}
            className={nueva ? `scrollbar-thin ${c.cuerpo}` : "scrollbar-thin"}
          >
            {SECTIONS.map((sec) => (
              <section key={sec.titleKey} {...vestir({ marginTop: 16 }, c.seccion)}>
                <h3
                  {...vestir({
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-2)",
                    margin: "0 0 8px 0",
                    fontFamily: "var(--font-sans, system-ui, sans-serif)",
                  }, c.seccionTitulo)}
                >
                  {t(sec.titleKey)}
                </h3>
                <ul {...vestir({ listStyle: "none", padding: 0, margin: 0 }, c.listaAtajos)}>
                  {sec.rows.map((row, i) => (
                    <li
                      key={i}
                      {...vestir({
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 0",
                        borderBottom:
                          i < sec.rows.length - 1 ? "1px solid var(--border-soft)" : "none",
                      }, c.atajo)}
                    >
                      <span {...vestir({ fontSize: 13, color: "var(--text-1)" }, c.atajoTexto)}>{t(row.labelKey)}</span>
                      <span {...vestir({ display: "inline-flex", gap: 4, flexShrink: 0, marginLeft: 12 }, c.teclas)}>
                        {row.keys.map((k, j) => (
                          <kbd
                            key={j}
                            {...vestir({
                              fontSize: 11,
                              padding: "2px 8px",
                              minWidth: 20,
                              textAlign: "center",
                              borderRadius: 6,
                              background: "var(--bg-elev-2)",
                              border: "1px solid var(--border-soft)",
                              color: "var(--text-2)",
                              fontFamily: "var(--font-mono, monospace)",
                              fontWeight: 500,
                              display: "inline-block",
                            }, c.kbd)}
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <p
              {...vestir({
                fontSize: 11,
                color: "var(--text-2)",
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px solid var(--border-soft)",
                lineHeight: 1.6,
              }, c.notaPie)}
            >
              {t("shell.shortcuts.footnoteLead")} <InlineKbd nueva={nueva}>⌘</InlineKbd>{" "}
              {t("shell.shortcuts.footnoteEquals")} <InlineKbd nueva={nueva}>Ctrl</InlineKbd>{" "}
              {t("shell.shortcuts.footnoteOnWindows")}
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InlineKbd({ children, nueva }: { children: React.ReactNode; nueva?: boolean }) {
  if (nueva) {
    return <kbd className={`${c.kbd} ${c.kbdChica}`}>{children}</kbd>;
  }
  return (
    <kbd
      style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 10,
        padding: "1px 5px",
        background: "var(--bg-hover)",
        borderRadius: 4,
        border: "1px solid var(--border-soft)",
        color: "var(--text-2)",
      }}
    >
      {children}
    </kbd>
  );
}
