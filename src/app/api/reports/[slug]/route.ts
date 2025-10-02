import { NextResponse } from 'next/server';

/** Route signature (what Next's checker reads) */
export function GET(
  _req: Request,
  context: { params: { slug: string } }
): Promise<Response>;

/** Implementation (kept broad so it compiles everywhere) */
export async function GET(_req: Request, context: any) {
  return NextResponse.json(
    { ok: true, slug: context?.params?.slug },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export {};
