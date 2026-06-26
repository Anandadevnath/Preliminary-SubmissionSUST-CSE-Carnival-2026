"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
    >
      Sign out
    </button>
  );
}