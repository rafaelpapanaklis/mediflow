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
      <div className="px-[18px] py-6">
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-[14px] bg-[color:var(--pr-activo-suave)] text-[color:var(--orto-violeta)] flex items-center justify-center flex-shrink-0"
            aria-hidden
          >
            {props.icon}
          </div>
          <div className="flex-1 min-w-0">
            <ul className="space-y-1.5 text-[13px] text-[color:var(--pr-texto-2)]">
              {props.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[color:var(--orto-violeta-borde)] mt-1.5 flex-shrink-0"
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
