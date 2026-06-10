export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;

  return (
    <main className="reveal gate">
      <p className="eyebrow">Restricted</p>
      <h1>Floor access</h1>
      <p className="lede">
        This control plane manages live MCP servers, credentials bindings, and
        release gates. Operators only.
      </p>
      <form method="post" action="/api/login" className="panel gate-form">
        <label className="gate-label" htmlFor="password">
          Operator password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          className="gate-input"
        />
        {from ? <input type="hidden" name="from" value={from} /> : null}
        {error ? <p className="gate-error">Wrong password. Attempt logged.</p> : null}
        <button type="submit" className="gate-button">
          Enter the floor
        </button>
      </form>
    </main>
  );
}
