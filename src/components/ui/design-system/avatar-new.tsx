type AvatarSize = "sm" | "lg" | "xl";

type AvatarProps = {
  name: string;
  size?: AvatarSize;
  className?: string;
};

// Gradient determinístico a partir del nombre — el mismo usuario siempre obtiene
// el mismo gradiente. Dos colores complementarios en OKLCH para buen contraste.
function gradientFromName(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, oklch(0.72 0.18 ${h}), oklch(0.55 0.20 ${(h + 40) % 360}))`;
}

function initialsFromName(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase();
}

export function AvatarNew({ name, size, className }: AvatarProps) {
  const cls = ["avatar-new", size ? `avatar-new--${size}` : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} style={{ background: gradientFromName(name) }}>
      {initialsFromName(name)}
    </div>
  );
}
