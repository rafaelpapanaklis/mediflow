/**
 * Los íconos 3D del BONO POR CLÍNICAS ACTIVAS de /afiliados.
 *
 * Mismo lenguaje que `escenas.tsx`: CSS PURO —`perspective` +
 * `transform-style: preserve-3d`— sin WebGL, sin librerías y sin una sola
 * imagen. Las piezas animan SÓLO `transform`, así que no provocan reflow, y van
 * `aria-hidden` porque son decoración: el número de clínicas y el monto del
 * bono están escritos en texto real justo al lado.
 *
 * Dos piezas para tres escalones: los dos primeros comparten el regalo (el
 * segundo con el moño en violeta y un 12 % más grande) y el tercero se lleva el
 * trofeo. A 86 px, una pila de monedas se leía como unas rayas sueltas: mejor
 * repetir una silueta que SÍ se reconoce en pequeño.
 *
 * LENTAS a propósito (10–12 s): son un acento junto a una tarjeta, no pueden
 * competir con las tres escenas grandes de la página ni marear a quien hace
 * scroll. Los keyframes viven en `src/app/afiliados/afiliados.css` con prefijo
 * `dcafHito` y el bloque `prefers-reduced-motion: reduce` de ese mismo archivo
 * las congela enteras (apaga toda animación dentro de `.dcaf-root`).
 *
 * NINGÚN monto se escribe aquí: las piezas son geometría, los números los pone
 * la tarjeta desde `getPublicOffer()`.
 */

/** Caja de 86px que reserva el alto: sin esto la tarjeta salta al montar. */
const CAJA: React.CSSProperties = {
  width: 86,
  height: 86,
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  perspective: 520,
  flexShrink: 0,
};

// ── Hito 1 · caja de regalo ────────────────────────────────────────────────

const LADO = 52;
const MEDIO = LADO / 2;

/** Cara del cubo. `cara` es su transform respecto al centro. */
function CaraCubo({ cara, fondo, children }: { cara: string; fondo: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: LADO,
        height: LADO,
        margin: `${-MEDIO}px 0 0 ${-MEDIO}px`,
        background: fondo,
        border: "1px solid rgba(191,219,254,.55)",
        borderRadius: 4,
        transform: cara,
      }}
    >
      {children}
    </div>
  );
}

/** Listón: una banda que cruza la cara de lado a lado. */
function Liston({ vertical, fondo }: { vertical?: boolean; fondo: string }) {
  return (
    <span
      style={{
        position: "absolute",
        background: fondo,
        ...(vertical
          ? { left: "50%", top: 0, bottom: 0, width: 10, marginLeft: -5 }
          : { top: "50%", left: 0, right: 0, height: 10, marginTop: -5 }),
      }}
    />
  );
}

/**
 * Los dos tonos del regalo. El cubo NO cambia (los dos escalones son azules en
 * la tarjeta): lo único que se mueve es el listón, el moño y el tamaño, lo justo
 * para que las dos tarjetas no se lean como copia-pega.
 */
const TONOS = {
  azul: { liston: "linear-gradient(180deg,#eff6ff,#bfdbfe)", lazo: "linear-gradient(180deg,#eff6ff,#93c5fd)", nudo: "#dbeafe", escala: 1 },
  violeta: { liston: "linear-gradient(180deg,#f5f3ff,#ddd6fe)", lazo: "linear-gradient(180deg,#f5f3ff,#a78bfa)", nudo: "#ede9fe", escala: 1.12 },
} as const;

/**
 * Regalo: cubo de 4 caras (la de atrás y la de abajo nunca se ven con este
 * balanceo) con listones cruzados y un moño de dos lazos sobre la tapa.
 *
 * `tono` es la ÚNICA variación entre el primer y el segundo escalón. El escalado
 * va en la caja exterior y no en la que anima: el keyframe `dcafHitoSway`
 * reescribe `transform` entero y se comería cualquier `scale()` puesto ahí.
 * Como `transform` no provoca reflow, crecer un 12 % no mueve nada de la
 * tarjeta.
 */
