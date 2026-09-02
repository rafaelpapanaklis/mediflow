import { C, pts, toScreen } from "@/lib/floor-plan/iso";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LOS TRES RESPALDOS ESTÁTICOS DE LAS ESCENAS 3D.
 *
 * Esto es lo que viaja en el HTML y lo que ve TODO el mundo en el primer
 * pintado. Y es lo que ve PARA SIEMPRE quien pidió menos movimiento, quien
 * no tiene WebGL y quien nunca desplaza hasta la sección. Por eso no son
 * marcadores de posición ni cajas grises: son dibujos terminados.
 *
 * Todo es SVG en línea —cero peticiones, cero archivos en /public— y
 * `aria-hidden`: el texto alternativo lo pone el anfitrión de la escena
 * con `role="img"` y su etiqueta.
 *
 * 🔴 LA CLÍNICA ISOMÉTRICA NO INVENTA SU GEOMETRÍA. Usa `toScreen`, `pts`
 * y la constante `C` de src/lib/floor-plan/iso.ts, que es la retícula con
 * la que el producto dibuja un piso clínico. Son funciones PURAS (nada de
 * prisma, nada de sesión), así que importarlas no arrastra el panel a una
 * página pública — y si mañana cambia la proyección, este dibujo cambia
 * con ella en vez de quedarse en otra perspectiva.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── 1 · La arcada (portada) ─────────────────────────────────────────────

/**
 * Dieciséis dientes sobre una parábola, vistos desde arriba: incisivos al
 * frente, molares al fondo. Las posiciones se calculan una vez al cargar
 * el módulo —matemática pura, mismo resultado en el servidor y en el
 * navegador— así que no hay ni un número dibujado a mano.
 */
const ARCO_A = 148; // media anchura de la arcada
const ARCO_B = 186; // profundidad de la parábola

interface Diente {
  x: number;
  y: number;
  w: number;
  h: number;
  giro: number;
}

const DIENTES: Diente[] = Array.from({ length: 16 }, (_, i) => {
  const t = -1 + (2 * i) / 15;
  const x = 216 + ARCO_A * t;
  const y = 52 + ARCO_B * t * t;
  // Tangente de la parábola en t: (dx/dt, dy/dt) = (A, 2·B·t). El diente
  // gira con ella, que es lo que hace que la fila se lea como un arco y no
  // como dieciséis rectángulos alineados.
  const giro = (Math.atan2(2 * ARCO_B * t, ARCO_A) * 180) / Math.PI;
  // Los de atrás son molares (anchos); los de en medio, incisivos.
  const w = 15 + 11 * Math.pow(Math.abs(t), 1.35);
  return { x, y, w, h: w * 0.94, giro };
});

export function ArcadaEstatica() {
  return (
    <svg
      className="dcei-static dcei-static--arcada"
      viewBox="0 0 432 300"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="dcei-marfil" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#fdfbf6" />
          <stop offset="55%" stopColor="#efe7d6" />
          <stop offset="100%" stopColor="#d8cbb2" />
        </linearGradient>
        <radialGradient id="dcei-halo" cx="50%" cy="42%" r="58%">
          <stop offset="0%" stopColor="#4665ac" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#4665ac" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dcei-encia" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a3f70" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#121a2e" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      <ellipse cx="216" cy="150" rx="200" ry="140" fill="url(#dcei-halo)" />

      {/* La encía: la misma parábola, engrosada, por debajo de los dientes. */}
      <path
        d={`M ${216 - ARCO_A - 26} ${52 + ARCO_B + 4}
            Q 216 ${52 - 74} ${216 + ARCO_A + 26} ${52 + ARCO_B + 4}
            L ${216 + ARCO_A - 4} ${52 + ARCO_B + 26}
            Q 216 ${52 + 34} ${216 - ARCO_A + 4} ${52 + ARCO_B + 26} Z`}
        fill="url(#dcei-encia)"
      />

      {DIENTES.map((d, i) => (
        <g key={i} transform={`translate(${d.x.toFixed(1)} ${d.y.toFixed(1)}) rotate(${d.giro.toFixed(1)})`}>
          <rect
            x={(-d.w / 2).toFixed(1)}
            y={(-d.h / 2 + 3).toFixed(1)}
            width={d.w.toFixed(1)}
            height={d.h.toFixed(1)}
            rx={(d.w * 0.32).toFixed(1)}
            fill="#121a2e"
            opacity="0.28"
          />
          <rect
            x={(-d.w / 2).toFixed(1)}
            y={(-d.h / 2).toFixed(1)}
            width={d.w.toFixed(1)}
            height={d.h.toFixed(1)}
            rx={(d.w * 0.32).toFixed(1)}
            fill="url(#dcei-marfil)"
            stroke="#c9bda4"
            strokeWidth="0.6"
          />
          <rect
            x={(-d.w / 2 + 2.4).toFixed(1)}
            y={(-d.h / 2 + 2.2).toFixed(1)}
            width={(d.w * 0.34).toFixed(1)}
            height={(d.h * 0.5).toFixed(1)}
            rx="3"
            fill="#ffffff"
            opacity="0.5"
          />
        </g>
      ))}
    </svg>
  );
}

