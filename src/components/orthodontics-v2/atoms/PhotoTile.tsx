// PhotoTile (slot foto + empty state) · design/atoms.jsx atom 12.

import { ImagePlus, Search, Pencil, Star } from "lucide-react";
import type { PhotoVM } from "@/lib/orthodontics-v2/types";

interface PhotoTileProps {
  photo?: PhotoVM | null;
  stage?: string;
  empty?: boolean;
  onClick?: () => void;
  onExpand?: () => void;
  onAnnotate?: () => void;
}

export function PhotoTile({
  photo,
  stage,
  empty,
  onClick,
  onExpand,
  onAnnotate,
}: PhotoTileProps) {
  if (empty || !photo) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted"
      >
        <ImagePlus className="h-5 w-5" />
        <span className="text-[11px]">+ subir</span>
      </button>
    );
  }

  return (
    <div
      onClick={onClick}
      className="group relative aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-card"
    >
      <img
        src={photo.url}
        alt={photo.kind}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent p-1.5">
        <span className="font-mono text-[10px] text-white">{stage ?? photo.kind}</span>
        {photo.isFavorite && (
          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
        )}
      </div>
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {onExpand && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            className="rounded-md bg-black/55 p-1 text-white"
            aria-label="Ampliar"
          >
            <Search className="h-3 w-3" />
          </button>
        )}
        {onAnnotate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAnnotate();
            }}
            className="rounded-md bg-black/55 p-1 text-white"
            aria-label="Anotar"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
