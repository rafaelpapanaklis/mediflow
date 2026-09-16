"use client";

/**
 * «Hoy» para admin, con el diseño nuevo. Lo mismo que `home/home-admin.tsx`:
 * los cuatro indicadores (con el sparkline de seis meses en ingresos), el
 * selector de periodo, la tendencia de ingresos con las próximas citas al
 * lado y el rendimiento del equipo. Mismos datos, mismos clics.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownRight, ArrowUpRight, Calendar, ChevronRight, DollarSign, TrendingUp, UserX, Users,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type { AdminPeriod, HomeAdminData, HomeAdminKpi } from "@/lib/home/types";
import { AccionesRapidas, Saludo, Tarjeta } from "./piezas";
import { TarjetaIngresos } from "./tarjeta-ingresos";
import { TarjetaProximas } from "./tarjeta-proximas";
import { TablaEquipo } from "./tabla-equipo";
import s from "./hoy.module.css";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeAdminData;
  period: AdminPeriod;
}

type Acento = "violeta" | "info" | "exito" | "alerta";

/** Ícono y color por métrica, por su etiqueta: igual que la home de siempre. */
function aspectoKpi(label: string): { icono: LucideIcon; acento: Acento } {
  const l = label.toLowerCase();
  if (l.includes("ingreso") || l.includes("revenue")) return { icono: DollarSign, acento: "violeta" };
  if (l.includes("cita")) return { icono: Calendar, acento: "info" };
  if (l.includes("ocupación") || l.includes("ocup")) return { icono: TrendingUp, acento: "exito" };
  if (l.includes("no-show") || l.includes("no show")) return { icono: UserX, acento: "alerta" };
  return { icono: DollarSign, acento: "violeta" };
}

const ICONO_ACENTO: Record<Acento, string> = {
  violeta: "",
  info: s.kpiIconoInfo,
  exito: s.kpiIconoExito,
  alerta: s.kpiIconoAlerta,
};

export function HoyAdmin({ clinic, data, period }: Props) {
  const t = useT();

  const kpis: HomeAdminKpi[] =
    data.kpis.length > 0
      ? data.kpis.slice(0, 4)
      : [
          { label: t("home.admin.kpiRevenue"), value: "—" },
          { label: t("home.admin.kpiAppointments"), value: "—" },
          { label: t("home.admin.kpiOccupancy"), value: "—" },
          { label: t("home.admin.kpiNoShows"), value: "—" },
        ];

  return (
    <>
      <div className={s.cabecera}>
        <Saludo nombreCompleto={clinic.name} cola={t("home.admin.opSummary")} />
        <AccionesRapidas />
      </div>

      <div role="group" aria-label={t("home.admin.kpiGroupAria")} className={s.kpis}>
        {kpis.map((k, i) => (
          <TarjetaKpi
            key={`${k.label}-${i}`}
            kpi={k}
            hero={i === 0}
            // El sparkline solo en ingresos: los seis meses que ya trae el endpoint.
            chispa={i === 0 && data.kpis.length > 0 ? data.revenueSeries.map((p) => p.value) : undefined}
            chispaEtiqueta={t("home.admin.revenueSparkAria")}
          />
        ))}
      </div>

      <div className={s.periodo}>
        <SelectorPeriodo value={period} />
      </div>

      <div className={s.rejillaPrincipal}>
        {/* La gráfica arranca en el mismo periodo que los KPIs: su total es el
            número de la tarjeta de ingresos, no otro recorte. */}
        <TarjetaIngresos period={period} />
        <TarjetaProximas />
      </div>

      <Tarjeta
        icono={Users}
        titulo={t("home.admin.teamPerformanceTitle")}
        sub={t("home.admin.teamPerformanceSubtitle")}
        accion={
          <Link href="/dashboard/reports" className={s.tarjetaEnlace}>
            {t("home.admin.viewFullReport")}
            <ChevronRight size={13} strokeWidth={1.75} aria-hidden />
          </Link>
        }
        lista
      >
        {data.team.length === 0 ? (
          <div className={s.mensajeVacio}>{t("home.admin.noTeamActivity")}</div>
        ) : (
          <TablaEquipo filas={data.team} />
        )}
      </Tarjeta>
    </>
  );
}

/* ── Indicador ───────────────────────────────────────────────────── */

