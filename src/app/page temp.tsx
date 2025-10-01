// src/app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Pace Shuttles</h1>
      <p className="mb-4">Home is temporarily a simple page while we debug login.</p>
      <div className="space-x-3">
        <Link href="/book/country" className="underline">Pick country</Link>
        <Link href="/login" className="underline">Login</Link>
        <Link href="/account" className="underline">Account</Link>
      </div>
    </main>
  );
}
