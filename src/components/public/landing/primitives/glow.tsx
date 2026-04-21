interface GlowProps {
  x?: string;
  y?: string;
  size?: number;
  opacity?: number;
  /** RGB triplet string, e.g. "124,58,237" */
  color?: string;
}

export function Glow({
  x = "50%",
  y = "0%",
  size = 800,
  opacity = 0.4,
  color = "124,58,237",
}: GlowProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
        background: `radial-gradient(circle, rgba(${color},${opacity}) 0%, rgba(${color},0) 60%)`,
        pointerEvents: "none",
        filter: "blur(20px)",
      }}
    />
  );
}
