"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Stethoscope,
  FlaskConical,
  Camera,
  CreditCard,
  Sparkles,
  XCircle,
  MoreHorizontal,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useConsultElapsedSeconds } from "./active-consult-provider";
import { AlergiesPopover } from "./alergies-popover";
import { PatientContextEndModal } from "./patient-context-end-modal";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import type { AparienciaTopbar } from "./topbar-rediseno/apariencia";
import { CLASES_MENU } from "./menu-dos-niveles/clases";
import piel from "./layout-rediseno/barra-consulta.module.css";

/**
 * REDISEÑO (interruptor `menu-dos-niveles`, ws1-t2 hallazgo 12) — «dos
 * pieles, un esqueleto», como las piezas de la barra superior
 * (`topbar-rediseno/apariencia.ts`). El JSX es UNO. Con la apariencia clásica
 * (o sin apariencia) cada elemento recibe EXACTAMENTE su `style` de siempre y
 * su clase global de siempre, en el mismo orden: ni un byte distinto. Con la
 * nueva recibe su clase de `layout-rediseno/barra-consulta.module.css` y
 * ningún `style` (un `style` en línea le ganaría a la clase).
 *
 * `ropa(estiloDeSiempre, claseNueva, claseGlobal?)` → las props de estilo de
 * un elemento, con `className` antes que `style` como en el JSX de siempre.
 */
type Ropa = { className?: string; style?: CSSProperties };
function vestidorBarra(nueva: boolean) {
  return (clasico: CSSProperties, clase: string, global?: string): Ropa => {
    if (nueva) return { className: global ? `${global} ${clase}` : clase };
    return global ? { className: global, style: clasico } : { style: clasico };
  };
}

