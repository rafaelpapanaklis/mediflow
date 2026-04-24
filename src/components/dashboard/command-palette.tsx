"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search, CornerDownLeft, User as UserIcon,
  Calendar as CalendarIcon, FileText as FileTextIcon,
} from "lucide-react";
import type {
  CommandItem, CommandGroup, RemoteSearchResult, CommandContext,
} from "@/lib/command-palette/types";
import { buildGlobalActions, buildActiveConsultActions } from "@/lib/command-palette/actions";
import { fuzzyScore } from "@/lib/command-palette/fuzzy";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useDebouncedValue } from "@/hooks/use-command-palette";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_LABELS: Record<CommandGroup, string> = {
  "paciente-activo": "EN PACIENTE ACTUAL",
  pacientes: "PACIENTES",
  citas: "CITAS",
  facturas: "FACTURAS",
  acciones: "ACCIONES",
  "ir-a": "IR A",
};

const GROUP_ORDER: CommandGroup[] = [
  "paciente-activo",
  "pacientes",
  "citas",
  "facturas",
  "acciones",
  "ir-a",
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const activeConsult = useActiveConsult();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [remoteResults, setRemoteResults] = useState<RemoteSearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
      setRemoteResults(null);
      setLoading(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = debouncedQuery.trim();
    if (!q) {
      setRemoteResults(null);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);

    fetch(`/api/dashboard/search?q=${encodeURIComponent(q)}`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: RemoteSearchResult) => {
        setRemoteResults(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          setRemoteResults(null);
          setLoading(false);
        }
      });

    return () => ac.abort();
  }, [debouncedQuery, open]);

  const ctx: CommandContext = useMemo(
    () => ({
      close: () => onOpenChange(false),
      push: (href: string) => {
        onOpenChange(false);
        router.push(href);
      },
      activeConsultPatientId: activeConsult?.patientId ?? null,
    }),
    [onOpenChange, router, activeConsult],
  );

  const items: CommandItem[] = useMemo(() => {
    const q = query.trim();
    const all: CommandItem[] = [];

    if (activeConsult) {
      all.push(
        ...buildActiveConsultActions(activeConsult.patientId, activeConsult.patientName),
      );
    }

    if (remoteResults) {
      remoteResults.patients?.forEach((p) => {
        all.push({
          id: `patient-${p.id}`,
          group: "pacientes",
          label: p.name,
          sub: p.sub,
          icon: UserIcon,
          run: (c) => c.push(p.href),
        });
      });
      remoteResults.appointments?.forEach((a) => {
        all.push({
          id: `appt-${a.id}`,
          group: "citas",
          label: a.title,
          sub: a.sub,
          icon: CalendarIcon,
          run: (c) => c.push(a.href),
        });
      });
      remoteResults.invoices?.forEach((inv) => {
        all.push({
          id: `inv-${inv.id}`,
          group: "facturas",
          label: inv.title,
          sub: inv.sub,
          icon: FileTextIcon,
          run: (c) => c.push(inv.href),
        });
      });
    }

    const globals = buildGlobalActions();
    if (!q) {
      all.push(...globals);
      return all;
    }
    const filteredGlobals = globals.filter((item) => {
      const haystack = [item.label, ...(item.keywords ?? [])].join(" ");
      return fuzzyScore(q, haystack) > 0;
    });
    all.push(...filteredGlobals);

    return all;
  }, [activeConsult, remoteResults, query]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [items.length, debouncedQuery]);

  const grouped = useMemo(() => {
    const byGroup = new Map<CommandGroup, CommandItem[]>();
    for (const it of items) {
      const arr = byGroup.get(it.group) ?? [];
      arr.push(it);
      byGroup.set(it.group, arr);
    }
    const ordered: Array<{
      group: CommandGroup;
      entries: Array<{ item: CommandItem; idx: number }>;
    }> = [];
    const flat: Array<{ item: CommandItem; idx: number }> = [];
    let i = 0;
    for (const g of GROUP_ORDER) {
      const list = byGroup.get(g);
      if (!list || list.length === 0) continue;
      const entries = list.map((item) => ({ item, idx: i++ }));
      ordered.push({ group: g, entries });
      flat.push(...entries);
    }
    return { ordered, flat };
  }, [items]);

  const total = grouped.flat.length;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Shortcuts de acción cuando el input está vacío — pattern Linear/Raycast
      if (query.trim() === "" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        const shortcutMap: Record<string, string> = {
          c: "create:appointment",
          n: "create:patient",
          i: "create:invoice",
          t: "cmd:toggle-theme",
        };
        if (shortcutMap[key]) {
          const target = items.find((it) => it.id === shortcutMap[key]);
          if (target) {
            e.preventDefault();
            target.run(ctx);
            return;
          }
        }
        // S solo si hay consulta activa (active:soap)
        if (key === "s") {
          const soapAction = items.find((it) => it.id === "active:soap");
          if (soapAction) {
            e.preventDefault();
            soapAction.run(ctx);
            return;
          }
        }
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (total === 0 ? 0 : (i + 1) % total));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (total === 0 ? 0 : (i - 1 + total) % total));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = grouped.flat[highlightedIndex];
        if (target) target.item.run(ctx);
      } else if (e.key === "Home") {
        e.preventDefault();
        setHighlightedIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        if (total > 0) setHighlightedIndex(total - 1);
      }
    },
    [total, highlightedIndex, grouped.flat, ctx, query, items],
  );

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-cmd-idx="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          data-cmd-palette-overlay
          style={{
            background: "rgba(5,5,10,0.72)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            animation: "cmdOverlayIn 0.15s ease-out",
          }}
        />
        <Dialog.Content
          onKeyDown={handleKeyDown}
          aria-label="Buscar o ejecutar comando"
          className="fixed z-50"
          data-cmd-palette-content
          style={{
            top: "15vh",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(640px, 90vw)",
            maxHeight: "70vh",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            boxShadow:
              "0 24px 60px -12px rgba(0,0,0,0.4), 0 8px 20px -8px rgba(0,0,0,0.2)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            animation: "cmdPanelIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <Dialog.Title className="sr-only">Buscar o ejecutar comando</Dialog.Title>
          <Dialog.Description className="sr-only">
            Escribe para buscar pacientes, citas o facturas. Navega con flechas, presiona Enter para abrir.
          </Dialog.Description>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 16px",
              borderBottom: "1px solid var(--border-soft)",
              flexShrink: 0,
            }}
          >
            <Search size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar pacientes, citas, acciones…"
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-label="Buscar"
              aria-controls="cmd-list"
              aria-expanded={true}
              aria-autocomplete="list"
              aria-activedescendant={total > 0 ? `cmd-item-${highlightedIndex}` : undefined}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text-1)",
                fontSize: 14,
                fontFamily: "inherit",
                height: 24,
              }}
            />
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 8px",
                fontSize: 10,
                color: "var(--text-2)",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-soft)",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              esc
            </button>
          </div>

          <div
            ref={listRef}
            id="cmd-list"
            role="listbox"
            aria-label="Resultados"
            style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}
            className="scrollbar-thin"
          >
            {loading && total === 0 && <EmptyMessage>Buscando…</EmptyMessage>}
            {!loading && total === 0 && (
              <EmptyMessage>
                {query ? `Sin resultados para "${query}".` : "Empieza a escribir o selecciona una acción."}
              </EmptyMessage>
            )}

            {grouped.ordered.map(({ group, entries }) => (
              <div key={group} role="group" aria-label={GROUP_LABELS[group]}>
                <div
                  style={{
                    padding: "10px 16px 6px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    color: "var(--text-2)",
                    fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  }}
                >
                  {GROUP_LABELS[group]}
                </div>
                {entries.map(({ item, idx }) => (
                  <CommandRow
                    key={item.id}
                    item={item}
                    idx={idx}
                    isActive={idx === highlightedIndex}
                    onHover={() => setHighlightedIndex(idx)}
                    onSelect={() => item.run(ctx)}
                  />
                ))}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 16px",
              borderTop: "1px solid var(--border-soft)",
              fontSize: 10,
              color: "var(--text-2)",
              flexShrink: 0,
              background: "var(--bg-elev)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <FooterHint keys={["↑", "↓"]} label="navegar" />
              <FooterHint keys={["↵"]} label="abrir" />
              <FooterHint keys={["esc"]} label="cerrar" />
              {query.trim() === "" && (
                <span style={{
                  color: "var(--text-3)",
                  fontSize: 10,
                  fontStyle: "italic",
                }}>
                  o presiona C/N/I/T
                </span>
              )}
            </div>
            <button
              onClick={() => {
                onOpenChange(false);
                window.dispatchEvent(new CustomEvent("mf:open-shortcuts-panel"));
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-2)",
                fontSize: 10,
                cursor: "pointer",
                padding: 0,
                fontFamily: "inherit",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              ¿Qué es esto?
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommandRow({
  item, idx, isActive, onHover, onSelect,
}: {
  item: CommandItem;
  idx: number;
  isActive: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <div
      id={`cmd-item-${idx}`}
      data-cmd-idx={idx}
      role="option"
      aria-selected={isActive}
      onClick={onSelect}
      onMouseMove={onHover}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 16px",
        cursor: "pointer",
        background: isActive ? "var(--brand-soft)" : "transparent",
        color: "var(--text-1)",
        transition: "background 0.08s",
      }}
    >
      {Icon && (
        <Icon
          size={16}
          style={{ color: isActive ? "var(--brand)" : "var(--text-3)", flexShrink: 0 }}
          aria-hidden
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: "var(--text-1)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{item.label}</div>
        {item.sub && (
          <div style={{
            fontSize: 11, color: "var(--text-2)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            marginTop: 2,
          }}>{item.sub}</div>
        )}
      </div>
      {item.shortcut && (
        <kbd style={{
          fontSize: 10, padding: "2px 6px", borderRadius: 4,
          background: isActive ? "rgba(124,58,237,0.20)" : "var(--bg-hover)",
          color: isActive ? "var(--brand)" : "var(--text-2)",
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontWeight: 500, border: "1px solid var(--border-soft)",
          flexShrink: 0, whiteSpace: "nowrap",
        }}>{item.shortcut}</kbd>
      )}
      {isActive && (
        <CornerDownLeft size={12} style={{ color: "var(--brand)", flexShrink: 0 }} aria-hidden />
      )}
    </div>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "32px 16px", textAlign: "center",
      color: "var(--text-2)", fontSize: 12,
    }}>{children}</div>
  );
}

function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {keys.map((k, i) => (
        <kbd key={i} style={{
          fontSize: 10, padding: "1px 5px", minWidth: 16,
          textAlign: "center", borderRadius: 4,
          background: "var(--bg-hover)", border: "1px solid var(--border-soft)",
          color: "var(--text-2)", fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontWeight: 500, display: "inline-block",
        }}>{k}</kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}
