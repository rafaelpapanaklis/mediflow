"use client";

import { memo } from "react";
import { X, FileText } from "lucide-react";
import { toScreen } from "@/lib/floor-plan/iso";
import type { TFunction } from "@/i18n/t";
import {
  STATUS_COLORS,
  type ChairStatus,
  type ElementType,
  type LayoutElement,
  type LiveAppointment,
} from "@/lib/floor-plan/elements";
import {
  appointmentProgress,
  fmtHM,
  maskPatient,
} from "@/lib/floor-plan/live-mode";
import styles from "./floor-look.module.css";

/**
 * EL ASPECTO DEL PISO — lo que el plano del instituto trajo y aquí faltaba.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Cinco piezas, ninguna con estado propio: la losa y las sombras van
 * DENTRO del SVG del editor; los contadores, la leyenda y la tarjeta van
 * ENCIMA del lienzo, en HTML. Todas reciben ya masticado lo que pintan —
 * quien decide sigue siendo layout-client.tsx.
 *
 * 🔴 LA MÁSCARA DEL PACIENTE NO SE RELAJA. La tarjeta llama a
 * `maskPatient(nombre, showFullNames)` con la MISMA bandera que el panel
 * de estado y el tooltip (`clinic.liveModeShowPatientNames`). Si la
 * clínica pidió iniciales, aquí también son iniciales — abrir una tarjeta
 * no es una puerta trasera al nombre completo.
 *
 * ⛔ De `src/lib/floor-plan/` solo se IMPORTA (la retícula isométrica y
 * los helpers del modo En Vivo). No se toca ni un renglón: esas funciones
 * también las leen el mundo 3D, /live y el plano del instituto.
 */

/* ═══════════════════════════════════════════════════════════════════════
   1 · LA LOSA — el piso deja de flotar
   ═══════════════════════════════════════════════════════════════════════ */

/** Grosor de la losa, en píxeles de pantalla. */
const SLAB_DEPTH = 18;
/** Cuánto sobresale la losa por fuera de la rejilla, en celdas. */
const SLAB_PAD = 0.45;

/**
 * El piso como un OBJETO con grosor: la cara de arriba (un pelo más grande
 * que la rejilla) más las dos caras que se ven desde este ángulo. Sin
 * esto, las baldosas terminan en un borde de sierra contra el fondo y el
 * plano flota.
 *
 * ⚠️ Nada de `filter: drop-shadow()` aquí, que fue lo primero que se
 * probó. La losa mide unos 2 600 × 1 150 px: un filtro sobre ella obliga a
 * rasterizar esa superficie entera en cada frame del desplazamiento con la
 * mano. El zócalo cuesta tres polígonos y da MÁS sensación de volumen.
 *
 * La cara de abajo-izquierda va más oscura que la de abajo-derecha, que es
 * de dónde viene la luz en todo el catálogo isométrico (elements-dental.ts
 * pinta sus cajas con el mismo criterio).
 */
