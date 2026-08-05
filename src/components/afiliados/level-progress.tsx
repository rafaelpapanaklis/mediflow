// Nivel del afiliado (bronce/plata/oro) + lo que gana por cada clínica.
// Con el programa en modo "fixed" los % ya no aplican: en su lugar se pinta la
// rejilla de montos por plan de la modalidad vigente del afiliado (los montos
// llegan ya calculados desde el server vía props).
// Server-safe: SIN "use client" (solo render de props, sin hooks ni handlers).
//
// ESTILO: lenguaje del panel de afiliados — primitivas de ui/panel-ui.tsx y
// clases `dcafp-*` de src/app/afiliados/panel.css. Aquí NO se declaran colores
// propios: el nivel se distingue por el tono del chip, no por una paleta de
// metales (la tenía cuando el panel era oscuro; ahora es claro).
//
// NI UN MONTO NI UN PORCENTAJE ESCRITO A MANO: todo sale de `info`/`amounts`.
import { LEVEL_LABELS, type AffiliateLevel, type LevelInfo } from "@/lib/affiliate-levels";
// payout-core es PURO (sin Prisma): el componente sigue siendo server-safe.
import { PAYOUT_MODE_LABELS, type PayoutMode, type ProgramMode } from "@/lib/affiliates/payout-core";
import { formatCurrency } from "@/lib/utils";
import {
  Chip,
  Eyebrow,
  Footnote,
  Note,
  PanelCard,
  ProgressBar,
  Stat,
  StatRow,
  type ChipTone,
} from "@/components/afiliados/ui/panel-ui";

// Tono del chip por nivel: oro = marca (violeta), bronce = ámbar, plata =
// neutro. Es la única señal de color que queda del metal.
const LEVEL_TONES: Record<AffiliateLevel, ChipTone> = {
  bronze: "amber",
  silver: "neutral",
  gold: "brand",
};

/** Monto que paga el programa por un plan, ya resuelto en el server. */
export interface LevelAmountRow {
  /** Id del plan ("BASIC" | "PRO" | "CLINIC"). */
  plan: string;
  /** Etiqueta real del plan (sale de plan_configs, nunca escrita a mano). */
  label: string;
  /** Fijo que se paga cada mes mientras la clínica siga pagando. */
  recurringMxn: number;
  /** Fijo que se paga UNA sola vez por clínica. */
  oneTimeMxn: number;
}

export interface LevelProgressProps {
  info: LevelInfo;
  /**
   * Modo del programa. "fixed" = montos fijos por plan (los % del nivel ya no
   * aplican); "pct" o ausente = escalera de porcentajes de siempre.
   */
  mode?: ProgramMode;
  /** Modalidad vigente del afiliado (decide qué columna de montos se muestra). */
  payoutMode?: PayoutMode;
  /** Montos por plan ya calculados en el server (solo se usan en modo "fixed"). */
  amounts?: LevelAmountRow[];
}

