import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard `cn()` helper used by shadcn-style components.
 * Combines clsx (conditional classes) with tailwind-merge (deduplicates).
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}