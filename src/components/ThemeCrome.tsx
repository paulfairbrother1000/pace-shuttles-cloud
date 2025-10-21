// components/ThemeChrome.tsx
"use client";
export default function ThemeChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="ps-theme min-h-screen bg-app text-app">
      <style jsx global>{`
        /* === paste the WHOLE Theme Block v1 from src/app/page.tsx here, unchanged === */
      `}</style>
      {children}
    </div>
  );
}
