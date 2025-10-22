// src/app/layout.tsx

import RoleAwareMenu from "@/components/menus/RoleAwareMenu";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RoleAwareMenu />
        {/* Spacer so content doesn't sit under the fixed bar */}
        <div className="h-12 md:h-12" />
        {children}
      </body>
    </html>
  );
}