/**
 * Ancho aproximado de cada carácter, en em, con cifras tabulares: el mismo
 * cálculo que `ui/design-system/kpi-card.tsx` para que un importe largo en una
 * tarjeta estrecha baje de tamaño en vez de cortarse a media cifra.
 */
function anchoEm(ch: string): number {
  if (ch >= "0" && ch <= "9") return 0.56;
  if (ch === "," || ch === "." || ch === " ") return 0.28;
  return 0.6;
}

function tamanoAjustado(valor: string): string | undefined {
  if (!valor || /\s/.test(valor)) return undefined;
  let em = 0;
  for (const ch of valor) em += anchoEm(ch);
  if (em <= 0) return undefined;
  return `clamp(13px, ${(100 / em).toFixed(2)}cqi, clamp(25px, 2.1vw, 32px))`;
}

function TarjetaKpi({
  kpi,
  hero,
  chispa,
  chispaEtiqueta,
}: {
  kpi: HomeAdminKpi;
  hero: boolean;
  chispa?: number[];
  chispaEtiqueta: string;
}) {
  const { icono: Icono, acento } = aspectoKpi(kpi.label);
  const ajuste = tamanoAjustado(kpi.value);
  return (
    <div className={`${s.kpi} ${hero ? s.kpiHero : ""}`}>
      <div className={s.kpiArriba}>
        <span className={s.kpiEtiqueta}>{kpi.label}</span>
        <span className={`${s.kpiIcono} ${hero ? "" : ICONO_ACENTO[acento]}`}>
          <Icono size={16} strokeWidth={1.75} aria-hidden />
        </span>
      </div>
      <div className={s.kpiMedidor}>
        <div className={s.kpiValor} style={ajuste ? { fontSize: ajuste } : undefined}>
          {kpi.value}
        </div>
      </div>
      {kpi.delta && (
        <div className={s.kpiDelta}>
          <span className={`${s.kpiPastilla} ${kpi.delta.direction === "up" ? s.kpiSube : s.kpiBaja}`}>
            {kpi.delta.direction === "up" ? (
              <ArrowUpRight size={13} strokeWidth={2} aria-hidden />
            ) : (
              <ArrowDownRight size={13} strokeWidth={2} aria-hidden />
            )}
            {kpi.delta.value}
          </span>
          {kpi.delta.sub && <span>{kpi.delta.sub}</span>}
        </div>
      )}
      <Chispa valores={chispa} etiqueta={chispaEtiqueta} />
    </div>
  );
}

/** Sparkline en SVG inline, sin librería: la misma que la tarjeta de siempre. */
function Chispa({ valores, etiqueta }: { valores?: number[]; etiqueta: string }) {
  if (!valores || valores.length < 2) return null;
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  if (max <= 0) return null;

  const W = 100;
  const H = 26;
  const PADX = 1.5;
  const base = min < 0 ? min : 0;
  const escala = max - base || 1;
  const paso = (W - PADX * 2) / (valores.length - 1);
  const puntos = valores.map((v, i) => {
    const x = PADX + i * paso;
    const y = H - 1.5 - ((v - base) / escala) * (H - 3);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const linea = puntos.join(" ");
  const area = `${PADX},${H} ${linea} ${(PADX + (valores.length - 1) * paso).toFixed(2)},${H}`;

  return (
    <svg
      className={s.kpiChispa}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={etiqueta}
    >
      <polygon points={area} fill="currentColor" opacity={0.12} />
      <polyline
        points={linea}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ── Selector de periodo ─────────────────────────────────────────── */

const PERIODOS: Array<{ value: AdminPeriod; labelKey: string }> = [
  { value: "day",     labelKey: "home.adminPeriod.day" },
  { value: "month",   labelKey: "home.adminPeriod.month" },
  { value: "quarter", labelKey: "home.adminPeriod.quarter" },
  { value: "year",    labelKey: "home.adminPeriod.year" },
];

function SelectorPeriodo({ value }: { value: AdminPeriod }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const elegir = (p: AdminPeriod) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", p);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div role="tablist" aria-label={t("home.adminPeriod.ariaLabel")} className={s.segmentado}>
      {PERIODOS.map((p) => {
        const activo = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={activo}
            className={`${s.segmento} ${activo ? s.segmentoActivo : ""}`}
            onClick={() => elegir(p.value)}
          >
            {t(p.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
