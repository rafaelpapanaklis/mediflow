/**
 * Panel de afiliado — LAS TRES PIEZAS 3D del Bono por Clínicas Activas.
 *
 * Portadas del diseño tal cual: el regalo (sway), la pila de monedas (spinZ)
 * y el trofeo (spinY). CSS puro —ni una librería—, solo `transform` y
 * `opacity`, y `aria-hidden` en la raíz: son adorno, no información. El
 * número y el monto de cada escalón se leen del texto de al lado.
 *
 * Los keyframes viven en panel.css con prefijo `dcafp` (dcafpSway,
 * dcafpSpinY, dcafpSpinZ) y ahí mismo `prefers-reduced-motion` los congela.
 *
 * SERVER-SAFE: sin "use client", sin estado. Es geometría.
 *
 * REGALO COBRADO: cuando el escalón ya se ganó cambia a dorado y se detiene,
 * como en el estado B del diseño. Un premio conseguido no sigue girando
 * pidiendo atención.
 */

/** Una cara del cubo con su cinta. */
function GiftFace({
  bg,
  ribbon,
  transform,
  cross,
}: {
  bg: string;
  ribbon: string;
  transform: string;
  /** La cara de arriba lleva cinta en cruz y el moño. */
  cross?: boolean;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, background: bg, transform }}>
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 9, marginLeft: -4.5, background: ribbon }} />
      {cross ? (
        <>
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 9, marginTop: -4.5, background: ribbon }} />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 14,
              height: 14,
              margin: "-7px 0 0 -7px",
              background: ribbon === "#ffffff" ? "#ffffff" : "#fbbf24",
              borderRadius: 4,
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function Gift({ done }: { done: boolean }) {
  // Morado mientras se persigue; dorado cuando ya se cobró.
  const faces = done
    ? { front: "#fbbf24", back: "#f59e0b", side: "#d97706", top: "#fde68a", bottom: "#b45309", ribbon: "#ffffff" }
    : { front: "#8b5cf6", back: "#7c3aed", side: "#6d28d9", top: "#a78bfa", bottom: "#5b21b6", ribbon: "#fde68a" };

  return (
    <div className="dcafp-3d__stage" style={{ width: 84, height: 72, perspective: 520 }}>
      <div
        className={done ? "dcafp-3d" : "dcafp-3d dcafp-sway"}
        style={{
          width: 44,
          height: 44,
          // Congelado en la pose de reposo del keyframe: la misma silueta que
          // se ve a mitad de la animación, no una cara plana.
          transform: done ? "rotateX(-14deg) rotateY(-28deg)" : undefined,
        }}
      >
        <GiftFace bg={faces.front} ribbon={faces.ribbon} transform="translateZ(22px)" />
        <GiftFace bg={faces.back} ribbon={faces.ribbon} transform="rotateY(180deg) translateZ(22px)" />
        <GiftFace bg={faces.side} ribbon={faces.ribbon} transform="rotateY(90deg) translateZ(22px)" />
        <GiftFace bg={faces.side} ribbon={faces.ribbon} transform="rotateY(-90deg) translateZ(22px)" />
        <GiftFace bg={faces.top} ribbon={faces.ribbon} transform="rotateX(90deg) translateZ(22px)" cross />
        <div style={{ position: "absolute", inset: 0, background: faces.bottom, transform: "rotateX(-90deg) translateZ(22px)" }} />
      </div>
    </div>
  );
}

const COIN_FACE: React.CSSProperties = {
  position: "absolute",
  inset: 3,
  borderRadius: "50%",
  background: "radial-gradient(circle at 36% 32%, #fde68a, #f59e0b 62%, #d97706)",
  boxShadow: "inset 0 0 0 5px rgba(180,83,9,.28)",
};

function Coins() {
  return (
    <div className="dcafp-3d__stage" style={{ width: 84, height: 72, perspective: 640 }}>
      <div
        className="dcafp-3d"
        style={{ width: 58, height: 58, transform: "rotateX(58deg)", marginTop: 8 }}
      >
        <div className="dcafp-3d dcafp-spinZ" style={{ position: "absolute", inset: 0 }}>
          <div className="dcafp-coin" style={{ ...COIN_FACE, transform: "translateZ(5px)" }} />
          <div className="dcafp-coin" style={{ ...COIN_FACE, transform: "translateZ(12px)" }} />
          <div className="dcafp-coin" style={{ ...COIN_FACE, transform: "translateZ(19px)" }} />
          <div className="dcafp-coin" style={{ ...COIN_FACE, transform: "translateZ(26px)" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 21,
                fontWeight: 800,
                color: "#b45309",
              }}
            >
              $
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Una cara del trofeo. El 3D sale de cruzar dos copias a 90°. */
function TrophyPlane({ transform }: { transform?: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, transform }}>
      <div style={{ position: "absolute", left: -1, top: 7, width: 15, height: 18, border: "3.5px solid #d97706", borderRadius: "50%" }} />
      <div style={{ position: "absolute", right: -1, top: 7, width: 15, height: 18, border: "3.5px solid #d97706", borderRadius: "50%" }} />
      <div style={{ position: "absolute", left: 11, top: 4, width: 34, height: 27, background: "linear-gradient(180deg,#fde68a 0%,#fbbf24 35%,#f59e0b 70%,#d97706 100%)", borderRadius: "5px 5px 17px 17px" }} />
      <div style={{ position: "absolute", left: 8, top: 1, width: 40, height: 7, borderRadius: 3.5, background: "linear-gradient(180deg,#fde68a,#f59e0b)" }} />
      <div style={{ position: "absolute", left: 24, top: 12, width: 8, height: 8, transform: "rotate(45deg)", background: "#fffbeb", opacity: 0.9 }} />
      <div style={{ position: "absolute", left: 25, top: 31, width: 6, height: 11, background: "linear-gradient(180deg,#d97706,#b45309)" }} />
      <div style={{ position: "absolute", left: 20, top: 42, width: 16, height: 5, borderRadius: 2, background: "#b45309" }} />
      <div style={{ position: "absolute", left: 13, top: 47, width: 30, height: 9, borderRadius: 3, background: "linear-gradient(180deg,#b45309,#92400e)" }} />
      <div style={{ position: "absolute", left: 22, top: 49, width: 12, height: 4, borderRadius: 1, background: "#fde68a", opacity: 0.7 }} />
    </div>
  );
}

function Trophy() {
  return (
    <div className="dcafp-3d__stage" style={{ width: 84, height: 74, perspective: 620, alignItems: "flex-end" }}>
      <div className="dcafp-3d dcafp-spinY" style={{ width: 56, height: 58 }}>
        <TrophyPlane />
        <TrophyPlane transform="rotateY(90deg)" />
      </div>
    </div>
  );
}

export type TierPieceKind = "gift" | "coins" | "trophy";

/** Las piezas en el orden de los escalones; se recicla si hubiera más de tres. */
export const TIER_PIECES: TierPieceKind[] = ["gift", "coins", "trophy"];

export function TierPiece({ kind, done = false }: { kind: TierPieceKind; done?: boolean }) {
  const shadowWidth = kind === "coins" ? 50 : kind === "trophy" ? 46 : 42;
  return (
    <div aria-hidden style={{ width: 84, flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {kind === "gift" ? <Gift done={done} /> : kind === "coins" ? <Coins /> : <Trophy />}
      <div className="dcafp-3d__shadow" style={{ width: shadowWidth }} />
    </div>
  );
}
