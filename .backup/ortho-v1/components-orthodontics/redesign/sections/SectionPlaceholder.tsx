// Placeholder card "Próximamente · Fase 2" para secciones E, F, G, H, I.
// Renderiza teaser con icono + bullets de qué viene en Fase 2.

import type { ReactNode } from "react";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";

export interface SectionPlaceholderProps {
  id: string;
  eyebrow: string;
  title: string;
  icon: ReactNode;
  bullets: string[];
}

export function SectionPlaceholder(props: SectionPlaceholderProps) {
  return (
    <Card
      id={props.id}
      eyebrow={props.eyebrow}
      title={props.title}
      action={
        <Pill color="amber" size="xs">
          Próximamente · Fase 2
        </Pill>
      }
    >
      <div className="px-6 py-6">
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0 dark:bg-violet-900/30 dark:text-violet-300"
            aria-hidden
          >
            {props.icon}
          </div>
          <div className="flex-1 min-w-0">
            <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
              {props.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-violet-300 mt-1.5 flex-shrink-0 dark:bg-violet-600"
                    aria-hidden
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
