import AdminNav from "./_components/AdminNav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminNav />
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </>
  );
}
