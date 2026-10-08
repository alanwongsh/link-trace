"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <h1 className="font-serif text-3xl">Something went wrong</h1>
      <p className="mt-3 text-sm text-muted">{error.message}</p>
      <button type="button" className="btn-primary mt-6 w-fit" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