// ── 2 · El volumen tomográfico (imagenología) ───────────────────────────

/**
 * La lectura de un volumen: la caja que lo contiene, el hueso en tonos de
 * marfil sobre marrón —el mismo mapa de color que usa el visor del
 * expediente— y el corte que lo recorre, con su regla en milímetros.
 *
 * Es una RECREACIÓN dibujada a mano para esta página. No hay ningún
 * estudio real aquí: una tomografía de una persona no se publica.
 */
const CORTES = [0.18, 0.3, 0.42, 0.54, 0.66, 0.78];

export function VolumenEstatica() {
  return (
    <svg
      className="dcei-static dcei-static--volumen"
      viewBox="0 0 420 300"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="dcei-hueso" cx="50%" cy="46%" r="52%">
          <stop offset="0%" stopColor="#f7edd8" />
          <stop offset="42%" stopColor="#e2c79b" />
          <stop offset="72%" stopColor="#a87f4e" />
          <stop offset="100%" stopColor="#3a2a1c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dcei-corte" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9bb0dc" stopOpacity="0" />
          <stop offset="18%" stopColor="#c4d1ec" stopOpacity="0.95" />
          <stop offset="82%" stopColor="#c4d1ec" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#9bb0dc" stopOpacity="0" />
        </linearGradient>
        <clipPath id="dcei-caja">
          <rect x="72" y="34" width="276" height="232" rx="6" />
        </clipPath>
      </defs>

      <rect x="72" y="34" width="276" height="232" rx="6" fill="#0d1424" />

      <g clipPath="url(#dcei-caja)">
        {/* El maxilar reconstruido: una herradura de hueso vista de frente. */}
        <path
          d="M120 214 C 118 118, 168 66, 210 66 C 252 66, 302 118, 300 214
             L 268 214 C 270 140, 244 100, 210 100 C 176 100, 150 140, 152 214 Z"
          fill="url(#dcei-hueso)"
        />
        <ellipse cx="210" cy="176" rx="96" ry="62" fill="url(#dcei-hueso)" opacity="0.55" />

        {/* Las láminas del volumen: lo que de verdad es un estudio, cortes. */}
        {CORTES.map((t) => (
          <line
            key={t}
            x1="72"
            x2="348"
            y1={34 + 232 * t}
            y2={34 + 232 * t}
            stroke="#f2f5fb"
            strokeOpacity="0.07"
            strokeWidth="1"
          />
        ))}

        {/* El corte activo. */}
        <rect x="72" y="150" width="276" height="3" fill="url(#dcei-corte)" />
        <rect x="72" y="146" width="276" height="11" fill="#c4d1ec" opacity="0.09" />
      </g>

      {/* La caja del volumen y su cruz. */}
      <rect
        x="72"
        y="34"
        width="276"
        height="232"
        rx="6"
        fill="none"
        stroke="#4665ac"
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      <line x1="210" y1="34" x2="210" y2="266" stroke="#9bb0dc" strokeOpacity="0.32" strokeDasharray="4 6" />

      {/* Regla en milímetros al costado: la medida es del producto, no del dibujo. */}
      {Array.from({ length: 9 }, (_, i) => (
        <line
          key={i}
          x1="60"
          x2={i % 2 === 0 ? 70 : 66}
          y1={44 + i * 27}
          y2={44 + i * 27}
          stroke="#9bb0dc"
          strokeOpacity="0.5"
          strokeWidth="1"
        />
      ))}
      <line x1="60" y1="44" x2="60" y2="260" stroke="#9bb0dc" strokeOpacity="0.35" strokeWidth="1" />
    </svg>
  );
}

// ── 3 · La clínica isométrica (sedes) ───────────────────────────────────

/** Origen en pantalla del vértice (0,0) de la retícula. */
const OX = 218;
const OY = 42;
const COLS = 7;
const ROWS = 5;

