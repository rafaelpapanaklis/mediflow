"use client";

import { TvOperationalView } from "./operational-view";
import { TvMarketingView } from "./marketing-view";

interface Props {
  clinicId: string;
  clinicName: string;
  clinicLogo: string | null;
  config: Record<string, unknown>;
}

/**
 * TvHybridView — split 60/40: arriba operativo (turnos en sala),
 * abajo carrusel marketing. Reusa los dos componentes anteriores
 * con CSS Grid de 60/40.
 *
 * Optimizado para TVs verticales y horizontales 1920×1080. En aspect
 * más cuadrado, considera mode OPERATIONAL solo.
 */
export function TvHybridView(props: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateRows: "60% 40%",
        background: "#0F1A2E",
      }}
    >
      <div style={{ overflow: "hidden", position: "relative" }}>
        <TvOperationalView {...props} />
      </div>
      <div style={{ overflow: "hidden", position: "relative" }}>
        <TvMarketingView
          clinicName={props.clinicName}
          clinicLogo={props.clinicLogo}
          config={props.config}
        />
      </div>
    </div>
  );
}