export function FloorSlab({
  ox,
  oy,
  cols,
  rows,
}: {
  ox: number;
  oy: number;
  cols: number;
  rows: number;
}) {
  const p = SLAB_PAD;
  const arriba = toScreen(-p, -p, ox, oy);
  const derecha = toScreen(cols + p, -p, ox, oy);
  const abajo = toScreen(cols + p, rows + p, ox, oy);
  const izquierda = toScreen(-p, rows + p, ox, oy);
  const baja = ([x, y]: [number, number]): [number, number] => [x, y + SLAB_DEPTH];

  const pts = (arr: Array<[number, number]>) =>
    arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <g aria-hidden="true">
      <polygon
        className={styles.slabSideLeft}
        points={pts([izquierda, abajo, baja(abajo), baja(izquierda)])}
      />
      <polygon
        className={styles.slabSideRight}
        points={pts([derecha, abajo, baja(abajo), baja(derecha)])}
      />
      <polygon
        className={styles.slabTop}
        points={pts([arriba, derecha, abajo, izquierda])}
      />
    </g>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   2 · LAS SOMBRAS DE CONTACTO
   ═══════════════════════════════════════════════════════════════════════ */

/** Desplazamiento de la sombra: la luz entra por arriba a la izquierda. */
const SHADOW_DX = 7;
const SHADOW_DY = 5;

/** id del desenfoque compartido. Vive aquí, junto a quien lo usa. */
const SHADOW_FILTER_ID = "mcFloorShadow";

/**
 * La huella de un mueble en el piso, ya desplazada.
 *
 * Sale de `type.w`/`type.h` (el tamaño del mueble en celdas) y no de su
 * dibujo: el catálogo devuelve cadenas SVG y no hay forma de medir su
 * silueta sin montarla. Para asentar el mueble basta la caja.
 */
function huella(
  el: LayoutElement,
  td: ElementType,
  col: number,
  row: number,
  ox: number,
  oy: number,
) {
  const [sx, sy] = toScreen(col, row, ox, oy);
  const bx = sx + SHADOW_DX;
  const by = sy + SHADOW_DY;
  const corners: Array<[number, number]> = [
    toScreen(0, 0, bx, by),
    toScreen(td.w, 0, bx, by),
    toScreen(td.w, td.h, bx, by),
    toScreen(0, td.h, bx, by),
  ];
  return (
    <polygon
      key={el.id}
      points={corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
      // La sombra gira con el mueble y alrededor del MISMO punto que usa
      // su dibujo; si no, a 90° la sombra se queda donde estaba.
      transform={el.rotation !== 0 ? `rotate(${el.rotation} ${sx} ${sy})` : undefined}
    />
  );
}

/**
 * Las sombras quietas: TODAS en un grupo con UN desenfoque.
 *
 * ⚠️ `memo` y `skipId` no son adorno. Un filtro SVG obliga al navegador a
 * rasterizar la caja entera del grupo —el piso completo, ~2200 × 1400—
 * cada vez que el grupo cambia. Si el mueble que se está arrastrando
 * viviera aquí dentro, ese rasterizado se repetiría en CADA frame del
 * arrastre. Así el grupo grande no cambia mientras se arrastra y la
 * sombra del que se mueve se pinta aparte, con su caja de un mueble.
 */
const StaticShadows = memo(function StaticShadows({
  elements,
  byKey,
  ox,
  oy,
  skipId,
}: {
  elements: LayoutElement[];
  byKey: Map<string, ElementType>;
  ox: number;
  oy: number;
  skipId: number | null;
}) {
  return (
    <g
      className={styles.shadowLayer}
      filter={`url(#${SHADOW_FILTER_ID})`}
      aria-hidden="true"
    >
      {elements.map((el) => {
        if (el.id === skipId) return null;
        const td = byKey.get(el.type);
        if (!td) return null;
        return huella(el, td, el.col, el.row, ox, oy);
      })}
    </g>
  );
});

export function FloorShadows({
  elements,
  byKey,
  ox,
  oy,
  movingId,
  movingPosition,
}: {
  elements: LayoutElement[];
  byKey: Map<string, ElementType>;
  ox: number;
  oy: number;
  movingId: number | null;
  movingPosition: { col: number; row: number } | null;
}) {
  const moving = movingId === null ? null : elements.find((e) => e.id === movingId) ?? null;
  const movingType = moving ? byKey.get(moving.type) ?? null : null;

  return (
    <>
      {/* El desenfoque vive junto a quien lo usa: `<defs>` vale en
          cualquier punto del SVG y así nadie tiene que acordarse de
          declararlo en la pantalla anfitriona. */}
      <defs>
        <filter id={SHADOW_FILTER_ID} x="-6%" y="-6%" width="112%" height="112%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
      </defs>
      <StaticShadows
        elements={elements}
        byKey={byKey}
        ox={ox}
        oy={oy}
        skipId={movingId}
      />
      {moving && movingType && (
        <g
          className={styles.shadowLayer}
          filter={`url(#${SHADOW_FILTER_ID})`}
          aria-hidden="true"
        >
          {huella(
            moving,
            movingType,
            movingPosition ? movingPosition.col : moving.col,
            movingPosition ? movingPosition.row : moving.row,
            ox,
            oy,
          )}
        </g>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   3 · LOS CONTADORES DE ARRIBA
   ═══════════════════════════════════════════════════════════════════════ */

export interface StatusCounts {
  libre: number;
  proximo: number;
  ocupado: number;
}

const ESTADOS: ChairStatus[] = ["libre", "proximo", "ocupado"];

const COUNT_CLASS: Record<ChairStatus, string> = {
  libre: styles.countLibre,
  proximo: styles.countProximo,
  ocupado: styles.countOcupado,
};

const DOT_CLASS: Record<ChairStatus, string> = {
  libre: styles.dotLibre,
  proximo: styles.dotProximo,
  ocupado: styles.dotOcupado,
};

const COUNT_KEY: Record<ChairStatus, string> = {
  libre: "pages.clinicLayout.statusCountFree",
  proximo: "pages.clinicLayout.statusCountUpcoming",
  ocupado: "pages.clinicLayout.statusCountOccupied",
};

const DETAIL_KEY: Record<ChairStatus, string> = {
  libre: "pages.clinicLayout.statusDetailFree",
  proximo: "pages.clinicLayout.statusDetailUpcoming",
  ocupado: "pages.clinicLayout.statusDetailOccupied",
};

const LABEL_KEY: Record<ChairStatus, string> = {
  libre: "pages.clinicLayout.legendFree",
  proximo: "pages.clinicLayout.legendUpcoming",
  ocupado: "pages.clinicLayout.legendOccupied",
};

/**
 * Cuántos sillones hay en cada estado, encima del piso. Responde de un
 * vistazo "¿queda alguno libre?"; el DÓNDE lo contesta el piso.
 */
export function LiveCounters({ counts, t }: { counts: StatusCounts; t: TFunction }) {
  return (
    <div
      className={styles.counters}
      role="status"
      aria-live="polite"
      aria-label={t("pages.clinicLayout.statusCountsLabel")}
    >
      {ESTADOS.map((s) => (
        <span
          key={s}
          className={`${styles.count} ${COUNT_CLASS[s]}`}
          title={t(DETAIL_KEY[s])}
        >
          <b>{counts[s]}</b> {t(COUNT_KEY[s])}
        </span>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   4 · LA LEYENDA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * En vivo: qué significa cada color y cómo se abre una tarjeta. Armando:
 * la única línea que dice cómo se pone un mueble (el catálogo de la
 * izquierda no lo explica en ningún sitio).
 *
 * ♿ El color nunca va solo: cada punto lleva su palabra al lado, y la
 * tarjeta que se abre repite el estado escrito.
 */
export function FloorLegend({ live, t }: { live: boolean; t: TFunction }) {
  return (
    <div className={styles.legend}>
      {live && (
        <>
          <p className={styles.legendTitle}>{t("pages.clinicLayout.legendTitle")}</p>
          <ul className={styles.legendItems}>
            {ESTADOS.map((s) => (
              <li key={s} title={t(DETAIL_KEY[s])}>
                <span className={`${styles.dot} ${DOT_CLASS[s]}`} aria-hidden="true" />
                <b>{t(LABEL_KEY[s])}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={styles.legendHint}>
        {live
          ? t("pages.clinicLayout.legendHintLive")
          : t("pages.clinicLayout.legendHintEdit")}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   5 · LA TARJETA DEL SILLÓN
   ═══════════════════════════════════════════════════════════════════════ */

const CARD_CLASS: Record<ChairStatus, string> = {
  libre: "",
  proximo: styles.cardProximo,
  ocupado: styles.cardOcupado,
};

const CARD_STATE_CLASS: Record<ChairStatus, string> = {
  libre: "",
  proximo: styles.cardStateProximo,
  ocupado: styles.cardStateOcupado,
};

/** "42 min", "1 h 05". Tres cifras de minutos no se leen. */
function duracion(min: number, t: TFunction): string {
  if (min < 60) return t("pages.clinicLayout.durMinutes", { count: min });
  return t("pages.clinicLayout.durHours", {
    hours: Math.floor(min / 60),
    minutes: (min % 60).toString().padStart(2, "0"),
  });
}

export interface ChairCardData {
  chairName: string;
  status: ChairStatus;
  /** Cita en curso en el momento que se está viendo, o null. */
  current: LiveAppointment | null;
  /** Siguiente cita futura del sillón, o null. */
  next: LiveAppointment | null;
  /** Las que vienen después de la siguiente (máximo 4 se pintan). */
  upcoming: LiveAppointment[];
}

/**
 * Lo que se abre al clicar un sillón en modo En Vivo. NO pide nada al
 * servidor: sale de las mismas citas que ya pintaron el halo, así que no
 * puede contradecir al piso.
 */
export function ChairCard({
  data,
  viewTime,
  showFullNames,
  onClose,
  onOpenRecord,
  t,
}: {
  data: ChairCardData;
  viewTime: Date;
  showFullNames: boolean;
  onClose: () => void;
  onOpenRecord: (apt: LiveAppointment) => void;
  t: TFunction;
}) {
  const { chairName, status, current, next, upcoming } = data;
  const color = STATUS_COLORS[status];
  const elapsedMin = current
    ? Math.max(0, Math.floor((viewTime.getTime() - current.start.getTime()) / 60_000))
    : null;
  const startsInMin = next
    ? Math.max(0, Math.round((next.start.getTime() - viewTime.getTime()) / 60_000))
    : null;

  return (
    <aside
      className={`${styles.card} ${CARD_CLASS[status]}`}
      /* `region` y no `dialog`: no atrapa el foco ni bloquea el piso de
         atrás, así que prometer un diálogo sería mentirle al lector de
         pantalla. Se cierra con la X, con Esc o clicando el piso. */
      role="region"
      aria-label={chairName}
    >
      <header className={styles.cardHead}>
        <div>
          <p className={styles.cardChair}>{chairName}</p>
          <span className={`${styles.cardState} ${CARD_STATE_CLASS[status]}`}>
            {t(LABEL_KEY[status])}
          </span>
        </div>
        <button
          type="button"
          className={styles.cardClose}
          onClick={onClose}
          aria-label={t("pages.clinicLayout.cardClose")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {current ? (
        <div className={styles.cardBody}>
          <p className={styles.cardKicker}>{t("pages.clinicLayout.cardPatient")}</p>
          <p className={styles.cardName}>{maskPatient(current.patient, showFullNames)}</p>
          <p className={styles.cardLine}>
            <span className={styles.cardKey}>{t("pages.clinicLayout.cardTreatment")}</span>{" "}
            {current.treatment}
          </p>
          <p className={styles.cardLine}>
            <span className={styles.cardKey}>{t("pages.clinicLayout.cardDoctor")}</span>{" "}
            {current.doctor}
          </p>
          <p className={styles.cardClock}>
            {t("pages.clinicLayout.cardSince", { time: fmtHM(current.start) })}
            {elapsedMin !== null
              ? ` · ${t("pages.clinicLayout.cardElapsed", { duration: duracion(elapsedMin, t) })}`
              : ""}
          </p>
          <div className={styles.cardBar}>
            <div
              style={{
                width: `${appointmentProgress(current, viewTime) * 100}%`,
                background: color,
              }}
            />
          </div>
          {current.patientId ? (
            <button
              type="button"
              className={styles.cardBtn}
              onClick={() => onOpenRecord(current)}
            >
              <FileText size={13} aria-hidden="true" />{" "}
              {t("pages.clinicLayout.openRecordOdontogram")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.cardBody}>
          {next ? (
            <p className={`${styles.cardClock} ${styles.cardClockStrong}`}>
              {status === "proximo"
                ? t("pages.clinicLayout.cardNextAt", { time: fmtHM(next.start) })
                : t("pages.clinicLayout.cardFreeNext", { time: fmtHM(next.start) })}
              {startsInMin !== null
                ? ` · ${t("pages.clinicLayout.cardStartsIn", { duration: duracion(startsInMin, t) })}`
                : ""}
            </p>
          ) : (
            <p className={styles.cardClock}>{t("pages.clinicLayout.cardFreeNothing")}</p>
          )}

          {upcoming.length > 0 && (
            <>
              <p className={styles.cardKicker}>{t("pages.clinicLayout.cardComingUp")}</p>
              <ul className={styles.cardList}>
                {upcoming.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <b>{fmtHM(a.start)}</b> {maskPatient(a.patient, showFullNames)}
                    {a.treatment ? ` · ${a.treatment}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
