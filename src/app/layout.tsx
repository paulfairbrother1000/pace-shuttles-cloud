// app/layout.tsx
import "./globals.css";
import { Suspense } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Suspense boundary fixes all descendants that use useSearchParams */}
        <Suspense fallback={null}>
          {children}
        </Suspense>
      </body>
    </html>
  );
}
