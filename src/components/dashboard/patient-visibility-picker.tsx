"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Eye, Lock, Search } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

/**
 * Picker de visibilidad por paciente.
 *
 * Botón compacto con el estado ("Visibilidad: Todos" / "Visibilidad: 3 de 8")
 * que abre un popover con el equipo y checkboxes. Todos marcados por default;
 * los admins salen marcados y DESHABILITADOS (siempre ven todo, y por eso
 * tampoco se guardan en la lista — ver src/lib/patient-visibility.ts).
 *
 * `value` = [] significa "todos" (default, sin restricción). Una lista con ids
 * de no-admin restringe a esas personas (+ admins). Una lista con SOLO ids de
 * admin = "solo administradores": ningún no-admin lo ve. El padre manda la
 * lista al server SOLO si quedó restringida. Ver src/lib/patient-visibility.ts.
 *
 * Radix Popover a propósito: los dos montajes viven dentro de un Radix Dialog y
 * Popover.Content se registra como capa HIJA del Dialog → ni cierra el modal ni
 * hereda su pointer-events:none. Un createPortal a <body> exigiría parchear el
 * Dialog (el patrón [data-datefield-popover]). Y NADA de stopPropagation: rompe
 * el manejo de capas de Radix.
 */

export interface VisibilityTeamMember {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  color?: string | null;
}

interface Props {
  /** userIds seleccionados. [] = todos lo ven (default). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Deshabilita el botón (p.ej. mientras guarda). */
  disabled?: boolean;
  /**
   * Equipo ya cargado. Si se omite, el componente lo pide a /api/team/light la
   * PRIMERA vez que se abre el popover (lazy: el modal de alta no lo trae, y no
   * queremos un fetch por cada apertura del modal que nadie usa).
   */
  team?: VisibilityTeamMember[];
}

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];
const isAdminRole = (role: string) => ADMIN_ROLES.includes(role);

