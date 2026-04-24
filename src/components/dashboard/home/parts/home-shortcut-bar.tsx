// src/components/dashboard/home/parts/home-shortcut-bar.tsx
"use client";
import { useRouter } from "next/navigation";
import { CalendarPlus, UserPlus, Search } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useCommandPalette } from "@/hooks/use-command-palette";

export function HomeShortcutBar() {
  const router = useRouter();
  const { openPalette } = useCommandPalette();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 18,
        paddingTop: 18,
        borderTop: "1px solid var(--border-soft)",
      }}
    >
      <ButtonNew
        variant="primary"
        icon={<CalendarPlus size={14} />}
        onClick={() => router.push("/dashboard/appointments?new=1")}
      >
        Nueva cita
      </ButtonNew>
      <ButtonNew
        variant="secondary"
        icon={<UserPlus size={14} />}
        onClick={() => router.push("/dashboard/patients?new=1")}
      >
        Nuevo paciente
      </ButtonNew>
      <ButtonNew
        variant="ghost"
        icon={<Search size={14} />}
        onClick={openPalette}
      >
        Buscar paciente
      </ButtonNew>
    </div>
  );
}
