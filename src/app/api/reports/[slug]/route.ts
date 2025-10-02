import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.pathname.split('/').filter(Boolean).pop() ?? '';

  const format = url.searchParams.get('format') ?? 'json';

  if (format === 'csv') {
    return new NextResponse(`ok,slug\ntrue,${slug}\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json({ ok: true, slug }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export {};
