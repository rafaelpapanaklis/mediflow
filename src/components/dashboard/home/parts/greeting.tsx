// src/components/dashboard/home/parts/greeting.tsx
"use client";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/i18n-provider";
import { timeGreeting, formatLongDate, firstName } from "@/lib/home/greet";

export function Greeting({
  userFullName,
  trailing,
  clinicTimezone,
}: {
  userFullName: string;
  trailing?: string;
  /** H26 (QA ws1-t9): sin esto, el saludo y la fecha usan la zona del
   *  navegador — de noche puede ya ser "mañana" ahí y no en la clínica. */
  clinicTimezone?: string | null;
}) {
  const t = useT();
  const [greeting, setGreeting] = useState(t("home.greeting.hello"));
  const [date, setDate] = useState(formatLongDate(undefined, clinicTimezone));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const update = () => {
      setGreeting(timeGreeting(undefined, clinicTimezone));
      setDate(formatLongDate(undefined, clinicTimezone));
    };
    update();
    setMounted(true);
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [clinicTimezone]);

  const first = firstName(userFullName);

  return (
    <div>
      <h1
        style={{
          fontSize: "clamp(18px, 1.6vw, 22px)",
          fontWeight: 700,
          color: "var(--text-1)",
          margin: 0,
          letterSpacing: "-0.01em",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
        }}
      >
        {greeting}, {first}.
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-3)",
          margin: 0,
          marginTop: 3,
        }}
        suppressHydrationWarning={!mounted}
      >
        {date}
        {trailing ? ` · ${trailing}` : ""}
      </p>
    </div>
  );
}
