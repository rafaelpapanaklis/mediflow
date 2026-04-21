import type { FeatureIcon } from "@/lib/specialty-data";

const COMMON = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type IconType = FeatureIcon | "tooth" | "braces" | "gum" | "root" | "scan" | "skin" | "heart"
  | "female" | "baby" | "eye" | "brain" | "pill" | "apple" | "hand" | "spa" | "needle" | "leaf"
  | "doc" | "bell" | "invoice" | "box" | "camera" | "stethoscope";

export function SpecIcon({ type, size = 20 }: { type: IconType | string; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", ...COMMON };
  switch (type) {
    case "tooth":
      return <svg {...props}><path d="M8 3c-2 0-3 1.5-3 4 0 2 .5 3 .5 5s-.5 4 .5 7c.5 1.5 2 2 2.5 0 .3-1.2.5-3 .5-4 0-1 1-1 2 0 0 1 .2 2.8.5 4 .5 2 2 1.5 2.5 0 1-3 .5-5 .5-7s.5-3 .5-5c0-2.5-1-4-3-4-1.5 0-2 1-3 1s-1.5-1-3-1z"/></svg>;
    case "braces":
      return <svg {...props}><path d="M5 9h14M5 15h14"/><circle cx="8" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="16" cy="12" r="1.2"/></svg>;
    case "root":
      return <svg {...props}><path d="M12 3v10"/><path d="M8 13c0 4 2 8 4 8s4-4 4-8"/><path d="M8 13h8"/></svg>;
    case "gum":
      return <svg {...props}><path d="M4 14c0-3 3-5 8-5s8 2 8 5v3c-3 1-5 1-8 1s-5 0-8-1z"/><path d="M8 10v3M12 9v4M16 10v3"/></svg>;
    case "scan":
      return <svg {...props}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M3 17v2a2 2 0 0 0 2 2h2M17 21h2a2 2 0 0 0 2-2v-2M7 12h10"/></svg>;
    case "skin":
      return <svg {...props}><circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r=".8"/><circle cx="14" cy="11" r=".8"/><circle cx="11" cy="14" r=".8"/></svg>;
    case "heart":
      return <svg {...props}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>;
    case "female":
      return <svg {...props}><circle cx="12" cy="9" r="5"/><path d="M12 14v7M9 18h6"/></svg>;
    case "baby":
      return <svg {...props}><circle cx="12" cy="10" r="5"/><circle cx="10" cy="10" r=".8" fill="currentColor"/><circle cx="14" cy="10" r=".8" fill="currentColor"/><path d="M10 12c1 1 3 1 4 0"/><path d="M7 17l5 4 5-4"/></svg>;
    case "eye":
      return <svg {...props}><ellipse cx="12" cy="12" rx="9" ry="5"/><circle cx="12" cy="12" r="2.5"/></svg>;
    case "brain":
      return <svg {...props}><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 3 3h1V4zM15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-3 3h-1V4z"/></svg>;
    case "pill":
      return <svg {...props}><rect x="3" y="9" width="18" height="6" rx="3"/><path d="M12 9v6"/></svg>;
    case "apple":
      return <svg {...props}><path d="M12 7c-2-3-6-2-6 2 0 5 3 12 6 12s6-7 6-12c0-4-4-5-6-2z"/><path d="M12 7V4"/></svg>;
    case "hand":
      return <svg {...props}><path d="M8 11V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5a1.5 1.5 0 0 1 3 0v9c0 4-3 6-6 6s-6-2-6-6v-3a1.5 1.5 0 0 1 3 0"/></svg>;
    case "spa":
      return <svg {...props}><path d="M12 3c-3 3-3 7 0 10 3-3 3-7 0-10z"/><path d="M4 13c0 4 3 7 8 7s8-3 8-7"/></svg>;
    case "needle":
      return <svg {...props}><path d="M4 20L14 10M14 10l6-6M14 10l3 3M11 13l3 3"/></svg>;
    case "leaf":
      return <svg {...props}><path d="M4 20c0-8 6-14 16-16-2 10-8 16-16 16zM4 20l8-8"/></svg>;
    case "stethoscope":
      return <svg {...props}><path d="M6 3v7a4 4 0 0 0 8 0V3"/><path d="M10 14v3a4 4 0 0 0 8 0v-2"/><circle cx="18" cy="12" r="2"/></svg>;
    case "doc":
      return <svg {...props}><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9 13h8M9 17h6"/></svg>;
    case "bell":
      return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>;
    case "invoice":
      return <svg {...props}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>;
    case "box":
      return <svg {...props}><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>;
    case "camera":
      return <svg {...props}><path d="M3 7h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="8"/></svg>;
  }
}
