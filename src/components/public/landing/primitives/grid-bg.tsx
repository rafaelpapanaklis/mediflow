interface GridBgProps {
  opacity?: number;
}

export function GridBg({ opacity = 0.04 }: GridBgProps) {
  const mask = "radial-gradient(ellipse at 50% 30%, black 20%, transparent 75%)";
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `linear-gradient(rgba(255,255,255,${opacity}) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,${opacity}) 1px, transparent 1px)`,
        backgroundSize: "48px 48px",
        maskImage: mask,
        WebkitMaskImage: mask,
        pointerEvents: "none",
      }}
    />
  );
}
