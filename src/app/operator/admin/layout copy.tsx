import type { ReactNode } from "react";
import OperatorNav from "./_components/OperatorNav";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <OperatorNav />
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </>
  );
}