/** Dónde va cada sillón. Dos filas, como un piso clínico de verdad. */
const SILLONES: Array<{ col: number; row: number; activo: boolean }> = [
  { col: 0.4, row: 0.4, activo: true },
  { col: 2.3, row: 0.4, activo: true },
  { col: 4.2, row: 0.4, activo: false },
  { col: 0.4, row: 2.6, activo: true },
  { col: 2.3, row: 2.6, activo: false },
  { col: 4.2, row: 2.6, activo: true },
];

function punto(col: number, row: number): [number, number] {
  return toScreen(col, row, OX, OY);
}

/** Una caja isométrica: las tres caras, en el orden que las tapa bien. */
function Caja({
  col,
  row,
  cw,
  rh,
  ph,
  top,
  left,
  right,
  opacity,
}: {
  col: number;
  row: number;
  cw: number;
  rh: number;
  ph: number;
  top: string;
  left: string;
  right: string;
  opacity?: number;
}) {
  const g = (c: number, r: number) => punto(col + c, row + r);
  const A = g(0, 0);
  const B = g(cw, 0);
  const D = g(0, rh);
  const up = (p: [number, number]): [number, number] => [p[0], p[1] - ph];
  const Au = up(A);
  const Bu = up(B);
  const Cu = up(g(cw, rh));
  const Du = up(D);
  return (
    <g opacity={opacity ?? 1}>
      <polygon points={pts([A, B, Bu, Au])} fill={right} />
      <polygon points={pts([A, Au, Du, D])} fill={left} />
      <polygon points={pts([Au, Bu, Cu, Du])} fill={top} />
    </g>
  );
}

/**
 * Un sillón dental estilizado: base, asiento, respaldo y el brazo de la
 * lámpara. Cuatro cajas isométricas; nada más hace falta para que se lea
 * lo que es desde tres metros.
 */
function Sillon({ col, row, activo }: { col: number; row: number; activo: boolean }) {
  const t = activo ? "#c4d1ec" : "#e3e9f6";
  const l = activo ? "#4665ac" : "#9bb0dc";
  const r = activo ? "#6c88c6" : "#c4d1ec";
  return (
    <g>
      <Caja col={col} row={row} cw={1.5} rh={0.9} ph={7} top="#23345a" left="#1e2b4a" right="#2a3f70" opacity={0.3} />
      <Caja col={col + 0.15} row={row + 0.12} cw={1.2} rh={0.66} ph={16} top={t} left={l} right={r} />
      <Caja col={col + 0.15} row={row + 0.12} cw={0.34} rh={0.66} ph={40} top={t} left={l} right={r} />
      <Caja col={col + 1.16} row={row + 0.3} cw={0.16} rh={0.3} ph={54} top="#e3e9f6" left="#6c88c6" right="#9bb0dc" />
      {activo ? (
        <circle
          cx={punto(col + 1.24, row + 0.45)[0]}
          cy={punto(col + 1.24, row + 0.45)[1] - 58}
          r="7"
          fill="#fcd34d"
          opacity="0.85"
        />
      ) : null}
    </g>
  );
}

export function ClinicaEstatica() {
  const ancho = (COLS + ROWS) * C + 80;
  const alto = (COLS + ROWS) * (C / 2) + 130;
  return (
    <svg
      className="dcei-static dcei-static--clinica"
      viewBox={`0 0 ${ancho} ${alto}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {/* El piso, celda por celda: la misma retícula del producto. */}
      {Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) => {
          const A = punto(c, r);
          const B = punto(c + 1, r);
          const Cc = punto(c + 1, r + 1);
          const D = punto(c, r + 1);
          const par = (c + r) % 2 === 0;
          return (
            <polygon
              key={`${c}-${r}`}
              points={pts([A, B, Cc, D])}
              fill={par ? "#e8edf8" : "#f2f5fb"}
              stroke="#c4d1ec"
              strokeWidth="0.5"
            />
          );
        }),
      )}

      {/* Muro bajo al fondo: le da suelo a la escena sin taparla. */}
      <Caja col={0} row={0} cw={COLS} rh={0.16} ph={40} top="#dbe3f4" left="#c4d1ec" right="#eef2fa" />
      <Caja col={0} row={0} cw={0.16} rh={ROWS} ph={40} top="#dbe3f4" left="#c4d1ec" right="#eef2fa" />

      {SILLONES.map((s) => (
        <Sillon key={`${s.col}-${s.row}`} col={s.col + 0.9} row={s.row + 0.9} activo={s.activo} />
      ))}
    </svg>
  );
}
