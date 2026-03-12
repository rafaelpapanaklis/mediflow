import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm",
          "placeholder:text-muted-foreground resize-none",
          "focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-all duration-150",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
