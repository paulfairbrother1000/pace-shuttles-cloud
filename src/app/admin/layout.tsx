// BEFORE (you likely had something like this):
// import AdminTabs from "@/components/Nav/AdminTabs";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Keep the new header */}
      <TopBar userName={name} homeHref="/" accountHref="/login" />
      {/* ❌ remove the old tabs row */} 
      {/* <AdminTabs /> */}

      {/* Give content room below the sticky TopBar */}
      <main className="pt-20">{children}</main>
    </div>
  );
}
