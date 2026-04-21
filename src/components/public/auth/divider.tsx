export function Divider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        color: "var(--ld-fg-muted)",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
      }}
    >
      <div style={{ flex: 1, height: 1, background: "var(--ld-border)" }} />
      <span>{label}</span>
      <div style={{ flex: 1, height: 1, background: "var(--ld-border)" }} />
    </div>
  );
}