export function PatientContextBar({ apariencia }: { apariencia?: AparienciaTopbar } = {}) {
  const router = useRouter();
  const t = useT();
  const { consult, loading } = useActiveConsult();
  const elapsedSeconds = useConsultElapsedSeconds();
  const [endModalOpen, setEndModalOpen] = useState(false);
  const nueva = apariencia === "nueva";
  const ropa = vestidorBarra(nueva);
  const barraRef = useRef<HTMLDivElement>(null);
  // Solo con la ropa nueva: a cuántos píxeles del borde se pega la barra.
  const [topMedido, setTopMedido] = useState(0);

  // Esta barra es sticky a top:52 (justo bajo el topbar) y mide otros 52px, pero
  // solo existe cuando hay una consulta activa. Las barras sticky que van MÁS
  // ABAJO en la página —la de secciones de la ficha y su rail derecho— no tienen
  // forma de saberlo desde su propio CSS: si se anclan a 52px fijos acaban
  // EXACTAMENTE encima de esta (mismo z-index, y ganan por orden de DOM).
  // Publicamos el alto en una custom property del root y allá lo suman con
  // var(--mf-context-bar-h, 0px), que sin consulta activa vale 0.
  useEffect(() => {
    if (loading || !consult) return;
    const root = document.documentElement;
    root.style.setProperty("--mf-context-bar-h", "52px");
    // Con llaves: removeProperty devuelve string y el cleanup debe devolver void.
    return () => {
      root.style.removeProperty("--mf-context-bar-h");
    };
  }, [loading, consult]);

  // REDISEÑO — el `top` del sticky sale de la altura REAL de la barra
  // superior, no de un número escrito a mano. La barra de siempre mide 52 px y
  // la del menú nuevo 56: con `top: 52` a mano, esta barra se metía 4 px por
  // debajo. Se busca el hermano sticky más cercano por encima (la barra
  // superior, sea cual sea) y se vigila su alto con ResizeObserver: si un día
  // cambia, o se esconde por CSS en algún ancho (alto 0), esto lo sigue. De
  // paso se publica el alto REAL de esta barra en --mf-context-bar-h (corre
  // después del efecto de siempre, así que con la ropa nueva manda este).
  // Con la apariencia clásica no hace nada: ni mide ni escribe.
  useEffect(() => {
    if (!nueva || loading || !consult) return;
    const el = barraRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let arriba: Element | null = el.previousElementSibling;
    while (arriba && getComputedStyle(arriba).position !== "sticky") arriba = arriba.previousElementSibling;
    const medir = () => {
      setTopMedido(arriba instanceof HTMLElement ? arriba.offsetHeight : 0);
      document.documentElement.style.setProperty("--mf-context-bar-h", `${el.offsetHeight}px`);
    };
    medir();
    const observador = new ResizeObserver(medir);
    if (arriba) observador.observe(arriba);
    observador.observe(el);
    return () => observador.disconnect();
  }, [nueva, loading, consult]);

  // Early returns DESPUÉS de todos los hooks
  if (loading) return null;
  if (!consult) return null;

  // Cálculos puros (no son hooks, pueden ir después del return)
  const timerText = formatTime(elapsedSeconds);
  const genderAge = [
    consult.patientAge != null ? `${consult.patientAge}a` : null,
    consult.patientGender ?? null,
  ].filter(Boolean).join(" · ");

  const firstAllergy = consult.patientAlerts.allergies?.[0];
  const totalAlerts =
    (consult.patientAlerts.allergies?.length ?? 0) +
    (consult.patientAlerts.medications?.length ?? 0) +
    (consult.patientAlerts.conditions?.length ?? 0);

  const actions = buildActions(t, router, consult.patientId, () => setEndModalOpen(true));

  return (
    <>
      <div
        ref={barraRef}
        role="region"
        aria-label={t("shell.patientContextBar.regionLabel", { name: consult.patientName })}
        className={nueva ? `${CLASES_MENU} ${piel.barra} mf-context-bar` : "mf-context-bar"}
        style={nueva ? { top: topMedido } : {
          position: "sticky",
          top: 52,
          zIndex: 4,
          background: "var(--consult-active-bg)",
          borderBottom: "1px solid var(--consult-active-border)",
          borderLeft: "3px solid var(--brand)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 clamp(12px, 1.5vw, 24px)",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
        }}
      >
        {/* LEFT */}
        <div
          {...ropa({
            display: "flex", alignItems: "center", gap: 10,
            minWidth: 0, flex: "1 1 auto",
          }, piel.izquierda)}
        >
          <span
            aria-hidden
            {...ropa({
              width: 10, height: 10, borderRadius: "50%",
              background: "var(--consult-active-dot)",
              flexShrink: 0,
            }, piel.punto, "mf-pulse-dot")}
          />
          <span
            {...ropa({
              fontSize: 10, fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--consult-active-accent)",
              textTransform: "uppercase",
              flexShrink: 0,
            }, piel.estado, "mf-ctx-bar__status")}
          >
            {t("shell.patientContextBar.inConsult")}
          </span>
          <span
            aria-hidden
            {...ropa({
              width: 1, height: 16,
              background: "var(--border-strong)",
              flexShrink: 0,
            }, piel.separador, "mf-ctx-bar__sep")}
          />
          <div {...ropa({ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }, piel.nombreGrupo)}>
            <button
              type="button"
              onClick={() => router.push(`/dashboard/patients/${consult.patientId}`)}
              aria-label={t("shell.patientContextBar.viewRecord", { name: consult.patientName })}
              {...ropa({
                background: "transparent", border: "none", padding: 0,
                cursor: "pointer",
                fontSize: 13, fontWeight: 600,
                color: "var(--text-1)",
                fontFamily: "inherit",
                overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "clamp(120px, 25vw, 240px)",
                textAlign: "left",
              }, piel.nombre)}
            >
              {consult.patientName}
            </button>
            {genderAge && (
              <span
                {...ropa({
                  fontSize: 11,
                  color: "var(--text-2)",
                  fontFamily: "var(--font-mono, monospace)",
                  flexShrink: 0,
                }, piel.meta, "mf-ctx-bar__meta")}
              >
                {genderAge}
              </span>
            )}
          </div>
          {firstAllergy && (
            <div {...ropa({ flexShrink: 0 }, piel.alergia, "mf-ctx-bar__allergy")}>
              <AlergiesPopover
                alerts={consult.patientAlerts}
                trigger={
                  <button
                    type="button"
                    aria-label={t("shell.patientContextBar.alertsAria", { count: totalAlerts })}
                    {...ropa({
                      display: "inline-flex", alignItems: "center", gap: 4,
                      height: 24, padding: "0 8px", borderRadius: 20,
                      background: "var(--danger-soft-strong)",
                      border: "1px solid var(--danger-border-strong)",
                      color: "var(--danger)",
                      fontSize: 11, fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                      maxWidth: "clamp(140px, 20vw, 260px)",
                      overflow: "hidden", textOverflow: "ellipsis",
                    }, piel.alergiaBoton)}
                  >
                    <AlertTriangle size={11} {...ropa({ flexShrink: 0 }, piel.alergiaIcono)} aria-hidden />
                    <span {...ropa({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, piel.alergiaTexto)}>
                      {t("shell.patientContextBar.allergyPrefix")} {firstAllergy}
                      {totalAlerts > 1 ? ` +${totalAlerts - 1}` : ""}
                    </span>
                  </button>
                }
              />
            </div>
          )}
        </div>

        {/* TIMER */}
        <div
          className={nueva ? `mf-ctx-bar__timer ${piel.reloj}` : "mf-ctx-bar__timer"}
          aria-live="off"
          aria-label={t("shell.patientContextBar.timerAria", { time: timerText })}
          {...(nueva ? {} : { style: {
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 13, fontWeight: 500,
            color: "var(--text-1)",
            padding: "4px 10px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 6,
            letterSpacing: "0.04em",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          } as CSSProperties })}
        >
          {timerText}
        </div>

        {/* ACTIONS DESKTOP */}
        <div
          {...ropa({ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }, piel.accionesEscritorio, "mf-ctx-bar__actions-desktop")}
        >
          {actions.main.map((a) => (
            <ActionButton key={a.id} action={a} nueva={nueva} />
          ))}
          <div
            aria-hidden
            {...ropa({
              width: 1, height: 20,
              background: "var(--border-strong)",
              margin: "0 6px",
            }, piel.accionesSeparador)}
          />
          <ActionButton action={actions.end} nueva={nueva} />
        </div>

        {/* ACTIONS MOBILE */}
        <div {...ropa({ display: "none", flexShrink: 0 }, piel.accionesMovil, "mf-ctx-bar__actions-mobile")}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label={t("shell.patientContextBar.moreActions")}
                {...ropa({
                  width: 32, height: 32,
                  display: "grid", placeItems: "center",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid var(--border-soft)",
                  color: "var(--text-1)",
                  cursor: "pointer",
                }, piel.menuBoton)}
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end" sideOffset={6}
                {...ropa({
                  zIndex: 50, minWidth: 200,
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 10, padding: 4,
                  boxShadow:
                    "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
                  fontFamily: "inherit",
                }, `${CLASES_MENU} ${piel.menu}`)}
              >
                {[...actions.main, actions.end].map((a) => (
                  <DropdownMenu.Item
                    key={a.id}
                    onSelect={a.run}
                    {...ropa({
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", fontSize: 13,
                      color: a.tone === "danger" ? "var(--danger)" : "var(--text-1)",
                      borderRadius: 6, cursor: "pointer", outline: "none",
                    }, a.tone === "danger" ? `${piel.menuItem} ${piel.menuItemPeligro}` : piel.menuItem)}
                  >
                    <a.Icon
                      size={14}
                      {...ropa({
                        color: a.tone === "danger" ? "var(--danger)" : "var(--text-2)",
                      }, piel.menuIcono)}
                    />
                    {a.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <PatientContextEndModal open={endModalOpen} onOpenChange={setEndModalOpen} />
    </>
  );
}

// Helpers

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

interface ActionDef {
  id: string;
  label: string;
  ariaLabel: string;
  Icon: LucideIcon;
  tone?: "brand" | "danger";
  run: () => void;
}

function buildActions(
  t: TFunction,
  router: ReturnType<typeof useRouter>,
  patientId: string,
  openEndModal: () => void,
): { main: ActionDef[]; end: ActionDef } {
  const main: ActionDef[] = [
    { id: "soap", label: t("shell.patientContextBar.soapLabel"), ariaLabel: t("shell.patientContextBar.soapAria"),
      Icon: Stethoscope,
      run: () => router.push(`/dashboard/patients/${patientId}?tab=soap&new=1`) },
    { id: "prescribe", label: t("shell.patientContextBar.prescribeLabel"), ariaLabel: t("shell.patientContextBar.prescribeAria"),
      Icon: FlaskConical,
      run: () => router.push(`/dashboard/patients/${patientId}?prescribe=1`) },
    { id: "xray", label: t("shell.patientContextBar.xrayLabel"), ariaLabel: t("shell.patientContextBar.xrayAria"),
      Icon: Camera,
      run: () => router.push(`/dashboard/xrays?patient=${patientId}`) },
    { id: "charge", label: t("shell.patientContextBar.chargeLabel"), ariaLabel: t("shell.patientContextBar.chargeAria"),
      Icon: CreditCard,
      run: () => router.push(`/dashboard/patients/${patientId}?charge=1`) },
    { id: "ai", label: t("shell.patientContextBar.aiLabel"), ariaLabel: t("shell.patientContextBar.aiAria"),
      Icon: Sparkles, tone: "brand",
      run: () => router.push(`/dashboard/ai-assistant?patient=${patientId}`) },
  ];
  const end: ActionDef = {
    id: "end", label: t("shell.patientContextBar.endLabel"), ariaLabel: t("shell.patientContextBar.endAria"),
    Icon: XCircle, tone: "danger", run: openEndModal,
  };
  return { main, end };
}

/**
 * Con la ropa nueva el hover lo hace el CSS (`.accion:hover`), así que los
 * `onMouseEnter`/`onMouseLeave` de siempre —que escriben `style` en línea y le
 * ganarían a la clase— no se montan. Con la clásica, todo igual que hoy.
 */
function ActionButton({ action, nueva }: { action: ActionDef; nueva: boolean }) {
  const isDanger = action.tone === "danger";
  const isBrand = action.tone === "brand";
  if (nueva) {
    return (
      <button
        type="button"
        onClick={action.run}
        aria-label={action.ariaLabel}
        title={action.label}
        className={isDanger ? `${piel.accion} ${piel.accionPeligro}` : isBrand ? `${piel.accion} ${piel.accionMarca}` : piel.accion}
      >
        <action.Icon size={16} aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={action.run}
      aria-label={action.ariaLabel}
      title={action.label}
      style={{
        width: 32, height: 32,
        display: "grid", placeItems: "center",
        borderRadius: 8,
        background: "transparent",
        border: "1px solid transparent",
        color: isDanger
          ? "var(--danger)"
          : isBrand
            ? "var(--consult-active-accent)"
            : "var(--text-2)",
        cursor: "pointer",
        transition: "all 0.15s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isDanger ? "var(--danger-soft)" : "var(--bg-hover)";
        e.currentTarget.style.color = isDanger ? "var(--danger)" : "var(--text-1)";
        e.currentTarget.style.borderColor = isDanger
          ? "var(--danger-border-strong)"
          : "var(--border-soft)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = isDanger
          ? "var(--danger)"
          : isBrand
            ? "var(--consult-active-accent)"
            : "var(--text-2)";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <action.Icon size={16} aria-hidden />
    </button>
  );
}
