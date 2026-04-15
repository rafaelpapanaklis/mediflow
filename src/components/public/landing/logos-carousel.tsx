"use client";

import Marquee from "react-fast-marquee";
import { Heart } from "lucide-react";
import { marqueeLogos } from "@/lib/landing-data";

export function LogosCarousel() {
  return (
    <section className="py-10 border-y border-[rgba(99,102,241,0.08)] bg-[#0B0F1E]">
      <div className="max-w-7xl mx-auto px-6 md:px-12 mb-6">
        <p className="text-center text-sm text-slate-600 font-medium">
          Utilizado por clínicas líderes en México
        </p>
      </div>
      <Marquee gradient gradientColor="#0B0F1E" gradientWidth={100} speed={35}>
        {marqueeLogos.map((name) => (
          <div key={name} className="mx-10 logo-item flex items-center justify-center h-10">
            <div className="flex items-center gap-2 text-slate-500">
              <Heart className="w-5 h-5" />
              <span className="font-semibold text-base whitespace-nowrap">{name}</span>
            </div>
          </div>
        ))}
      </Marquee>
    </section>
  );
}
