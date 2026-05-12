// ComparisonSlider antes/después · design/atoms.jsx atom 10.

"use client";

import { useState } from "react";
import { MoveHorizontal } from "lucide-react";

interface ComparisonSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export function ComparisonSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Antes",
  afterLabel = "Después",
}: ComparisonSliderProps) {
  const [pct, setPct] = useState(50);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPct(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      className="relative aspect-[4/3] cursor-ew-resize select-none overflow-hidden rounded-lg border border-border bg-black"
      onMouseMove={handleMove}
    >
      <img
        src={afterUrl}
        alt={afterLabel}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
      <div
        className="absolute bottom-0 top-0 w-[3px] bg-white shadow-lg"
        style={{ left: `${pct}%` }}
      />
      <div
        className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md"
        style={{ left: `${pct}%` }}
      >
        <MoveHorizontal className="h-3.5 w-3.5" />
      </div>
      <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white">
        {beforeLabel}
      </span>
      <span className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white">
        {afterLabel}
      </span>
    </div>
  );
}
