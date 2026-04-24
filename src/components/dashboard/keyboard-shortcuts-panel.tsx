"use client";
import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface ShortcutRow {
  keys: string[];
  label: string;
}

interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: "General",
    rows: [
      { keys: ["⌘", "K"], label: "Abrir búsqueda / comandos" },
      { keys: ["?"], label: "Abrir esta ventana de atajos" },
      { keys: ["esc"], label: "Cerrar modal / panel" },
    ],
  },
  {
    title: "Ir a…",
    rows: [
      { keys: ["G", "H"], label: "Hoy (home)" },
      { keys: ["G", "A"], label: "Agenda" },
      { keys: ["G", "P"], label: "Pacientes" },
      { keys: ["G", "M"], label: "Mensajes" },
      { keys: ["G", "F"], label: "Facturación" },
      { keys: ["G", "E"], label: "Expedientes" },
      { keys: ["G", "R"], label: "Radiografías" },
      { keys: ["G", "I"], label: "IA asistente" },
      { keys: ["G", "S"], label: "Configuración" },
    ],
  },
  {
    title: "Crear",
    rows: [
      { keys: ["C"], label: "Nueva cita" },
      { keys: ["N"], label: "Nuevo paciente" },
      { keys: ["I"], label: "Nueva factura" },
      { keys: ["S"], label: "Nota SOAP del paciente activo" },
    ],
  },
  {
    title: "Sistema",
    rows: [
      { keys: ["T"], label: "Alternar tema claro / oscuro" },
    ],
  },
];

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsPanel({ open, onOpenChange }: KeyboardShortcutsPanelProps) {
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
          className="fixed inset-0 z-50"
          style={{
            background: "rgba(5,5,10,0.72)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        />
        <Dialog.Content
          aria-labelledby="shortcuts-title"
          className="fixed z-50"
          style={{
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
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              padding: "18px 22px 14px",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <div>
              <Dialog.Title
                id="shortcuts-title"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  margin: 0,
                }}
              >
                Atajos de teclado
              </Dialog.Title>
              <Dialog.Description
                style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}
              >
                Acelera tu trabajo sin tocar el mouse.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Cerrar"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                color: "var(--text-2)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <X size={14} />
            </Dialog.Close>
          </header>

          <div
            style={{ flex: 1, overflowY: "auto", padding: "8px 22px 20px" }}
            className="scrollbar-thin"
          >
            {SECTIONS.map((sec) => (
              <section key={sec.title} style={{ marginTop: 16 }}>
                <h3
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-2)",
                    margin: "0 0 8px 0",
                    fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  }}
                >
                  {sec.title}
                </h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {sec.rows.map((row, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 0",
                        borderBottom:
                          i < sec.rows.length - 1 ? "1px solid var(--border-soft)" : "none",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "var(--text-1)" }}>{row.label}</span>
                      <span style={{ display: "inline-flex", gap: 4, flexShrink: 0, marginLeft: 12 }}>
                        {row.keys.map((k, j) => (
                          <kbd
                            key={j}
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              minWidth: 20,
                              textAlign: "center",
                              borderRadius: 6,
                              background: "var(--bg-elev-2)",
                              border: "1px solid var(--border-soft)",
                              color: "var(--text-2)",
                              fontFamily: "var(--font-jetbrains-mono, monospace)",
                              fontWeight: 500,
                              display: "inline-block",
                            }}
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
              style={{
                fontSize: 11,
                color: "var(--text-2)",
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px solid var(--border-soft)",
                lineHeight: 1.6,
              }}
            >
              Los atajos de una sola letra (C, N, I, T, S) solo funcionan cuando no
              estás escribiendo en un campo. <InlineKbd>⌘</InlineKbd> equivale a{" "}
              <InlineKbd>Ctrl</InlineKbd> en Windows.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InlineKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "var(--font-jetbrains-mono, monospace)",
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
