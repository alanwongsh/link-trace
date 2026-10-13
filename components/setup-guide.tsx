export function SetupGuide({ message }: { message: string }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 text-sm leading-6">
      <h2 className="font-serif text-2xl text-ink">Connect the database</h2>
      <p className="mt-2 text-muted">{message}</p>
      <ol className="mt-4 grid list-decimal gap-2 pl-5 text-ink">
        <li>Create a Postgres database, for example a project at supabase.com.</li>
        <li>
          Set <code className="font-mono">DATABASE_URL</code> and{" "}
          <code className="font-mono">ADMIN_PASSWORD</code> in{" "}
          <code className="font-mono">.env.local</code> and in Vercel.
        </li>
        <li>
          Run <code className="font-mono">npm run db:migrate</code> to create the tables.
        </li>
        <li>Restart the dev server, or redeploy.</li>
      </ol>
    </section>
  );
}
