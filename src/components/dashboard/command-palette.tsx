"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useT, useLocale } from "@/i18n/i18n-provider";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search, CornerDownLeft, User as UserIcon,
  Calendar as CalendarIcon, FileText as FileTextIcon,
} from "lucide-react";
import type {
  CommandItem, CommandGroup, RemoteSearchResult, CommandContext,
} from "@/lib/command-palette/types";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fmtMXN } from "@/lib/format";
import { buildGlobalActions, buildActiveConsultActions } from "@/lib/command-palette/actions";
import { fuzzyScore } from "@/lib/command-palette/fuzzy";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";
import { useDebouncedValue } from "@/hooks/use-command-palette";
import { isAbortError } from "@/lib/fetch-safe";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { RUTA_AGENDA, vestidor, type AparienciaTopbar } from "@/components/dashboard/topbar-rediseno/apariencia";
import c from "@/components/dashboard/topbar-rediseno/piezas-topbar.module.css";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * La ropa (topbar-rediseno/apariencia.ts). Sin ella —la barra de siempre—
   * cada elemento recibe EXACTAMENTE los `style` de antes y «Agenda» manda a
   * la agenda de siempre; con "nueva" —la barra del menú de dos niveles— el
   * portal monta CLASES_MENU, se pinta con las clases del rediseño y «Agenda»
   * manda a la agenda nueva. La búsqueda, los atajos y las acciones son unos.
   */
  apariencia?: AparienciaTopbar;
}

// Map group id -> translation-key; the visible label is resolved via t() at render time.
const GROUP_LABEL_KEYS: Record<CommandGroup, string> = {
  "paciente-activo": "shell.commandPalette.groupActivePatient",
  pacientes: "shell.commandPalette.groupPatients",
  citas: "shell.commandPalette.groupAppointments",
  facturas: "shell.commandPalette.groupInvoices",
  acciones: "shell.commandPalette.groupActions",
  "ir-a": "shell.commandPalette.groupGoTo",
};

// Mismo par tono/etiqueta que la tabla de Facturación, para que el estado se
// lea igual en el palette que en la lista.
const INVOICE_STATUS: Record<
  string,
  { tone: "success" | "warning" | "danger" | "info" | "brand" | "neutral"; labelKey: string }
> = {
  DRAFT:     { tone: "brand",   labelKey: "billing.billingClient.statusDraft"     },
  PENDING:   { tone: "warning", labelKey: "billing.billingClient.statusPending"   },
  PARTIAL:   { tone: "info",    labelKey: "billing.billingClient.statusPartial"   },
  PAID:      { tone: "success", labelKey: "billing.billingClient.statusPaid"      },
  OVERDUE:   { tone: "danger",  labelKey: "billing.billingClient.statusOverdue"   },
  CANCELLED: { tone: "neutral", labelKey: "billing.billingClient.statusCancelled" },
};

/** El mismo tono de estado con la ropa nueva: semáforo de globals + marca del menú. */
const TONO_NUEVO: Record<string, string> = {
  success: c.tonoExito,
  warning: c.tonoAlerta,
  danger: c.tonoPeligro,
  info: c.tonoInfo,
  brand: c.tonoMarca,
  neutral: c.tonoNeutro,
};

/** "YYYY-MM-DD" → "31 jul". Se arma y se formatea en UTC a propósito: la fecha
 *  ya viene resuelta en la zona de la clínica, y pasarla por la zona local del
 *  navegador la correría un día en offsets negativos. */
