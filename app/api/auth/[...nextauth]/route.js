import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// NextAuth handler — handles /api/auth/* (signin, callback, session, csrf, etc.)
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };