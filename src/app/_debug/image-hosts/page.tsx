// src/app/_debug/image-hosts/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ImgInfo = {
  url: string;
  hostname: string;
  ok: boolean | null; // null = not checked yet
};

export default function DebugImageHosts() {
  const [imgs, setImgs] = useState<ImgInfo[]>([]);

  useEffect(() => {
    // Collect all <img> and <Image> outputs on the page
    const urls = Array.from(document.querySelectorAll("img"))
      .map((n) => (n.currentSrc || (n as HTMLImageElement).src))
      .filter(Boolean) as string[];

    const dedup = Array.from(new Set(urls));
    const out: ImgInfo[] = dedup.map((u) => {
      let host = "";
      try {
        host = new URL(u).hostname;
      } catch {}
      return { url: u, hostname: host, ok: null };
    });

    setImgs(out);

    // Kick off a fetch check for each url (HEAD first; fall back to GET)
    out.forEach(async (it, idx) => {
      try {
        await fetch(it.url, { method: "HEAD", mode: "no-cors" });
        // With no-cors, we can't read status; assume success if no exception
        update(idx, true);
      } catch {
        try {
          await fetch(it.url, { method: "GET", mode: "no-cors" });
          update(idx, true);
        } catch {
          update(idx, false);
        }
      }
    });

    function update(i: number, ok: boolean) {
      setImgs((prev) => {
        const copy = [...prev];
        copy[i] = { ...copy[i], ok };
        return copy;
      });
    }
  }, []);

  const byHost = useMemo(() => {
    const map = new Map<string, ImgInfo[]>();
    for (const it of imgs) {
      const k = it.hostname || "(invalid URL)";
      const arr = map.get(k) || [];
      arr.push(it);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [imgs]);

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Image Hosts Detected</h1>
      <p className="text-sm text-neutral-700">
        This page lists the hostnames for all images currently on the page. Add each hostname to{" "}
        <code>next.config.js</code> under <code>images.remotePatterns</code> and redeploy with the build cache disabled.
      </p>

      <div className="rounded-xl border bg-white shadow divide-y">
        {byHost.length === 0 && (
          <div className="p-4 text-sm text-neutral-600">No images found on this page.</div>
        )}
        {byHost.map(([host, items]) => (
          <div key={host} className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">{host}</div>
              <div className="text-xs text-neutral-500">{items.length} image{items.length === 1 ? "" : "s"}</div>
            </div>
            <ul className="mt-2 space-y-1 text-xs break-all">
              {items.slice(0, 6).map((it) => (
                <li key={it.url} className="flex items-center gap-2">
                  <span
                    className={
                      "inline-block h-2 w-2 rounded-full " +
                      (it.ok === null ? "bg-gray-300" : it.ok ? "bg-green-500" : "bg-red-500")
                    }
                    title={it.ok === null ? "checking" : it.ok ? "reachable" : "blocked"}
                  />
                  <code className="whitespace-pre-wrap">{it.url}</code>
                </li>
              ))}
              {items.length > 6 && (
                <li className="text-neutral-500">+ {items.length - 6} more…</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="text-sm text-neutral-600">
        Tip: if you see a host like <code>images.unsplash.com</code> or <code>res.cloudinary.com</code>, add it to{" "}
        <code>remotePatterns</code>:
        <pre className="mt-2 rounded bg-neutral-50 p-2 overflow-x-auto"><code>{`images: {
  remotePatterns: [
    { protocol: "https", hostname: "bopvaaexicvdueidyvjd.supabase.co", pathname: "/storage/v1/object/public/**" },
    { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
    // …add the others you see here
  ],
}`}</code></pre>
      </div>
    </div>
  );
}
