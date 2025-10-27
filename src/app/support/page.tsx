// src/app/support/page.tsx  (TEMP ISOLATION VERSION)
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main style={{minHeight:"60vh",padding:"24px",color:"#eaf2ff",background:"#0f1a2a"}}>
      <h1 style={{fontSize:"20px",fontWeight:600}}>Support</h1>
      <p style={{opacity:.85,marginTop:12}}>
        Temporary isolation page to diagnose a build-time import cycle.
      </p>
    </main>
  );
}
