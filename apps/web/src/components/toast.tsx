/**
 * Feedback toast — a pure SERVER component. The page reads ?notice / ?error and
 * renders this straight to HTML, so it always appears (no client hydration to
 * fail). It fades itself out with a CSS animation after a few seconds; error
 * toasts linger longer than success ones (see `.toast` in globals.css).
 */

export function Toast({ message, kind }: { message: string; kind: "ok" | "error" }) {
  return (
    <div className={`toast toast-${kind}`} role="status" aria-live="polite">
      <span className="toast-icon">{kind === "error" ? "!" : "✓"}</span>
      <span className="toast-msg">{message}</span>
    </div>
  );
}
