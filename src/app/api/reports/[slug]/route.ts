import { NextResponse } from 'next/server';

type Ctx = { params: { slug: string } };

export async function GET(_req: Request, { params }: Ctx) {
  return NextResponse.json(
    { ok: true, slug: params.slug },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export {};
