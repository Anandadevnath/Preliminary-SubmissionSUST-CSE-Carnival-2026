"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Wraps the app in NextAuth's React context so client components can call
 * useSession() / signIn() / signOut(). Server components still get session
 * data via getServerSession().
 */
export function Providers({ children, session }) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}