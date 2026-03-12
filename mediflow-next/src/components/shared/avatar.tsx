import { cn } from "@/lib/utils";

interface AvatarProps {
  initials: string;
  color?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-9 h-9 text-sm",
  lg: "w-11 h-11 text-base",
  xl: "w-14 h-14 text-lg",
};

export function Avatar({ initials, color = "bg-brand-600", size = "md", className }: AvatarProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full font-bold text-white select-none flex-shrink-0",
        sizeMap[size],
        color,
        className
      )}
    >
      {initials}
    </div>
  );
}
