"use client";
export default function Error({ error, reset }:{ error: Error & { digest?: string }, reset: () => void }) {
  console.error("Route editor error:", error);
  return (
    <div style={{padding:16}}>
      <h2>Editor crashed</h2>
      <pre style={{whiteSpace:"pre-wrap",fontSize:12}}>
        {error.stack || error.message}
      </pre>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