export function HitoRegalo({ tono = "azul" }: { tono?: keyof typeof TONOS }) {
  const t = TONOS[tono];
  return (
    <div aria-hidden="true" style={{ ...CAJA, transform: `scale(${t.escala})` }}>
      <div className="dcaf-hito-sway" style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
        <CaraCubo cara={`translateZ(${MEDIO}px)`} fondo="linear-gradient(155deg,#3b82f6,#1d4ed8)">
          <Liston vertical fondo={t.liston} />
        </CaraCubo>
        <CaraCubo cara={`rotateY(90deg) translateZ(${MEDIO}px)`} fondo="linear-gradient(155deg,#1d4ed8,#1e3a8a)">
          <Liston vertical fondo={t.liston} />
        </CaraCubo>
        <CaraCubo cara={`rotateY(-90deg) translateZ(${MEDIO}px)`} fondo="linear-gradient(155deg,#1e40af,#172554)">
          <Liston vertical fondo={t.liston} />
        </CaraCubo>
        <CaraCubo cara={`rotateX(90deg) translateZ(${MEDIO}px)`} fondo="linear-gradient(155deg,#60a5fa,#2563eb)">
          <Liston vertical fondo={t.liston} />
          <Liston fondo={t.liston} />
          {/* Moño: dos lazos y el nudo, planos sobre la tapa. */}
          <span style={{ position: "absolute", left: "50%", top: "50%", width: 22, height: 13, marginLeft: -23, marginTop: -6.5, borderRadius: "60% 30% 60% 30%", background: t.lazo, transform: "rotate(-16deg)" }} />
          <span style={{ position: "absolute", left: "50%", top: "50%", width: 22, height: 13, marginLeft: 1, marginTop: -6.5, borderRadius: "30% 60% 30% 60%", background: t.lazo, transform: "rotate(16deg)" }} />
          <span style={{ position: "absolute", left: "50%", top: "50%", width: 9, height: 9, margin: "-4.5px 0 0 -4.5px", borderRadius: "50%", background: t.nudo }} />
        </CaraCubo>
      </div>
    </div>
  );
}

// ── Hito 3 · trofeo con destello ───────────────────────────────────────────

/** Copa del trofeo. Se dibuja dos veces: la de atrás hace de grosor. */
function Copa({ fondo, z }: { fondo: string; z: number }) {
  return (
    <span
      style={{
        position: "absolute",
        left: "50%",
        top: 12,
        width: 40,
        height: 34,
        marginLeft: -20,
        background: fondo,
        borderRadius: "6px 6px 20px 20px",
        transform: `translateZ(${z}px)`,
      }}
    />
  );
}

/** Destello de 4 puntas: dos rombos cruzados que giran y laten (transform). */
function Destello({ x, y, size, clase }: { x: string; y: string; size: number; clase: string }) {
  const rayo: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    background: "linear-gradient(180deg,#fef3c7,#fbbf24)",
    borderRadius: "50%",
  };
  return (
    <span className={clase} style={{ position: "absolute", left: x, top: y, width: size, height: size }}>
      <span style={{ ...rayo, width: 2.5, height: size, margin: `${-size / 2}px 0 0 -1.25px` }} />
      <span style={{ ...rayo, width: size, height: 2.5, margin: `-1.25px 0 0 ${-size / 2}px` }} />
    </span>
  );
}

/**
 * Trofeo: copa con asas, pie y base, con dos destellos girando. Es la pieza
 * más llamativa de las tres —el hito grande— pero sigue siendo lenta (20 s).
 */
export function HitoTrofeo() {
  const asa: React.CSSProperties = {
    position: "absolute",
    top: 15,
    width: 16,
    height: 22,
    border: "3px solid #f59e0b",
    borderRadius: "50%",
  };
  return (
    <div aria-hidden="true" style={CAJA}>
      <div className="dcaf-hito-float" style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
        <span style={{ ...asa, left: 12, borderRight: "3px solid transparent" }} />
        <span style={{ ...asa, right: 12, borderLeft: "3px solid transparent" }} />
        <Copa fondo="linear-gradient(160deg,#b45309,#78350f)" z={-7} />
        <Copa fondo="linear-gradient(160deg,#fde68a,#f59e0b)" z={0} />
        {/* Brillo de la copa: una franja clara pegada al borde izquierdo. */}
        <span style={{ position: "absolute", left: "50%", top: 15, width: 7, height: 26, marginLeft: -16, borderRadius: "4px 4px 10px 10px", background: "linear-gradient(180deg,rgba(255,251,235,.9),rgba(255,251,235,.15))", transform: "translateZ(1px)" }} />
        {/* Pie y base. */}
        <span style={{ position: "absolute", left: "50%", top: 46, width: 9, height: 12, marginLeft: -4.5, background: "linear-gradient(90deg,#b45309,#f59e0b,#b45309)" }} />
        <span style={{ position: "absolute", left: "50%", top: 58, width: 34, height: 8, marginLeft: -17, borderRadius: 4, background: "linear-gradient(180deg,#f59e0b,#92400e)" }} />
        <span style={{ position: "absolute", left: "50%", top: 65, width: 44, height: 7, marginLeft: -22, borderRadius: 5, background: "linear-gradient(180deg,#6d28d9,#4c1d95)" }} />
      </div>

      <Destello x="9%" y="12%" size={16} clase="dcaf-hito-sparkle" />
      <Destello x="76%" y="30%" size={11} clase="dcaf-hito-sparkle--b" />
    </div>
  );
}

/** Despacha la pieza que le toca a cada escalón (1º, 2º, 3º). */
export function IconoHito({ orden }: { orden: number }) {
  if (orden === 0) return <HitoRegalo />;
  if (orden === 1) return <HitoRegalo tono="violeta" />;
  return <HitoTrofeo />;
}
