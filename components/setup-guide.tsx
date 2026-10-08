export function SetupGuide({ message }: { message: string }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 text-sm leading-6">
      <h2 className="font-serif text-2xl text-ink">Connect Supabase</h2>
      <p className="mt-2 text-muted">{message}</p>
      <ol className="mt-4 grid list-decimal gap-2 pl-5 text-ink">
        <li>Create a project at supabase.com.</li>
        <li>
          Open the SQL editor and run <code className="font-mono">supabase/schema.sql</code>.
        </li>
        <li>
          In Vercel, add the Supabase integration or set{" "}
          <code className="font-mono">SUPABASE_URL</code>,{" "}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>, and{" "}
          <code className="font-mono">ADMIN_PASSWORD</code>.
        </li>
        <li>Redeploy. Locally, put the same values in <code className="font-mono">.env.local</code>.</li>
      </ol>
    </section>
  );
}
