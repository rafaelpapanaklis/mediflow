"use client";

// ═══════════════════════════════════════════════════════════════════════
// ChatLauncher — ícono flotante PERMANENTE (FAB) abajo-derecha, visible en
// todo el dashboard. Al clic abre un POPUP anclado sobre el FAB con 2
// pestañas (Proveedores + Laboratorios). Cada pestaña monta un <ChatPanel>
// que reusa los endpoints de chat existentes (no se crean endpoints nuevos).
//
// No-leídos:
//   • Badge TOTAL en el FAB + mini-badge por pestaña.
//   • Fuente base: GET /api/dashboard/chat-unread (polling ~15s + al volver el
//     foco, pausa con document.hidden) → { lab, supplier, total }.
//   • Mientras el popup está abierto, cada panel reporta su conteo vivo
//     (excluye el hilo abierto) y ése prevalece: al abrir un hilo el badge baja
//     de inmediato sin esperar al siguiente poll.
//
// Coexiste con <OrderChatDock> (chat contextual de una orden, también
// abajo-derecha, z-index 60): este launcher usa z-index 55 para que, en las 2
// pantallas donde existe el dock, el chat contextual quede al frente. NO se
// fusionan: el launcher es la entrada global; el dock es por-orden.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import { ChatPanel } from "./chat-panel";

type Tab = "supplier" | "lab";

const UNREAD_URL = "/api/dashboard/chat-unread";
const UNREAD_POLL_MS = 15000;
const TAB_STORAGE_KEY = "mf:chat-launcher:tab";

const FAB_Z = 55;

function Badge({ count, tone = "danger" }: { count: number; tone?: "danger" | "brand" }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 999,
        background: tone === "danger" ? "var(--danger)" : "var(--brand)",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        display: "grid",
        placeItems: "center",
        lineHeight: 1,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "10px 8px",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--brand)" : "2px solid transparent",
        color: active ? "var(--text-1)" : "var(--text-3)",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "color 0.12s",
      }}
    >
      {label}
      <Badge count={count} tone="brand" />
    </button>
  );
}

export function ChatLauncher() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("supplier");

  // Conteos base del endpoint (siempre vivos, abierto o cerrado).
  const [endpointCounts, setEndpointCounts] = useState<{ lab: number; supplier: number }>({
    lab: 0,
    supplier: 0,
  });
  // Conteos reportados por los paneles montados (prevalecen mientras abierto).
  const [panelCounts, setPanelCounts] = useState<{ lab?: number; supplier?: number }>({});

  // ── Montaje + pestaña recordada ──────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
      if (saved === "lab" || saved === "supplier") setTab(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const selectTab = (t: Tab) => {
    setTab(t);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  };

  // Al cerrar, soltar los conteos de panel → el badge vuelve a regirse por el
  // endpoint hasta la próxima apertura.
  useEffect(() => {
    if (!open) setPanelCounts({});
  }, [open]);

  // ── Polling del endpoint de no-leídos (pausa con pestaña oculta) ─────
  useEffect(() => {
    let cancelled = false;
    let ac: AbortController | null = null;

    const fetchCounts = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      ac?.abort();
      ac = new AbortController();
      fetch(UNREAD_URL, {
        signal: ac.signal,
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { lab?: number; supplier?: number } | null) => {
          if (cancelled || !data) return;
          setEndpointCounts({
            lab: Number(data.lab ?? 0) | 0,
            supplier: Number(data.supplier ?? 0) | 0,
          });
        })
        .catch((err) => {
          if (cancelled || err?.name === "AbortError") return;
        });
    };

    fetchCounts();
    const intervalId = window.setInterval(fetchCounts, UNREAD_POLL_MS);
    const onFocus = () => fetchCounts();
    const onVis = () => {
      if (!document.hidden) fetchCounts();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      ac?.abort();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!mounted) return null;

  // Efectivos: el conteo vivo del panel prevalece mientras el popup está abierto.
  const supplierCount =
    open && panelCounts.supplier !== undefined ? panelCounts.supplier : endpointCounts.supplier;
  const labCount = open && panelCounts.lab !== undefined ? panelCounts.lab : endpointCounts.lab;
  const total = supplierCount + labCount;

  return createPortal(
    <>
      {/* ── Popup ── */}
      {open && (
        <div
          role="dialog"
          aria-label="Mensajes"
          style={{
            position: "fixed",
            right: 24,
            bottom: 92,
            zIndex: FAB_Z,
            width: "min(400px, calc(100vw - 32px))",
            height: "min(560px, 70vh)",
            maxHeight: "calc(100dvh - 104px)",
            display: "flex",
            flexDirection: "column",
            borderRadius: "var(--radius-lg, 14px)",
            overflow: "hidden",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            boxShadow: "0 24px 60px -16px rgba(0,0,0,0.5), 0 0 0 1px var(--border-soft)",
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
          }}
        >
          {/* Header */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: "1px solid var(--border-soft)",
              background: "var(--bg-elev)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
              Mensajes
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar mensajes"
              style={{
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "1px solid var(--border-soft)",
                background: "var(--bg-elev-2)",
                color: "var(--text-2)",
                cursor: "pointer",
              }}
            >
              <X size={15} />
            </button>
          </header>

          {/* Pestañas */}
          <div role="tablist" aria-label="Tipo de chat" style={{ display: "flex", borderBottom: "1px solid var(--border-soft)" }}>
            <TabButton active={tab === "supplier"} label="Proveedores" count={supplierCount} onClick={() => selectTab("supplier")} />
            <TabButton active={tab === "lab"} label="Laboratorios" count={labCount} onClick={() => selectTab("lab")} />
          </div>

          {/* Cuerpo — ambos paneles montados; se alterna la visibilidad para
              conservar estado y mantener vivos los mini-badges. */}
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <div style={{ position: "absolute", inset: 0, display: tab === "supplier" ? "block" : "none" }}>
              <ChatPanel
                domain="supplier"
                active={tab === "supplier"}
                onUnreadCount={(n) => setPanelCounts((p) => ({ ...p, supplier: n }))}
              />
            </div>
            <div style={{ position: "absolute", inset: 0, display: tab === "lab" ? "block" : "none" }}>
              <ChatPanel
                domain="lab"
                active={tab === "lab"}
                onUnreadCount={(n) => setPanelCounts((p) => ({ ...p, lab: n }))}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── FAB ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Cerrar mensajes" : "Abrir mensajes"}
        aria-expanded={open}
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: FAB_Z,
          width: 58,
          height: 58,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          color: "#fff",
          background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
          boxShadow: "0 12px 30px -8px rgba(124,58,237,0.7)",
          display: "grid",
          placeItems: "center",
          transition: "transform 0.12s, filter 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.filter = "brightness(1.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.filter = "brightness(1)";
        }}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && total > 0 && (
          <span
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              minWidth: 22,
              height: 22,
              padding: "0 6px",
              borderRadius: 999,
              background: "var(--danger)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
              border: "2px solid var(--bg)",
            }}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
    </>,
    document.body,
  );
}
