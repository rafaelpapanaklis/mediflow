// Avatar redondo con iniciales · derivado de design/atoms.jsx.

interface AvatarProps {
  name: string;
  size?: number;
  color?: string;
}

export function Avatar({ name, size = 64, color = "#5da3f8" }: AvatarProps) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      aria-label={`Avatar de ${name}`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, ${color}, ${color}aa)`,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: size * 0.36,
        fontFamily: "'Sora',sans-serif",
        letterSpacing: "-0.02em",
        flex: "0 0 auto",
        boxShadow: "inset 0 -2px 6px rgba(0,0,0,.15)",
      }}
    >
      {initials}
    </div>
  );
}
