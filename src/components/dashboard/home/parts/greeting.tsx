// src/components/dashboard/home/parts/greeting.tsx
"use client";
import { useEffect, useState } from "react";
import { timeGreeting, formatLongDate, firstName } from "@/lib/home/greet";

export function Greeting({
  userFullName,
  trailing,
}: {
  userFullName: string;
  trailing?: string;
}) {
  const [greeting, setGreeting] = useState("Hola");
  const [date, setDate] = useState(formatLongDate());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const update = () => {
      setGreeting(timeGreeting());
      setDate(formatLongDate());
    };
    update();
    setMounted(true);
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const first = firstName(userFullName);

  return (
    <div style={{ marginBottom: 18 }}>
      <h1
        style={{
          fontSize: "clamp(18px, 1.6vw, 22px)",
          fontWeight: 600,
          color: "var(--text-1)",
          margin: 0,
          letterSpacing: "-0.01em",
          fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        }}
      >
        {greeting}, {first}.
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-2)",
          marginTop: 4,
          margin: 0,
        }}
        suppressHydrationWarning={!mounted}
      >
        {date}
        {trailing ? ` · ${trailing}` : ""}
      </p>
    </div>
  );
}