/** Iniciales sobre el color del usuario — mismo idioma visual que el equipo/agenda. */
function initials(m: VisibilityTeamMember): string {
  return `${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

/** Blanco o gris oscuro según la luminancia: algunos colores del equipo son claros. */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "#1f2937" : "#fff";
}

export function PatientVisibilityPicker({ value, onChange, disabled, team: teamProp }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<VisibilityTeamMember[]>(teamProp ?? []);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const fetched = useRef(false);

  useEffect(() => {
    if (teamProp) setTeam(teamProp);
  }, [teamProp]);

  // Fetch perezoso: solo al abrir por primera vez y solo si el padre no lo dio.
  useEffect(() => {
    if (!open || teamProp || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    fetch("/api/team/light")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setTeam(Array.isArray(rows) ? rows : []))
      .catch(() => setTeam([]))
      .finally(() => setLoading(false));
  }, [open, teamProp]);

  const admins = useMemo(() => team.filter((m) => isAdminRole(m.role)), [team]);
  const selectable = useMemo(() => team.filter((m) => !isAdminRole(m.role)), [team]);

  const adminIds = useMemo(() => admins.map((a) => a.id), [admins]);

  // "Todos" = lista vacía. Con lista, los admins cuentan igual porque SIEMPRE
  // ven: mostrar "1 de 8" cuando en realidad lo ven 1 + los admins mentiría.
  const restricted = value.length > 0;

  // "Solo administradores": lista restringida sin ningún no-admin seleccionado
  // (value trae solo ids de admin). Ver src/lib/patient-visibility.ts.
  const selectedNonAdmin = useMemo(
    () => (restricted ? selectable.filter((s) => value.includes(s.id)) : selectable),
    [restricted, selectable, value],
  );
  const adminsOnly = restricted && selectedNonAdmin.length === 0;

  const selectedCount = restricted
    ? new Set([...value, ...adminIds]).size
    : team.length;

  // Sin el equipo cargado (fetch perezoso: el popover puede no haberse abierto
  // nunca) NO sabemos el total → "Restringida" a secas en vez de un "3 de 3"
  // que mentiría.
  const label = !restricted
    ? t("shell.patientVisibility.allLabel")
    : adminsOnly
      ? t("shell.patientVisibility.adminsOnlyLabel")
      : team.length > 0
        ? t("shell.patientVisibility.someLabel", { count: selectedCount, total: team.length })
        : t("shell.patientVisibility.restrictedLabel");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return team;
    return team.filter((m) => `${m.firstName} ${m.lastName}`.toLowerCase().includes(q));
  }, [team, query]);

  function toggle(m: VisibilityTeamMember) {
    if (isAdminRole(m.role)) return; // siempre ven: no se togglea
    // Trabajamos SOLO con la selección de no-admins. Al primer clic desde
    // "todos" materializamos toda la lista no-admin y quitamos al destildado;
    // así "excluir a una persona" es un solo clic (el caso de uso real).
    const currentNonAdmin = restricted
      ? selectable.filter((s) => value.includes(s.id)).map((s) => s.id)
      : selectable.map((s) => s.id);
    const nextNonAdmin = currentNonAdmin.includes(m.id)
      ? currentNonAdmin.filter((id) => id !== m.id)
      : [...currentNonAdmin, m.id];

    if (nextNonAdmin.length === selectable.length) {
      onChange([]); // vuelven todos → "todos" ([]), sin lista redundante
    } else if (nextNonAdmin.length === 0) {
      // Ningún no-admin → "solo administradores". Guardamos ids de admin para que
      // la lista quede NO vacía (vacía = "todos"). Sin admins en el equipo no es
      // representable → dejamos la selección como estaba.
      if (adminIds.length > 0) onChange(adminIds);
    } else {
      onChange(nextNonAdmin);
    }
  }

  const isChecked = (m: VisibilityTeamMember) =>
    isAdminRole(m.role) || !restricted || value.includes(m.id);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="btn-new btn-new--ghost btn-new--sm"
          aria-label={t("shell.patientVisibility.aria")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            maxWidth: "100%",
            minWidth: 0,
            color: restricted ? "var(--brand)" : "var(--text-2)",
          }}
        >
          {restricted ? <Lock size={13} /> : <Eye size={13} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={6}
          collisionPadding={12}
          style={{
            zIndex: 100, // por encima del Dialog (z-index 91 en new-patient-modal)
            width: "min(320px, calc(100vw - 24px))",
            maxHeight: "min(380px, 60vh)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            boxShadow: "0 12px 32px -8px rgba(15,10,30,0.35)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
              {t("shell.patientVisibility.title")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
              {t("shell.patientVisibility.hint")}
            </div>
          </div>

          {/* Buscador solo con equipos grandes: con 5 personas estorba. */}
          {team.length > 8 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              <Search size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("shell.patientVisibility.searchPlaceholder")}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 12,
                  color: "var(--text-1)",
                }}
              />
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 4 }}>
            {loading && (
              <div style={{ padding: "12px", fontSize: 12, color: "var(--text-2)" }}>
                {t("common.loading")}
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div style={{ padding: "12px", fontSize: 12, color: "var(--text-2)" }}>
                {t("shell.patientVisibility.empty")}
              </div>
            )}
            {!loading &&
              filtered.map((m) => {
                const admin = isAdminRole(m.role);
                const locked = admin;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m)}
                    disabled={locked}
                    title={admin ? t("shell.patientVisibility.adminAlways") : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "7px 8px",
                      border: "none",
                      borderRadius: 6,
                      background: "transparent",
                      textAlign: "left",
                      cursor: locked ? "default" : "pointer",
                      opacity: admin ? 0.65 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked(m)}
                      disabled={locked}
                      readOnly
                      style={{ margin: 0, accentColor: "var(--brand)", flexShrink: 0 }}
                    />
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        fontWeight: 700,
                        background: m.color || "var(--brand)",
                        color: readableOn(m.color || "#7c3aed"),
                      }}
                    >
                      {initials(m)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--text-1)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {`${m.firstName} ${m.lastName}`.trim()}
                      </span>
                      {admin && (
                        <span style={{ display: "block", fontSize: 10, color: "var(--text-3)" }}>
                          {t("shell.patientVisibility.adminAlways")}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
          </div>

          {(restricted || (adminIds.length > 0 && !adminsOnly)) && (
            <div
              style={{
                padding: 8,
                borderTop: "1px solid var(--border-soft)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {adminIds.length > 0 && !adminsOnly && (
                <button
                  type="button"
                  onClick={() => onChange(adminIds)}
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ width: "100%" }}
                >
                  {t("shell.patientVisibility.adminsOnlyAction")}
                </button>
              )}
              {restricted && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ width: "100%" }}
                >
                  {t("shell.patientVisibility.reset")}
                </button>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