export function LevelProgress({ info, mode, payoutMode, amounts }: LevelProgressProps) {
  const isGold = !info.legacy && info.level === "gold";

  // Modo "fixed": los % del nivel dejan de aplicar, así que NO se pinta ni el
  // chip de % ni la barra de progreso (sería mentirle al afiliado).
  const isFixed = mode === "fixed";
  const effectiveMode: PayoutMode = payoutMode === "onetime" ? "onetime" : "recurring";
  // Un plan en $0 es un plan que el programa apagó: no genera comisión, no se lista.
  const amountRows = isFixed
    ? (amounts ?? []).filter(
        (a) => (effectiveMode === "onetime" ? a.oneTimeMxn : a.recurringMxn) > 0,
      )
    : [];
  // El sufijo depende de la modalidad, nunca del plan.
  const unitSuffix = effectiveMode === "onetime" ? " única vez" : " /mes";

  const levelTone: ChipTone = LEVEL_TONES[info.level] ?? "neutral";
  // El punto del chip solo se pinta en los tonos que tienen color: panel.css no
  // le da fondo al de `neutral`, y sin esto plata dejaría un hueco de 8px.
  const showDot = levelTone !== "neutral";

  // Singular/plural correcto en español.
  const activeLabel = info.activeCount === 1 ? "Clínica activa" : "Clínicas activas";

  // La barra habla en clínicas, no en porcentaje: ProgressBar calcula el ancho
  // y de paso publica los valores accesibles. Oro = llena; sin umbral siguiente
  // no hay avance que mostrar (0), igual que antes.
  const nextThreshold = info.nextThreshold != null && info.nextThreshold > 0 ? info.nextThreshold : 0;
  const hasNext = !isGold && nextThreshold > 0;
  const barMax = isGold ? 1 : hasNext ? nextThreshold : 1;
  const barValue = isGold ? 1 : hasNext ? info.activeCount : 0;
  const barLabel = isGold
    ? "Nivel máximo alcanzado"
    : info.nextLevel != null
      ? `Avance hacia nivel ${LEVEL_LABELS[info.nextLevel]}`
      : "Avance hacia el siguiente nivel";

  const missingLabel =
    info.nextLevel != null && info.missing != null
      ? info.missing === 1
        ? `Te falta 1 clínica activa para ${LEVEL_LABELS[info.nextLevel]} (${info.nextPct}%)`
        : `Te faltan ${info.missing} clínicas activas para ${LEVEL_LABELS[info.nextLevel]} (${info.nextPct}%)`
      : null;
  const progressNote = isGold ? "Estás en el nivel máximo" : missingLabel;

  return (
    <PanelCard>
      {/* Nivel + modalidad (o el % vigente cuando el programa va por niveles). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          minWidth: 0,
          marginBottom: 16,
        }}
      >
        <Chip tone={levelTone} dot={showDot}>
          Nivel {LEVEL_LABELS[info.level]}
        </Chip>
        <Chip tone="brand">
          {/* El fragmento conserva el markup exacto del modo % (mismos nodos). */}
          {isFixed ? PAYOUT_MODE_LABELS[effectiveMode] : <>{info.pct}% de comisión</>}
        </Chip>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, marginBottom: 16 }}>
        {isFixed ? (
          // Programa con montos fijos: la rejilla real de lo que gana por
          // clínica, en su modalidad vigente. Sin % ni barra hacia otro %.
          <>
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
              <Eyebrow>Ganas por cada clínica</Eyebrow>
              <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--dcafp-ink-3)", minWidth: 0 }}>
                {effectiveMode === "onetime"
                  ? "Un solo pago por clínica"
                  : "Cada mes que la clínica siga pagando"}
              </span>
            </div>
            {amountRows.length === 0 ? (
              <Note>
                Tus montos por plan se están configurando. En cuanto estén listos los verás aquí.
              </Note>
            ) : (
              <div className="dcafp-plangrid">
                {amountRows.map((a) => (
                  <div key={a.plan} className="dcafp-planbox">
                    <div className="dcafp-planbox__k">{a.label}</div>
                    <div className="dcafp-planbox__v">
                      {formatCurrency(effectiveMode === "onetime" ? a.oneTimeMxn : a.recurringMxn)}
                      <span className="dcafp-planbox__u">{unitSuffix}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : info.legacy ? (
          // Modo legacy (tabla de config sin aplicar): % fijo, sin barra.
          <Note>Comisión fija de {info.pct}%. Los niveles se activan próximamente.</Note>
        ) : (
          <>
            <ProgressBar value={barValue} max={barMax} label={barLabel} />
            {progressNote ? <Footnote>{progressNote}</Footnote> : null}
          </>
        )}
      </div>

      {/* La cifra que mueve el nivel. En cero se apaga a gris: es "todavía no",
          no una pérdida. */}
      <StatRow>
        <Stat
          label={activeLabel}
          value={info.activeCount}
          tone={info.activeCount === 0 ? "idle" : "default"}
        />
      </StatRow>
    </PanelCard>
  );
}
