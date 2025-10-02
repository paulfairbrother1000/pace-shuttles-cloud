cat > 'src/app/api/reports/[slug]/route.ts' <<'TS'
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  // Extract the last path segment as the slug: /api/reports/<slug>
  const { pathname } = new URL(req.url);
  const parts = pathname.split('/').filter(Boolean);
  const slug = parts[parts.length - 1] ?? '';

  // minimal handler (replace with your real logic once build is green)
  return NextResponse.json(
    { ok: true, slug },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export {};
TS

git add 'src/app/api/reports/[slug]/route.ts'
git commit -m "fix(api): Next 15 route—use single-arg GET(req) and parse slug from URL"
git push origin main
CI=1 npx next build
