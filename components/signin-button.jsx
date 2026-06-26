"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/" })}
      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="currentColor"
      >
        <path d="M21.35 11.1H12v3.8h5.35c-.23 1.25-1.66 3.65-5.35 3.65-3.22 0-5.85-2.67-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.77 4.06 14.6 3.1 12 3.1 6.92 3.1 2.85 7.17 2.85 12.25S6.92 21.4 12 21.4c6.93 0 9.62-4.86 9.62-9.34 0-.63-.07-1.1-.27-1.96z" />
      </svg>
      Sign in with Google
    </button>
  );
}