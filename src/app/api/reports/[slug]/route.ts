// src/app/api/reports/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/** Minimal, safe CSV encoder */
function csv(rows: any[]): string {
  if (!rows?.length) return '';
  const headers = Object.keys(rows[0] ?? {});
  const quote = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => quote(r[h])).join(','))].join('\n');
}

/** Build a Supabase server client with Next.js cookies adapter */
function getSb() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options?: any) {
          cookieStore.set(name, value, options as any);
        },
        remove(name: string, options?: any) {
          cookieStore.set(name, '', { ...(options || {}), maxAge: 0 } as any);
        },
      },
    }
  );
}

async function getUserRole() {
  const sb = getSb();
  const { data: s } = await sb.auth.getSession();
  const uid = s?.session?.user?.id;
  if (!uid) return { site_admin: false, operator_admin: false, operator_id: null };

  const { data, error } = await sb
    .from('users')
    .select('site_admin, operator_admin, operator_id')
    .eq('id', uid)
    .maybeSingle();

  if (error) throw new Error(`users lookup failed: ${error.message}`);

  return {
    site_admin: !!data?.site_admin,
    operator_admin: !!data?.operator_admin,
    operator_id: data?.operator_id ?? null,
  };
}

function mapSlugToFn(slug: string) {
  switch (slug) {
    case 'revenue_by_route_date': return 'rpt_revenue_by_route_date_v3';
    case 'seat_utilisation':      return 'rpt_seat_utilisation_v2';
    case 'min_seats':             return 'rpt_min_seats_v2';
    case 'operator_settlement':   return 'rpt_operator_settlement_v2';
    default: return null;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: { slug: string } }
) {
  try {
    const { slug } = context.params;

    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'json';
    const qOperatorId = url.searchParams.get('operator_id');
    const from = url.searchParams.get('from');
    const to   = url.searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json({ error: 'from/to required (ISO)' }, { status: 400 });
    }

    const role = await getUserRole();

    // scope operator
    let p_operator: string | null = null;
    if (role.site_admin) {
      p_operator = qOperatorId || null;
      if (!p_operator) {
        return NextResponse.json({ error: 'operator_id required for site admin' }, { status: 400 });
      }
    } else if (role.operator_admin && role.operator_id) {
      p_operator = role.operator_id;
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const fn = mapSlugToFn(slug);
    if (!fn) return NextResponse.json({ error: `Unknown report slug: ${slug}` }, { status: 404 });

    const sb = getSb();
    const { data, error } = await sb.rpc(fn, { p_operator, p_from: from, p_to: to });

    if (error) {
      return NextResponse.json(
        { error: `rpc ${fn} failed`, detail: error.message, hint: (error as any).hint ?? null },
        { status: 500 }
      );
    }

    if (format === 'csv') {
      return new NextResponse(csv(data || []), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    return NextResponse.json({ rows: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: 'Internal error', detail: e?.message ?? String(e) }, { status: 500 });
  }
}

/** Accept HEAD/OPTIONS to avoid 405s from prefetches */
export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: { Allow: 'GET, HEAD, OPTIONS' } });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: { Allow: 'GET, HEAD, OPTIONS' } });
}
