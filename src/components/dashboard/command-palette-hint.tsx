"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";

interface CommandPaletteHintProps {
  onClick: () => void;
  compact?: boolean;
}

export function CommandPaletteHint({ onClick, compact }: CommandPaletteHintProps) {
  const [isMac, setIsMac] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.platform));
  }, []);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`Abrir búsqueda y comandos (${isMac ? "⌘" : "Ctrl"}+K)`}
      aria-keyshortcuts="Control+K Meta+K"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 32,
        padding: compact ? "0 8px" : "0 10px 0 12px",
        background: hovered ? "var(--bg-elev-2)" : "var(--bg-hover)",
        border: `1px solid ${hovered ? "var(--border-strong)" : "var(--border-soft)"}`,
        borderRadius: 8,
        color: "var(--text-2)",
        fontSize: 12,
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s",
        minWidth: compact ? undefined : 240,
        fontFamily: "inherit",
      }}
    >
      <Search size={14} style={{ flexShrink: 0 }} aria-hidden />
      {!compact && (
        <>
          <span style={{ flex: 1, textAlign: "left", color: "var(--text-2)" }}>
            Buscar o ejecutar…
          </span>
          <kbd
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              color: "var(--text-2)",
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {isMac ? "⌘" : "Ctrl"}K
          </kbd>
        </>
      )}
    </button>
  );
}
