import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  centered?: boolean;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  centered = false,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn(centered && "text-center", className)}>
      {eyebrow && (
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3.5 py-1.5 mb-4">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />
          <span className="text-xs font-semibold text-brand-700 uppercase tracking-wider">
            {eyebrow}
          </span>
        </div>
      )}
      <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground leading-tight tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className={cn(
          "mt-3 text-base text-muted-foreground leading-relaxed",
          centered ? "max-w-2xl mx-auto" : "max-w-2xl"
        )}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
