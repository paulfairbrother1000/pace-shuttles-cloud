// src/components/Nav/TopBar.tsx
"use client";

type Props = {
  userName?: string | null;     // e.g., "Paul"
  homeHref?: string;            // default "/"
  accountHref?: string;         // default "/login"
  className?: string;           // optional overrides
};

export default function TopBar({
  userName,
  homeHref = "/",
  accountHref = "/login",
  className = "",
}: Props) {
  return (
    <header
      className={
        "fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2 " +
        "bg-black/40 backdrop-blur-md text-white " + className
      }
      role="navigation"
      aria-label="Top navigation"
    >
      <a href={homeHref} className="text-sm font-medium" aria-label="Go to Home">Home</a>
      <a href={accountHref} className="text-sm font-medium" aria-label="Open account">
        {userName ?? "Login"}
      </a>
    </header>
  );
}
