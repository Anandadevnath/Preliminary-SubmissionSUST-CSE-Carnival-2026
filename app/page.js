import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignInButton } from "@/components/signin-button";
import { SignOutButton } from "@/components/signout-button";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-16 space-y-10">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tighter">
          Hackathon Template
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          MongoDB · Google OAuth · Cloudinary · SMTP — all wired up and ready
          to build on.
        </p>
      </header>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 space-y-4">
        <h2 className="font-semibold">Authentication</h2>

        {session?.user ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Signed in as{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {session.user.email}
              </span>
            </p>
            <SignOutButton />
          </div>
        ) : (
          <SignInButton />
        )}
      </section>

      <section className="grid sm:grid-cols-2 gap-4">
        <ConnectionCard
          title="MongoDB"
          envKey="MONGODB_URI"
          healthPath="/api/health"
        />
        <ConnectionCard
          title="Google OAuth"
          envKey="GOOGLE_CLIENT_ID"
          healthPath="/api/health"
        />
        <ConnectionCard
          title="Cloudinary"
          envKey="CLOUDINARY_CLOUD_NAME"
          healthPath="/api/health"
        />
        <ConnectionCard
          title="SMTP"
          envKey="MAIL_HOST"
          healthPath="/api/health"
        />
      </section>
    </main>
  );
}

function ConnectionCard({ title, envKey, healthPath }) {
  const present = Boolean(process.env[envKey]);
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-medium">{title}</div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            present
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              present ? "bg-emerald-500" : "bg-zinc-400"
            }`}
          />
          {present ? "configured" : "missing"}
        </span>
      </div>
      <div className="text-xs text-zinc-500 font-mono">{envKey}</div>
      <a
        href={healthPath}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-zinc-600 dark:text-zinc-400 hover:underline"
      >
        GET {healthPath} →
      </a>
    </div>
  );
}
