// src/app/dashboard/home-client-switch.tsx
"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Shield, Stethoscope } from "lucide-react";

type HomeMode = "admin" | "doctor";

interface Props {
  user: { displayName: string; role: string };
  clinic: { name: string };
  adminContent: ReactNode;
  doctorContent: ReactNode | null;
  canBeDoctor: boolean;
  initialMode: HomeMode;
}

export function HomeClientSwitch({
  adminContent,
  doctorContent,
  canBeDoctor,
  initialMode,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<HomeMode>(initialMode);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    setHydrated(true);
    if (!canBeDoctor) return;

    const urlMode = searchParams.get("mode");
    if (urlMode === "admin" || urlMode === "doctor") {
      setMode(urlMode);
      return;
    }
    try {
      const stored = window.localStorage.getItem("home-mode");
      if (stored === "admin" || stored === "doctor") {
        setMode(stored);
      }
    } catch {
      // noop
    }
  }, [hydrated, canBeDoctor, searchParams]);

  const switchMode = (next: HomeMode) => {
    if (next === mode) return;
    setMode(next);
    try {
      window.localStorage.setItem("home-mode", next);
    } catch {}
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const showToggle = canBeDoctor && doctorContent !== null;

  return (
    <>
      {showToggle && (
        <div
          role="tablist"
          aria-label="Cambiar vista del home"
          style={{
            display: "inline-flex",
            marginBottom: 14,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
            padding: 3,
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
          }}
        >
          <SwitchButton
            active={mode === "admin"}
            onClick={() => switchMode("admin")}
            Icon={Shield}
            label="Admin"
          />
          <SwitchButton
            active={mode === "doctor"}
            onClick={() => switchMode("doctor")}
            Icon={Stethoscope}
            label="Doctor"
          />
        </div>
      )}

      {mode === "doctor" && doctorContent ? doctorContent : adminContent}
    </>
  );
}

function SwitchButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        border: "none",
        background: active ? "var(--brand-soft)" : "transparent",
        color: active ? "var(--brand)" : "var(--text-2)",
        fontSize: 12,
        fontWeight: 500,
        borderRadius: 7,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 0.15s, color 0.15s",
        boxShadow: active
          ? "0 1px 3px rgba(124,58,237,0.10), inset 0 0 0 1px rgba(124,58,237,0.10)"
          : "none",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.color = "var(--text-1)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.color = "var(--text-2)";
      }}
    >
      <Icon size={12} aria-hidden />
      {label}
    </button>
  );
}
