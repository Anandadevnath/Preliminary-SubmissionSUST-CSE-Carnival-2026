import GoogleProvider from "next-auth/providers/google";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { getMongoClient } from "@/lib/mongo-client";

/**
 * NextAuth configuration — Google OAuth only.
 *
 * Adapter:
 *   - MongoDBAdapter stores users, accounts, and sessions in MongoDB.
 *
 * Required env:
 *   - GOOGLE_CLIENT_ID
 *   - GOOGLE_CLIENT_SECRET
 *   - NEXTAUTH_SECRET
 *   - NEXTAUTH_URL
 *   - MONGODB_URI
 */
function buildAdapter() {
  if (!process.env.MONGODB_URI) return undefined;
  // Wrap async resolution in a lazy proxy — MongoDBAdapter calls client.db()
  // on first use, which is after our async getMongoClient() resolves.
  const clientP = getMongoClient();
  return MongoDBAdapter(clientP);
}

export const authOptions = {
  adapter: buildAdapter(),

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  session: { strategy: "jwt" },

  pages: {
    signIn: "/",
  },

  callbacks: {
    async session({ session, token }) {
      if (session.user && token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

export default authOptions;
