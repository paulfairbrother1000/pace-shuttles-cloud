"use client";
import { Home, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ClientTopNav({ userName }: { userName?: string | null }) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-4 py-2 transition-colors duration-300 ${
        scrolled ? "bg-black/70 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <button
        onClick={() => router.push("/")}
        className="flex items-center gap-1 text-white text-sm font-medium"
      >
        <Home className="w-4 h-4" /> Home
      </button>
      <button
        onClick={() => router.push("/login")}
        className="flex items-center gap-1 text-white text-sm font-medium"
      >
        <User className="w-4 h-4" /> {userName ?? "Login"}
      </button>
    </header>
  );
}
