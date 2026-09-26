"use client";

interface StepperProps {
  step: 1 | 2 | 3;
}

const STEPS: Array<{ n: 1 | 2 | 3; label: string }> = [
  { n: 1, label: "Tu cuenta" },
  { n: 2, label: "Tu clínica" },
  { n: 3, label: "Tu plan" },
];

/**
 * Progreso del alta en tres tramos: cada paso es una barra con su número y
 * su nombre. Hecho = verde con palomita, actual = azul→violeta de la
 * portada, pendiente = gris. Es una lista ordenada con `aria-current` para
 * que el lector de pantalla diga en qué paso va. Estilos en auth-v4.css.
 */
export function Stepper({ step }: StepperProps) {
  return (
    <nav aria-label="Progreso del registro">
      <p className="dca-stepper__sr">Paso {step} de {STEPS.length}</p>
      <ol className="dca-stepper">
        {STEPS.map((s) => {
          const state = s.n < step ? "is-done" : s.n === step ? "is-active" : "";
          return (
            <li key={s.n} className={`dca-step ${state}`} aria-current={s.n === step ? "step" : undefined}>
              <span className="dca-step__bar" aria-hidden="true">
                <span className="dca-step__fill" />
              </span>
              <span className="dca-step__row">
                <span className="dca-step__n" aria-hidden="true">
                  {s.n < step ? (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6 L5 9 L10 3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    s.n
                  )}
                </span>
                <span className="dca-step__label">{s.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