function fmtDayMonth(iso: string, locale: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const GROUP_ORDER: CommandGroup[] = [
  "paciente-activo",
  "pacientes",
  "citas",
  "facturas",
  "acciones",
  "ir-a",
];

export function CommandPalette({ open, onOpenChange, apariencia }: CommandPaletteProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const nueva = apariencia === "nueva";
  // Memoizado: `items` lo lleva en sus deps y su identidad tiene que ser
  // estable entre renders, como lo son `t` y `locale`.
  const vestir = useMemo(() => vestidor(apariencia), [apariencia]);
  const { consult: activeConsult } = useActiveConsult();
  const { open: openAppt } = useNewAppointmentDialog();
  const { open: openPatient } = useNewPatientDialog();
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
        if (!isAbortError(err)) {
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
      openNewAppointment: () => {
        onOpenChange(false);
        openAppt({ openAgendaAfter: true });
      },
      openNewPatient: () => {
        onOpenChange(false);
        openPatient();
      },
    }),
    [onOpenChange, router, activeConsult, openAppt, openPatient],
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
        const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
        const sub = [p.patientNumber, p.phone].filter(Boolean).join(" · ");
        all.push({
          id: `patient-${p.id}`,
          group: "pacientes",
          label: name || (p.patientNumber ?? "—"),
          sub: sub || undefined,
          icon: UserIcon,
          run: (c) => c.push(`/dashboard/patients/${p.id}`),
        });
      });
      remoteResults.appointments?.forEach((a) => {
        all.push({
          id: `appt-${a.id}`,
          group: "citas",
          label: a.patientName,
          sub: [`${fmtDayMonth(a.date, locale)} · ${a.startTime}`, a.doctorName]
            .filter(Boolean)
            .join(" · "),
          icon: CalendarIcon,
          // /dashboard/appointments/[id] no existe: la cita se abre en la
          // agenda del día, que resalta la fila con ?highlight=.
          run: (c) => c.push(`/dashboard/agenda?date=${a.date}&highlight=${a.id}`),
        });
      });
      remoteResults.invoices?.forEach((inv) => {
        const badge = INVOICE_STATUS[inv.status];
        all.push({
          id: `inv-${inv.id}`,
          group: "facturas",
          // Texto plano para lector de pantalla; el render va en labelNode.
          label: `${inv.folio} · ${inv.patientName}`,
          labelNode: (
            <span {...vestir({ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }, c.folio)}>
              <span
                {...vestir({
                  fontFamily: "var(--font-mono, monospace)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-1)",
                  flexShrink: 0,
                }, c.folioNumero)}
              >
                {inv.folio}
              </span>
              <span
                {...vestir({
                  color: "var(--text-2)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }, c.folioNombre)}
              >
                {inv.patientName}
              </span>
            </span>
          ),
          sub: fmtDayMonth(inv.date, locale),
          trailing: (
            <span {...vestir({ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }, c.opcionCola)}>
              <span
                {...vestir({
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  fontVariantNumeric: "tabular-nums",
                }, c.importe)}
              >
                {fmtMXN(inv.amount)}
              </span>
              {badge && (nueva
                ? <span className={`${c.etiqueta} ${TONO_NUEVO[badge.tone] ?? c.tonoNeutro}`}>{t(badge.labelKey)}</span>
                : <BadgeNew tone={badge.tone}>{t(badge.labelKey)}</BadgeNew>)}
            </span>
          ),
          icon: FileTextIcon,
          run: (c) => c.push(`/dashboard/billing?focus=${inv.id}`),
        });
      });
    }

    const globals = buildGlobalActions(nueva ? { rutaAgenda: RUTA_AGENDA.nueva } : undefined);
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
  }, [activeConsult, remoteResults, query, locale, t, nueva, vestir]);

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
          className={nueva ? `fixed inset-0 z-50 ${c.velo}` : "fixed inset-0 z-50"}
          data-cmd-palette-overlay
          style={nueva ? undefined : {
            background: "rgba(5,5,10,0.72)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            animation: "cmdOverlayIn 0.15s ease-out",
          }}
        />
        <Dialog.Content
          onKeyDown={handleKeyDown}
          aria-label={t("shell.commandPalette.dialogLabel")}
          className={nueva ? `fixed z-50 ${CLASES_MENU} ${c.piel} ${c.paleta}` : "fixed z-50"}
          data-cmd-palette-content
          style={nueva ? undefined : {
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
          <Dialog.Title className="sr-only">{t("shell.commandPalette.dialogLabel")}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("shell.commandPalette.dialogDesc")}
          </Dialog.Description>

          <div
            {...vestir({
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 16px",
              borderBottom: "1px solid var(--border-soft)",
              flexShrink: 0,
            }, c.paletaBusqueda)}
          >
            <Search size={16} {...vestir({ color: "var(--text-3)", flexShrink: 0 }, c.paletaLupa)} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("shell.commandPalette.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-label={t("common.search")}
              aria-controls="cmd-list"
              aria-expanded={true}
              aria-autocomplete="list"
              aria-activedescendant={total > 0 ? `cmd-item-${highlightedIndex}` : undefined}
              {...vestir({
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text-1)",
                fontSize: 14,
                fontFamily: "inherit",
                height: 24,
              }, c.paletaInput)}
            />
            <button
              onClick={() => onOpenChange(false)}
              aria-label={t("common.close")}
              {...vestir({
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 8px",
                fontSize: 10,
                color: "var(--text-2)",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-soft)",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 500,
                flexShrink: 0,
              }, c.paletaEsc)}
            >
              esc
            </button>
          </div>

          {/* Con el input vacío la lista solo trae acciones rápidas; esta línea
              dice QUÉ se puede buscar, que es justo lo que no se entendía desde
              el trigger del topbar. Va FUERA del listbox: un div suelto entre
              los role="option" ensucia el árbol de accesibilidad. */}
          {query.trim() === "" && (
            <div
              {...vestir({
                padding: "10px 16px",
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--text-3)",
                borderBottom: "1px solid var(--border-soft)",
                flexShrink: 0,
              }, c.paletaPista)}
            >
              {t("shell.commandPalette.scopeHint")}
            </div>
          )}

          <div
            ref={listRef}
            id="cmd-list"
            role="listbox"
            aria-label={t("shell.commandPalette.resultsLabel")}
            style={nueva ? undefined : { flex: 1, overflowY: "auto", padding: "8px 0" }}
            className={nueva ? `scrollbar-thin ${c.paletaLista}` : "scrollbar-thin"}
          >
            {loading && total === 0 && <EmptyMessage nueva={nueva}>{t("shell.commandPalette.searching")}</EmptyMessage>}
            {!loading && total === 0 && (
              <EmptyMessage nueva={nueva}>
                {query ? (
                  <>
                    <div>{t("shell.commandPalette.noResultsFor", { query })}</div>
                    <div {...vestir({ marginTop: 6, color: "var(--text-3)" }, c.vacioPaletaSub)}>
                      {t("shell.commandPalette.noResultsHint")}
                    </div>
                  </>
                ) : (
                  t("shell.commandPalette.emptyHint")
                )}
              </EmptyMessage>
            )}


            {grouped.ordered.map(({ group, entries }) => (
              <div key={group} role="group" aria-label={t(GROUP_LABEL_KEYS[group])}>
                <div
                  {...vestir({
                    padding: "10px 16px 6px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    color: "var(--text-2)",
                    fontFamily: "var(--font-sans, system-ui, sans-serif)",
                  }, c.grupoTitulo)}
                >
                  {t(GROUP_LABEL_KEYS[group])}
                </div>
                {entries.map(({ item, idx }) => (
                  <CommandRow
                    key={item.id}
                    item={item}
                    idx={idx}
                    isActive={idx === highlightedIndex}
                    onHover={() => setHighlightedIndex(idx)}
                    onSelect={() => item.run(ctx)}
                    apariencia={apariencia}
                  />
                ))}
              </div>
            ))}
          </div>

          <div
            {...vestir({
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
            }, c.paletaPie)}
          >
            <div {...vestir({ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, c.paletaPistas)}>
              <FooterHint keys={["↑", "↓"]} label={t("shell.commandPalette.hintNavigate")} nueva={nueva} />
              <FooterHint keys={["↵"]} label={t("shell.commandPalette.hintOpen")} nueva={nueva} />
              <FooterHint keys={["esc"]} label={t("shell.commandPalette.hintClose")} nueva={nueva} />
              {query.trim() === "" && (
                <span {...vestir({
                  color: "var(--text-3)",
                  fontSize: 10,
                  fontStyle: "italic",
                }, c.paletaPistaTexto)}>
                  {t("shell.commandPalette.pressShortcuts")}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                onOpenChange(false);
                window.dispatchEvent(new CustomEvent("mf:open-shortcuts-panel"));
              }}
              {...vestir({
                background: "transparent",
                border: "none",
                color: "var(--text-2)",
                fontSize: 10,
                cursor: "pointer",
                padding: 0,
                fontFamily: "inherit",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }, c.paletaAyuda)}
            >
              {t("shell.commandPalette.whatIsThis")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommandRow({
  item, idx, isActive, onHover, onSelect, apariencia,
}: {
  item: CommandItem;
  idx: number;
  isActive: boolean;
  onHover: () => void;
  onSelect: () => void;
  apariencia?: AparienciaTopbar;
}) {
  const Icon = item.icon;
  const vestir = vestidor(apariencia);
  return (
    <div
      id={`cmd-item-${idx}`}
      data-cmd-idx={idx}
      role="option"
      aria-selected={isActive}
      onClick={onSelect}
      onMouseMove={onHover}
      {...vestir({
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 16px",
        cursor: "pointer",
        background: isActive ? "var(--brand-soft)" : "transparent",
        color: "var(--text-1)",
        transition: "background 0.08s",
      }, c.opcion)}
    >
      {Icon && (
        <Icon
          size={16}
          {...vestir({ color: isActive ? "var(--brand)" : "var(--text-3)", flexShrink: 0 }, c.opcionIcono)}
          aria-hidden
        />
      )}
      <div {...vestir({ flex: 1, minWidth: 0 }, c.opcionTextos)}>
        <div {...vestir({
          fontSize: 13, fontWeight: 500, color: "var(--text-1)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }, c.opcionTitulo)}>{item.labelNode ?? item.label}</div>
        {item.sub && (
          <div {...vestir({
            fontSize: 11, color: "var(--text-2)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            marginTop: 2,
          }, c.opcionSub)}>{item.sub}</div>
        )}
      </div>
      {item.trailing}
      {item.shortcut && (
        <kbd {...vestir({
          fontSize: 10, padding: "2px 6px", borderRadius: 4,
          background: isActive ? "rgba(124,58,237,0.20)" : "var(--bg-hover)",
          color: isActive ? "var(--brand)" : "var(--text-2)",
          fontFamily: "var(--font-mono, monospace)",
          fontWeight: 500, border: "1px solid var(--border-soft)",
          flexShrink: 0, whiteSpace: "nowrap",
        }, `${c.kbd} ${c.kbdChica}`)}>{item.shortcut}</kbd>
      )}
      {isActive && (
        <CornerDownLeft size={12} {...vestir({ color: "var(--brand)", flexShrink: 0 }, c.opcionEnter)} aria-hidden />
      )}
    </div>
  );
}

function EmptyMessage({ children, nueva }: { children: React.ReactNode; nueva?: boolean }) {
  if (nueva) return <div className={c.vacioPaleta}>{children}</div>;
  return (
    <div style={{
      padding: "32px 16px", textAlign: "center",
      color: "var(--text-2)", fontSize: 12,
    }}>{children}</div>
  );
}

function FooterHint({ keys, label, nueva }: { keys: string[]; label: string; nueva?: boolean }) {
  const vestir = vestidor(nueva ? "nueva" : undefined);
  return (
    <span {...vestir({ display: "inline-flex", alignItems: "center", gap: 4 }, c.pista)}>
      {keys.map((k, i) => (
        <kbd key={i} {...vestir({
          fontSize: 10, padding: "1px 5px", minWidth: 16,
          textAlign: "center", borderRadius: 4,
          background: "var(--bg-hover)", border: "1px solid var(--border-soft)",
          color: "var(--text-2)", fontFamily: "var(--font-mono, monospace)",
          fontWeight: 500, display: "inline-block",
        }, `${c.kbd} ${c.kbdChica}`)}>{k}</kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}
