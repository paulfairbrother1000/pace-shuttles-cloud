

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app";


ALTER SCHEMA "app" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "pace";


ALTER SCHEMA "pace" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."booking_status" AS ENUM (
    'Scheduled',
    'Complete',
    'Cancelled',
    'Postponed'
);


ALTER TYPE "public"."booking_status" OWNER TO "postgres";


CREATE TYPE "public"."crew_assignment_status" AS ENUM (
    'assigned',
    'confirmed',
    'declined',
    'removed',
    'no_show',
    'completed'
);


ALTER TYPE "public"."crew_assignment_status" OWNER TO "postgres";


CREATE TYPE "public"."inventory_status" AS ENUM (
    'pending',
    'uploading',
    'indexing',
    'ready',
    'error'
);


ALTER TYPE "public"."inventory_status" OWNER TO "postgres";


CREATE TYPE "public"."journey_event_type" AS ENUM (
    'waiting_pickup',
    'underway_outbound',
    'arrived_destination',
    'waiting_destination_pickup',
    'underway_inbound',
    'complete'
);


ALTER TYPE "public"."journey_event_type" OWNER TO "postgres";


CREATE TYPE "public"."partner_application_status" AS ENUM (
    'new',
    'under_review',
    'needs_more_info',
    'approved',
    'declined'
);


ALTER TYPE "public"."partner_application_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'authorized',
    'captured',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."refund_status" AS ENUM (
    'Pending',
    'PartiallyRefunded',
    'Refunded'
);


ALTER TYPE "public"."refund_status" OWNER TO "postgres";


CREATE TYPE "public"."staff_status" AS ENUM (
    'Active',
    'Suspended',
    'Not Active'
);


ALTER TYPE "public"."staff_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'guest',
    'user',
    'operator',
    'captain',
    'crew',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."operators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "admin_email" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "address1" "text",
    "address2" "text",
    "town" "text",
    "region" "text",
    "postal_code" "text",
    "country_id" "uuid",
    "logo_url" "text",
    "commisison" real,
    "csat" smallint,
    "cancellation_policy_id" "uuid",
    "white_label_member" boolean DEFAULT false NOT NULL,
    "ps_owner" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."operators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "minseats" numeric NOT NULL,
    "maxseats" numeric NOT NULL,
    "minvalue" real NOT NULL,
    "description" "text" NOT NULL,
    "picture_url" "text",
    "min_val_threshold" real,
    "type_id" character varying,
    "operator_id" "uuid",
    "preferred" boolean,
    "maxseatdiscount" real,
    "white_label_enabled" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wl_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "owner_operator_id" "uuid" NOT NULL,
    "day_rate_cents" integer NOT NULL,
    "security_deposit_cents" integer DEFAULT 0 NOT NULL,
    "min_notice_hours" integer DEFAULT 12 NOT NULL,
    "cancellation_policy" "text" DEFAULT 'standard'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."wl_assets" OWNER TO "postgres";


CREATE OR REPLACE VIEW "app"."wl_market_assets" AS
 SELECT "wa"."id" AS "wl_asset_id",
    "v"."id" AS "vehicle_id",
    "v"."name" AS "vehicle_name",
    ("v"."maxseats")::integer AS "seats_capacity",
    "wa"."day_rate_cents",
    "wa"."security_deposit_cents",
    "wa"."min_notice_hours",
    "o"."id" AS "owner_operator_id",
    "o"."name" AS "owner_operator_name",
    "o"."country_id",
    "v"."description" AS "vehicle_description",
    "v"."picture_url" AS "vehicle_picture_url",
    "v"."type_id" AS "vehicle_type_id"
   FROM (("public"."wl_assets" "wa"
     JOIN "public"."vehicles" "v" ON ((("v"."id" = "wa"."vehicle_id") AND ("v"."white_label_enabled" = true))))
     JOIN "public"."operators" "o" ON ((("o"."id" = "wa"."owner_operator_id") AND ("o"."ps_owner" = true))))
  WHERE ("wa"."is_active" = true);


ALTER VIEW "app"."wl_market_assets" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."wl_market_for_operator"("p_operator_id" "uuid") RETURNS SETOF "app"."wl_market_assets"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT *
  FROM app.wl_market_assets a
  WHERE a.country_id = (SELECT country_id FROM public.operators WHERE id = p_operator_id)
    AND EXISTS (
      SELECT 1 FROM public.operators op
      WHERE op.id = p_operator_id
        AND op.white_label_member = true
    );
$$;


ALTER FUNCTION "app"."wl_market_for_operator"("p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "pace"."allocate_parties_to_boats"("p_route" "uuid", "p_ymd" "date") RETURNS TABLE("route_id" "uuid", "ymd" "date", "vehicle_id" "uuid", "vehicle_name" "text", "preferred" boolean, "cap" integer, "used" integer, "remaining" integer, "groups" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  boat_ids    uuid[];
  boat_names  text[];
  boat_pref   boolean[];
  boat_caps   int[];
  boat_used   int[];
  boat_groups jsonb[];  -- parallel array of per-boat groups as JSON arrays

  party_size int;
  i int;
  best_i int;
  best_free int;
  free_i int;
begin
  -- Load active boats for this route (cap from vehicles.maxseats)
  select
    array_agg(v.id order by (coalesce(a.preferred,false)) desc, coalesce(v.maxseats,0), v.name),
    array_agg(v.name order by (coalesce(a.preferred,false)) desc, coalesce(v.maxseats,0), v.name),
    array_agg(coalesce(a.preferred,false) order by (coalesce(a.preferred,false)) desc, coalesce(v.maxseats,0), v.name),
    array_agg(coalesce(v.maxseats,0)::int order by (coalesce(a.preferred,false)) desc, coalesce(v.maxseats,0), v.name)
  into boat_ids, boat_names, boat_pref, boat_caps
  from route_vehicle_assignments a
  join vehicles v on v.id = a.vehicle_id and coalesce(v.active,true) = true
  where a.route_id = p_route
    and coalesce(a.is_active,true) = true;

  if boat_ids is null or array_length(boat_ids,1) is null then
    return; -- no boats assigned
  end if;

  -- init used and groups
  boat_used := array_fill(0, array[array_length(boat_ids,1)]);
  boat_groups := array_fill('[]'::jsonb, array[array_length(boat_ids,1)]);

  -- Greedy assign biggest groups first
  for party_size in
    select qty::int
    from orders
    where route_id = p_route
      and journey_date = p_ymd
      and coalesce(qty,0) > 0
      and status = 'paid'
    order by qty desc
  loop
    best_i := null;
    best_free := null;

    -- pass 1: preferred boats
    for i in 1..array_length(boat_ids,1) loop
      if boat_pref[i] then
        free_i := boat_caps[i] - boat_used[i];
        if free_i >= party_size then
          if best_free is null or free_i < best_free then
            best_i := i; best_free := free_i;
          end if;
        end if;
      end if;
    end loop;

    -- pass 2: non-preferred if nothing found
    if best_i is null then
      for i in 1..array_length(boat_ids,1) loop
        if not boat_pref[i] then
          free_i := boat_caps[i] - boat_used[i];
          if free_i >= party_size then
            if best_free is null or free_i < best_free then
              best_i := i; best_free := free_i;
            end if;
          end if;
        end if;
      end loop;
    end if;

    -- assign if any candidate fits; otherwise unassigned (ignored)
    if best_i is not null then
      boat_used[best_i] := boat_used[best_i] + party_size;
      boat_groups[best_i] := boat_groups[best_i] || to_jsonb(party_size);
    end if;
  end loop;

  -- Emit one row per boat
  for i in 1..array_length(boat_ids,1) loop
    route_id   := p_route;
    ymd        := p_ymd;
    vehicle_id := boat_ids[i];
    vehicle_name := boat_names[i];
    preferred  := boat_pref[i];
    cap        := boat_caps[i];
    used       := boat_used[i];
    remaining  := greatest(0, boat_caps[i] - boat_used[i]);
    groups     := boat_groups[i];
    return next;
  end loop;
end;
$$;


ALTER FUNCTION "pace"."allocate_parties_to_boats"("p_route" "uuid", "p_ymd" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_booked_seats_for_route_day"("p_route" "uuid", "p_date" "date") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(sum(bsc.seats), 0)
  from public.booking_seat_counts bsc
  join public.journeys j on j.id = bsc.journey_id
  where j.route_id = p_route
    and public._journey_local_date(j.id) = p_date
$$;


ALTER FUNCTION "public"."_booked_seats_for_route_day"("p_route" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_journey_date"("p_journey" "uuid") RETURNS "date"
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(
           (to_jsonb(j)->>'journey_date')::date,
           (to_jsonb(j)->>'date')::date,
           (to_jsonb(j)->>'date_iso')::date,
           ((to_jsonb(j)->>'departure_ts')::timestamptz)::date
         )
  from public.journeys j
  where j.id = p_journey
$$;


ALTER FUNCTION "public"."_journey_date"("p_journey" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_journey_local_date"("p_journey" "uuid") RETURNS "date"
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(
           (to_jsonb(j)->>'journey_date')::date,
           (to_jsonb(j)->>'date')::date,
           (to_jsonb(j)->>'date_iso')::date,
           (
             (to_jsonb(j)->>'departure_ts')::timestamptz
               at time zone coalesce(c.timezone, 'UTC')
           )::date
         )
  from public.journeys j
  join public.routes r on r.id = j.route_id
  left join public.countries c on c.id = r.country_id
  where j.id = p_journey
$$;


ALTER FUNCTION "public"."_journey_local_date"("p_journey" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_route_capacity"("p_route" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(sum((v.maxseats)::int), 0)
  from public.route_vehicle_assignments rva
  join public.vehicles v on v.id = rva.vehicle_id
  where rva.route_id = p_route
    and coalesce(rva.is_active, true) = true
    and coalesce(v.active, true) = true
$$;


ALTER FUNCTION "public"."_route_capacity"("p_route" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."allocate_and_book"("p_route_id" "uuid", "p_departure_ts" timestamp with time zone, "p_seats" integer, "p_customer_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  cand record;
  v_booking_id uuid;
  v_created_journey uuid;
  v_current_filled int;
  v_capacity int;
  v_minseats int;
  v_effective_price numeric;

  -- cursor over ranked candidates for this route
  cur_candidates cursor for
    with candidates as (
      select
        v.id                                as vehicle_id,
        v.name                              as vehicle_name,
        v.operator_id,
        o.csat                              as operator_csat,
        coalesce(rva.preferred,false)       as preferred,
        v.maxseats                          as maxseats,
        coalesce(v.minseats, 0)             as minseats,
        coalesce(v.baseprice, 999999.0)     as baseprice,
        coalesce(v.maxseatdiscount, 0.0)    as maxseatdiscount
      from route_vehicle_assignments rva
      join vehicles v on v.id = rva.vehicle_id and v.active = true
      join operators o on o.id = v.operator_id
      where rva.is_active = true
        and rva.route_id = p_route_id
    ),
    filled as (
      select j.vehicle_id, coalesce(sum(b.seats),0)::int as booked
      from journeys j
      left join bookings b on b.journey_id = j.id
      where j.route_id = p_route_id
        and j.is_active = true
        and j.departure_ts = p_departure_ts
      group by j.vehicle_id
    )
    select
      c.*,
      coalesce(f.booked, 0)                    as booked_now,
      effective_price(c.baseprice, c.maxseatdiscount, coalesce(f.booked,0), c.maxseats) as effprice_now
    from candidates c
    left join filled f on f.vehicle_id = c.vehicle_id
    order by
      case when coalesce(f.booked,0) < c.minseats then 0 else 1 end, -- Phase A first
      -- Phase A buckets sort by base/eff price; Phase B uses effective price
      case when coalesce(f.booked,0) < c.minseats then c.baseprice else effective_price(c.baseprice, c.maxseatdiscount, coalesce(f.booked,0), c.maxseats) end asc,
      c.operator_csat desc,
      c.preferred desc,
      c.vehicle_name asc;
begin
  if p_seats <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_seats');
  end if;

  -- Iterate ranked candidates until we place the booking or exhaust options
  for cand in cur_candidates loop
    -- ensure there is a journey row for this vehicle/route/departure (create on demand)
    select j.id into v_created_journey
    from journeys j
    where j.route_id = p_route_id
      and j.vehicle_id = cand.vehicle_id
      and j.departure_ts = p_departure_ts
      and j.is_active = true
    limit 1;

    if v_created_journey is null then
      insert into journeys (route_id, vehicle_id, departure_ts, is_active)
      values (p_route_id, cand.vehicle_id, p_departure_ts, true)
      returning id into v_created_journey;
    end if;

    -- lock journey's vehicle capacity row to serialize capacity checks
    select v.maxseats, coalesce(v.minseats,0) into v_capacity, v_minseats
    from vehicles v
    where v.id = cand.vehicle_id
    for update;

    -- recompute filled (current tx view)
    select coalesce(sum(b.seats),0)::int into v_current_filled
    from bookings b
    where b.journey_id = v_created_journey;

    -- capacity guard
    if v_current_filled + p_seats > v_capacity then
      continue; -- try next candidate
    end if;

    -- PHASE A rule already encoded in ordering: all boats that are still < minseats come before others.
    -- The first candidate that passes capacity is our target.

    insert into bookings (journey_id, vehicle_id, seats, customer_name, status)
    values (v_created_journey, cand.vehicle_id, p_seats, p_customer_name, 'confirmed')
    returning id into v_booking_id;

    return jsonb_build_object(
      'ok', true,
      'journey_id', v_created_journey,
      'vehicle_id', cand.vehicle_id,
      'booking_id', v_booking_id
    );
  end loop;

  -- No boat could accept the seats -> sold out
  return jsonb_build_object('ok', false, 'code', 'sold_out');
end;
$$;


ALTER FUNCTION "public"."allocate_and_book"("p_route_id" "uuid", "p_departure_ts" timestamp with time zone, "p_seats" integer, "p_customer_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."allocate_parties_to_vehicles"("p_route" "uuid", "p_ymd" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  rec RECORD;
  party RECORD;
  chosen RECORD;
  v_capacity int;
  v_used int;
BEGIN
  -- Clear any previous allocations for this route/day
  DELETE FROM public.vehicle_allocations
  WHERE route_id = p_route AND ymd = p_ymd;

  -- Cursor through parties (largest groups first)
  FOR party IN
    SELECT b.id AS party_id, b.seats
    FROM public.bookings b
    WHERE b.route_id = p_route
      AND b.journey_date = p_ymd
      AND b.status = 'Scheduled'   -- only those travelling
    ORDER BY b.seats DESC
  LOOP
    -- Pick the smallest vehicle that can still take them
    SELECT v.id, v.maxseats,
           COALESCE(SUM(a.seats),0) AS used
    INTO chosen
    FROM public.vehicles v
    JOIN public.route_vehicle_assignments rva
      ON rva.vehicle_id = v.id AND rva.route_id = p_route
    LEFT JOIN public.vehicle_allocations a
      ON a.vehicle_id = v.id AND a.route_id = p_route AND a.ymd = p_ymd
    WHERE v.active = true
    GROUP BY v.id, v.maxseats
    HAVING (v.maxseats - COALESCE(SUM(a.seats),0)) >= party.seats
    ORDER BY rva.preferred DESC, (v.maxseats - COALESCE(SUM(a.seats),0)) ASC
    LIMIT 1;

    IF chosen.id IS NOT NULL THEN
      INSERT INTO public.vehicle_allocations(route_id, ymd, party_id, vehicle_id)
      VALUES (p_route, p_ymd, party.party_id, chosen.id);
    ELSE
      RAISE NOTICE 'Party % could not be allocated (size %)', party.party_id, party.seats;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."allocate_parties_to_vehicles"("p_route" "uuid", "p_ymd" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."allocate_vehicles_for_day"("_route_id" "uuid", "_ymd" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  p_record RECORD;
  chosen uuid;
BEGIN
  -- Clear any previous allocation for this route/day
  DELETE FROM public.vehicle_allocations
  WHERE route_id = _route_id AND ymd = _ymd;

  -- Working state of vehicles (remaining capacity) for this route
  CREATE TEMP TABLE _veh_state (
    vehicle_id uuid PRIMARY KEY,
    remaining  integer NOT NULL,
    preferred  boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;

  INSERT INTO _veh_state (vehicle_id, remaining, preferred)
  SELECT
    a.vehicle_id,
    COALESCE(NULLIF(v.maxseats::int, 0), 0) AS remaining,
    COALESCE(a.preferred, false)            AS preferred
  FROM public.route_vehicle_assignments a
  JOIN public.vehicles v
    ON v.id = a.vehicle_id
  WHERE a.route_id = _route_id
    AND COALESCE(a.is_active, true)
    AND COALESCE(v.active, true);

  -- Parties = one row per booking on that journey, sized by pax in the manifest
  CREATE TEMP TABLE _parties (
    party_id uuid PRIMARY KEY,
    size     integer NOT NULL CHECK (size > 0)
  ) ON COMMIT DROP;

  INSERT INTO _parties (party_id, size)
  SELECT
    b.id AS party_id,
    COUNT(*)::int AS size
  FROM public.journeys j
  JOIN public.bookings b
    ON b.journey_id = j.id
  JOIN public.journey_order_manifest m
    ON m.journey_id = j.id
  WHERE j.route_id = _route_id
    AND j.departure_ts::date = _ymd
    AND b.status IN ('Scheduled','Complete')   -- counts only travelling bookings
  GROUP BY b.id;

  -- Greedy fit: largest parties first; pick smallest-sufficient remaining, preferring preferred boats
  FOR p_record IN
    SELECT party_id, size
    FROM _parties
    ORDER BY size DESC, party_id
  LOOP
    chosen := NULL;
    SELECT s.vehicle_id
      INTO chosen
    FROM _veh_state s
    WHERE s.remaining >= p_record.size
    ORDER BY
      CASE WHEN s.preferred THEN 0 ELSE 1 END,  -- prefer preferred boats
      s.remaining                               -- smallest sufficient remaining first
    LIMIT 1;

    IF chosen IS NOT NULL THEN
      -- Assign and reduce remaining capacity
      INSERT INTO public.vehicle_allocations(route_id, ymd, party_id, vehicle_id)
      VALUES (_route_id, _ymd, p_record.party_id, chosen);

      UPDATE _veh_state
      SET remaining = remaining - p_record.size
      WHERE vehicle_id = chosen;
      -- If you want to track unassigned parties, add an ELSE branch here
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."allocate_vehicles_for_day"("_route_id" "uuid", "_ymd" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."api_finalize_checkout"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_lead_first" "text", "p_lead_last" "text", "p_lead_email" "text", "p_lead_phone" "text", "p_seat_count" integer, "p_unit_base_cents" integer, "p_unit_tax_cents" integer, "p_unit_fees_cents" integer, "p_quote_token" "text") RETURNS TABLE("booking_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_booking_id uuid;
begin
  -- (A) Verify quote token (required by your SSOT rule)
  -- Replace with your actual verification; must fail if invalid.
  perform 1 from public.valid_quote_tokens
   where quote_token = p_quote_token and journey_id = p_journey_id
   for update;
  if not found then
    raise exception 'invalid quote token' using errcode = '22023';
  end if;

  -- (B) Optional: capacity guard (read from base tables, NOT the view)
  -- Prevent oversell at commit-time
  -- Lock the journey record (or a lightweight lock) to serialize concurrent checkouts
  perform 1 from public.journeys j where j.id = p_journey_id for update;

  -- Compute remaining safely in-SQL from bookings (source of truth)
  -- Adjust these table/column names to yours:
  --   vehicles.maxseats, route_vehicle_assignments, booking_items.seats, etc.
  if (
    select coalesce(v.maxseats,0)
           - coalesce((
               select sum(bi.seats)
               from public.booking_items bi
               where bi.journey_id = p_journey_id
             ),0)
    from public.vehicles v
    join public.route_vehicle_assignments rva on rva.vehicle_id = v.id
    where rva.route_id = (select route_id from public.journeys where id = p_journey_id)
      and (p_vehicle_id is null or v.id = p_vehicle_id)
    limit 1
  ) < p_seat_count then
    raise exception 'not enough seats remaining' using errcode = '22023';
  end if;

  -- (C) Create the booking header (if you use a header table; otherwise skip)
  insert into public.bookings (lead_first, lead_last, lead_email, lead_phone, created_at)
  values (p_lead_first, p_lead_last, p_lead_email, p_lead_phone, now())
  returning id into v_booking_id;

  -- (D) Insert line into booking_items (this is the ONLY thing that should affect availability)
  insert into public.booking_items (
    booking_id,
    journey_id,
    vehicle_id,         -- keep nullable if assignment can change later
    seats,
    unit_base_cents,
    unit_tax_cents,
    unit_fees_cents,
    unit_total_cents,   -- convenience
    created_at
  )
  values (
    v_booking_id,
    p_journey_id,
    p_vehicle_id,
    p_seat_count,
    p_unit_base_cents,
    p_unit_tax_cents,
    p_unit_fees_cents,
    p_unit_base_cents + p_unit_tax_cents + p_unit_fees_cents,
    now()
  );

  -- (E) (Optional) mark quote_token as consumed to enforce single-use
  update public.valid_quote_tokens
     set consumed_at = now()
   where quote_token = p_quote_token;

  return query select v_booking_id;
end;
$$;


ALTER FUNCTION "public"."api_finalize_checkout"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_lead_first" "text", "p_lead_last" "text", "p_lead_email" "text", "p_lead_phone" "text", "p_seat_count" integer, "p_unit_base_cents" integer, "p_unit_tax_cents" integer, "p_unit_fees_cents" integer, "p_quote_token" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_vehicle_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "route_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "preferred" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."route_vehicle_assignments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_vehicle_to_route"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_preferred" boolean DEFAULT false) RETURNS "public"."route_vehicle_assignments"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rec route_vehicle_assignments;
begin
  -- ensure the vehicle exists and is active
  if not exists (select 1 from vehicles v where v.id = p_vehicle_id and v.active = true) then
    raise exception 'Vehicle is not active or does not exist';
  end if;

  -- upsert the assignment and (re)activate it
  insert into route_vehicle_assignments(route_id, vehicle_id, is_active, preferred)
  values (p_route_id, p_vehicle_id, true, coalesce(p_preferred,false))
  on conflict (route_id, vehicle_id)
  do update set
    is_active = true,
    preferred = coalesce(excluded.preferred, route_vehicle_assignments.preferred)
  returning * into rec;

  -- if we set this as preferred, clear any other preferred for the same route
  if p_preferred then
    update route_vehicle_assignments
      set preferred = false
    where route_id = p_route_id
      and vehicle_id <> p_vehicle_id
      and preferred = true;
  end if;

  return rec;
end;
$$;


ALTER FUNCTION "public"."assign_vehicle_to_route"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_preferred" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booking_counts_delete_redirect"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  -- Redirect delete on aggregated view row to base table rows.
  -- Example: delete bookings for this journey/vehicle that were created by the current quote/hold flow, etc.
  delete from public.bookings
  where journey_id = old.journey_id
    and vehicle_id = old.vehicle_id
    -- add any extra WHERE to match exactly what your app expects.
  ;
  return null; -- INSTEAD OF trigger: nothing to return
end;
$$;


ALTER FUNCTION "public"."booking_counts_delete_redirect"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_route_capacity"("p_route_id" "uuid") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  WITH caps AS (
    SELECT
      rva.route_id,
      COUNT(*) FILTER (
        WHERE COALESCE(v.active, TRUE) AND COALESCE(rva.is_active, TRUE)
      ) AS active_vehicles,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.active, TRUE) AND COALESCE(rva.is_active, TRUE)
          THEN COALESCE(v.maxseats, 0) ELSE 0 END
      ), 0) AS active_capacity
    FROM public.route_vehicle_assignments rva
    JOIN public.vehicles v ON v.id = rva.vehicle_id
    WHERE rva.route_id = p_route_id
    GROUP BY rva.route_id
  )
  INSERT INTO public.route_inventory_status AS s (route_id, active_vehicles, active_capacity)
  SELECT p_route_id, COALESCE(c.active_vehicles,0), COALESCE(c.active_capacity,0)
  FROM caps c
  ON CONFLICT (route_id) DO UPDATE
    SET active_vehicles = EXCLUDED.active_vehicles,
        active_capacity = EXCLUDED.active_capacity,
        updated_at = now();
$$;


ALTER FUNCTION "public"."compute_route_capacity"("p_route_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_operator_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select (current_setting('request.jwt.claims', true)::jsonb ->> 'operator_id')::uuid;
$$;


ALTER FUNCTION "public"."current_operator_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."effective_price"("p_base" numeric, "p_maxseatdiscount" numeric, "p_filled" integer, "p_capacity" integer) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select
    case
      when p_capacity <= 0 then p_base
      else
        -- simple monotonic discount up to maxseatdiscount as boat fills
        p_base * (1 - least(greatest(p_filled::numeric / nullif(p_capacity,0), 0), coalesce(p_maxseatdiscount,0)))
    end
$$;


ALTER FUNCTION "public"."effective_price"("p_base" numeric, "p_maxseatdiscount" numeric, "p_filled" integer, "p_capacity" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flag_enabled"("p_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce((select enabled from public.app_flags where key = p_key limit 1), false);
$$;


ALTER FUNCTION "public"."flag_enabled"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_assert_one_lead"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_is_lead boolean;
  v_count   integer;
BEGIN
  -- Is the incoming row a lead role and in an active state?
  SELECT is_mandatory INTO v_is_lead
  FROM public.transport_type_roles
  WHERE id = NEW.role_id;

  IF v_is_lead IS TRUE AND NEW.status IN ('assigned','confirmed') THEN
    SELECT COUNT(*) INTO v_count
    FROM public.journey_crew_assignments jca
    JOIN public.transport_type_roles ttr ON ttr.id = jca.role_id
    WHERE jca.journey_id = NEW.journey_id
      AND jca.vehicle_id = NEW.vehicle_id
      AND jca.id <> COALESCE(NEW.id, jca.id)
      AND jca.status IN ('assigned','confirmed')
      AND ttr.is_mandatory = TRUE;

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Only one lead (mandatory role) allowed per journey+vehicle in active states';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_assert_one_lead"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_assign_seats"("p_order_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_item RECORD;
  v_vehicle_id uuid;
  v_minseats int;
  v_maxseats int;
  v_reserved int;
  v_remaining int;
  v_next_price int;
BEGIN
  -- pick the first item (extend to multi-line orders as needed)
  SELECT oi.*, j.id AS journey_id, j.route_id, j.departure_ts, v.id AS veh_id, v.preferred, v.minseats::int, v.maxseats::int
  INTO v_item
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.journeys j ON j.route_id = oi.route_id AND j.departure_ts::date = oi.departure_date
  JOIN public.vehicles v ON v.id = oi.vehicle_id
  WHERE oi.order_id = p_order_id
  LIMIT 1;

  v_vehicle_id := v_item.veh_id;
  v_minseats   := v_item.minseats;
  v_maxseats   := v_item.maxseats;

  -- capacity guard: ensure not exceeding maxseats
  SELECT COALESCE(SUM(oi.qty),0) INTO v_reserved
  FROM public.order_items oi
  JOIN public.orders o2 ON o2.id = oi.order_id AND o2.status IN ('paid','assigned','fulfilled')
  WHERE oi.vehicle_id = v_vehicle_id
    AND oi.route_id = v_item.route_id
    AND oi.departure_date = v_item.departure_date;

  IF (v_reserved + v_item.qty) > v_maxseats THEN
    RAISE EXCEPTION 'No capacity on vehicle % for journey %', v_vehicle_id, v_item.journey_id USING ERRCODE = 'check_violation';
  END IF;

  -- recompute next advertised price (reuse pricing)
  SELECT advertised_unit_next_cents
  INTO v_next_price
  FROM public.fn_calculate_pricing(v_item.journey_id, v_vehicle_id, v_item.qty);

  v_remaining := GREATEST(0, v_maxseats - (v_reserved + v_item.qty));

  -- upsert journey_inventory
  INSERT INTO public.journey_inventory (journey_id, seats_reserved, seats_remaining, minseats_reached, advertised_unit_price_cents)
  VALUES (v_item.journey_id, v_reserved + v_item.qty, v_remaining, (v_reserved + v_item.qty) >= v_minseats, v_next_price)
  ON CONFLICT (journey_id) DO UPDATE
  SET seats_reserved = EXCLUDED.seats_reserved,
      seats_remaining = EXCLUDED.seats_remaining,
      minseats_reached = EXCLUDED.minseats_reached,
      advertised_unit_price_cents = EXCLUDED.advertised_unit_price_cents,
      updated_at = now();

  -- mark order assigned
  UPDATE public.orders SET status = 'assigned' WHERE id = p_order_id AND status = 'paid';

  RETURN v_vehicle_id;
END;
$$;


ALTER FUNCTION "public"."fn_assign_seats"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_calculate_pricing"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_qty" integer) RETURNS TABLE("unit_base_cents" integer, "base_cents" integer, "tax_cents" integer, "fees_cents" integer, "total_cents" integer, "commission_percent" numeric, "commission_due_cents" integer, "operator_yield_cents" integer, "advertised_unit_next_cents" integer)
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_route_id uuid;
  v_departure_ts timestamptz;
  v_unit0 int;               -- journeys.base_price_cents
  v_minseats int;
  v_maxseats int;
  v_maxseatdiscount numeric;  -- fraction (e.g., 0.10)
  v_minvalue_cents int;       -- floor (per-journey base)
  v_country_id uuid;
  v_tax_frac numeric;         -- 0.17 = 17%
  v_fees_frac numeric;        -- 0.05 = 5%
  v_op_id uuid;
  v_op_comm_frac numeric;     -- operator.commission fraction
  v_fallback_comm_frac numeric;
  v_days_to int;
  v_late_days_max int;
  v_late_disc_frac numeric;   -- routes.late_discount_percent as fraction
  v_seats_reserved int;
  v_progress numeric;
  v_seat_disc_frac numeric;
  v_unit1 numeric;
  v_unit2 numeric;
  v_R_so_far int;
  v_unit_final int;
  v_comm_frac numeric;
  v_unit_next int;
BEGIN
  SELECT j.route_id, j.departure_ts, j.base_price_cents, r.country_id,
         COALESCE(r.late_booking_days_max, 0),
         COALESCE(r.late_discount_percent, 0)::numeric/100.0
  INTO v_route_id, v_departure_ts, v_unit0, v_country_id, v_late_days_max, v_late_disc_frac
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id;

  SELECT GREATEST(0, (v_departure_ts::date - current_date)) INTO v_days_to;

  SELECT v.minseats::int, v.maxseats::int,
         COALESCE(v.maxseatdiscount,0)::numeric/100.0,
         COALESCE(v.minvalue,0)::numeric
  INTO v_minseats, v_maxseats, v_maxseatdiscount, v_minvalue_cents
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;

  SELECT COALESCE(tf.tax,0), COALESCE(tf.fees,0),
         COALESCE(tf.platform_commission_percent,0)
  INTO v_tax_frac, v_fees_frac, v_fallback_comm_frac
  FROM public.tax_fees tf
  WHERE tf.country_id = v_country_id
  ORDER BY tf.id DESC
  LIMIT 1;

  SELECT j.operator_id INTO v_op_id FROM public.journeys j WHERE j.id = p_journey_id;
  SELECT o.commission INTO v_op_comm_frac FROM public.operators o WHERE o.id = v_op_id;

  -- current seats & base revenue (this vehicle on this journey)
  SELECT COALESCE(SUM(oi.qty),0), COALESCE(SUM(oi.unit_price_cents * oi.qty),0)
  INTO v_seats_reserved, v_R_so_far
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id AND o.status IN ('paid','assigned','fulfilled')
  WHERE oi.vehicle_id = p_vehicle_id
    AND oi.route_id = v_route_id
    AND oi.departure_date = v_departure_ts::date;

  -- seat-based discount (linear from minseats->maxseats)
  v_progress := LEAST(1, GREATEST(0, (v_seats_reserved - v_minseats)::numeric / NULLIF(v_maxseats - v_minseats,0)));
  v_seat_disc_frac := v_maxseatdiscount * v_progress;
  v_unit1 := v_unit0 * (1 - v_seat_disc_frac);

  -- late discount (sequential)
  IF v_days_to <= COALESCE(v_late_days_max,0) THEN
    v_unit2 := v_unit1 * (1 - v_late_disc_frac);
  ELSE
    v_unit2 := v_unit1;
  END IF;

  -- minvalue guard (conservative: this order alone won't push base revenue below minvalue)
  IF (v_R_so_far + CEIL(v_unit2) * p_qty) < v_minvalue_cents THEN
    v_unit_final := CEIL( GREATEST(0, (v_minvalue_cents - v_R_so_far)) / NULLIF(p_qty,0) );
  ELSE
    v_unit_final := CEIL(v_unit2);
  END IF;

  unit_base_cents := v_unit_final;
  base_cents := unit_base_cents * p_qty;

  tax_cents := ROUND(base_cents * v_tax_frac);
  fees_cents := ROUND( (base_cents + tax_cents) * v_fees_frac );
  total_cents := base_cents + tax_cents + fees_cents;

  v_comm_frac := COALESCE(v_op_comm_frac, v_fallback_comm_frac);
  commission_percent := COALESCE(v_comm_frac,0);
  commission_due_cents := ROUND(base_cents * COALESCE(v_comm_frac,0));
  operator_yield_cents := base_cents - commission_due_cents;

  -- price to show next buyer after adding these seats
  v_unit_next := CEIL( v_unit0 * (1 - (v_maxseatdiscount * LEAST(1, GREATEST(0, ((v_seats_reserved + p_qty) - v_minseats)::numeric / NULLIF(v_maxseats - v_minseats,0))))) );
  advertised_unit_next_cents := v_unit_next;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."fn_calculate_pricing"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_qty" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_guard_journey_alloc_capacity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_route_id uuid;
  v_cap int;
  v_sum int;
BEGIN
  -- allow NULL vehicle (unassigned)
  IF NEW.vehicle_id IS NULL THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- journey must exist
  SELECT j.route_id INTO v_route_id
  FROM public.journeys j
  WHERE j.id = NEW.journey_id;

  IF v_route_id IS NULL THEN
    RAISE EXCEPTION 'journey % not found', NEW.journey_id;
  END IF;

  -- vehicle must be an active assignment for the journey's route
  IF NOT EXISTS (
    SELECT 1
    FROM public.route_vehicle_assignments rva
    WHERE rva.route_id = v_route_id
      AND rva.vehicle_id = NEW.vehicle_id
      AND COALESCE(rva.is_active, TRUE) = TRUE
  ) THEN
    RAISE EXCEPTION 'vehicle % is not an active assignment for route %',
      NEW.vehicle_id, v_route_id;
  END IF;

  -- capacity from vehicles.maxseats
  SELECT CAST(COALESCE(v.maxseats, 0) AS int)
  INTO v_cap
  FROM public.vehicles v
  WHERE v.id = NEW.vehicle_id;

  IF v_cap IS NULL OR v_cap <= 0 THEN
    RAISE EXCEPTION 'vehicle % has no capacity (maxseats)', NEW.vehicle_id;
  END IF;

  -- current seats on this (journey, vehicle), excluding the same order on UPDATE
  SELECT COALESCE(SUM(a.seats), 0)
  INTO v_sum
  FROM public.journey_allocations a
  WHERE a.journey_id = NEW.journey_id
    AND a.vehicle_id = NEW.vehicle_id
    AND (TG_OP = 'INSERT' OR a.order_id <> NEW.order_id);

  IF v_sum + NEW.seats > v_cap THEN
    RAISE EXCEPTION 'capacity exceeded for journey %, vehicle %: % + % > %',
      NEW.journey_id, NEW.vehicle_id, v_sum, NEW.seats, v_cap;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."fn_guard_journey_alloc_capacity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_operator_remove_vehicle"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_operator_id" "uuid") RETURNS TABLE("moved_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  _orders RECORD;
  _candidates RECORD;
  _placed boolean;
  _moved int := 0;
BEGIN
  -- Precheck: the source vehicle must belong to this operator on this journey.
  IF NOT EXISTS (
    SELECT 1
    FROM public.vw_journey_vehicle_remaining v
    WHERE v.journey_id = p_journey_id
      AND v.vehicle_id = p_vehicle_id
      AND v.operator_id = p_operator_id
  ) THEN
    RAISE EXCEPTION 'Vehicle % is not owned by operator % on journey %',
      p_vehicle_id, p_operator_id, p_journey_id;
  END IF;

  -- Precheck: T-24 guard (use journey departure)
  PERFORM 1
  FROM public.journeys j
  WHERE j.id = p_journey_id
    AND (j.departure_ts AT TIME ZONE 'UTC') > (now() AT TIME ZONE 'UTC') + interval '24 hours';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot remove at or after T-24 for journey %', p_journey_id;
  END IF;

  -- We do a greedy "smallest viable boat, prefer preferred" allocation across OTHER boats of same operator
  -- Build a temp table of candidate boats with remaining capacity we can update as we place orders
  CREATE TEMP TABLE _cand(
    vehicle_id uuid primary key,
    preferred boolean,
    remaining int
  ) ON COMMIT DROP;

  INSERT INTO _cand(vehicle_id, preferred, remaining)
  SELECT v.vehicle_id, COALESCE(v.preferred,false),
         GREATEST(v.remaining,0)
  FROM public.vw_journey_vehicle_remaining v
  WHERE v.journey_id = p_journey_id
    AND v.operator_id = p_operator_id
    AND v.vehicle_id <> p_vehicle_id;

  -- Gather orders currently on the removed boat, biggest groups first
  CREATE TEMP TABLE _to_move(order_id uuid primary key, qty int) ON COMMIT DROP;

  INSERT INTO _to_move(order_id, qty)
  SELECT ja.order_id, COALESCE(o.qty,0)::int
  FROM public.journey_allocations ja
  JOIN public.orders o ON o.id = ja.order_id
  WHERE ja.journey_id = p_journey_id
    AND ja.vehicle_id = p_vehicle_id
  ORDER BY COALESCE(o.qty,0) DESC;

  -- Quick feasibility check: total remaining across other boats must be >= total qty to move
  IF (SELECT COALESCE(SUM(qty),0) FROM _to_move) >
     (SELECT COALESCE(SUM(remaining),0) FROM _cand) THEN
    RAISE EXCEPTION 'Insufficient operator capacity to remove boat: need %, have %',
      (SELECT COALESCE(SUM(qty),0) FROM _to_move),
      (SELECT COALESCE(SUM(remaining),0) FROM _cand);
  END IF;

  -- Transactional move: delete then reinsert per-order on chosen boat
  -- We do all changes in a subtransaction; if any insert fails (trigger), we abort.
  PERFORM pg_advisory_xact_lock( ('x'||replace(substr(p_journey_id::text,1,16),'-',''))::bit(64)::bigint );

  -- Remove existing rows for these orders on this boat
  DELETE FROM public.journey_allocations ja
  USING _to_move t
  WHERE ja.journey_id = p_journey_id
    AND ja.vehicle_id = p_vehicle_id
    AND ja.order_id = t.order_id;

  -- Place each order into smallest viable candidate (prefer preferred then lowest remaining)
  FOR _orders IN SELECT * FROM _to_move ORDER BY qty DESC LOOP
    _placed := false;

    -- Candidate vehicles that can fit this group
    FOR _candidates IN
      SELECT c.vehicle_id
      FROM _cand c
      WHERE c.remaining >= _orders.qty
      ORDER BY c.preferred DESC, c.remaining ASC, c.vehicle_id
    LOOP
      BEGIN
        INSERT INTO public.journey_allocations(journey_id, vehicle_id, order_id)
        VALUES (p_journey_id, _candidates.vehicle_id, _orders.order_id);

        -- success => update remaining cache and mark placed
        UPDATE _cand SET remaining = remaining - _orders.qty
        WHERE vehicle_id = _candidates.vehicle_id;

        _moved := _moved + 1;
        _placed := true;
        EXIT; -- break candidates loop
      EXCEPTION WHEN others THEN
        -- capacity/validity trigger may throw; try next candidate
        CONTINUE;
      END;
    END LOOP;

    IF NOT _placed THEN
      RAISE EXCEPTION 'Failed to place order % (size %)', _orders.order_id, _orders.qty;
    END IF;
  END LOOP;

  moved_count := _moved;
  RETURN NEXT;

END
$$;


ALTER FUNCTION "public"."fn_operator_remove_vehicle"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_pick_vehicle_for_group"("p_journey" "uuid", "p_qty" integer) RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  WITH r AS (
    SELECT
      vehicle_id,
      preferred,
      remaining
    FROM public.vw_journey_vehicle_remaining
    WHERE journey_id = p_journey
      AND remaining >= p_qty
  )
  SELECT vehicle_id
  FROM r
  ORDER BY preferred DESC, remaining DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."fn_pick_vehicle_for_group"("p_journey" "uuid", "p_qty" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_seed_allocations_t72"("p_journey" "uuid") RETURNS TABLE("order_id" "uuid", "vehicle_id" "uuid", "allocated_qty" integer, "note" "text")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_route   uuid;
  v_ymd     date;
  rec       record;
  v_vehicle uuid;
BEGIN
  -- Resolve journey context
  SELECT route_id, date(departure_ts)
    INTO v_route, v_ymd
  FROM public.journeys
  WHERE id = p_journey;

  IF v_route IS NULL THEN
    RAISE EXCEPTION 'Journey % not found', p_journey;
  END IF;

  -- Iterate over unallocated orders for this route+date, largest groups first to reduce fragmentation
  FOR rec IN
    SELECT o.id AS order_id, COALESCE(o.qty,0)::int AS qty
    FROM public.orders o
    WHERE o.route_id = v_route
      AND o.journey_date = v_ymd
      AND COALESCE(o.qty,0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.journey_allocations ja WHERE ja.order_id = o.id
      )
    ORDER BY o.qty DESC, o.created_at
  LOOP
    -- choose a boat with enough remaining seats
    SELECT public.fn_pick_vehicle_for_group(p_journey, rec.qty)
      INTO v_vehicle;

    IF v_vehicle IS NULL THEN
      -- No contiguous capacity large enough; skip (don’t split)
      order_id := rec.order_id;
      vehicle_id := NULL;
      allocated_qty := 0;
      note := 'skipped: insufficient contiguous capacity';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Insert (trigger will enforce correctness)
    INSERT INTO public.journey_allocations (journey_id, order_id, vehicle_id)
    VALUES (p_journey, rec.order_id, v_vehicle)
    ON CONFLICT (order_id) DO NOTHING;

    order_id := rec.order_id;
    vehicle_id := v_vehicle;
    allocated_qty := rec.qty;
    note := 'allocated';
    RETURN NEXT;
  END LOOP;
END
$$;


ALTER FUNCTION "public"."fn_seed_allocations_t72"("p_journey" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_seed_allocations_t72_by_route_date"("p_route" "uuid", "p_ymd" "date") RETURNS TABLE("journey_id" "uuid", "order_id" "uuid", "vehicle_id" "uuid", "allocated_qty" integer, "note" "text")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  j_id uuid;
  r record;
BEGIN
  -- Find the journey on that route/date (assumes one journey per date; adjust if multiple)
  SELECT j.id INTO j_id
  FROM public.journeys j
  WHERE j.route_id = p_route
    AND date(j.departure_ts) = p_ymd
  ORDER BY j.departure_ts
  LIMIT 1;

  IF j_id IS NULL THEN
    RAISE EXCEPTION 'No journey for route % on %', p_route, p_ymd;
  END IF;

  FOR r IN
    SELECT * FROM public.fn_seed_allocations_t72(j_id)
  LOOP
    journey_id := j_id;
    order_id := r.order_id;
    vehicle_id := r.vehicle_id;
    allocated_qty := r.allocated_qty;
    note := r.note;
    RETURN NEXT;
  END LOOP;
END
$$;


ALTER FUNCTION "public"."fn_seed_allocations_t72_by_route_date"("p_route" "uuid", "p_ymd" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_manifest_for_journey"("jid" "uuid") RETURNS TABLE("order_id" "uuid", "first_name" "text", "last_name" "text", "is_lead" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  _op_id uuid;
  _is_admin boolean;
  _journey_operator uuid;
  _vehicle_operator uuid;
begin
  -- Map auth user -> app user
  select u.operator_id, coalesce(u.operator_admin, false)
  into   _op_id,     _is_admin
  from public.users u
  where u.auth_user_id = auth.uid();

  if _op_id is null then
    raise exception 'not allowed: no app user for auth.uid()';
  end if;
  if not _is_admin then
    raise exception 'not allowed: user is not operator_admin';
  end if;

  -- Determine owning operator of the journey
  select j.operator_id, v.operator_id
  into   _journey_operator, _vehicle_operator
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where j.id = jid;

  if _op_id is distinct from coalesce(_vehicle_operator, _journey_operator) then
    raise exception 'not allowed: operator mismatch';
  end if;

  -- Return one row per passenger
  return query
  select op.order_id, op.first_name, op.last_name, op.is_lead
  from public.order_passengers op
  join public.bookings b on b.order_id = op.order_id
  where b.journey_id = jid
  order by op.order_id, op.is_lead desc, op.last_name, op.first_name;
end;
$$;


ALTER FUNCTION "public"."get_manifest_for_journey"("jid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("u" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(site_admin, false) or coalesce(operator_admin, false)
  from public.users
  where id = u
$$;


ALTER FUNCTION "public"."is_admin"("u" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."needs_assignment"() RETURNS TABLE("route_id" "uuid", "journey_date" "date", "seats" integer, "pickup_name" "text", "destination_name" "text")
    LANGUAGE "sql" STABLE
    AS $$
  with paid as (
    select o.route_id, o.journey_date, sum(o.qty)::int as seats
    from public.orders o
    where o.status in ('paid','requires_payment')   -- <— adjust statuses here
      and o.route_id is not null
      and o.journey_date is not null
    group by o.route_id, o.journey_date
  ),
  already as (
    select distinct jv.route_id, jv.journey_date
    from public.journey_vehicles jv
    where jv.vehicle_id is not null
      and coalesce(jv.status,'') <> 'removed'
  )
  select p.route_id,
         p.journey_date,
         p.seats,
         pp.name as pickup_name,
         dd.name as destination_name
  from paid p
  left join already a
    on a.route_id = p.route_id and a.journey_date = p.journey_date
  join public.routes r on r.id = p.route_id
  left join public.pickup_points pp on pp.id = r.pickup_id
  left join public.destinations dd on dd.id = r.destination_id
  where a.route_id is null
  order by p.journey_date asc;
$$;


ALTER FUNCTION "public"."needs_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."op_needing_assignments"("p_operator_id" "uuid") RETURNS TABLE("route_id" "uuid", "journey_date" "date", "seats" integer, "pickup_name" "text", "destination_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with eligible_routes as (
    select distinct rva.route_id
    from route_vehicle_assignments rva
    join vehicles v on v.id = rva.vehicle_id
    where rva.is_active = true
      and v.active = true
      and (p_operator_id is null or v.operator_id = p_operator_id)
  ),
  paid as (
    select o.route_id, o.journey_date, sum(o.qty)::int seats
    from orders o
    join eligible_routes er on er.route_id = o.route_id
    where o.status = 'paid'
    group by o.route_id, o.journey_date
  )
  select p.route_id, p.journey_date, p.seats,
         pp.name as pickup_name,
         dd.name as destination_name
  from paid p
  join routes r on r.id = p.route_id
  left join pickup_points pp on pp.id = r.pickup_id
  left join destinations  dd on dd.id = r.destination_id
  left join journey_vehicles jv
    on jv.route_id = p.route_id
   and jv.journey_date = p.journey_date
   and jv.vehicle_id is not null                -- has an assignment
  where jv.id is null                            -- i.e. NOT assigned yet
  order by p.journey_date asc;
$$;


ALTER FUNCTION "public"."op_needing_assignments"("p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."operator_create_journey"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_departure_ts" timestamp with time zone, "p_base_price_cents" integer, "p_currency" "text", "p_operator_secret" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_journey_id uuid;
  v_secret text;
begin
  -- fetch stored secret
  select value into v_secret from secrets where key = 'operator_secret';

  -- verify operator secret
  if p_operator_secret is null or p_operator_secret <> v_secret then
    raise exception 'Invalid operator secret';
  end if;

  -- insert journey
  insert into journeys (route_id, vehicle_id, departure_ts, base_price_cents, currency)
  values (p_route_id, p_vehicle_id, p_departure_ts, p_base_price_cents, p_currency)
  returning id into v_journey_id;

  return v_journey_id;
end;
$$;


ALTER FUNCTION "public"."operator_create_journey"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_departure_ts" timestamp with time zone, "p_base_price_cents" integer, "p_currency" "text", "p_operator_secret" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."order_for_receipt_raw"("p_order_id" "uuid", "p_token" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare rec jsonb;
begin
  select to_jsonb(o) into rec
  from public.orders o
  where o.id = p_order_id and o.success_token = p_token;
  return rec;
end;
$$;


ALTER FUNCTION "public"."order_for_receipt_raw"("p_order_id" "uuid", "p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."order_receipt_v2"("p_order_id" "uuid", "p_token" "uuid") RETURNS TABLE("id" "uuid", "currency" "text", "qty" integer, "journey_date" "date", "total_cents" bigint, "total_c" numeric)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with o as (
    select id, currency, qty, journey_date
    from orders
    where id = p_order_id
      and success_token = p_token
    limit 1
  ),
  pay as (
    select coalesce(sum(amount_cents), 0)::bigint as total_cents
    from payments
    where order_id = p_order_id
      and status in ('succeeded','paid','captured')
  )
  select
    o.id,
    o.currency,
    o.qty,
    o.journey_date,
    pay.total_cents,
    (pay.total_cents::numeric / 100.0) as total_c
  from o
  left join pay on true;
$$;


ALTER FUNCTION "public"."order_receipt_v2"("p_order_id" "uuid", "p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."order_receipt_v3"("p_order_id" "uuid", "p_token" "uuid") RETURNS TABLE("id" "uuid", "currency" "text", "qty" integer, "journey_date" "date", "tax_rate" numeric, "fees_rate" numeric, "total_cents" bigint, "total_c" numeric, "base_c" numeric, "tax_c" numeric, "fees_c" numeric)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with o as (
  select id, currency, qty, journey_date, created_at
  from orders
  where id = p_order_id
    and success_token = p_token
  limit 1
),
tf as (
  -- tax/fees snapshot closest to order time
  select tax, fees
  from tax_fees
  where created_at <= (select created_at from o)
  order by created_at desc
  limit 1
),
pay as (
  select coalesce(sum(amount_cents),0)::bigint as total_cents
  from payments
  where order_id = p_order_id
    and status in ('succeeded','paid','captured')
),
calc as (
  select
    (pay.total_cents::numeric / 100.0)             as total_c,
    coalesce(tf.tax,  0)::numeric                  as tax_rate,
    coalesce(tf.fees, 0)::numeric                  as fees_rate
  from pay, tf
)
select
  o.id,
  o.currency,
  o.qty,
  o.journey_date,
  calc.tax_rate,
  calc.fees_rate,
  pay.total_cents,
  calc.total_c,
  round( calc.total_c / ((1+calc.tax_rate)*(1+calc.fees_rate))::numeric, 2 )                           as base_c,
  round( (calc.total_c / ((1+calc.tax_rate)*(1+calc.fees_rate))) * calc.tax_rate, 2 )                  as tax_c,
  round( ((calc.total_c / ((1+calc.tax_rate)*(1+calc.fees_rate))) * (1+calc.tax_rate)) * calc.fees_rate, 2 ) as fees_c
from o, pay, calc;
$$;


ALTER FUNCTION "public"."order_receipt_v3"("p_order_id" "uuid", "p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."orders_fill_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  -- If caller didn't pass a user_id, take it from the JWT
  if new.user_id is null then
    begin
      new.user_id := auth.uid();  -- will be null if no JWT context; that's OK
    exception when others then
      -- In case auth extension isn't in search_path in some contexts
      null;
    end;
  end if;

  -- If caller didn't pass status (or passed empty), use default
  if new.status is null or length(trim(new.status)) = 0 then
    new.status := 'requires_payment';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."orders_fill_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pick_cancellation_rule"("_policy" "uuid", "_days" integer) RETURNS bigint
    LANGUAGE "sql" STABLE
    AS $$
  select id
  from cancellation_policy_rules
  where policy_id = _policy
    and _days >= min_days_out
    and (_days <= coalesce(max_days_out, 2147483647))
  order by sort_order desc, min_days_out desc, coalesce(max_days_out, 2147483647) asc
  limit 1;
$$;


ALTER FUNCTION "public"."pick_cancellation_rule"("_policy" "uuid", "_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."price_quote"("journey_uuid" "uuid", "now_utc" timestamp with time zone DEFAULT "now"(), "depart_utc_override" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("journey_id" "uuid", "advertised_all_in_pp" numeric, "seats_remaining" integer, "low_inventory_flag" boolean, "seats_sold" integer, "maxseats" numeric, "revenue_so_far" numeric, "min_required_value" numeric, "tolerance_required_min" numeric, "is_maxseat_discount_active" boolean, "is_t48_discount_active" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with latest_tax as (
  select tax::numeric, fees::numeric
  from tax_fees
  order by id desc
  limit 1
),
j as (
  select j.id as journey_id,
         j.route_id,
         j.vehicle_id
  from journeys j
  where j.id = journey_uuid
),
r as (
  select r.id, r.base_price_gbp,
         r.late_booking_days_max, r.late_discount_percent,
         r.next_departure_iso
  from routes r
  join j on j.route_id = r.id
),
v as (
  select v.id,
         v.minseats::numeric, v.maxseats::numeric, v.minvalue::numeric,
         v.min_val_threshold::numeric, v.maxseatdiscount::numeric,
         v.operator_id
  from vehicles v
  join j on j.vehicle_id = v.id
),
rev as (
  select coalesce(sum(b.total_price), 0)::numeric as revenue_so_far,
         coalesce(sum(b.seats), 0)::integer      as seats_sold
  from bookings b
  join j on b.journey_id = j.journey_id
  where b.status::text in ('Scheduled','Confirmed','Paid','Completed')
),
calc as (
  select
    coalesce(r.base_price_gbp, v.minvalue / nullif(v.minseats,0))          as seat_base,
    (1 + coalesce(lt.tax,0) + coalesce(lt.fees,0))                         as tax_fee_mult,
    v.minvalue                                                              as min_required_value,
    v.minvalue * coalesce(v.min_val_threshold, 1.0)                         as tolerance_required_min,
    coalesce(depart_utc_override, r.next_departure_iso)                     as dep_utc,
    rev.revenue_so_far, rev.seats_sold,
    v.maxseats
  from j
  join r on true
  join v on true
  join rev on true
  join latest_tax lt on true
)
select
  j.journey_id,
  round(
    seat_base
    * case
        when revenue_so_far >= min_required_value
          then (1 - coalesce(v.maxseatdiscount,0))
        when dep_utc is not null
             and (extract(epoch from (dep_utc - now_utc))/86400.0)
                 <= coalesce(r.late_booking_days_max, 0)
             and revenue_so_far < min_required_value
          then (1 - coalesce(r.late_discount_percent,0))
        else 1
      end
    * tax_fee_mult
  )::numeric                                                   as advertised_all_in_pp,
  (v.maxseats - seats_sold)::integer                           as seats_remaining,
  ((v.maxseats - seats_sold) <= 6)                             as low_inventory_flag,
  seats_sold,
  v.maxseats,
  revenue_so_far,
  min_required_value,
  tolerance_required_min,
  (revenue_so_far >= min_required_value)                       as is_maxseat_discount_active,
  (
    dep_utc is not null
    and (extract(epoch from (dep_utc - now_utc))/86400.0)
        <= coalesce(r.late_booking_days_max, 0)
    and revenue_so_far < min_required_value
  )                                                            as is_t48_discount_active
from calc, j, v, r;
$$;


ALTER FUNCTION "public"."price_quote"("journey_uuid" "uuid", "now_utc" timestamp with time zone, "depart_utc_override" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."price_quotes_for_route"("p_route_id" "uuid", "p_now" timestamp with time zone DEFAULT "now"(), "p_depart_utc_override" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("route_id" "uuid", "vehicle_id" "uuid", "operator_id" "uuid", "operator_name" "text", "vehicle_name" "text", "is_primary" boolean, "rank_order" integer, "seat_base" numeric, "advertised_all_in_pp" numeric, "seats_remaining" integer, "low_inventory_flag" boolean, "seats_sold_alloc" integer, "maxseats" numeric, "revenue_route_base" numeric, "revenue_available_for_this_vehicle" numeric, "min_required_value" numeric, "tolerance_required_min" numeric, "is_maxseat_discount_active" boolean, "is_t48_discount_active" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with latest_tax as (
  select tax::numeric, fees::numeric
  from tax_fees
  order by id desc
  limit 1
),
r as (
  select id, base_price_gbp, late_booking_days_max, late_discount_percent, next_departure_iso
  from routes
  where id = p_route_id
),
cand as (
  select
    rva.route_id,
    v.id            as vehicle_id,
    v.name          as vehicle_name,
    v.operator_id,
    v.minseats::numeric as minseats,
    v.maxseats::numeric as maxseats,
    v.minvalue::numeric as minvalue,
    v.min_val_threshold::numeric as min_val_threshold,
    v.maxseatdiscount::numeric   as maxseatdiscount,
    v.preferred   as vehicle_pref,
    rva.preferred as route_vehicle_pref,
    rva.created_at as rva_created_at,
    o.name as operator_name,
    o.csat
  from route_vehicle_assignments rva
  join vehicles v on v.id = rva.vehicle_id and v.active = true
  join operators o on o.id = v.operator_id
  where rva.is_active = true
    and rva.route_id = p_route_id
),
route_demand as (
  select
    coalesce(sum(b.seats), 0)::int                                   as seats_sold_route,
    coalesce(sum(b.total_price), 0)::numeric                         as revenue_route_gross
  from bookings b
  where b.route_id = p_route_id
    and b.status::text not in ('Cancelled','Refunded')
),
ranked as (
  select
    c.*,
    coalesce(r.base_price_gbp, c.minvalue / nullif(c.minseats,0))::numeric as seat_base,
    row_number() over (
      order by
        c.route_vehicle_pref desc,             -- explicit per-route preference first
        coalesce(r.base_price_gbp, c.minvalue / nullif(c.minseats,0)) asc, -- cheapest economics
        c.csat desc nulls last,
        c.vehicle_pref desc,
        c.rva_created_at asc
    ) as rank_order
  from cand c
  join r on true
),
timing as (
  select
    r.id as route_id,
    coalesce(p_depart_utc_override, r.next_departure_iso) as dep_utc,
    (extract(epoch from (coalesce(p_depart_utc_override, r.next_departure_iso) - p_now))/86400.0) as days_to_go,
    lt.tax, lt.fees
  from r
  join latest_tax lt on true
),
net_rev as (
  select
    rd.seats_sold_route,
    -- convert gross route revenue to base (net of tax+fees) using current rates
    (rd.revenue_route_gross / (1 + coalesce(t.tax,0) + coalesce(t.fees,0)))::numeric as revenue_route_base
  from route_demand rd, timing t
),
calc as (
  select
    rk.route_id,
    rk.vehicle_id,
    rk.operator_id,
    rk.operator_name,
    rk.vehicle_name,
    rk.rank_order,
    rk.seat_base,
    rk.maxseats,
    rk.minvalue,
    rk.min_val_threshold,
    rk.maxseatdiscount,
    t.tax, t.fees, t.days_to_go,
    nr.seats_sold_route,
    nr.revenue_route_base,
    -- cumulative sums prior to this vehicle (by rank)
    coalesce(sum(rk2.minvalue)  over (order by rk.rank_order rows between unbounded preceding and 1 preceding), 0)::numeric as cum_minvalue_prior,
    coalesce(sum(rk2.maxseats)  over (order by rk.rank_order rows between unbounded preceding and 1 preceding), 0)::numeric as cum_maxseats_prior
  from ranked rk
  join ranked rk2 on true
  join timing t on true
  join net_rev nr on true
  where rk2.rank_order <= rk.rank_order
),
final as (
  select
    c.route_id,
    c.vehicle_id,
    c.operator_id,
    c.operator_name,
    c.vehicle_name,
    (c.rank_order = 1) as is_primary,
    c.rank_order,
    c.seat_base,
    -- allocate seats to this vehicle based on route seats and cumulative capacity of prior vehicles
    greatest(least(nr.seats_sold_route - c.cum_maxseats_prior, c.maxseats), 0)::int as seats_sold_alloc,
    (c.maxseats - greatest(least(nr.seats_sold_route - c.cum_maxseats_prior, c.maxseats), 0))::int as seats_remaining,
    nr.seats_sold_route,
    c.maxseats,
    nr.revenue_route_base,
    -- revenue "available" to this vehicle after prior vehicles' minvalues are satisfied
    greatest(nr.revenue_route_base - c.cum_minvalue_prior, 0)::numeric as revenue_available_for_this_vehicle,
    c.minvalue                                               as min_required_value,
    (c.minvalue * coalesce(c.min_val_threshold, 1.0))::numeric as tolerance_required_min,
    -- discount switches
    (greatest(nr.revenue_route_base - c.cum_minvalue_prior, 0) >= c.minvalue) as is_maxseat_discount_active,
    (c.days_to_go <= coalesce(r.late_booking_days_max, 0)
      and greatest(nr.revenue_route_base - c.cum_minvalue_prior, 0) < c.minvalue) as is_t48_discount_active,
    -- advertised price: tax+fees included; commission excluded
    round(
      c.seat_base
      * case
          when (greatest(nr.revenue_route_base - c.cum_minvalue_prior, 0) >= c.minvalue)
            then (1 - coalesce(c.maxseatdiscount,0))
          when (c.days_to_go <= coalesce(r.late_booking_days_max, 0)
                and greatest(nr.revenue_route_base - c.cum_minvalue_prior, 0) < c.minvalue)
            then (1 - coalesce(r.late_discount_percent,0))
          else 1
        end
      * (1 + coalesce(c.tax,0) + coalesce(c.fees,0))
    )::numeric as advertised_all_in_pp,
    ( (c.maxseats - greatest(least(nr.seats_sold_route - c.cum_maxseats_prior, c.maxseats), 0)) <= 6 ) as low_inventory_flag
  from calc c
  join r on r.id = c.route_id
  join net_rev nr on true
)
select
  route_id,
  vehicle_id,
  operator_id,
  operator_name,
  vehicle_name,
  is_primary,
  rank_order,
  seat_base,
  advertised_all_in_pp,
  seats_remaining,
  low_inventory_flag,
  seats_sold_alloc,
  maxseats,
  revenue_route_base,
  revenue_available_for_this_vehicle,
  min_required_value,
  tolerance_required_min,
  is_maxseat_discount_active,
  is_t48_discount_active
from final
order by rank_order;
$$;


ALTER FUNCTION "public"."price_quotes_for_route"("p_route_id" "uuid", "p_now" timestamp with time zone, "p_depart_utc_override" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_allocate_all_future"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  rec record;
  n   integer := 0;
BEGIN
  FOR rec IN
    SELECT id
    FROM public.journeys
    WHERE is_active = true
      AND departure_ts >= now()
    ORDER BY departure_ts
  LOOP
    PERFORM public.ps_allocate_journey(rec.id);
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;


ALTER FUNCTION "public"."ps_allocate_all_future"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_allocate_journey"("p_journey_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_route_id    uuid;
  v_vehicle_id  uuid;
  v_unassigned  integer := 0;
  v_unassigned_vid uuid;
  rec_party     record;
begin
  -- Resolve route
  select j.route_id into v_route_id
  from public.journeys j
  where j.id = p_journey_id;

  if v_route_id is null then
    raise exception 'Journey % not found', p_journey_id;
  end if;

  -- Get (or create) the sentinel vehicle id
  v_unassigned_vid := public.ps_unassigned_vehicle_id();

  -- Clear previous allocations for this journey
  delete from public.journey_vehicle_allocs
  where journey_id = p_journey_id;

  -- Candidate boats for this route
  create temporary table tmp_fit_boats (
    vehicle_id uuid primary key,
    cap        integer not null,
    used       integer not null default 0,
    preferred  boolean not null default false
  ) on commit drop;

  insert into tmp_fit_boats (vehicle_id, cap, preferred)
  select rva.vehicle_id,
         coalesce(nullif(v.maxseats::int, 0), 999999),
         coalesce(rva.preferred, false)
  from public.route_vehicle_assignments rva
  join public.vehicles v on v.id = rva.vehicle_id and v.active = true
  where rva.route_id = v_route_id
    and rva.is_active = true;

  -- No boats? Bucket all parties into Unassigned sentinel
  if not exists (select 1 from tmp_fit_boats) then
    insert into public.journey_vehicle_allocs (journey_id, vehicle_id, seats)
    select p_journey_id, v_unassigned_vid, b.seats
    from public.booking_seat_counts b
    where b.journey_id = p_journey_id
      and b.seats > 0;
    return;
  end if;

  -- Allocate largest parties first
  for rec_party in
    select seats
    from public.booking_seat_counts
    where journey_id = p_journey_id
      and seats > 0
    order by seats desc
  loop
    -- smallest viable boat, prefer preferred, tightest fit
    select t.vehicle_id
      into v_vehicle_id
    from (
      select vehicle_id, (cap - used) as free, preferred
      from tmp_fit_boats
    ) t
    where t.free >= rec_party.seats
    order by (case when t.preferred then 0 else 1 end),
             t.free asc,
             vehicle_id asc
    limit 1;

    if found then
      update tmp_fit_boats
      set used = used + rec_party.seats
      where vehicle_id = v_vehicle_id;

      insert into public.journey_vehicle_allocs (journey_id, vehicle_id, seats)
      values (p_journey_id, v_vehicle_id, rec_party.seats)
      on conflict (journey_id, vehicle_id)
      do update set seats = public.journey_vehicle_allocs.seats + excluded.seats;
    else
      v_unassigned := v_unassigned + rec_party.seats;
    end if;
  end loop;

  if v_unassigned > 0 then
    insert into public.journey_vehicle_allocs (journey_id, vehicle_id, seats)
    values (p_journey_id, v_unassigned_vid, v_unassigned)
    on conflict (journey_id, vehicle_id)
    do update set seats = public.journey_vehicle_allocs.seats + excluded.seats;
  end if;
end;
$$;


ALTER FUNCTION "public"."ps_allocate_journey"("p_journey_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_allocate_unassigned"("journey_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  r_route_id uuid;
  r record;      -- unassigned seat blocks (one row per booking block)
  pick record;   -- chosen boat
begin
  -- Which route is this journey on?
  select j.route_id into r_route_id
  from journeys j
  where j.id = journey_id;

  if r_route_id is null then
    return;
  end if;

  -- Build a working gaps table (one row per active assigned boat on the route)
  create temporary table _gaps (
    vehicle_id uuid primary key,
    gap int not null default 0,
    preferred boolean not null default false
  ) on commit drop;

  insert into _gaps(vehicle_id, gap, preferred)
  select
    v.id,
    greatest(
      0,
      coalesce(nullif(v.maxseats::int, 0), 0)
      - coalesce((
          select sum(bsv.seats)
          from booking_seat_counts_by_vehicle bsv
          where bsv.journey_id = journey_id
            and bsv.vehicle_id = v.id
        ), 0)
    ) as gap,
    coalesce(rva.preferred, false) as preferred
  from route_vehicle_assignments rva
  join vehicles v on v.id = rva.vehicle_id
  where rva.route_id = r_route_id
    and rva.is_active = true
    and v.active = true;

  -- Allocate each unassigned block, largest blocks first (bin-packing heuristic).
  for r in
    select id, seats
    from booking_seat_counts_by_vehicle
    where journey_id = journey_id
      and vehicle_id is null
    order by seats desc, id
  loop
    -- 1) try a boat that can fully fit the block, pref boats first, then biggest remaining gap
    select g.vehicle_id into pick
    from _gaps g
    where g.gap >= r.seats
    order by g.preferred desc, g.gap desc
    limit 1;

    -- 2) if none can fully fit, optionally pick the biggest-gap boat (comment this block out
    --    if you prefer to leave "oversize" groups unassigned instead of partial packing.)
    if pick.vehicle_id is null then
      select g.vehicle_id into pick
      from _gaps g
      where g.gap > 0
      order by g.preferred desc, g.gap desc
      limit 1;
      -- If still nothing, leave unassigned.
      if pick.vehicle_id is null then
        continue;
      end if;
      -- If you never want to overfill a boat with a larger block, skip this and continue.
      if (select gap from _gaps where vehicle_id = pick.vehicle_id) < r.seats then
        continue;
      end if;
    end if;

    -- Apply assignment
    update booking_seat_counts_by_vehicle
    set vehicle_id = pick.vehicle_id
    where id = r.id;

    -- Reduce the boat gap in our working table
    update _gaps
    set gap = greatest(0, gap - r.seats)
    where vehicle_id = pick.vehicle_id;
  end loop;
end;
$$;


ALTER FUNCTION "public"."ps_allocate_unassigned"("journey_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_block_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_reason" "text" DEFAULT 'Pace booking'::"text") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  INSERT INTO public.asset_blackouts (vehicle_id, start_ts, end_ts, reason, source)
  VALUES (p_vehicle_id, p_start, p_end, p_reason, 'pace_booking')
  ON CONFLICT DO NOTHING;
$$;


ALTER FUNCTION "public"."ps_block_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_ensure_journey"("p_route_id" "uuid", "p_day" "date", "p_base_price_cents" integer DEFAULT 0, "p_currency" "text" DEFAULT 'USD'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_journey_id    uuid;
  v_vehicle_id    uuid;
  v_departure_ts  timestamptz;
BEGIN
  -- look for any journey on that calendar day (UTC)
  SELECT j.id
  INTO v_journey_id
  FROM public.journeys j
  WHERE j.route_id = p_route_id
    AND j.departure_ts >= (p_day::timestamptz)
    AND j.departure_ts <  ((p_day + 1)::timestamptz)
  ORDER BY j.departure_ts
  LIMIT 1;

  IF v_journey_id IS NOT NULL THEN
    RETURN v_journey_id;
  END IF;

  -- pick preferred active vehicle for the route (if any)
  SELECT rva.vehicle_id
  INTO v_vehicle_id
  FROM public.route_vehicle_assignments rva
  WHERE rva.route_id = p_route_id
    AND rva.is_active = true
  ORDER BY rva.preferred DESC, rva.created_at DESC
  LIMIT 1;

  v_departure_ts := (p_day::timestamptz) + INTERVAL '12 hours'; -- noon UTC

  INSERT INTO public.journeys (
    route_id, departure_ts, base_price_cents, currency,
    vehicle_id, operator_id, is_active
  )
  VALUES (
    p_route_id,
    v_departure_ts,
    GREATEST(0, COALESCE(p_base_price_cents,0)),
    COALESCE(p_currency,'USD'),
    v_vehicle_id,
    NULL,
    true
  )
  RETURNING id INTO v_journey_id;

  RETURN v_journey_id;
END;
$$;


ALTER FUNCTION "public"."ps_ensure_journey"("p_route_id" "uuid", "p_day" "date", "p_base_price_cents" integer, "p_currency" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_ensure_journey_for_order"("p_route_id" "uuid", "p_journey_date" "date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  j_id uuid;
  dep  timestamptz;
begin
  dep := public.ps_make_departure_ts(p_journey_date, p_route_id);

  -- Try to find existing journey for this route + day
  select j.id into j_id
  from public.journeys j
  where j.route_id = p_route_id
    and (j.departure_ts at time zone 'UTC')::date = dep::date
  limit 1;

  if j_id is null then
    insert into public.journeys (route_id, departure_ts, base_price_cents, currency, vehicle_id, operator_id, is_active)
    values (p_route_id, dep, 0, 'USD', null, null, true)
    returning id into j_id;
  end if;

  return j_id;
end;
$$;


ALTER FUNCTION "public"."ps_ensure_journey_for_order"("p_route_id" "uuid", "p_journey_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_ensure_journey_vehicle"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  j_id uuid;
begin
  -- Make sure the journey exists for (route_id, journey_date)
  insert into journeys(id, route_id, date_iso)
  select gen_random_uuid(), NEW.route_id, NEW.journey_date
  where not exists (
    select 1 from journeys
    where route_id = NEW.route_id
      and date_iso = NEW.journey_date
  );

  -- Look up the journey id
  select id into j_id
  from journeys
  where route_id = NEW.route_id
    and date_iso = NEW.journey_date;

  -- Re-run allocation for this journey (idempotent)
  perform public.ps_allocate_unassigned(j_id);

  return NEW;
end;
$$;


ALTER FUNCTION "public"."ps_ensure_journey_vehicle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_journey_departure_ts"("p_journey_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$
  select j.departure_ts
  from public.journeys j
  where j.id = p_journey_id
$$;


ALTER FUNCTION "public"."ps_journey_departure_ts"("p_journey_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_journey_horizon"("p_journey_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select case
           when j.departure_ts <= now() + interval '24 hours' then 'T24'
           when j.departure_ts <= now() + interval '72 hours' then 'T72'
           else '>72h'
         end
  from public.journeys j
  where j.id = p_journey_id;
$$;


ALTER FUNCTION "public"."ps_journey_horizon"("p_journey_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_make_departure_ts"("p_date" "date", "p_route_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$
  select
    case
      when r.pickup_time is not null then
        make_timestamptz(
          extract(year  from p_date)::int,
          extract(month from p_date)::int,
          extract(day   from p_date)::int,
          extract(hour   from (r.pickup_time::time))::int,
          extract(minute from (r.pickup_time::time))::int,
          0,
          'UTC'
        )
      else
        (p_date::timestamptz + interval '12 hours')
    end
  from public.routes r
  where r.id = p_route_id
$$;


ALTER FUNCTION "public"."ps_make_departure_ts"("p_date" "date", "p_route_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_orders_after_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  j_id uuid;
begin
  -- Find the journey for (route_id, day)
  select j.id into j_id
  from public.journeys j
  where j.route_id = OLD.route_id
    and (j.departure_ts at time zone 'UTC')::date = OLD.journey_date
  limit 1;

  if j_id is not null then
    perform public.ps_reconcile_journey(j_id);
  end if;

  return OLD;
end;
$$;


ALTER FUNCTION "public"."ps_orders_after_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_orders_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  j_id uuid;
begin
  j_id := public.ps_ensure_journey_for_order(NEW.route_id, NEW.journey_date);
  perform public.ps_reconcile_journey(j_id);
  return NEW;
end;
$$;


ALTER FUNCTION "public"."ps_orders_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_reconcile_journey"("p_journey_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_route_id uuid;
  v_hz text;
  rec_party record;
  v_vehicle_id uuid;
begin
  -- Find the route for the journey
  select j.route_id into v_route_id
  from public.journeys j
  where j.id = p_journey_id;

  if v_route_id is null then
    raise exception 'Journey % not found', p_journey_id;
  end if;

  -- Determine horizon (gt72 / t72 / t24 / past). You can switch logic by horizon if needed.
  select public.ps_journey_horizon(p_journey_id) into v_hz;

  -- Clear current allocations for this journey
  delete from public.booking_seat_counts_by_vehicle where journey_id = p_journey_id;

  -- Build a temp table of candidate boats (active assignment + active vehicle)
  create temporary table tmp_fit_boats (
    vehicle_id uuid primary key,
    cap int,
    used int not null default 0,
    preferred boolean not null default false
  ) on commit drop;

  insert into tmp_fit_boats (vehicle_id, cap, preferred)
  select
    rva.vehicle_id,
    coalesce(nullif(v.maxseats::int,0), 999999),
    coalesce(rva.preferred, false)
  from public.route_vehicle_assignments rva
  join public.vehicles v on v.id = rva.vehicle_id and v.active = true
  where rva.route_id = v_route_id
    and rva.is_active = true;

  -- Nothing to allocate to? Then just mark everything unassigned and finish
  if not exists (select 1 from tmp_fit_boats) then
    insert into public.booking_seat_counts_by_vehicle (journey_id, vehicle_id, seats)
    select p_journey_id, null, b.seats
    from public.booking_seat_counts b
    where b.journey_id = p_journey_id and b.seats > 0;
    return;
  end if;

  -- Largest parties first
  for rec_party in
    select seats
    from public.booking_seat_counts
    where journey_id = p_journey_id
      and seats > 0
    order by seats desc
  loop
    -- Pick the smallest boat that can fit this party.
    select t.vehicle_id into v_vehicle_id
    from tmp_fit_boats t
    where (t.cap - t.used) >= rec_party.seats
    order by
      t.preferred desc,      -- prefer preferred boats
      (t.cap - t.used) asc,  -- pick the tightest fit
      t.cap asc
    limit 1;

    if v_vehicle_id is null then
      -- Unassigned bucket (no boat can take it)
      insert into public.booking_seat_counts_by_vehicle (journey_id, vehicle_id, seats)
      values (p_journey_id, null, rec_party.seats);
    else
      -- Place on boat and update "used"
      insert into public.booking_seat_counts_by_vehicle (journey_id, vehicle_id, seats)
      values (p_journey_id, v_vehicle_id, rec_party.seats);

      update tmp_fit_boats
      set used = used + rec_party.seats
      where vehicle_id = v_vehicle_id;
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."ps_reconcile_journey"("p_journey_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_reconcile_upcoming"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  perform public.ps_reconcile_journey(j.id)
  from journeys j
  where j.date_iso between (current_date - interval '1 day') and (current_date + interval '90 day');
end;
$$;


ALTER FUNCTION "public"."ps_reconcile_upcoming"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_record_cancellation_settlement"("p_order_id" "uuid", "p_operator_id" "uuid", "p_note" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- 2a) refund the full amount to the customer (ledger only, payments handled by PSP elsewhere)
  insert into public.ledger_transactions(order_id, user_id, amount_cents, currency, type, direction, memo)
  values (o.id, o.user_id, greatest(0, coalesce(o.total_cents,0)), coalesce(o.currency,'GBP'),
          'customer_refund', 'credit', coalesce(p_note, 'Journey cancelled'));

  -- 2b) bill the operator for the FEES portion (if attributable)
  if p_operator_id is not null and coalesce(o.fees_cents,0) > 0 then
    insert into public.ledger_transactions(order_id, operator_id, amount_cents, currency, type, direction, memo)
    values (o.id, p_operator_id, greatest(0, coalesce(o.fees_cents,0)), coalesce(o.currency,'GBP'),
            'operator_fee_charge', 'debit', 'Customer-impacting cancellation');
  end if;

  -- (optional) mark order as cancelled if you’re using this as the canonical cancel step
  update public.orders set status = 'cancelled' where id = o.id;
end
$$;


ALTER FUNCTION "public"."ps_record_cancellation_settlement"("p_order_id" "uuid", "p_operator_id" "uuid", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_recount_journey_vehicle"("p_route_id" "uuid", "p_journey_date" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_paid int;
  v_id   uuid;
  v_min  int;
  v_cap  int;
begin
  select coalesce(sum(qty),0)
    into v_paid
  from public.orders
  where route_id = p_route_id
    and journey_date = p_journey_date
    and status = 'paid';

  -- update all JV rows for that departure with the latest paid seat count
  for v_id, v_min, v_cap in
    select id, coalesce(min_seats,0), coalesce(seats_capacity,0)
    from public.journey_vehicles
    where route_id = p_route_id
      and journey_date = p_journey_date
  loop
    update public.journey_vehicles
       set booked_seats = v_paid,
           status = case
                      when vehicle_id is null then 'available'
                      when v_cap > 0 and v_paid >= v_cap then 'full'
                      when v_min > 0 and v_paid >= v_min then 'assigned'
                      when v_paid > 0 then 'loading'
                      else 'available'
                    end
     where id = v_id;
  end loop;
end
$$;


ALTER FUNCTION "public"."ps_recount_journey_vehicle"("p_route_id" "uuid", "p_journey_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_select_pricing_vehicle"("p_route_id" "uuid", "p_journey_date" "date", "p_qty" integer) RETURNS TABLE("vehicle_id" "uuid", "journey_vehicle_id" "uuid", "operator_id" "uuid", "remaining" integer, "can_fit" boolean, "base_seat" numeric, "rank_reason" "text")
    LANGUAGE "plpgsql"
    AS $$
declare
begin
  -- Candidates: active assignment + active vehicle + route in season (if bounded)
  return query
  with cand as (
    select
      v.id                      as vehicle_id,
      v.operator_id,
      v.minseats::numeric       as v_minseats,
      nullif(v.minvalue,0)::numeric as v_minvalue,
      (v.minvalue / nullif(v.minseats,1))::numeric as base_seat,
      coalesce(rva.preferred, false) as rva_pref,
      coalesce(v.preferred, false)   as v_pref,
      coalesce(o.csat, 0)            as csat
    from public.route_vehicle_assignments rva
    join public.vehicles v on v.id = rva.vehicle_id and v.active = true
    join public.routes   r on r.id = rva.route_id and r.is_active = true
    left join public.operators o on o.id = v.operator_id
    where rva.route_id = p_route_id
      and rva.is_active = true
      and (r.season_from is null or p_journey_date >= r.season_from)
      and (r.season_to   is null or p_journey_date <= r.season_to)
  ),
  ensured as (
    -- Make sure a journey_vehicles row exists for each candidate
    insert into public.journey_vehicles (route_id, journey_date, vehicle_id, operator_id, min_seats, capacity, seats_capacity, status)
    select
      p_route_id, p_journey_date, c.vehicle_id, c.operator_id,
      c.v_minseats::int,
      greatest(1, (select maxseats::int from public.vehicles v2 where v2.id = c.vehicle_id)),
      greatest(1, (select maxseats::int from public.vehicles v2 where v2.id = c.vehicle_id)),
      'planned'
    from cand c
    on conflict (route_id, journey_date, vehicle_id) do update
      set operator_id = excluded.operator_id
    returning route_id, journey_date, vehicle_id, id as journey_vehicle_id
  ),
  load as (
    select
      jv.id as journey_vehicle_id,
      jv.vehicle_id,
      jv.operator_id,
      jv.seats_capacity,
      coalesce(count(pva.id),0) as allocated
    from public.journey_vehicles jv
    left join public.passenger_vehicle_assignments pva on pva.journey_vehicle_id = jv.id
    where jv.route_id = p_route_id
      and jv.journey_date = p_journey_date
    group by jv.id
  ),
  ranked as (
    select
      c.vehicle_id,
      e.journey_vehicle_id,
      l.operator_id,
      greatest(l.seats_capacity - l.allocated, 0) as remaining,
      (greatest(l.seats_capacity - l.allocated, 0) >= p_qty) as can_fit,
      c.base_seat,
      c.csat,
      c.rva_pref,
      c.v_pref
    from cand c
    join ensured e on e.vehicle_id = c.vehicle_id
    join load   l on l.journey_vehicle_id = e.journey_vehicle_id
  )
  select
    vehicle_id,
    journey_vehicle_id,
    operator_id,
    remaining,
    can_fit,
    base_seat,
    case
      when can_fit then 'fits'
      else 'not-enough-remaining'
    end as rank_reason
  from ranked
  order by
    can_fit desc,
    base_seat asc,
    csat desc nulls last,
    rva_pref desc,
    v_pref  desc,
    vehicle_id asc
  limit 1;

end; $$;


ALTER FUNCTION "public"."ps_select_pricing_vehicle"("p_route_id" "uuid", "p_journey_date" "date", "p_qty" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_sync_jv_on_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  j_id uuid;
begin
  -- Recompute journey and allocation after an order was deleted
  select id into j_id
  from journeys
  where route_id = OLD.route_id
    and date_iso = OLD.journey_date;

  if j_id is not null then
    perform public.ps_allocate_unassigned(j_id);
  end if;

  return OLD;
end;
$$;


ALTER FUNCTION "public"."ps_sync_jv_on_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_tick_journey_status"("now_at" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("updated_id" "uuid", "old_status" "text", "new_status" "text")
    LANGUAGE "plpgsql"
    AS $$
declare rec record;
begin
  for rec in
    select jv.id, jv.status as old_status
    from public.journey_vehicles jv
    join public.routes r on r.id = jv.route_id
    where jv.vehicle_id is not null
      and jv.status in ('loading','assigned','full')
      and (jv.journey_date::timestamp + coalesce(r.pickup_time, time '00:00')) 
            <= (now_at + interval '24 hour')  -- i.e., within 24h window
  loop
    update public.journey_vehicles set status = 'scheduled' where id = rec.id;
    updated_id := rec.id; old_status := rec.old_status; new_status := 'scheduled'; return next;
  end loop;
end
$$;


ALTER FUNCTION "public"."ps_tick_journey_status"("now_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_unassigned_vehicle_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Reuse existing “Unassigned” vehicle if present
  SELECT id INTO v_id
  FROM public.vehicles
  WHERE name = 'Unassigned'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Otherwise create one that satisfies NOT NULL constraints
  INSERT INTO public.vehicles (
    name,       active, minseats, maxseats, minvalue, description,
    picture_url, type_id, operator_id, preferred, maxseatdiscount, white_label_enabled
  ) VALUES (
    'Unassigned', false, 0, 0, 0.0, 'System bucket for parties not yet placed',
    NULL, NULL, NULL, false, NULL, false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."ps_unassigned_vehicle_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ps_unblock_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) RETURNS "void"
    LANGUAGE "sql"
    AS $$
  DELETE FROM public.asset_blackouts
  WHERE vehicle_id = p_vehicle_id
    AND start_ts = p_start
    AND end_ts   = p_end
    AND source   = 'pace_booking';
$$;


ALTER FUNCTION "public"."ps_unblock_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."qi_set_departure_ts"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  hhmm text;
  hh int;
  mm int;
  assembled timestamptz;
begin
  -- Only attempt when route_id/date_iso are present
  if new.route_id is null or new.date_iso is null then
    return new;
  end if;

  -- Load pickup_time from route
  select r.pickup_time into hhmm
  from public.routes r
  where r.id = new.route_id;

  -- Parse HH:MM (default 00:00)
  hh := coalesce(split_part(hhmm, ':', 1)::int, 0);
  mm := coalesce(split_part(hhmm, ':', 2)::int, 0);

  -- Build timestamp in your chosen timezone, here UTC (change if needed)
  assembled :=
    (make_timestamp(
       substring(new.date_iso,1,4)::int,
       substring(new.date_iso,6,2)::int,
       substring(new.date_iso,9,2)::int,
       hh, mm, 0
     ) at time zone 'UTC');

  new.departure_ts := assembled;
  return new;
end;
$$;


ALTER FUNCTION "public"."qi_set_departure_ts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_from_journey"("p_journey" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_route uuid;
  v_date  date;
begin
  select j.route_id, public._journey_local_date(j.id)
    into v_route, v_date
  from public.journeys j
  where j.id = p_journey;

  if v_route is not null and v_date is not null then
    perform public.recompute_route_day_inventory(v_route, v_date);
  end if;
end;
$$;


ALTER FUNCTION "public"."recompute_from_journey"("p_journey" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_route_day_inventory"("p_route" "uuid", "p_date" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_cap int := 0;
  v_booked int := 0;
  v_remaining int := 0;
  v_status text := 'open';
begin
  v_cap := public._route_capacity(p_route);
  v_booked := public._booked_seats_for_route_day(p_route, p_date);
  v_remaining := greatest(v_cap - v_booked, 0);

  if v_cap = 0 then
    v_status := 'sold_out';
  elsif v_remaining = 0 then
    v_status := 'sold_out';
  elsif v_remaining <= 6 then
    v_status := 'limited';
  else
    v_status := 'open';
  end if;

  insert into public.route_day_inventory(route_id, journey_date, cap, booked_paid, remaining, status, updated_at)
  values (p_route, p_date, v_cap, v_booked, v_remaining, v_status, now())
  on conflict (route_id, journey_date) do update
  set cap = excluded.cap,
      booked_paid = excluded.booked_paid,
      remaining = excluded.remaining,
      status = excluded.status,
      updated_at = now();
end;
$$;


ALTER FUNCTION "public"."recompute_route_day_inventory"("p_route" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_route_range"("p_route" "uuid", "p_from" "date" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"date", "p_to" "date" DEFAULT (((("now"() AT TIME ZONE 'utc'::"text"))::"date" + '6 mons'::interval))::"date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  d date;
begin
  for d in
    select distinct public._journey_local_date(j.id)
    from public.journeys j
    where j.route_id = p_route
      and public._journey_local_date(j.id) between p_from and p_to
  loop
    perform public.recompute_route_day_inventory(p_route, d);
  end loop;
end;
$$;


ALTER FUNCTION "public"."recompute_route_range"("p_route" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_inventory_window"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  r record;
  dfrom date := (now() at time zone 'utc')::date;
  dto   date := ((now() at time zone 'utc')::date + interval '6 months')::date;
begin
  for r in
    select distinct j.route_id, public._journey_local_date(j.id) as jdate
    from public.journeys j
    where public._journey_local_date(j.id) between dfrom and dto
  loop
    perform public.recompute_route_day_inventory(r.route_id, r.jdate);
  end loop;
end;
$$;


ALTER FUNCTION "public"."refresh_inventory_window"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_jva_for_journey"("p_journey_id" "uuid", "p_rows" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  perform set_config('role', current_user, true);
  -- start transaction block
  delete from journey_vehicle_allocations where journey_id = p_journey_id;

  insert into journey_vehicle_allocations (journey_id, vehicle_id, order_id, seats)
  select
    (x->>'journey_id')::uuid,
    (x->>'vehicle_id')::uuid,
    (x->>'order_id')::uuid,
    (x->>'seats')::int
  from jsonb_array_elements(p_rows) as x;

end $$;


ALTER FUNCTION "public"."replace_jva_for_journey"("p_journey_id" "uuid", "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_booking_financials"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("booking_id" "uuid", "order_id" "uuid", "journey_id" "uuid", "vehicle_id" "uuid", "route_id" "uuid", "departure_ts" timestamp with time zone, "seats" integer, "base_per_seat_cents" integer, "base_cents" bigint, "tax_cents" bigint, "fees_cents" bigint, "revenue_cents" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with rates as (
    select * from rpt_resolved_rates(p_operator)
  ),
  src as (
    select b.id as booking_id, b.order_id, b.journey_id, b.vehicle_id, b.route_id,
           j.departure_ts, b.seats,
           coalesce(b.price_cents, j.base_price_cents) as base_per_seat_cents
    from bookings b
    join journeys j on j.id = b.journey_id
    join operators o on o.id = j.operator_id
    where o.id = p_operator
      and j.departure_ts >= p_from and j.departure_ts < p_to
      -- status filter removed to avoid enum mismatch; include all bookings in window
  )
  select s.booking_id, s.order_id, s.journey_id, s.vehicle_id, s.route_id, s.departure_ts, s.seats,
         s.base_per_seat_cents,
         (s.base_per_seat_cents * s.seats)::bigint as base_cents,
         round((s.base_per_seat_cents * s.seats) * (select tax from rates))::bigint as tax_cents,
         round(((s.base_per_seat_cents * s.seats) * (1 + (select tax from rates))) * (select fees from rates))::bigint as fees_cents,
         ((s.base_per_seat_cents * s.seats)
            + round((s.base_per_seat_cents * s.seats) * (select tax from rates))
            + round(((s.base_per_seat_cents * s.seats) * (1 + (select tax from rates))) * (select fees from rates))
         )::bigint as revenue_cents
  from src s;
$$;


ALTER FUNCTION "public"."rpt_booking_financials"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_is_site_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce( (select site_admin from users where id = auth.uid()), false );
$$;


ALTER FUNCTION "public"."rpt_is_site_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_min_seats"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("vehicle_id" "uuid", "vehicle_name" "text", "journeys" integer, "met" integer, "shortfall" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with per as (
    select v.id as vehicle_id, v.name as vehicle_name, j.id as journey_id,
           v.minseats::int as minseats,
           coalesce(sum(b.seats) filter (where true),0)::int as booked
    from journeys j
    join route_vehicle_assignments a on a.route_id=j.route_id and a.is_active
    join vehicles v on v.id=a.vehicle_id and v.operator_id=p_operator
    left join bookings b on b.journey_id=j.id and b.vehicle_id=v.id
    where j.departure_ts >= p_from and j.departure_ts < p_to
    group by 1,2,3,4
  )
  select vehicle_id, vehicle_name,
         count(*) as journeys,
         count(*) filter (where booked >= minseats) as met,
         sum(greatest(0, minseats - booked)) as shortfall
  from per group by 1,2 order by vehicle_name;
$$;


ALTER FUNCTION "public"."rpt_min_seats"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_min_seats_summary_v1"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("journeys_total" integer, "journeys_met" integer, "percent_met" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with per as (
  select *
  from public.rpt_min_seats_v3(p_operator, p_from, p_to)
)
select
  count(*)::int as journeys_total,
  count(*) filter (where met) as journeys_met,
  round( (count(*) filter (where met))::numeric / nullif(count(*),0) * 100, 1) as percent_met
from per;
$$;


ALTER FUNCTION "public"."rpt_min_seats_summary_v1"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_min_seats_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("journey_id" "uuid", "departure_ts" timestamp with time zone, "route_name" "text", "pickup_name" "text", "destination_name" "text", "vehicle_name" "text", "min_required" integer, "booked" integer, "met" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with base as (
  select j.id as journey_id,
         j.departure_ts,
         j.route_id,
         j.vehicle_id,
         coalesce(v.minseats::int, 0) as min_required
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
bk as (
  select b.journey_id, coalesce(sum(b.seats),0)::int as booked
  from public.bookings b
  join base on base.journey_id = b.journey_id
  group by 1
)
select
  base.journey_id,
  base.departure_ts,
  rl.route_name,
  rl.pickup_name,
  rl.destination_name,
  vv.vehicle_name,
  base.min_required,
  coalesce(bk.booked,0) as booked,
  coalesce(bk.booked,0) >= base.min_required as met
from base
left join public.v_vehicle_names vv on vv.vehicle_id = base.vehicle_id
left join public.v_route_legs    rl on rl.route_id   = base.route_id
left join bk                        on bk.journey_id  = base.journey_id
order by base.departure_ts asc;
$$;


ALTER FUNCTION "public"."rpt_min_seats_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_min_seats_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("departure_ts" timestamp with time zone, "route_name" "text", "pickup_name" "text", "destination_name" "text", "vehicle_name" "text", "min_required" integer, "booked" integer, "pct_of_min" numeric, "met" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with base as (
  select j.id as journey_id,
         j.departure_ts,
         j.route_id,
         j.vehicle_id,
         coalesce(v.minseats::int, 0) as min_required
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
bk as (
  select b.journey_id, coalesce(sum(b.seats),0)::int as booked
  from public.bookings b
  join base on base.journey_id = b.journey_id
  group by 1
)
select
  base.departure_ts,
  coalesce(r.route_name, r.name) as route_name,
  pu.name as pickup_name,
  de.name as destination_name,
  v.name  as vehicle_name,
  base.min_required,
  coalesce(bk.booked,0) as booked,
  case when base.min_required > 0
       then round(coalesce(bk.booked,0)::numeric / base.min_required::numeric * 100, 1)
       else null end as pct_of_min,
  coalesce(bk.booked,0) >= base.min_required as met
from base
left join public.routes r         on r.id = base.route_id
left join public.pickup_points pu on pu.id = r.pickup_id
left join public.destinations  de on de.id = r.destination_id
left join public.vehicles      v  on v.id  = base.vehicle_id
left join bk                       on bk.journey_id = base.journey_id
order by base.departure_ts asc;
$$;


ALTER FUNCTION "public"."rpt_min_seats_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_my_operator_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select operator_id from users where id = auth.uid();
$$;


ALTER FUNCTION "public"."rpt_my_operator_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_operator_settlement"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("day" "date", "route_id" "uuid", "route_name" "text", "pax" integer, "base_cents" bigint, "tax_cents" bigint, "fees_cents" bigint, "revenue_cents" bigint, "commission_cents" bigint, "payout_cents" bigint, "cash_collected_cents" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with f as ( select * from rpt_booking_financials(p_operator, p_from, p_to) ),
  r as ( select id, name from routes ),
  comm as ( select commisison as rate from operators where id = p_operator ),
  cash_b as (
    -- cash per booking (avoid aggregates inside FILTER conditions by grouping at booking granularity)
    select b.id as booking_id,
           coalesce(sum(p.amount_cents) filter (where p.status='succeeded'),0)
           - coalesce(sum(p.amount_cents) filter (where p.status='refunded'),0) as net_cents
    from bookings b
    left join payments p on p.order_id = b.order_id
    group by 1
  )
  select (date_trunc('day', f.departure_ts))::date as day,
         f.route_id, r.name as route_name,
         sum(f.seats)::int as pax,
         sum(f.base_cents)::bigint as base_cents,
         sum(f.tax_cents)::bigint as tax_cents,
         sum(f.fees_cents)::bigint as fees_cents,
         sum(f.revenue_cents)::bigint as revenue_cents,
         round(sum(f.base_cents) * coalesce((select rate from comm), 0))::bigint as commission_cents,
         (sum(f.base_cents) - round(sum(f.base_cents) * coalesce((select rate from comm), 0))::bigint) as payout_cents,
         coalesce(sum(cb.net_cents),0)::bigint as cash_collected_cents
  from f
  left join r on r.id=f.route_id
  left join cash_b cb on cb.booking_id = f.booking_id
  group by 1,2,3
  order by 1,3;
$$;


ALTER FUNCTION "public"."rpt_operator_settlement"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_operator_settlement_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("vehicle_name" "text", "route_name" "text", "pickup_name" "text", "destination_name" "text", "booked_db" integer, "add" integer, "result" integer, "min" integer, "cap" integer, "allowed_target_cents" bigint, "unit_cents" bigint, "revenue_cents" bigint, "min_revenue_cents" bigint, "delta_cents" bigint, "cash_collected_cents" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with j as (
  select j.id, j.route_id, j.vehicle_id, j.departure_ts
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
bk as (
  select b.journey_id, sum(b.seats)::int as booked_db
  from public.bookings b
  join j on j.id = b.journey_id
  group by 1
),
cash_b as (
  select b.id as booking_id,
         coalesce(sum(p.amount_cents) filter (where p.status='succeeded'),0)
       - coalesce(sum(p.amount_cents) filter (where p.status='refunded'),0) as net_cents
  from public.bookings b
  left join public.payments p on p.order_id = b.order_id
  group by 1
),
cash_by_journey as (
  select b.journey_id, coalesce(sum(cb.net_cents),0)::bigint as cash_collected_cents
  from public.bookings b
  left join cash_b cb on cb.booking_id = b.id
  group by 1
)
select
  vv.vehicle_name,
  rl.route_name,
  rl.pickup_name,
  rl.destination_name,
  coalesce(bk.booked_db,0) as booked_db,
  0 as add,
  coalesce(bk.booked_db,0) as result,
  0 as min,
  vv.capacity as cap,
  0::bigint as allowed_target_cents,
  0::bigint as unit_cents,
  0::bigint as revenue_cents,
  0::bigint as min_revenue_cents,
  0::bigint as delta_cents,
  coalesce(cj.cash_collected_cents,0) as cash_collected_cents
from j
left join public.v_vehicle_names vv on vv.vehicle_id = j.vehicle_id
left join public.v_route_legs rl     on rl.route_id   = j.route_id
left join bk                          on bk.journey_id = j.id
left join cash_by_journey cj          on cj.journey_id = j.id
order by vv.vehicle_name, rl.route_name, j.departure_ts;
$$;


ALTER FUNCTION "public"."rpt_operator_settlement_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_operator_settlement_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("vehicle_name" "text", "route_name" "text", "pickup_name" "text", "destination_name" "text", "departure_ts" timestamp with time zone, "seats" integer, "min_required" integer, "cap" integer, "base_gbp" bigint, "tax_gbp" bigint, "fees_gbp" bigint, "commission_gbp" bigint, "total_gbp" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with j as (
  select j.id, j.route_id, j.vehicle_id, j.departure_ts
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
legs as (
  select
    j.id as journey_id,
    j.departure_ts,
    coalesce(r.route_name, r.name) as route_name,
    pu.name as pickup_name,
    de.name as destination_name,
    v.name as vehicle_name,
    coalesce(nullif(v.maxseats::int,0),0) as cap,
    coalesce(v.minseats::int,0)          as min_required,
    r.pickup_id, r.destination_id, pu.country_id
  from j
  join public.routes r            on r.id = j.route_id
  left join public.pickup_points pu on pu.id = r.pickup_id
  left join public.destinations  de on de.id = r.destination_id
  left join public.vehicles      v  on v.id = j.vehicle_id
),
rates as (
  select
    l.journey_id,
    coalesce(tf.tax, 0)::numeric  as tax_rate,
    coalesce(tf.fees, 0)::numeric as fee_rate
  from legs l
  left join lateral (
    select tax, fees
    from public.tax_fees tf
    where tf.country_id = l.country_id
    order by tf.created_at desc
    limit 1
  ) tf on true
),
op_comm as (
  select p_operator as operator_id, coalesce(o.commisison, 0)::numeric as commission_rate
  from public.operators o
  where o.id = p_operator
),
calc as (
  select
    l.journey_id,
    l.departure_ts,
    l.route_name,
    l.pickup_name,
    l.destination_name,
    l.vehicle_name,
    l.cap,
    l.min_required,
    sum(b.seats)::int as seats,
    sum(coalesce(b.price_cents, j.base_price_cents) * b.seats)::bigint as base_cents,
    r.tax_rate,
    r.fee_rate
  from legs l
  left join public.bookings b on b.journey_id = l.journey_id
  left join public.journeys j on j.id = l.journey_id
  left join rates r            on r.journey_id = l.journey_id
  group by
    l.journey_id, l.departure_ts, l.route_name, l.pickup_name,
    l.destination_name, l.vehicle_name, l.cap, l.min_required,
    r.tax_rate, r.fee_rate
)
select
  c.vehicle_name,
  c.route_name,
  c.pickup_name,
  c.destination_name,
  c.departure_ts,
  coalesce(c.seats,0) as seats,
  c.min_required,
  c.cap,
  round((coalesce(c.base_cents,0))/100.0)                                   as base_gbp,
  round((coalesce(c.base_cents,0) * c.tax_rate)/100.0)                      as tax_gbp,
  round(((coalesce(c.base_cents,0) + (coalesce(c.base_cents,0)*c.tax_rate)) * c.fee_rate)/100.0) as fees_gbp,
  round((coalesce(c.base_cents,0) * oc.commission_rate)/100.0)              as commission_gbp,
  round((
     coalesce(c.base_cents,0)
   + (coalesce(c.base_cents,0) * c.tax_rate)
   + ((coalesce(c.base_cents,0) + (coalesce(c.base_cents,0)*c.tax_rate)) * c.fee_rate)
  )/100.0) as total_gbp
from calc c
cross join op_comm oc
order by c.departure_ts, c.route_name, c.vehicle_name;
$$;


ALTER FUNCTION "public"."rpt_operator_settlement_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_resolved_rates"("p_operator" "uuid") RETURNS TABLE("tax" numeric, "fees" numeric, "platform_commission_percent" numeric)
    LANGUAGE "sql" STABLE
    AS $$
  select tf.tax::numeric, tf.fees::numeric, coalesce(tf.platform_commission_percent,0)::numeric
  from operators o
  join tax_fees tf on tf.country_id = o.country_id
  where o.id = p_operator
  limit 1;
$$;


ALTER FUNCTION "public"."rpt_resolved_rates"("p_operator" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_revenue_by_route_date"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("day" "date", "route_id" "uuid", "route_name" "text", "pax" integer, "base_cents" bigint, "tax_cents" bigint, "fees_cents" bigint, "revenue_cents" bigint, "avg_unit_cents" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with f as (
    select * from rpt_booking_financials(p_operator, p_from, p_to)
  ), r as (
    select id, name from routes
  )
  select (date_trunc('day', f.departure_ts))::date as day,
         f.route_id, r.name as route_name,
         sum(f.seats)::int as pax,
         sum(f.base_cents)::bigint as base_cents,
         sum(f.tax_cents)::bigint as tax_cents,
         sum(f.fees_cents)::bigint as fees_cents,
         sum(f.revenue_cents)::bigint as revenue_cents,
         nullif(round(avg( (f.revenue_cents::numeric) / nullif(f.seats,0) )),0)::bigint as avg_unit_cents
  from f
  left join r on r.id = f.route_id
  group by 1,2,3
  order by 1,3;
$$;


ALTER FUNCTION "public"."rpt_revenue_by_route_date"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_revenue_by_route_date_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("route_name" "text", "pickup_name" "text", "destination_name" "text", "day" "date", "seats" integer, "base_cents" bigint, "tax_cents" bigint, "fees_cents" bigint, "commission_cents" bigint, "total_cents" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with j as (
  select j.id, j.route_id, j.vehicle_id, j.departure_ts
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
b as (
  select b.journey_id, sum(b.seats)::int seats
  from public.bookings b
  join j on j.id = b.journey_id
  group by 1
)
select
  rl.route_name,
  rl.pickup_name,
  rl.destination_name,
  j.departure_ts::date as day,
  coalesce(b.seats,0) as seats,
  0::bigint as base_cents,
  0::bigint as tax_cents,
  0::bigint as fees_cents,
  0::bigint as commission_cents,
  0::bigint as total_cents
from j
left join b               on b.journey_id = j.id
left join public.v_route_legs rl on rl.route_id   = j.route_id
order by day, rl.route_name;
$$;


ALTER FUNCTION "public"."rpt_revenue_by_route_date_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_revenue_by_route_date_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("route_name" "text", "pickup_name" "text", "destination_name" "text", "day" "date", "seats" integer, "base_gbp" bigint, "tax_gbp" bigint, "fees_gbp" bigint, "commission_gbp" bigint, "total_gbp" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with j as (
  select j.id, j.route_id, j.vehicle_id, j.departure_ts
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
legs as (
  select
    j.id as journey_id,
    j.departure_ts::date as day,
    r.id  as route_id,
    coalesce(r.route_name, r.name) as route_name,
    pu.name as pickup_name,
    de.name as destination_name,
    pu.country_id
  from j
  join public.routes r            on r.id = j.route_id
  left join public.pickup_points pu on pu.id = r.pickup_id
  left join public.destinations  de on de.id = r.destination_id
),
rates as (
  select
    l.journey_id,
    coalesce(tf.tax, 0)::numeric  as tax_rate,
    coalesce(tf.fees, 0)::numeric as fee_rate
  from legs l
  left join lateral (
    select tax, fees
    from public.tax_fees tf
    where tf.country_id = l.country_id
    order by tf.created_at desc
    limit 1
  ) tf on true
),
op_comm as (
  select p_operator as operator_id, coalesce(o.commisison, 0)::numeric as commission_rate
  from public.operators o
  where o.id = p_operator
),
b_aggr as (
  select
    l.route_name, l.pickup_name, l.destination_name, l.day,
    sum(b.seats)::int as seats,
    sum( coalesce(b.price_cents, j.base_price_cents) * b.seats )::bigint as base_cents,
    max(r.tax_rate)  as tax_rate,
    max(r.fee_rate)  as fee_rate
  from legs l
  join public.bookings b on b.journey_id = l.journey_id
  join public.journeys j on j.id = l.journey_id
  left join rates r       on r.journey_id = l.journey_id
  group by 1,2,3,4
)
select
  ba.route_name,
  ba.pickup_name,
  ba.destination_name,
  ba.day,
  coalesce(ba.seats,0)                                     as seats,
  round( (coalesce(ba.base_cents,0))/100.0 )               as base_gbp,
  round( (coalesce(ba.base_cents,0) * ba.tax_rate)/100.0 ) as tax_gbp,
  round( ((coalesce(ba.base_cents,0) + (coalesce(ba.base_cents,0)*ba.tax_rate)) * ba.fee_rate)/100.0 ) as fees_gbp,
  round( (coalesce(ba.base_cents,0) * oc.commission_rate)/100.0 ) as commission_gbp,
  round( (
     coalesce(ba.base_cents,0)
   + (coalesce(ba.base_cents,0) * ba.tax_rate)
   + ((coalesce(ba.base_cents,0) + (coalesce(ba.base_cents,0)*ba.tax_rate)) * ba.fee_rate)
  ) / 100.0 ) as total_gbp
from b_aggr ba
cross join op_comm oc
order by ba.day, ba.route_name;
$$;


ALTER FUNCTION "public"."rpt_revenue_by_route_date_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_seat_utilisation"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("journey_id" "uuid", "departure_ts" timestamp with time zone, "route_id" "uuid", "vehicle_id" "uuid", "vehicle_name" "text", "capacity" integer, "booked" integer, "utilisation_percent" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with booked as (
    select b.journey_id, b.vehicle_id, sum(b.seats)::int as booked
    from bookings b
    join journeys j on j.id=b.journey_id
    where j.operator_id = p_operator
      and j.departure_ts >= p_from and j.departure_ts < p_to
      -- status filter removed to avoid enum mismatch; include all bookings in window
    group by 1,2
  )
  select j.id, j.departure_ts, j.route_id, v.id as vehicle_id, v.name as vehicle_name,
         v.maxseats::int as capacity,
         coalesce(b.booked,0) as booked,
         case when v.maxseats > 0 then round(100.0 * coalesce(b.booked,0) / v.maxseats, 1) else null end as utilisation_percent
  from journeys j
  join route_vehicle_assignments a on a.route_id = j.route_id and a.is_active
  join vehicles v on v.id = a.vehicle_id and v.operator_id = p_operator
  left join booked b on b.journey_id = j.id and b.vehicle_id = v.id
  where j.departure_ts >= p_from and j.departure_ts < p_to
  order by j.departure_ts, v.name;
$$;


ALTER FUNCTION "public"."rpt_seat_utilisation"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_seat_utilisation_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("journey_id" "uuid", "departure_ts" timestamp with time zone, "route_name" "text", "pickup_name" "text", "destination_name" "text", "vehicle_name" "text", "capacity" integer, "booked" integer, "utilisation_perc" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with base as (
  select j.id as journey_id, j.departure_ts, j.route_id, j.vehicle_id
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
bk as (
  select b.journey_id, coalesce(sum(b.seats),0)::int as booked
  from public.bookings b
  join base on base.journey_id = b.journey_id
  group by 1
)
select
  base.journey_id,
  base.departure_ts,
  rl.route_name,
  rl.pickup_name,
  rl.destination_name,
  vv.vehicle_name,
  vv.capacity,
  coalesce(bk.booked,0) as booked,
  case when vv.capacity > 0
       then round((coalesce(bk.booked,0)::numeric / vv.capacity::numeric) * 100, 2)
       else 0 end as utilisation_perc
from base
left join public.v_vehicle_names vv on vv.vehicle_id = base.vehicle_id
left join public.v_route_legs    rl on rl.route_id   = base.route_id
left join bk                        on bk.journey_id  = base.journey_id
order by base.departure_ts asc, rl.route_name nulls last, vv.vehicle_name nulls last;
$$;


ALTER FUNCTION "public"."rpt_seat_utilisation_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpt_seat_utilisation_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("departure_ts" timestamp with time zone, "route_name" "text", "pickup_name" "text", "destination_name" "text", "vehicle_name" "text", "capacity" integer, "booked" integer, "utilisation_pct" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with base as (
  select j.id as journey_id, j.departure_ts, j.route_id, j.vehicle_id
  from public.journeys j
  left join public.vehicles v on v.id = j.vehicle_id
  where (j.operator_id = p_operator or v.operator_id = p_operator)
    and j.departure_ts >= p_from
    and j.departure_ts <  p_to
),
bk as (
  select b.journey_id, coalesce(sum(b.seats),0)::int as booked
  from public.bookings b
  join base on base.journey_id = b.journey_id
  group by 1
)
select
  base.departure_ts,
  coalesce(r.route_name, r.name) as route_name,
  pu.name as pickup_name,
  de.name as destination_name,
  v.name  as vehicle_name,
  coalesce(nullif(v.maxseats::int,0),0) as capacity,
  coalesce(bk.booked,0) as booked,
  case when coalesce(nullif(v.maxseats::int,0),0) > 0
       then round( (coalesce(bk.booked,0)::numeric / v.maxseats::numeric) * 100, 1)
       else 0 end as utilisation_pct
from base
left join public.routes r         on r.id = base.route_id
left join public.pickup_points pu on pu.id = r.pickup_id
left join public.destinations  de on de.id = r.destination_id
left join public.vehicles      v  on v.id  = base.vehicle_id
left join bk                       on bk.journey_id = base.journey_id
order by base.departure_ts asc, route_name nulls last, vehicle_name nulls last;
$$;


ALTER FUNCTION "public"."rpt_seat_utilisation_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_flag"("p_key" "text", "p_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.app_flags(key, enabled, updated_at)
  VALUES (p_key, p_enabled, now())
  ON CONFLICT (key) DO UPDATE
  SET enabled = EXCLUDED.enabled, updated_at = now();
END;
$$;


ALTER FUNCTION "public"."set_flag"("p_key" "text", "p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_preferred_vehicle"("p_route_id" "uuid", "p_vehicle_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- clear current preferred
  update route_vehicle_assignments
    set preferred = false
  where route_id = p_route_id
    and preferred = true;

  -- ensure row exists and mark it preferred + active
  insert into route_vehicle_assignments(route_id, vehicle_id, is_active, preferred)
  values (p_route_id, p_vehicle_id, true, true)
  on conflict (route_id, vehicle_id)
  do update set is_active = true, preferred = true;
end;
$$;


ALTER FUNCTION "public"."set_preferred_vehicle"("p_route_id" "uuid", "p_vehicle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;


ALTER FUNCTION "public"."tg_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_capacity_changed_rva"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_route uuid;
begin
  v_route := coalesce(new.route_id, old.route_id);
  if v_route is not null then
    perform public.recompute_route_range(v_route);
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_capacity_changed_rva"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_capacity_changed_vehicle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- find all routes that use this vehicle and refresh their windows
  perform public.recompute_route_range(rva.route_id)
  from public.route_vehicle_assignments rva
  where rva.vehicle_id = coalesce(new.id, old.id);
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_capacity_changed_vehicle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recompute_from_bookings"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') and new.journey_id is not null then
    perform public.recompute_from_journey(new.journey_id);
  end if;

  if (tg_op = 'UPDATE' or tg_op = 'DELETE') and old.journey_id is not null and old.journey_id is distinct from coalesce(new.journey_id, old.journey_id) then
    perform public.recompute_from_journey(old.journey_id);
  end if;

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_recompute_from_bookings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recompute_from_journeys"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public.recompute_from_journey(new.id);
  elsif tg_op = 'UPDATE' then
    -- recompute old and new tuple if keys changed
    if (old.route_id, old.journey_date) is distinct from (new.route_id, new.journey_date) then
      perform public.recompute_from_journey(old.id);
      perform public.recompute_from_journey(new.id);
    else
      perform public.recompute_from_journey(new.id);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_recompute_from_journeys"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unassign_vehicle_from_route"("p_route_id" "uuid", "p_vehicle_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update route_vehicle_assignments
  set is_active = false,
      preferred = false
  where route_id = p_route_id
    and vehicle_id = p_vehicle_id;
end;
$$;


ALTER FUNCTION "public"."unassign_vehicle_from_route"("p_route_id" "uuid", "p_vehicle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wl_asset_unavailability"("p_wl_asset_id" "uuid", "p_from" timestamp with time zone DEFAULT ("now"() - '1 day'::interval), "p_to" timestamp with time zone DEFAULT ("now"() + '365 days'::interval)) RETURNS TABLE("start_ts" timestamp with time zone, "end_ts" timestamp with time zone, "source" "text")
    LANGUAGE "sql" STABLE
    AS $$
(
  SELECT d.start_ts, d.end_ts, 'charter'::text AS source
  FROM public.wl_day_charters d
  WHERE d.wl_asset_id = p_wl_asset_id
    AND d.status IN ('pending','confirmed')
    AND d.start_ts < p_to
    AND d.end_ts   > p_from
)
UNION ALL
(
  SELECT b.start_ts, b.end_ts, 'blackout'::text AS source
  FROM public.asset_blackouts b
  JOIN public.wl_assets wa ON wa.vehicle_id = b.vehicle_id
  WHERE wa.id = p_wl_asset_id
    AND b.start_ts < p_to
    AND b.end_ts   > p_from
);
$$;


ALTER FUNCTION "public"."wl_asset_unavailability"("p_wl_asset_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wl_confirm_booking"("p_charter_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.wl_day_charters
  SET status = 'confirmed'
  WHERE id = p_charter_id;

  -- ensure blackout exists (idempotent)
  INSERT INTO public.asset_blackouts (vehicle_id, start_ts, end_ts, reason, source)
  SELECT wa.vehicle_id, d.start_ts, d.end_ts, 'WL day-charter confirmed', 'wl_day_charter'
  FROM public.wl_day_charters d
  JOIN public.wl_assets wa ON wa.id = d.wl_asset_id
  WHERE d.id = p_charter_id
  ON CONFLICT DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."wl_confirm_booking"("p_charter_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wl_create_booking"("p_wl_asset_id" "uuid", "p_lessee_operator_id" "uuid", "p_start_ts" timestamp with time zone, "p_end_ts" timestamp with time zone, "p_terms_version" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_charter_id uuid;
  a record;
BEGIN
  -- validate asset & fetch terms
  SELECT wa.id AS wl_asset_id,
         wa.vehicle_id,
         wa.day_rate_cents,
         wa.security_deposit_cents,
         wa.min_notice_hours
  INTO a
  FROM public.wl_assets wa
  JOIN public.vehicles v   ON v.id = wa.vehicle_id AND v.white_label_enabled = TRUE
  JOIN public.operators o  ON o.id = wa.owner_operator_id AND o.ps_owner = TRUE
  WHERE wa.id = p_wl_asset_id
    AND wa.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'White-label asset not available';
  END IF;

  -- min notice
  IF now() > (p_start_ts - (a.min_notice_hours || ' hours')::interval) THEN
    RAISE EXCEPTION 'Minimum notice not met';
  END IF;

  -- overlap with WL charters
  IF EXISTS (
    SELECT 1
    FROM public.wl_day_charters d
    WHERE d.wl_asset_id = p_wl_asset_id
      AND d.status IN ('pending','confirmed')
      AND tstzrange(d.start_ts, d.end_ts, '[)') &&
          tstzrange(p_start_ts, p_end_ts, '[)')
  ) THEN
    RAISE EXCEPTION 'Asset already booked for that period';
  END IF;

  -- overlap with blackouts (incl. Pace holds)
  IF EXISTS (
    SELECT 1
    FROM public.asset_blackouts b
    WHERE b.vehicle_id = a.vehicle_id
      AND tstzrange(b.start_ts, b.end_ts, '[)') &&
          tstzrange(p_start_ts, p_end_ts, '[)')
  ) THEN
    RAISE EXCEPTION 'Asset is unavailable (blackout) for that period';
  END IF;

  -- insert charter (pending)
  INSERT INTO public.wl_day_charters
    (wl_asset_id, lessee_operator_id, start_ts, end_ts, status,
     quoted_day_rate_cents, deposit_cents, balance_cents, terms_version)
  VALUES
    (p_wl_asset_id, p_lessee_operator_id, p_start_ts, p_end_ts, 'pending',
     a.day_rate_cents, a.security_deposit_cents, 0, p_terms_version)
  RETURNING id INTO v_charter_id;

  -- place a hold blackout so the date blocks everywhere
  INSERT INTO public.asset_blackouts (vehicle_id, start_ts, end_ts, reason, source)
  VALUES (a.vehicle_id, p_start_ts, p_end_ts, 'WL day-charter hold', 'wl_day_charter')
  ON CONFLICT DO NOTHING;

  RETURN v_charter_id;
END;
$$;


ALTER FUNCTION "public"."wl_create_booking"("p_wl_asset_id" "uuid", "p_lessee_operator_id" "uuid", "p_start_ts" timestamp with time zone, "p_end_ts" timestamp with time zone, "p_terms_version" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wl_market_for_operator"("p_operator_id" "uuid") RETURNS SETOF "app"."wl_market_assets"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT *
  FROM app.wl_market_assets a
  WHERE a.country_id = (SELECT country_id FROM public.operators WHERE id = p_operator_id)
    AND EXISTS (
      SELECT 1 FROM public.operators op
      WHERE op.id = p_operator_id
        AND op.white_label_member = true
    );
$$;


ALTER FUNCTION "public"."wl_market_for_operator"("p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wl_set_terms"("p_vehicle_id" "uuid", "p_owner_operator_id" "uuid", "p_day_rate_cents" integer, "p_deposit_cents" integer, "p_min_notice_hours" integer, "p_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- toggle the vehicle flag
  UPDATE public.vehicles
  SET white_label_enabled = p_enabled
  WHERE id = p_vehicle_id;

  -- upsert commercial terms
  INSERT INTO public.wl_assets (vehicle_id, owner_operator_id, day_rate_cents, security_deposit_cents, min_notice_hours, is_active)
  VALUES (p_vehicle_id, p_owner_operator_id, p_day_rate_cents, p_deposit_cents, p_min_notice_hours, p_enabled)
  ON CONFLICT (vehicle_id, owner_operator_id)
  DO UPDATE SET
    day_rate_cents = EXCLUDED.day_rate_cents,
    security_deposit_cents = EXCLUDED.security_deposit_cents,
    min_notice_hours = EXCLUDED.min_notice_hours,
    is_active = EXCLUDED.is_active;
END;
$$;


ALTER FUNCTION "public"."wl_set_terms"("p_vehicle_id" "uuid", "p_owner_operator_id" "uuid", "p_day_rate_cents" integer, "p_deposit_cents" integer, "p_min_notice_hours" integer, "p_enabled" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_blackouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "start_ts" timestamp with time zone NOT NULL,
    "end_ts" timestamp with time zone NOT NULL,
    "reason" "text",
    "source" "text" DEFAULT 'maintenance'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "asset_blackouts_source_check" CHECK (("source" = ANY (ARRAY['wl_day_charter'::"text", 'pace_fractional'::"text", 'maintenance'::"text"]))),
    CONSTRAINT "blackout_range" CHECK (("end_ts" > "start_ts"))
);


ALTER TABLE "public"."asset_blackouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wl_day_charters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wl_asset_id" "uuid" NOT NULL,
    "lessee_operator_id" "uuid" NOT NULL,
    "start_ts" timestamp with time zone NOT NULL,
    "end_ts" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "quoted_day_rate_cents" integer NOT NULL,
    "deposit_cents" integer DEFAULT 0 NOT NULL,
    "balance_cents" integer DEFAULT 0 NOT NULL,
    "terms_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wl_day_charters_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text", 'completed'::"text", 'refunded'::"text"]))),
    CONSTRAINT "wl_dc_time" CHECK (("end_ts" > "start_ts"))
);


ALTER TABLE "public"."wl_day_charters" OWNER TO "postgres";


CREATE OR REPLACE VIEW "app"."vehicle_unavailability" AS
 SELECT "wa"."vehicle_id",
    "d"."start_ts",
    "d"."end_ts",
    'wl'::"text" AS "source",
    "d"."status"
   FROM ("public"."wl_day_charters" "d"
     JOIN "public"."wl_assets" "wa" ON (("wa"."id" = "d"."wl_asset_id")))
  WHERE ("d"."status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"]))
UNION ALL
 SELECT "b"."vehicle_id",
    "b"."start_ts",
    "b"."end_ts",
    COALESCE("b"."source", 'blackout'::"text") AS "source",
    'active'::"text" AS "status"
   FROM "public"."asset_blackouts" "b";


ALTER VIEW "app"."vehicle_unavailability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_flags" (
    "key" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text",
    "value_bool" boolean,
    "value_text" "text",
    "value_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."app_flags" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."app_flags_unified" AS
 SELECT "key" AS "name",
    "value_json",
    "note",
    "updated_at"
   FROM "public"."app_flags";


ALTER VIEW "public"."app_flags_unified" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_cancellations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "cancelled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "seats_cancelled" integer NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "rule_id" bigint NOT NULL,
    "days_out" integer NOT NULL,
    "base_plus_tax_per_seat" numeric(12,2) NOT NULL,
    "fees_per_seat" numeric(12,2) NOT NULL,
    "refund_if_resold_total" numeric(12,2) NOT NULL,
    "refund_if_not_resold_total" numeric(12,2) NOT NULL,
    "seats_resold" integer DEFAULT 0 NOT NULL,
    "finalized" boolean DEFAULT false NOT NULL,
    "refund_status" "public"."refund_status" DEFAULT 'Pending'::"public"."refund_status" NOT NULL,
    "refund_paid_total" numeric(12,2) DEFAULT 0,
    CONSTRAINT "booking_cancellations_seats_cancelled_check" CHECK (("seats_cancelled" > 0)),
    CONSTRAINT "booking_cancellations_seats_resold_check" CHECK (("seats_resold" >= 0))
);


ALTER TABLE "public"."booking_cancellations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "route_id" "uuid" NOT NULL,
    "customer_name" "text" NOT NULL,
    "seats" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "price_cents" integer,
    "currency" "text" DEFAULT 'USD'::"text",
    "wet_arrival_ack" boolean DEFAULT false,
    "journey_id" "uuid",
    "status" "public"."booking_status" DEFAULT 'Scheduled'::"public"."booking_status",
    "lead_last_name" "text",
    "total_price" numeric,
    "booked_at" timestamp with time zone DEFAULT "now"(),
    "order_id" "uuid",
    "paid_at" timestamp with time zone,
    "vehicle_id" "uuid",
    CONSTRAINT "bookings_seats_check" CHECK (("seats" > 0))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journeys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "route_id" "uuid" NOT NULL,
    "departure_ts" timestamp with time zone NOT NULL,
    "base_price_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vehicle_id" "uuid",
    "operator_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "sailings_base_price_cents_check" CHECK (("base_price_cents" >= 0))
);


ALTER TABLE "public"."journeys" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."booking_seat_counts" AS
 SELECT "j"."id" AS "journey_id",
    (COALESCE("sum"("b"."seats") FILTER (WHERE ("b"."status" = ANY (ARRAY['Scheduled'::"public"."booking_status", 'Complete'::"public"."booking_status"]))), (0)::bigint))::integer AS "seats"
   FROM ("public"."journeys" "j"
     LEFT JOIN "public"."bookings" "b" ON (("b"."journey_id" = "j"."id")))
  GROUP BY "j"."id";


ALTER VIEW "public"."booking_seat_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_seat_counts_by_vehicle_base" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid",
    "seats" integer NOT NULL,
    "source" "text" DEFAULT 'checkout'::"text",
    "quote_token" "text",
    "unit_base_cents" integer,
    "unit_tax_cents" integer,
    "unit_fees_cents" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_seat_counts_by_vehicle_base_seats_check" CHECK (("seats" > 0))
);


ALTER TABLE "public"."booking_seat_counts_by_vehicle_base" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."booking_seat_counts_by_vehicle" AS
 SELECT "id",
    "journey_id",
    "vehicle_id",
    "seats",
    "source",
    "quote_token",
    "unit_base_cents",
    "unit_tax_cents",
    "unit_fees_cents",
    "created_at"
   FROM "public"."booking_seat_counts_by_vehicle_base";


ALTER VIEW "public"."booking_seat_counts_by_vehicle" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."booking_seat_counts_by_vehicle_agg" AS
 SELECT "journey_id",
    "vehicle_id",
    "sum"("seats") AS "seats_booked",
    "min"("created_at") AS "first_booked_at",
    "max"("created_at") AS "last_booked_at"
   FROM "public"."booking_seat_counts_by_vehicle_base"
  GROUP BY "journey_id", "vehicle_id";


ALTER VIEW "public"."booking_seat_counts_by_vehicle_agg" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cancellation_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refund_fees" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."cancellation_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cancellation_policy_rules" (
    "id" bigint NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "min_days_out" integer NOT NULL,
    "max_days_out" integer,
    "refund_percent_if_resold" numeric(5,2) NOT NULL,
    "refund_percent_if_not_resold" numeric(5,2) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."cancellation_policy_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cancellation_policy_rules_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cancellation_policy_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cancellation_policy_rules_id_seq" OWNED BY "public"."cancellation_policy_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."captain_journey_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "captain_staff_id" "uuid" NOT NULL,
    "event_type" "public"."journey_event_type" NOT NULL,
    "event_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lat" double precision,
    "lng" double precision,
    "note" "text"
);


ALTER TABLE "public"."captain_journey_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."countries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "blurb" "text",
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "code" "text",
    "description" "text",
    "picture_url" "text",
    "timezone" "text"
);


ALTER TABLE "public"."countries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."destinations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country_id" "uuid",
    "name" "text" NOT NULL,
    "address1" "text",
    "address2" "text",
    "town" "text",
    "region" "text",
    "postal_code" "text",
    "phone" "text",
    "picture_url" "text",
    "description" "text",
    "season_from" "date",
    "season_to" "date",
    "destination_type" "text" DEFAULT 'Restaurant'::"text",
    "wet_or_dry" "text" DEFAULT 'dry'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "url" "text",
    "gift" "text",
    CONSTRAINT "destinations_destination_type_check" CHECK (("destination_type" = ANY (ARRAY['Restaurant'::"text", 'Bar'::"text", 'Beach Club'::"text", 'Restaurant & Bar'::"text"]))),
    CONSTRAINT "destinations_wet_or_dry_check" CHECK (("wet_or_dry" = ANY (ARRAY['wet'::"text", 'dry'::"text"])))
);


ALTER TABLE "public"."destinations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."destinations"."url" IS 'Web Address';



COMMENT ON COLUMN "public"."destinations"."gift" IS 'Any Pace Shuttles benefits?';



CREATE TABLE IF NOT EXISTS "public"."routes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "country" "text",
    "duration_mins" bigint,
    "next_departure_iso" timestamp with time zone,
    "country_id" "uuid",
    "pickup_id" "uuid",
    "destination_id" "uuid",
    "approximate_distance_miles" numeric(8,2),
    "pickup_time" time without time zone,
    "frequency_rrule" "text",
    "season_from" "date",
    "season_to" "date",
    "early_booking_days_min" integer,
    "early_discount_percent" numeric(5,2),
    "late_booking_days_max" integer,
    "late_discount_percent" numeric(5,2),
    "base_price_gbp" numeric(12,2),
    "journey_type_id" "uuid",
    "route_name" "text",
    "frequency" "text",
    "transport_type" "text",
    "approx_duration_mins" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "cancellation_policy_id" "uuid"
);


ALTER TABLE "public"."routes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."routes_on_sale_v" AS
 SELECT DISTINCT "r"."id" AS "route_id",
    "r"."country_id",
    "r"."pickup_id",
    "r"."destination_id",
    "r"."season_from",
    "r"."season_to",
    "r"."pickup_time",
    "r"."frequency",
    "r"."route_name"
   FROM (("public"."routes" "r"
     JOIN "public"."route_vehicle_assignments" "rva" ON ((("rva"."route_id" = "r"."id") AND ("rva"."is_active" = true))))
     JOIN "public"."vehicles" "v" ON ((("v"."id" = "rva"."vehicle_id") AND ("v"."active" = true))))
  WHERE (("r"."is_active" = true) AND ((("r"."season_from" IS NULL) AND ("r"."season_to" IS NULL)) OR ((CURRENT_DATE >= COALESCE("r"."season_from", CURRENT_DATE)) AND (CURRENT_DATE <= COALESCE("r"."season_to", CURRENT_DATE)))));


ALTER VIEW "public"."routes_on_sale_v" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."country_destinations_on_sale_v" AS
 SELECT "r"."country_id",
    "r"."destination_id",
    "d"."name" AS "destination_name",
    "count"(*) AS "num_routes"
   FROM ("public"."routes_on_sale_v" "r"
     JOIN "public"."destinations" "d" ON (("d"."id" = "r"."destination_id")))
  GROUP BY "r"."country_id", "r"."destination_id", "d"."name";


ALTER VIEW "public"."country_destinations_on_sale_v" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."country_timezones" (
    "code" "text" NOT NULL,
    "timezone" "text" NOT NULL
);


ALTER TABLE "public"."country_timezones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pickup_points" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address1" "text",
    "address2" "text",
    "town" "text",
    "region" "text",
    "postal_code" "text",
    "picture_url" "text",
    "description" "text",
    "transport_type_id" "uuid" NOT NULL,
    "transport_type_place_id" "uuid"
);


ALTER TABLE "public"."pickup_points" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "picture_url" "text",
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "slug" "text"
);


ALTER TABLE "public"."transport_types" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."country_transport_types_on_sale_v" AS
 SELECT "r"."country_id",
    "p"."transport_type_id" AS "journey_type_id",
    "tt"."name" AS "transport_type_name",
    "count"(*) AS "num_routes"
   FROM (("public"."routes_on_sale_v" "r"
     JOIN "public"."pickup_points" "p" ON (("p"."id" = "r"."pickup_id")))
     JOIN "public"."transport_types" "tt" ON ((("tt"."id" = "p"."transport_type_id") AND ("tt"."is_active" = true))))
  GROUP BY "r"."country_id", "p"."transport_type_id", "tt"."name";


ALTER VIEW "public"."country_transport_types_on_sale_v" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crew_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "staff_user_id" "uuid",
    "role_id" "uuid",
    "status" "text" DEFAULT 'allocated'::"text" NOT NULL,
    "assigned_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crew_assignments_status_check" CHECK (("status" = ANY (ARRAY['allocated'::"text", 'confirmed'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."crew_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crew_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crew_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."destination_arrival" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text",
    "advice" "text"
);


ALTER TABLE "public"."destination_arrival" OWNER TO "postgres";


ALTER TABLE "public"."destination_arrival" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."destination_arrival_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."destination_type" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text"
);


ALTER TABLE "public"."destination_type" OWNER TO "postgres";


ALTER TABLE "public"."destination_type" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."destination_type_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."destination_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."destination_types" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."flags_runtime" AS
 SELECT 'pricing_engine_v2'::"text" AS "key",
    "public"."flag_enabled"('pricing_engine_v2'::"text") AS "enabled";


ALTER VIEW "public"."flags_runtime" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_allocations" (
    "journey_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "vehicle_id" "uuid",
    "seats" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "journey_allocations_seats_check" CHECK (("seats" > 0))
);


ALTER TABLE "public"."journey_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "role_id" "uuid",
    "is_lead" boolean DEFAULT true NOT NULL,
    "status_simple" "text" DEFAULT 'allocated'::"text" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "journey_assignments_status_simple_check" CHECK (("status_simple" = ANY (ARRAY['allocated'::"text", 'confirmed'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."journey_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_boats" (
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "minseats" integer DEFAULT 0 NOT NULL,
    "maxseats" integer NOT NULL,
    "preferred" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."journey_boats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_crew" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "staff_id" "uuid",
    "role" "text",
    "state" "text" DEFAULT 'provisional'::"text" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."journey_crew" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_crew_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "status" "public"."crew_assignment_status" DEFAULT 'assigned'::"public"."crew_assignment_status" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid",
    "confirmed_at" timestamp with time zone,
    "declined_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."journey_crew_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_inventory" (
    "journey_id" "uuid" NOT NULL,
    "seats_reserved" integer DEFAULT 0 NOT NULL,
    "seats_remaining" integer DEFAULT 0 NOT NULL,
    "minseats_reached" boolean DEFAULT false NOT NULL,
    "advertised_unit_price_cents" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."journey_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_passengers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "is_lead" boolean DEFAULT false NOT NULL,
    "email" "text",
    "phone" "text"
);


ALTER TABLE "public"."order_passengers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."journey_manifest" AS
 SELECT "b"."journey_id",
    "b"."id" AS "booking_id",
    COALESCE("op"."first_name", ''::"text") AS "first_name",
    COALESCE("op"."last_name", ''::"text") AS "last_name",
    COALESCE("op"."is_lead", false) AS "is_lead",
    "b"."status" AS "booking_status",
    "b"."seats"
   FROM ("public"."bookings" "b"
     LEFT JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "b"."order_id")))
  WHERE ("b"."journey_id" IS NOT NULL)
  ORDER BY "b"."created_at", COALESCE("op"."is_lead", false) DESC, COALESCE("op"."last_name", ''::"text"), COALESCE("op"."first_name", ''::"text");


ALTER VIEW "public"."journey_manifest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_order_allocations" (
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "seats" integer NOT NULL,
    CONSTRAINT "journey_order_allocations_seats_check" CHECK (("seats" >= 0))
);


ALTER TABLE "public"."journey_order_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'requires_payment'::"text" NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "subtotal_cents" integer DEFAULT 0 NOT NULL,
    "tax_cents" integer DEFAULT 0 NOT NULL,
    "fees_cents" integer DEFAULT 0 NOT NULL,
    "total_cents" integer DEFAULT 0 NOT NULL,
    "lead_first_name" "text",
    "lead_last_name" "text",
    "lead_email" "text",
    "lead_phone" "text",
    "home_addr_line1" "text",
    "home_addr_line2" "text",
    "home_city" "text",
    "home_region" "text",
    "home_postal" "text",
    "home_country" "text",
    "bill_addr_line1" "text",
    "bill_addr_line2" "text",
    "bill_city" "text",
    "bill_region" "text",
    "bill_postal" "text",
    "bill_country" "text",
    "route_id" "uuid",
    "journey_date" "date",
    "qty" integer DEFAULT 1,
    "base_amount_c" numeric(12,2),
    "tax_amount_c" numeric(12,2),
    "fee_amount_c" numeric(12,2),
    "commission_amount_c" numeric(12,2),
    "total_amount_c" numeric(12,2),
    "success_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_price_cents" integer,
    "base_cents" integer,
    "tax_rate" numeric(6,4) DEFAULT 0 NOT NULL,
    "fees_rate" numeric(6,4) DEFAULT 0 NOT NULL,
    "card_last4" "text",
    "booking_id" "uuid",
    CONSTRAINT "orders_amounts_nonneg" CHECK (((COALESCE("unit_price_cents", 0) >= 0) AND (COALESCE("base_cents", 0) >= 0) AND (COALESCE("tax_cents", 0) >= 0) AND (COALESCE("fees_cents", 0) >= 0) AND (COALESCE("total_cents", 0) >= 0))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['requires_payment'::"text", 'paid'::"text", 'cancelled'::"text", 'refunded'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."journey_order_manifest" AS
 SELECT "b"."journey_id",
    "op"."first_name",
    "op"."last_name",
    "op"."is_lead"
   FROM (("public"."bookings" "b"
     JOIN "public"."orders" "o" ON (("o"."id" = "b"."order_id")))
     JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "o"."id")));


ALTER VIEW "public"."journey_order_manifest" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."journey_order_manifest_plus" AS
 SELECT "b"."journey_id",
    "op"."order_id",
    "op"."first_name",
    "op"."last_name",
    "op"."is_lead"
   FROM ("public"."bookings" "b"
     JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "b"."order_id")))
  WHERE ("b"."journey_id" IS NOT NULL);


ALTER VIEW "public"."journey_order_manifest_plus" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."journey_order_manifest_v2" AS
 SELECT "j"."id" AS "journey_id",
    "op"."first_name",
    "op"."last_name",
    "op"."is_lead"
   FROM ((("public"."journeys" "j"
     JOIN "public"."bookings" "b" ON (("b"."journey_id" = "j"."id")))
     JOIN "public"."orders" "o" ON ((("o"."id" = "b"."order_id") AND ("o"."status" = 'paid'::"text"))))
     JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "o"."id")));


ALTER VIEW "public"."journey_order_manifest_v2" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."journey_order_passenger_counts" AS
 SELECT "b"."journey_id",
    "count"("op"."id") AS "pax"
   FROM (("public"."bookings" "b"
     JOIN "public"."orders" "o" ON (("o"."id" = "b"."order_id")))
     JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "o"."id")))
  GROUP BY "b"."journey_id";


ALTER VIEW "public"."journey_order_passenger_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_passenger_allocations" (
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "passenger_id" "uuid" NOT NULL
);


ALTER TABLE "public"."journey_passenger_allocations" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."journey_pax_counts" AS
 SELECT "b"."journey_id",
    ("sum"(
        CASE
            WHEN ("op"."id" IS NULL) THEN "b"."seats"
            ELSE 1
        END))::integer AS "pax"
   FROM ("public"."bookings" "b"
     LEFT JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "b"."order_id")))
  GROUP BY "b"."journey_id";


ALTER VIEW "public"."journey_pax_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."journey_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_vehicle_allocations" (
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "seats" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "journey_vehicle_allocations_seats_check" CHECK (("seats" > 0))
);


ALTER TABLE "public"."journey_vehicle_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_vehicle_allocs" (
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "seats" integer NOT NULL,
    "source" "text" DEFAULT 'allocator'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "journey_vehicle_allocs_seats_check" CHECK (("seats" > 0))
);


ALTER TABLE "public"."journey_vehicle_allocs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_vehicle_overrides" (
    "journey_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "removed" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."journey_vehicle_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journey_vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "route_id" "uuid" NOT NULL,
    "journey_date" "date" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "operator_id" "uuid",
    "min_seats" integer NOT NULL,
    "capacity" integer NOT NULL,
    "booked_seats" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'none'::"text" NOT NULL,
    "seats_capacity" integer NOT NULL
);


ALTER TABLE "public"."journey_vehicles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."journeys_needing_assignment" AS
 SELECT "j"."id",
    "j"."route_id",
    "j"."departure_ts",
    "j"."base_price_cents",
    "j"."currency",
    "j"."created_at",
    "j"."vehicle_id",
    "j"."operator_id",
    "j"."is_active"
   FROM ("public"."journeys" "j"
     JOIN "public"."booking_seat_counts" "s" ON (("s"."journey_id" = "j"."id")))
  WHERE (("j"."vehicle_id" IS NULL) AND ("s"."seats" > 0) AND "j"."is_active");


ALTER VIEW "public"."journeys_needing_assignment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ledger_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text" NOT NULL,
    "order_id" "uuid",
    "operator_id" "uuid",
    "user_id" "uuid",
    "currency" "text" DEFAULT 'GBP'::"text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "direction" "text" NOT NULL,
    "memo" "text",
    "meta" "jsonb",
    CONSTRAINT "ledger_transactions_direction_check" CHECK (("direction" = ANY (ARRAY['debit'::"text", 'credit'::"text"]))),
    CONSTRAINT "ledger_transactions_type_check" CHECK (("type" = ANY (ARRAY['ticket_sale'::"text", 'refund_customer'::"text", 'operator_fee_charge'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."ledger_transactions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."operator_available_journeys" AS
 SELECT "j"."id" AS "journey_id",
    "j"."operator_id",
    "r"."id" AS "route_id",
    "r"."route_name",
    "r"."pickup_time",
    "r"."frequency",
    "r"."transport_type" AS "vehicle_type",
    "r"."approx_duration_mins",
    "j"."is_active"
   FROM ("public"."journeys" "j"
     JOIN "public"."routes" "r" ON (("r"."id" = "j"."route_id")))
  WHERE ("r"."is_active" AND "j"."is_active");


ALTER VIEW "public"."operator_available_journeys" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."operator_bookings_with_pax" AS
 SELECT "id" AS "booking_id",
    "journey_id",
    "route_id",
    "order_id",
    "seats",
    "customer_name",
    "status",
    COALESCE(( SELECT "json_agg"("json_build_object"('first_name', "op"."first_name", 'last_name', "op"."last_name", 'is_lead', "op"."is_lead") ORDER BY (NOT "op"."is_lead"), ("lower"(COALESCE("op"."first_name", ''::"text"))), ("lower"(COALESCE("op"."last_name", ''::"text")))) AS "json_agg"
           FROM "public"."order_passengers" "op"
          WHERE ("op"."order_id" = "b"."order_id")), '[]'::json) AS "passengers"
   FROM "public"."bookings" "b";


ALTER VIEW "public"."operator_bookings_with_pax" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_crew_codes" (
    "operator_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "issued_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."operator_crew_codes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."operator_journeys_performed" AS
 SELECT "j"."operator_id",
    "j"."id" AS "journey_id",
    "r"."route_name",
    "r"."pickup_time" AS "time",
    "r"."frequency",
    ("b"."booked_at")::"date" AS "date",
    COALESCE("b"."status", 'Scheduled'::"public"."booking_status") AS "status",
    "b"."lead_last_name" AS "lead_passenger_last_name",
    "b"."total_price" AS "price"
   FROM (("public"."bookings" "b"
     JOIN "public"."journeys" "j" ON (("j"."id" = "b"."journey_id")))
     JOIN "public"."routes" "r" ON (("r"."id" = "j"."route_id")));


ALTER VIEW "public"."operator_journeys_performed" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_payout_items" (
    "payout_id" "uuid" NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL
);


ALTER TABLE "public"."operator_payout_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "total_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "operator_payouts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'reconciled'::"text"])))
);


ALTER TABLE "public"."operator_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "status" "public"."staff_status" DEFAULT 'Active'::"public"."staff_status" NOT NULL,
    "photo_url" "text",
    "licenses" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "jobrole" "text",
    "type_id" character varying,
    "role_id" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "home_base_pickup_id" "uuid",
    "qualifications_note" "text",
    "chat_user_id" "text",
    "device_push_token" "text",
    "user_id" "uuid"
);


ALTER TABLE "public"."operator_staff" OWNER TO "postgres";


COMMENT ON COLUMN "public"."operator_staff"."jobrole" IS 'JobRole';



CREATE OR REPLACE VIEW "public"."operator_staff_active" AS
 SELECT "id",
    "operator_id",
    "first_name",
    "last_name",
    "status",
    "photo_url",
    "licenses",
    "notes",
    "created_at",
    "updated_at",
    "jobrole",
    "type_id"
   FROM "public"."operator_staff"
  WHERE (("status")::"text" = 'Active'::"text");


ALTER VIEW "public"."operator_staff_active" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_transport_types" (
    "operator_id" "uuid" NOT NULL,
    "journey_type_id" "uuid" NOT NULL
);


ALTER TABLE "public"."operator_transport_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_guests" (
    "order_id" "uuid",
    "full_name" "text" NOT NULL
);


ALTER TABLE "public"."order_guests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "route_id" "uuid" NOT NULL,
    "pickup_id" "uuid",
    "destination_id" "uuid",
    "vehicle_id" "uuid" NOT NULL,
    "departure_date" "date" NOT NULL,
    "pickup_time" time without time zone,
    "qty" integer NOT NULL,
    "unit_price_cents" integer NOT NULL,
    "line_total_cents" integer NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "commission_percent" numeric(5,2) DEFAULT 0 NOT NULL,
    "commission_due_cents" integer DEFAULT 0 NOT NULL,
    "operator_yield_cents" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "order_items_qty_check" CHECK (("qty" > 0)),
    CONSTRAINT "order_items_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'pending'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_passenger_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_passenger_id" "uuid" NOT NULL,
    "journey_vehicle_id" "uuid" NOT NULL
);


ALTER TABLE "public"."order_passenger_assignments" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."orders_paid_by_route_date" AS
 SELECT "route_id",
    "journey_date",
    "sum"(COALESCE("qty", 0)) AS "booked"
   FROM "public"."orders"
  WHERE (("status" = 'paid'::"text") AND ("route_id" IS NOT NULL) AND ("journey_date" IS NOT NULL))
  GROUP BY "route_id", "journey_date";


ALTER VIEW "public"."orders_paid_by_route_date" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_application_places" (
    "application_id" "uuid" NOT NULL,
    "place_id" "uuid" NOT NULL
);


ALTER TABLE "public"."partner_application_places" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_type" "text" NOT NULL,
    "status" "public"."partner_application_status" DEFAULT 'new'::"public"."partner_application_status" NOT NULL,
    "admin_notes" "text",
    "country_id" "uuid",
    "transport_type_id" "uuid",
    "fleet_size" integer,
    "destination_type_id" "uuid",
    "pickup_suggestions" "text",
    "destination_suggestions" "text",
    "org_name" "text" NOT NULL,
    "org_address" "text",
    "telephone" "text",
    "mobile" "text",
    "email" "text",
    "website" "text",
    "social_instagram" "text",
    "social_youtube" "text",
    "social_x" "text",
    "social_facebook" "text",
    "contact_name" "text",
    "contact_role" "text",
    "years_operation" integer,
    "description" "text",
    "submitted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "partner_applications_application_type_check" CHECK (("application_type" = ANY (ARRAY['operator'::"text", 'destination'::"text"]))),
    CONSTRAINT "partner_applications_fleet_size_check" CHECK ((("fleet_size" IS NULL) OR ("fleet_size" >= 0))),
    CONSTRAINT "partner_applications_years_operation_check" CHECK ((("years_operation" IS NULL) OR ("years_operation" >= 0)))
);


ALTER TABLE "public"."partner_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."passenger_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "seat_count" integer NOT NULL,
    CONSTRAINT "passenger_allocations_seat_count_check" CHECK (("seat_count" > 0))
);


ALTER TABLE "public"."passenger_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."passenger_vehicle_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_vehicle_id" "uuid" NOT NULL,
    "order_passenger_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."passenger_vehicle_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."passengers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "is_lead" boolean DEFAULT false NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL
);


ALTER TABLE "public"."passengers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "method" "text" NOT NULL,
    "brand" "text",
    "last4" "text",
    "amount_cents" integer NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_method_check" CHECK (("method" = 'card'::"text")),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "role" "public"."user_role" DEFAULT 'user'::"public"."user_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quote_intents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "route_id" "uuid" NOT NULL,
    "date_iso" "text" NOT NULL,
    "seats" integer NOT NULL,
    "per_seat_all_in" integer,
    "currency" "text" DEFAULT 'GBP'::"text",
    "quote_token" "text",
    "departure_ts" timestamp with time zone
);


ALTER TABLE "public"."quote_intents" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."route_capacity_active" AS
 SELECT "rva"."route_id",
    "sum"(COALESCE("v"."maxseats", (0)::numeric)) AS "capacity"
   FROM ("public"."route_vehicle_assignments" "rva"
     JOIN "public"."vehicles" "v" ON ((("v"."id" = "rva"."vehicle_id") AND COALESCE("v"."active", true))))
  WHERE COALESCE("rva"."is_active", true)
  GROUP BY "rva"."route_id";


ALTER VIEW "public"."route_capacity_active" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_day_inventory" (
    "route_id" "uuid" NOT NULL,
    "journey_date" "date" NOT NULL,
    "cap" integer DEFAULT 0 NOT NULL,
    "booked_paid" integer DEFAULT 0 NOT NULL,
    "remaining" integer DEFAULT 0 NOT NULL,
    "status" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "route_day_inventory_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'limited'::"text", 'sold_out'::"text"])))
);


ALTER TABLE "public"."route_day_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_departures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "route_id" "uuid" NOT NULL,
    "departure_ts" timestamp with time zone NOT NULL,
    "arrival_ts" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."route_departures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_durations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "route_id" "uuid" NOT NULL,
    "transport_type_id" "uuid" NOT NULL,
    "duration_mins" integer NOT NULL,
    CONSTRAINT "route_durations_duration_mins_check" CHECK (("duration_mins" > 0))
);


ALTER TABLE "public"."route_durations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_inventory_status" (
    "route_id" "uuid" NOT NULL,
    "status" "public"."inventory_status" DEFAULT 'pending'::"public"."inventory_status" NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "active_vehicles" integer DEFAULT 0 NOT NULL,
    "active_capacity" integer DEFAULT 0 NOT NULL,
    "last_upload_at" timestamp with time zone,
    "error_message" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "route_inventory_status_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100)))
);


ALTER TABLE "public"."route_inventory_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_transport_metrics" (
    "route_id" "uuid" NOT NULL,
    "transport_type_id" "uuid" NOT NULL,
    "approx_duration_mins" integer,
    "base_price_gbp" numeric(10,2),
    "next_departure_iso" timestamp with time zone
);


ALTER TABLE "public"."route_transport_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_transport_types" (
    "route_id" "uuid" NOT NULL,
    "transport_type_id" "uuid" NOT NULL
);


ALTER TABLE "public"."route_transport_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."secrets" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."soldout_overrides" (
    "route_id" "uuid" NOT NULL,
    "journey_date" "date" NOT NULL
);


ALTER TABLE "public"."soldout_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "shift_start" timestamp with time zone,
    "shift_end" timestamp with time zone,
    "unavailable_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."staff_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_role_certifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "transport_type_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "valid_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_to" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."staff_role_certifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_fees" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tax" real,
    "fees" real,
    "commisison" real,
    "country_id" "uuid" NOT NULL,
    "platform_commission_percent" numeric(5,2)
);


ALTER TABLE "public"."tax_fees" OWNER TO "postgres";


ALTER TABLE "public"."tax_fees" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tax_fees_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tips_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "journey_id" "uuid" NOT NULL,
    "booking_id" "uuid",
    "payer_user_id" "uuid",
    "amount_total" numeric(12,2) NOT NULL,
    "split_captain_pct" integer DEFAULT 50 NOT NULL,
    "amount_captain" numeric(12,2) GENERATED ALWAYS AS ("round"((("amount_total" * ("split_captain_pct")::numeric) / 100.0), 2)) STORED,
    "amount_crew" numeric(12,2) GENERATED ALWAYS AS ("round"((("amount_total" * ((100 - "split_captain_pct"))::numeric) / 100.0), 2)) STORED,
    "payment_intent_id" "text",
    "status" "public"."payment_status" DEFAULT 'authorized'::"public"."payment_status" NOT NULL,
    "operator_payout_batch_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tips_ledger_amount_total_check" CHECK (("amount_total" >= (0)::numeric)),
    CONSTRAINT "tips_ledger_split_captain_pct_check" CHECK ((("split_captain_pct" >= 0) AND ("split_captain_pct" <= 100)))
);


ALTER TABLE "public"."tips_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "transaction_id" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "payment_method_brand" "text",
    "last4" "text",
    "psp" "text" DEFAULT 'internal'::"text" NOT NULL,
    "platform_fee_cents" integer DEFAULT 0 NOT NULL,
    "psp_fee_cents" integer DEFAULT 0 NOT NULL,
    "net_cents" integer DEFAULT 0 NOT NULL,
    "authorized_at" timestamp with time zone,
    "captured_at" timestamp with time zone DEFAULT "now"(),
    "refunded_at" timestamp with time zone,
    "operator_id" "uuid",
    CONSTRAINT "transactions_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'refunded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_type_places" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transport_type_id" "uuid" NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."transport_type_places" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_type_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transport_type_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "is_mandatory" boolean DEFAULT false NOT NULL,
    "min_count" integer DEFAULT 0 NOT NULL,
    "recommended_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_type_roles_role_check" CHECK (("role" = ANY (ARRAY['captain'::"text", 'crew'::"text", 'pilot'::"text", 'driver'::"text"])))
);


ALTER TABLE "public"."transport_type_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."un_countries" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "int_code" "text",
    "timezone" "text"
);


ALTER TABLE "public"."un_countries" OWNER TO "postgres";


COMMENT ON COLUMN "public"."un_countries"."int_code" IS 'International dialling code';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "email" character varying,
    "mobile" bigint,
    "country_code" real,
    "password" character varying,
    "site_admin" boolean,
    "operator_admin" boolean,
    "operator_id" "uuid",
    "auth_user_id" "uuid"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_crew_assignments_min" AS
 SELECT "ca"."id" AS "assignment_id",
    "ca"."journey_id",
    "ca"."vehicle_id",
    "ca"."staff_id",
    "ca"."staff_user_id",
    "ca"."role_id",
    "ca"."status" AS "status_simple",
    "ca"."assigned_at",
    "ca"."confirmed_at",
    "ca"."created_at",
    "os"."first_name",
    "os"."last_name",
    "os"."photo_url",
    "tr"."role" AS "role_label",
    "j"."departure_ts",
    "pp"."name" AS "pickup_name",
    "d"."name" AS "destination_name",
    "v"."name" AS "vehicle_name"
   FROM ((((((("public"."crew_assignments" "ca"
     LEFT JOIN "public"."operator_staff" "os" ON (("os"."id" = "ca"."staff_id")))
     LEFT JOIN "public"."transport_type_roles" "tr" ON (("tr"."id" = "ca"."role_id")))
     LEFT JOIN "public"."journeys" "j" ON (("j"."id" = "ca"."journey_id")))
     LEFT JOIN "public"."routes" "r" ON (("r"."id" = "j"."route_id")))
     LEFT JOIN "public"."pickup_points" "pp" ON (("pp"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "d" ON (("d"."id" = "r"."destination_id")))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "ca"."vehicle_id")));


ALTER VIEW "public"."v_crew_assignments_min" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_journey_ui_labels" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    "j"."vehicle_id",
    NULLIF(TRIM(BOTH FROM "split_part"("r"."name", '→'::"text", 1)), ''::"text") AS "pickup_name",
    NULLIF(TRIM(BOTH FROM "split_part"("r"."name", '→'::"text", 2)), ''::"text") AS "destination_name",
    COALESCE("v"."name", ('Vehicle '::"text" || "left"(("j"."vehicle_id")::"text", 8))) AS "vehicle_name"
   FROM (("public"."journeys" "j"
     LEFT JOIN "public"."routes" "r" ON (("r"."id" = "j"."route_id")))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "j"."vehicle_id")));


ALTER VIEW "public"."v_journey_ui_labels" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_journey_vehicle_load" AS
 WITH "seats" AS (
         SELECT "opa"."journey_vehicle_id",
            ("count"("opa"."id") FILTER (WHERE ("o"."status" = 'paid'::"text")))::integer AS "seats_taken"
           FROM (("public"."order_passenger_assignments" "opa"
             JOIN "public"."order_passengers" "op" ON (("op"."id" = "opa"."order_passenger_id")))
             JOIN "public"."orders" "o" ON (("o"."id" = "op"."order_id")))
          GROUP BY "opa"."journey_vehicle_id"
        )
 SELECT "jv"."id",
    "jv"."route_id",
    "jv"."journey_date",
    "jv"."vehicle_id",
    COALESCE("jv"."seats_capacity", ("v"."maxseats")::integer) AS "seats_capacity",
    COALESCE("s"."seats_taken", 0) AS "seats_taken",
    (COALESCE("jv"."seats_capacity", ("v"."maxseats")::integer) - COALESCE("s"."seats_taken", 0)) AS "seats_free",
    "jv"."status",
    NULL::timestamp with time zone AS "created_at"
   FROM (("public"."journey_vehicles" "jv"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "jv"."vehicle_id")))
     LEFT JOIN "seats" "s" ON (("s"."journey_vehicle_id" = "jv"."id")));


ALTER VIEW "public"."v_journey_vehicle_load" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_occurrence_vehicle_stats" AS
 SELECT "oi"."route_id",
    "oi"."vehicle_id",
    "v"."operator_id",
    "oi"."departure_date",
    COALESCE("oi"."pickup_time", "r"."pickup_time") AS "pickup_time",
    "sum"("oi"."qty") AS "seats_sold",
    "sum"("oi"."line_total_cents") AS "revenue_cents",
    "max"("v"."minseats") AS "minseats",
    "max"("v"."minvalue") AS "minvalue",
    ((("sum"("oi"."qty"))::numeric >= "max"("v"."minseats")) OR (("sum"("oi"."line_total_cents"))::double precision >= "max"("v"."minvalue"))) AS "is_confirmed",
    ("oi"."departure_date" - CURRENT_DATE) AS "days_to_trip"
   FROM ((("public"."order_items" "oi"
     JOIN "public"."orders" "o" ON ((("o"."id" = "oi"."order_id") AND ("o"."status" = 'paid'::"text"))))
     JOIN "public"."vehicles" "v" ON (("v"."id" = "oi"."vehicle_id")))
     JOIN "public"."routes" "r" ON (("r"."id" = "oi"."route_id")))
  GROUP BY "oi"."route_id", "oi"."vehicle_id", "v"."operator_id", "oi"."departure_date", COALESCE("oi"."pickup_time", "r"."pickup_time");


ALTER VIEW "public"."v_occurrence_vehicle_stats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_operator_codes" AS
 SELECT "o"."id" AS "operator_id",
    "o"."name" AS "operator_name",
    "occ"."code",
    "occ"."issued_at"
   FROM ("public"."operators" "o"
     LEFT JOIN "public"."operator_crew_codes" "occ" ON (("occ"."operator_id" = "o"."id")));


ALTER VIEW "public"."v_operator_codes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_operator_journey_load" WITH ("security_invoker"='on') AS
 SELECT "jv"."operator_id",
    "jv"."route_id",
    "jv"."journey_date",
    "jv"."vehicle_id",
    COALESCE("r"."route_name", "r"."name") AS "route_name",
    "pp"."name" AS "pickup_name",
    "dd"."name" AS "destination_name",
    "v"."name" AS "vehicle_name",
    (COALESCE(("jv"."seats_capacity")::numeric, ("jv"."capacity")::numeric, "v"."maxseats"))::integer AS "capacity",
    COALESCE(( SELECT ("sum"("o"."qty"))::integer AS "sum"
           FROM "public"."orders" "o"
          WHERE (("o"."route_id" = "jv"."route_id") AND ("o"."journey_date" = "jv"."journey_date") AND ("o"."status" = 'paid'::"text"))), 0) AS "paid_seats"
   FROM (((("public"."journey_vehicles" "jv"
     JOIN "public"."routes" "r" ON (("r"."id" = "jv"."route_id")))
     LEFT JOIN "public"."pickup_points" "pp" ON (("pp"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "dd" ON (("dd"."id" = "r"."destination_id")))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "jv"."vehicle_id")))
  WHERE ("jv"."status" = ANY (ARRAY['active'::"text", 'planned'::"text"]));


ALTER VIEW "public"."v_operator_journey_load" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_operator_journey_status" AS
 WITH "per_jv" AS (
         SELECT "l"."route_id",
            "l"."journey_date",
            "l"."seats_capacity",
            "l"."seats_taken"
           FROM "public"."v_journey_vehicle_load" "l"
        ), "rolled" AS (
         SELECT "per_jv"."route_id",
            "per_jv"."journey_date",
            ("sum"("per_jv"."seats_capacity"))::integer AS "capacity",
            ("sum"("per_jv"."seats_taken"))::integer AS "taken",
            ("count"(*))::integer AS "vehicles"
           FROM "per_jv"
          GROUP BY "per_jv"."route_id", "per_jv"."journey_date"
        ), "paid_any" AS (
         SELECT "orders"."route_id",
            "orders"."journey_date",
            true AS "has_paid"
           FROM "public"."orders"
          WHERE (("orders"."status" = 'paid'::"text") AND ("orders"."route_id" IS NOT NULL) AND ("orders"."journey_date" IS NOT NULL))
          GROUP BY "orders"."route_id", "orders"."journey_date"
        ), "canc" AS (
         SELECT "journey_vehicles"."route_id",
            "journey_vehicles"."journey_date",
            "bool_or"(("journey_vehicles"."status" = 'cancelled'::"text")) AS "any_cancelled"
           FROM "public"."journey_vehicles"
          GROUP BY "journey_vehicles"."route_id", "journey_vehicles"."journey_date"
        )
 SELECT "r"."route_id",
    "r"."journey_date",
    "r"."capacity",
    "r"."taken",
    ("r"."capacity" - "r"."taken") AS "free",
    "r"."vehicles",
    COALESCE("p"."has_paid", false) AS "under_consideration",
    COALESCE("c"."any_cancelled", false) AS "any_cancelled"
   FROM (("rolled" "r"
     LEFT JOIN "paid_any" "p" USING ("route_id", "journey_date"))
     LEFT JOIN "canc" "c" USING ("route_id", "journey_date"));


ALTER VIEW "public"."v_operator_journey_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_operator_occurrences_confirmed" AS
 SELECT "route_id",
    "vehicle_id",
    "operator_id",
    "departure_date",
    "pickup_time",
    "seats_sold",
    "revenue_cents",
    "minseats",
    "minvalue",
    "is_confirmed",
    "days_to_trip"
   FROM "public"."v_occurrence_vehicle_stats"
  WHERE ("is_confirmed" AND ("departure_date" >= CURRENT_DATE));


ALTER VIEW "public"."v_operator_occurrences_confirmed" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_operator_occurrences_under_consideration" AS
 SELECT "route_id",
    "vehicle_id",
    "operator_id",
    "departure_date",
    "pickup_time",
    "seats_sold",
    "revenue_cents",
    "minseats",
    "minvalue",
    "is_confirmed",
    "days_to_trip"
   FROM "public"."v_occurrence_vehicle_stats"
  WHERE ((NOT "is_confirmed") AND ("departure_date" >= CURRENT_DATE));


ALTER VIEW "public"."v_operator_occurrences_under_consideration" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_operator_staff_min" AS
 SELECT "s"."id" AS "staff_id",
    "s"."operator_id",
    "s"."user_id",
    "s"."first_name",
    "s"."last_name",
    ((TRIM(BOTH FROM COALESCE("s"."first_name", ''::"text")) || ' '::"text") || TRIM(BOTH FROM COALESCE("s"."last_name", ''::"text"))) AS "full_name",
    COALESCE("r"."role", "s"."jobrole") AS "role_label",
    "s"."type_id",
    "s"."status",
    "s"."photo_url",
    (COALESCE(("s"."status")::"text", 'Active'::"text") ~~* 'active'::"text") AS "is_active"
   FROM ("public"."operator_staff" "s"
     LEFT JOIN "public"."transport_type_roles" "r" ON (("r"."id" = "s"."role_id")))
  ORDER BY ((TRIM(BOTH FROM COALESCE("s"."first_name", ''::"text")) || ' '::"text") || TRIM(BOTH FROM COALESCE("s"."last_name", ''::"text")));


ALTER VIEW "public"."v_operator_staff_min" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_operator_unassigned_journeys" WITH ("security_invoker"='on') AS
 SELECT "vv"."operator_id",
    "o"."route_id",
    "o"."journey_date",
    COALESCE("r"."route_name", "r"."name") AS "route_name",
    "pp"."name" AS "pickup_name",
    "dd"."name" AS "destination_name",
    ("sum"("o"."qty"))::integer AS "paid_seats"
   FROM ((((("public"."orders" "o"
     JOIN "public"."routes" "r" ON (("r"."id" = "o"."route_id")))
     LEFT JOIN "public"."pickup_points" "pp" ON (("pp"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "dd" ON (("dd"."id" = "r"."destination_id")))
     JOIN "public"."route_vehicle_assignments" "rva" ON ((("rva"."route_id" = "r"."id") AND "rva"."is_active")))
     JOIN "public"."vehicles" "vv" ON (("vv"."id" = "rva"."vehicle_id")))
  WHERE (("o"."status" = 'paid'::"text") AND (NOT (EXISTS ( SELECT 1
           FROM "public"."journey_vehicles" "jv"
          WHERE (("jv"."route_id" = "o"."route_id") AND ("jv"."journey_date" = "o"."journey_date") AND ("jv"."status" = ANY (ARRAY['active'::"text", 'planned'::"text"])))))))
  GROUP BY "vv"."operator_id", "o"."route_id", "o"."journey_date", "r"."route_name", "r"."name", "pp"."name", "dd"."name";


ALTER VIEW "public"."v_operator_unassigned_journeys" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_order_history" AS
 SELECT "o"."user_id",
    "o"."id" AS "order_id",
    "o"."created_at" AS "booked_at",
    "o"."qty",
    "o"."total_cents" AS "line_total_cents",
    COALESCE("r"."route_name", "r"."name") AS "route_name",
    "pp"."name" AS "pickup_name",
    "dd"."name" AS "destination_name",
    "o"."journey_date" AS "departure_date",
    "o"."status" AS "item_status",
    "r"."transport_type"
   FROM ((("public"."orders" "o"
     LEFT JOIN "public"."routes" "r" ON (("r"."id" = "o"."route_id")))
     LEFT JOIN "public"."pickup_points" "pp" ON (("pp"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "dd" ON (("dd"."id" = "r"."destination_id")));


ALTER VIEW "public"."v_order_history" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_order_receipt" AS
 SELECT "o"."id" AS "order_id",
    "o"."created_at",
    "o"."route_id",
    "o"."journey_date",
    "o"."qty",
    "o"."currency",
    "o"."base_amount_c",
    "o"."tax_amount_c",
    "o"."fee_amount_c",
    "o"."commission_amount_c",
    "o"."total_amount_c",
    "r"."route_name",
    "r"."pickup_time",
    "r"."approx_duration_mins",
    "r"."pickup_id",
    "r"."destination_id",
    "pu"."name" AS "pickup_name",
    "de"."name" AS "destination_name"
   FROM ((("public"."orders" "o"
     LEFT JOIN "public"."routes" "r" ON (("r"."id" = "o"."route_id")))
     LEFT JOIN "public"."pickup_points" "pu" ON (("pu"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "de" ON (("de"."id" = "r"."destination_id")));


ALTER VIEW "public"."v_order_receipt" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_route_legs" AS
 SELECT "r"."id" AS "route_id",
    COALESCE("r"."route_name", "r"."name") AS "route_name",
    "pu"."name" AS "pickup_name",
    "de"."name" AS "destination_name"
   FROM (("public"."routes" "r"
     LEFT JOIN "public"."pickup_points" "pu" ON (("pu"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "de" ON (("de"."id" = "r"."destination_id")));


ALTER VIEW "public"."v_route_legs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_vehicle_names" AS
 SELECT "id" AS "vehicle_id",
    "name" AS "vehicle_name",
    COALESCE(NULLIF(("maxseats")::integer, 0), 0) AS "capacity",
    "operator_id"
   FROM "public"."vehicles" "v";


ALTER VIEW "public"."v_vehicle_names" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_allocations" (
    "route_id" "uuid" NOT NULL,
    "ymd" "date" NOT NULL,
    "party_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vehicle_allocations" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_route_day_capacity" AS
 WITH "caps" AS (
         SELECT "j"."route_id",
            "date"("j"."departure_ts") AS "ymd",
            ("sum"(COALESCE("v"."maxseats", (0)::numeric)))::integer AS "cap"
           FROM ("public"."journeys" "j"
             JOIN "public"."vehicles" "v" ON (("v"."id" = "j"."vehicle_id")))
          WHERE ("j"."is_active" = true)
          GROUP BY "j"."route_id", ("date"("j"."departure_ts"))
        ), "sold" AS (
         SELECT "o"."route_id",
            "o"."journey_date" AS "ymd",
            ("sum"(COALESCE("o"."qty", 0)))::integer AS "sold"
           FROM "public"."orders" "o"
          WHERE ("o"."status" = 'paid'::"text")
          GROUP BY "o"."route_id", "o"."journey_date"
        )
 SELECT "c"."route_id",
    "c"."ymd",
    "c"."cap",
    COALESCE("s"."sold", 0) AS "sold",
    GREATEST(("c"."cap" - COALESCE("s"."sold", 0)), 0) AS "remaining"
   FROM ("caps" "c"
     LEFT JOIN "sold" "s" ON ((("s"."route_id" = "c"."route_id") AND ("s"."ymd" = "c"."ymd"))));


ALTER VIEW "public"."vw_route_day_capacity" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_capacity_next_14d" AS
 SELECT "c"."route_id",
    "r"."route_name",
    "r"."pickup_time",
    "pu"."id" AS "pickup_id",
    "pu"."name" AS "pickup_name",
    "de"."id" AS "destination_id",
    "de"."name" AS "destination_name",
    "c"."ymd",
    "c"."cap",
    "c"."sold",
    "c"."remaining",
    ("c"."remaining" <= 0) AS "is_sold_out",
    (("c"."remaining" > 0) AND ("c"."remaining" <= 5)) AS "is_low_seats"
   FROM ((("public"."vw_route_day_capacity" "c"
     JOIN "public"."routes" "r" ON (("r"."id" = "c"."route_id")))
     LEFT JOIN "public"."pickup_points" "pu" ON (("pu"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "de" ON (("de"."id" = "r"."destination_id")))
  WHERE (("c"."ymd" >= CURRENT_DATE) AND ("c"."ymd" < ((CURRENT_DATE + '14 days'::interval))::"date"))
  ORDER BY "c"."ymd", "r"."pickup_time", "pu"."name", "de"."name";


ALTER VIEW "public"."vw_admin_capacity_next_14d" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journey_capacity" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "c"."cap",
    "c"."sold",
    "c"."remaining"
   FROM ("public"."journeys" "j"
     LEFT JOIN "public"."vw_route_day_capacity" "c" ON ((("c"."route_id" = "j"."route_id") AND ("c"."ymd" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"))));


ALTER VIEW "public"."vw_admin_journey_capacity" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journey_headcounts" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "j"."departure_ts",
    "count"(DISTINCT "o"."id") AS "orders_count",
    (COALESCE("sum"("o"."qty"), (0)::bigint))::integer AS "pax_count",
    COALESCE("cap"."remaining", 0) AS "remaining",
    (COALESCE("cap"."remaining", 0) <= 0) AS "sold_out",
    "jsonb_agg"("jsonb_build_object"('order_id', "o"."id", 'qty', "o"."qty", 'lead?', (EXISTS ( SELECT 1
           FROM "public"."order_passengers" "op"
          WHERE (("op"."order_id" = "o"."id") AND "op"."is_lead")))) ORDER BY "o"."qty" DESC NULLS LAST, "o"."id") FILTER (WHERE ("o"."id" IS NOT NULL)) AS "groups"
   FROM (("public"."journeys" "j"
     LEFT JOIN "public"."orders" "o" ON ((("o"."route_id" = "j"."route_id") AND ("o"."journey_date" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date") AND ("o"."status" = 'paid'::"text"))))
     LEFT JOIN "public"."vw_route_day_capacity" "cap" ON ((("cap"."route_id" = "j"."route_id") AND ("cap"."ymd" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"))))
  GROUP BY "j"."id", "j"."route_id", "cap"."ymd", "j"."departure_ts", "cap"."remaining"
  ORDER BY "j"."departure_ts";


ALTER VIEW "public"."vw_admin_journey_headcounts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journey_headcounts_t24" AS
 SELECT "journey_id",
    "route_id",
    "ymd",
    "departure_ts",
    "orders_count",
    "pax_count",
    "remaining",
    "sold_out",
    "groups"
   FROM "public"."vw_admin_journey_headcounts"
  WHERE (("departure_ts" >= "now"()) AND ("departure_ts" < ("now"() + '24:00:00'::interval)))
  ORDER BY "departure_ts";


ALTER VIEW "public"."vw_admin_journey_headcounts_t24" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journey_headcounts_t72" AS
 SELECT "journey_id",
    "route_id",
    "ymd",
    "departure_ts",
    "orders_count",
    "pax_count",
    "remaining",
    "sold_out",
    "groups"
   FROM "public"."vw_admin_journey_headcounts"
  WHERE (("departure_ts" >= "now"()) AND ("departure_ts" < ("now"() + '72:00:00'::interval)))
  ORDER BY "departure_ts";


ALTER VIEW "public"."vw_admin_journey_headcounts_t72" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journey_manifest" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "o"."id" AS "order_id",
    COALESCE((("lead"."first_name" || ' '::"text") || "lead"."last_name"), 'Lead passenger'::"text") AS "lead_name",
    "o"."qty" AS "party_size",
    "count"("p"."id") AS "passengers_listed",
    GREATEST(("o"."qty" - "count"("p"."id")), (0)::bigint) AS "unlisted_passengers"
   FROM ((("public"."journeys" "j"
     JOIN "public"."orders" "o" ON ((("o"."route_id" = "j"."route_id") AND ("o"."journey_date" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date") AND ("o"."status" = 'paid'::"text"))))
     LEFT JOIN "public"."order_passengers" "p" ON (("p"."order_id" = "o"."id")))
     LEFT JOIN LATERAL ( SELECT "op"."first_name",
            "op"."last_name"
           FROM "public"."order_passengers" "op"
          WHERE (("op"."order_id" = "o"."id") AND ("op"."is_lead" = true))
         LIMIT 1) "lead" ON (true))
  GROUP BY "j"."id", "j"."route_id", ((("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"), "o"."id", "lead"."first_name", "lead"."last_name", "o"."qty";


ALTER VIEW "public"."vw_admin_journey_manifest" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journey_manifest_v2" AS
 SELECT "o"."route_id" AS "journey_id",
    "o"."journey_date" AS "ymd",
    "r"."pickup_time",
    ("o"."journey_date" + COALESCE("r"."pickup_time", '00:00:00'::time without time zone)) AS "departure_ts",
    "r"."pickup_id",
    "pu"."name" AS "pickup_name",
    "r"."destination_id",
    "de"."name" AS "destination_name",
    "o"."id" AS "order_id",
    "op"."id" AS "passenger_id",
    COALESCE("op"."first_name", '—'::"text") AS "first_name",
    COALESCE("op"."last_name", '—'::"text") AS "last_name",
    COALESCE("op"."is_lead", false) AS "is_lead"
   FROM (((("public"."orders" "o"
     JOIN "public"."routes" "r" ON (("r"."id" = "o"."route_id")))
     LEFT JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "o"."id")))
     LEFT JOIN "public"."pickup_points" "pu" ON (("pu"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "de" ON (("de"."id" = "r"."destination_id")))
  WHERE ("o"."status" = 'paid'::"text");


ALTER VIEW "public"."vw_admin_journey_manifest_v2" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journey_overview" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "j"."departure_ts",
    ((COALESCE("pp"."name", '?'::"text") || ' → '::"text") || COALESCE("dd"."name", '?'::"text")) AS "route_label",
    COALESCE("v"."cap", 0) AS "cap",
    GREATEST((COALESCE("v"."cap", 0) - COALESCE("v"."remaining", 0)), 0) AS "sold",
    COALESCE("v"."remaining", 0) AS "remaining",
    (COALESCE("v"."remaining", 0) <= 0) AS "is_sold_out",
    ((COALESCE("v"."remaining", 0) > 0) AND (COALESCE("v"."remaining", 0) <= 5)) AS "is_low_seats",
    ('/admin/manifest?journey_id='::"text" || "j"."id") AS "manifest_url",
    ('/admin/journey/'::"text" || "j"."id") AS "journey_url"
   FROM (((("public"."journeys" "j"
     JOIN "public"."routes" "r" ON (("r"."id" = "j"."route_id")))
     LEFT JOIN "public"."pickup_points" "pp" ON (("pp"."id" = "r"."pickup_id")))
     LEFT JOIN "public"."destinations" "dd" ON (("dd"."id" = "r"."destination_id")))
     LEFT JOIN "public"."vw_route_day_capacity" "v" ON ((("v"."route_id" = "j"."route_id") AND ("v"."ymd" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"))))
  ORDER BY "j"."departure_ts";


ALTER VIEW "public"."vw_admin_journey_overview" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_groups" AS
 WITH "agg" AS (
         SELECT "m"."journey_id",
            ("count"(*))::integer AS "pax_count",
            ("count"(*) FILTER (WHERE "m"."is_lead"))::integer AS "lead_count",
            ("count"(*) FILTER (WHERE (NOT "m"."is_lead")))::integer AS "nonlead_count"
           FROM "public"."journey_order_manifest" "m"
          GROUP BY "m"."journey_id"
        )
 SELECT "a"."journey_id",
    "j"."route_id",
    "j"."departure_ts",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "a"."pax_count",
    "a"."lead_count",
    "a"."nonlead_count",
    ((("a"."lead_count")::numeric + "ceil"(((GREATEST(("a"."nonlead_count" - "a"."lead_count"), 0))::numeric / (4)::numeric))))::integer AS "estimated_groups"
   FROM ("agg" "a"
     JOIN "public"."journeys" "j" ON (("j"."id" = "a"."journey_id")));


ALTER VIEW "public"."vw_journey_groups" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_route_day_groups" AS
 SELECT "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    ("sum"("g"."pax_count"))::integer AS "pax_count",
    ("sum"("g"."lead_count"))::integer AS "lead_count",
    ("sum"("g"."nonlead_count"))::integer AS "nonlead_count",
    ("sum"("g"."estimated_groups"))::integer AS "estimated_groups",
    "c"."cap",
        CASE
            WHEN (("c"."cap" IS NULL) OR ("c"."remaining" IS NULL)) THEN NULL::integer
            ELSE ("c"."cap" - "c"."remaining")
        END AS "used",
    "c"."remaining"
   FROM (("public"."vw_journey_groups" "g"
     JOIN "public"."journeys" "j" ON (("j"."id" = "g"."journey_id")))
     LEFT JOIN "public"."vw_route_day_capacity" "c" ON ((("c"."route_id" = "j"."route_id") AND ("c"."ymd" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"))))
  GROUP BY "j"."route_id", ((("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"), "c"."cap", "c"."remaining";


ALTER VIEW "public"."vw_route_day_groups" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_journeys_day" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "j"."departure_ts",
    "r"."country_id",
    "r"."pickup_id",
    "r"."destination_id",
    "r"."route_name",
    "r"."pickup_time",
    "r"."approx_duration_mins",
    "g"."pax_count",
    "g"."lead_count",
    "g"."nonlead_count",
    "g"."estimated_groups",
    "g"."cap",
    "g"."used",
    "g"."remaining",
    ("g"."remaining" <= 0) AS "sold_out"
   FROM (("public"."journeys" "j"
     JOIN "public"."routes" "r" ON (("r"."id" = "j"."route_id")))
     LEFT JOIN "public"."vw_route_day_groups" "g" ON ((("g"."route_id" = "j"."route_id") AND ("g"."ymd" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"))));


ALTER VIEW "public"."vw_admin_journeys_day" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_manifest" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "j"."departure_ts",
    "o"."id" AS "order_id",
    COALESCE("o"."qty", 0) AS "party_size",
    COALESCE("string_agg"(NULLIF(TRIM(BOTH FROM (("op"."first_name" || ' '::"text") || "op"."last_name")), ''::"text"), ', '::"text" ORDER BY "op"."is_lead" DESC, "op"."last_name", "op"."first_name"), '(names pending)'::"text") AS "passenger_names",
    ("count"("op"."id") FILTER (WHERE "op"."is_lead") > 0) AS "has_lead_passenger",
    ("count"("op"."id") = COALESCE("o"."qty", 0)) AS "names_complete"
   FROM ((("public"."journeys" "j"
     JOIN "public"."routes" "r" ON (("r"."id" = "j"."route_id")))
     JOIN "public"."orders" "o" ON ((("o"."route_id" = "j"."route_id") AND ("o"."journey_date" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date") AND ("o"."status" = 'paid'::"text"))))
     LEFT JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "o"."id")))
  GROUP BY "j"."id", "j"."route_id", "j"."departure_ts", "o"."id", "o"."qty"
  ORDER BY "j"."departure_ts", "o"."id";


ALTER VIEW "public"."vw_admin_manifest" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_manifest_passengers" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "j"."departure_ts",
    "o"."id" AS "order_id",
    "op"."id" AS "passenger_id",
    NULLIF(TRIM(BOTH FROM (("op"."first_name" || ' '::"text") || "op"."last_name")), ''::"text") AS "passenger_name",
    "op"."is_lead",
    "row_number"() OVER (PARTITION BY "o"."id" ORDER BY "op"."is_lead" DESC, "op"."last_name", "op"."first_name", "op"."id") AS "party_pos"
   FROM (("public"."journeys" "j"
     JOIN "public"."orders" "o" ON ((("o"."route_id" = "j"."route_id") AND ("o"."journey_date" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date") AND ("o"."status" = 'paid'::"text"))))
     LEFT JOIN "public"."order_passengers" "op" ON (("op"."order_id" = "o"."id")))
  ORDER BY "j"."departure_ts", "o"."id", ("row_number"() OVER (PARTITION BY "o"."id" ORDER BY "op"."is_lead" DESC, "op"."last_name", "op"."first_name", "op"."id"));


ALTER VIEW "public"."vw_admin_manifest_passengers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_manifest_t24" AS
 SELECT "journey_id",
    "ymd",
    "pickup_time",
    "departure_ts",
    "pickup_id",
    "pickup_name",
    "destination_id",
    "destination_name",
    "order_id",
    "passenger_id",
    "first_name",
    "last_name",
    "is_lead"
   FROM "public"."vw_admin_journey_manifest_v2" "jm"
  WHERE (("departure_ts" >= ("now"() AT TIME ZONE 'UTC'::"text")) AND ("departure_ts" < (("now"() AT TIME ZONE 'UTC'::"text") + '24:00:00'::interval)));


ALTER VIEW "public"."vw_admin_manifest_t24" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_manifest_t72" AS
 SELECT "journey_id",
    "ymd",
    "pickup_time",
    "departure_ts",
    "pickup_id",
    "pickup_name",
    "destination_id",
    "destination_name",
    "order_id",
    "passenger_id",
    "first_name",
    "last_name",
    "is_lead"
   FROM "public"."vw_admin_journey_manifest_v2" "jm"
  WHERE (("departure_ts" >= ("now"() AT TIME ZONE 'UTC'::"text")) AND ("departure_ts" < (("now"() AT TIME ZONE 'UTC'::"text") + '72:00:00'::interval)));


ALTER VIEW "public"."vw_admin_manifest_t72" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_booked_seats_by_route_day" AS
 SELECT "j"."route_id",
    ("j"."departure_ts")::"date" AS "ymd",
    (COALESCE("sum"("m"."seats"), (0)::bigint))::integer AS "sold"
   FROM ("public"."journey_manifest" "m"
     JOIN "public"."journeys" "j" ON (("j"."id" = "m"."journey_id")))
  GROUP BY "j"."route_id", (("j"."departure_ts")::"date");


ALTER VIEW "public"."vw_booked_seats_by_route_day" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_booked_seats_by_route_day_fixed" AS
 SELECT "j"."route_id",
    ("j"."departure_ts")::"date" AS "ymd",
    ("sum"("b"."seats"))::integer AS "sold"
   FROM ("public"."bookings" "b"
     JOIN "public"."journeys" "j" ON (("b"."journey_id" = "j"."id")))
  WHERE ("b"."paid_at" IS NOT NULL)
  GROUP BY "j"."route_id", (("j"."departure_ts")::"date");


ALTER VIEW "public"."vw_booked_seats_by_route_day_fixed" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_booking_seat_counts_by_vehicle" AS
 SELECT "journey_id",
    "vehicle_id",
    ("sum"("seats"))::integer AS "seats"
   FROM "public"."journey_vehicle_allocs"
  GROUP BY "journey_id", "vehicle_id";


ALTER VIEW "public"."vw_booking_seat_counts_by_vehicle" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_groups_by_journey" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    ("j"."departure_ts")::"date" AS "ymd",
    COALESCE("jsonb_agg"("o"."qty" ORDER BY "o"."qty" DESC) FILTER (WHERE ("o"."qty" IS NOT NULL)), '[]'::"jsonb") AS "groups",
    (COALESCE("sum"("o"."qty"), (0)::bigint))::integer AS "total_pax"
   FROM ("public"."journeys" "j"
     LEFT JOIN "public"."orders" "o" ON ((("o"."route_id" = "j"."route_id") AND ("o"."journey_date" = ("j"."departure_ts")::"date"))))
  GROUP BY "j"."id", "j"."route_id", (("j"."departure_ts")::"date");


ALTER VIEW "public"."vw_groups_by_journey" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_group_manifest" AS
 WITH "ranked" AS (
         SELECT "m"."journey_id",
            "m"."first_name",
            "m"."last_name",
            "m"."is_lead",
            "row_number"() OVER (PARTITION BY "m"."journey_id" ORDER BY
                CASE
                    WHEN "m"."is_lead" THEN 0
                    ELSE 1
                END, "m"."first_name", "m"."last_name") AS "rn",
            "sum"(
                CASE
                    WHEN "m"."is_lead" THEN 1
                    ELSE 0
                END) OVER (PARTITION BY "m"."journey_id" ORDER BY
                CASE
                    WHEN "m"."is_lead" THEN 0
                    ELSE 1
                END, "m"."first_name", "m"."last_name" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "party_no"
           FROM "public"."journey_order_manifest" "m"
        )
 SELECT "journey_id",
    "party_no",
    "count"(*) AS "party_size",
    "max"(
        CASE
            WHEN "is_lead" THEN "first_name"
            ELSE NULL::"text"
        END) AS "lead_first_name",
    "max"(
        CASE
            WHEN "is_lead" THEN "last_name"
            ELSE NULL::"text"
        END) AS "lead_last_name",
    "string_agg"((("first_name" || ' '::"text") || "last_name"), ', '::"text" ORDER BY
        CASE
            WHEN "is_lead" THEN 0
            ELSE 1
        END, "last_name", "first_name") AS "passengers"
   FROM "ranked"
  GROUP BY "journey_id", "party_no"
  ORDER BY "journey_id", "party_no";


ALTER VIEW "public"."vw_journey_group_manifest" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_group_sizes" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "o"."id" AS "order_id",
    (COALESCE(NULLIF("count"("p"."id"), 0), ("o"."qty")::bigint))::integer AS "party_size",
    COALESCE("max"(
        CASE
            WHEN "p"."is_lead" THEN ((COALESCE("p"."first_name", ''::"text") || ' '::"text") || COALESCE("p"."last_name", ''::"text"))
            ELSE NULL::"text"
        END), "max"(((COALESCE("p"."first_name", ''::"text") || ' '::"text") || COALESCE("p"."last_name", ''::"text"))), NULL::"text") AS "lead_name",
    "o"."created_at" AS "booked_at"
   FROM (("public"."journeys" "j"
     JOIN "public"."orders" "o" ON ((("o"."route_id" = "j"."route_id") AND ("o"."journey_date" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date") AND ("o"."status" = 'paid'::"text"))))
     LEFT JOIN "public"."order_passengers" "p" ON (("p"."order_id" = "o"."id")))
  GROUP BY "j"."id", "j"."route_id", ((("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"), "o"."id", "o"."qty", "o"."created_at";


ALTER VIEW "public"."vw_journey_group_sizes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_manifest" AS
 WITH "orders_paid" AS (
         SELECT "o"."id" AS "order_id",
            "o"."route_id",
            "o"."journey_date" AS "ymd",
            "o"."qty",
            "o"."created_at" AS "booked_at"
           FROM "public"."orders" "o"
          WHERE ("o"."status" = 'paid'::"text")
        ), "journeys_norm" AS (
         SELECT "j"."id" AS "journey_id",
            "j"."route_id",
            (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
            "j"."departure_ts"
           FROM "public"."journeys" "j"
        ), "ord_x_journey" AS (
         SELECT "j"."journey_id",
            "j"."route_id",
            "j"."ymd",
            "j"."departure_ts",
            "op"."order_id",
            "op"."qty",
            "op"."booked_at"
           FROM ("journeys_norm" "j"
             JOIN "orders_paid" "op" ON ((("op"."route_id" = "j"."route_id") AND ("op"."ymd" = "j"."ymd"))))
        ), "orders_with_pcount" AS (
         SELECT "o"."order_id",
            "count"("p"."id") AS "passenger_count"
           FROM ("orders_paid" "o"
             LEFT JOIN "public"."order_passengers" "p" ON (("p"."order_id" = "o"."order_id")))
          GROUP BY "o"."order_id"
        )
 SELECT "x"."journey_id",
    "x"."route_id",
    "x"."ymd",
    "x"."departure_ts",
    "x"."order_id",
    "p"."id" AS "passenger_id",
    "p"."is_lead",
    COALESCE(NULLIF(TRIM(BOTH FROM "p"."first_name"), ''::"text"), 'Passenger'::"text") AS "first_name",
    NULLIF(TRIM(BOTH FROM "p"."last_name"), ''::"text") AS "last_name",
    "x"."qty" AS "party_size",
    "x"."booked_at"
   FROM (("ord_x_journey" "x"
     JOIN "orders_with_pcount" "pc" ON (("pc"."order_id" = "x"."order_id")))
     JOIN "public"."order_passengers" "p" ON (("p"."order_id" = "x"."order_id")))
  WHERE ("pc"."passenger_count" > 0)
UNION ALL
 SELECT "x"."journey_id",
    "x"."route_id",
    "x"."ymd",
    "x"."departure_ts",
    "x"."order_id",
    NULL::"uuid" AS "passenger_id",
    ("gs"."n" = 1) AS "is_lead",
    'Passenger'::"text" AS "first_name",
    ("gs"."n")::"text" AS "last_name",
    "x"."qty" AS "party_size",
    "x"."booked_at"
   FROM (("ord_x_journey" "x"
     JOIN "orders_with_pcount" "pc" ON (("pc"."order_id" = "x"."order_id")))
     JOIN LATERAL "generate_series"(1, COALESCE("x"."qty", 0)) "gs"("n") ON (true))
  WHERE ("pc"."passenger_count" = 0);


ALTER VIEW "public"."vw_journey_manifest" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_manifest_with_vehicle" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    ("j"."departure_ts")::"date" AS "ymd",
    "j"."departure_ts",
    NULL::"uuid" AS "booking_id",
    "va"."vehicle_id",
    "v"."name" AS "vehicle_name",
    "m"."first_name",
    "m"."last_name",
    "m"."is_lead",
    "row_number"() OVER (PARTITION BY "j"."id" ORDER BY
        CASE
            WHEN "m"."is_lead" THEN 0
            ELSE 1
        END, "m"."first_name", "m"."last_name") AS "pax_seq",
    "count"(*) OVER (PARTITION BY "j"."id") AS "party_size"
   FROM ((("public"."journeys" "j"
     JOIN "public"."journey_order_manifest" "m" ON (("m"."journey_id" = "j"."id")))
     LEFT JOIN LATERAL ( SELECT "va2"."vehicle_id"
           FROM "public"."vehicle_allocations" "va2"
          WHERE (("va2"."route_id" = "j"."route_id") AND ("va2"."ymd" = ("j"."departure_ts")::"date"))
          ORDER BY "va2"."created_at"
         LIMIT 1) "va" ON (true))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "va"."vehicle_id")));


ALTER VIEW "public"."vw_journey_manifest_with_vehicle" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_passenger_manifest" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date" AS "ymd",
    "o"."id" AS "order_id",
    "o"."qty" AS "order_qty",
    "p"."id" AS "passenger_id",
    ((COALESCE("p"."first_name", ''::"text") || ' '::"text") || COALESCE("p"."last_name", ''::"text")) AS "passenger_name",
    "p"."is_lead"
   FROM (("public"."journeys" "j"
     JOIN "public"."orders" "o" ON ((("o"."route_id" = "j"."route_id") AND ("o"."journey_date" = (("j"."departure_ts" AT TIME ZONE 'UTC'::"text"))::"date") AND ("o"."status" = 'paid'::"text"))))
     LEFT JOIN "public"."order_passengers" "p" ON (("p"."order_id" = "o"."id")));


ALTER VIEW "public"."vw_journey_passenger_manifest" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_vehicle_capacity" AS
 WITH "j" AS (
         SELECT "j_1"."id" AS "journey_id",
            "j_1"."route_id",
            (("j_1"."departure_ts" AT TIME ZONE COALESCE("c"."timezone", 'UTC'::"text")))::"date" AS "ymd"
           FROM (("public"."journeys" "j_1"
             LEFT JOIN "public"."routes" "r" ON (("r"."id" = "j_1"."route_id")))
             LEFT JOIN "public"."countries" "c" ON (("c"."id" = "r"."country_id")))
        )
 SELECT "j"."journey_id",
    "j"."route_id",
    "j"."ymd",
    "a"."vehicle_id",
    COALESCE((NULLIF("v"."maxseats", (0)::numeric))::integer, 0) AS "cap"
   FROM (("j"
     JOIN "public"."route_vehicle_assignments" "a" ON ((("a"."route_id" = "j"."route_id") AND ("a"."is_active" = true))))
     JOIN "public"."vehicles" "v" ON ((("v"."id" = "a"."vehicle_id") AND ("v"."active" = true))));


ALTER VIEW "public"."vw_journey_vehicle_capacity" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_journey_vehicle_remaining" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    "date"("j"."departure_ts") AS "ymd",
    "v"."id" AS "vehicle_id",
    "v"."name" AS "vehicle_name",
    "v"."operator_id",
    (COALESCE(NULLIF(TRIM(BOTH FROM ("v"."maxseats")::"text"), ''::"text"), '0'::"text"))::integer AS "max_seats",
    (COALESCE(NULLIF(TRIM(BOTH FROM ("v"."minseats")::"text"), ''::"text"), '0'::"text"))::integer AS "min_seats",
    "rva"."preferred",
    COALESCE(( SELECT ("sum"("o"."qty"))::integer AS "sum"
           FROM ("public"."journey_allocations" "ja"
             JOIN "public"."orders" "o" ON (("o"."id" = "ja"."order_id")))
          WHERE (("ja"."journey_id" = "j"."id") AND ("ja"."vehicle_id" = "v"."id"))), 0) AS "allocated",
    GREATEST(((COALESCE(NULLIF(TRIM(BOTH FROM ("v"."maxseats")::"text"), ''::"text"), '0'::"text"))::integer - COALESCE(( SELECT ("sum"("o"."qty"))::integer AS "sum"
           FROM ("public"."journey_allocations" "ja"
             JOIN "public"."orders" "o" ON (("o"."id" = "ja"."order_id")))
          WHERE (("ja"."journey_id" = "j"."id") AND ("ja"."vehicle_id" = "v"."id"))), 0)), 0) AS "remaining"
   FROM (("public"."journeys" "j"
     JOIN "public"."route_vehicle_assignments" "rva" ON ((("rva"."route_id" = "j"."route_id") AND ("rva"."is_active" = true))))
     JOIN "public"."vehicles" "v" ON ((("v"."id" = "rva"."vehicle_id") AND (COALESCE("v"."active", true) = true))));


ALTER VIEW "public"."vw_journey_vehicle_remaining" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_manifest_journey_passengers" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    "j"."departure_ts",
    ("j"."departure_ts")::"date" AS "ymd",
    "m"."first_name",
    "m"."last_name",
    "m"."is_lead"
   FROM ("public"."journeys" "j"
     JOIN "public"."journey_order_manifest" "m" ON (("m"."journey_id" = "j"."id")));


ALTER VIEW "public"."vw_manifest_journey_passengers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_manifest_journey_summary" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    "j"."departure_ts",
    ("j"."departure_ts")::"date" AS "ymd",
    "count"("m".*) AS "pax_count",
    "count"(*) FILTER (WHERE "m"."is_lead") AS "lead_count",
    "count"(*) FILTER (WHERE (NOT "m"."is_lead")) AS "nonlead_count",
        CASE
            WHEN ("count"("m".*) = 0) THEN (0)::bigint
            WHEN ("count"(*) FILTER (WHERE "m"."is_lead") > 0) THEN "count"(*) FILTER (WHERE "m"."is_lead")
            ELSE (1)::bigint
        END AS "estimated_groups"
   FROM ("public"."journeys" "j"
     LEFT JOIN "public"."journey_order_manifest" "m" ON (("m"."journey_id" = "j"."id")))
  GROUP BY "j"."id", "j"."route_id", "j"."departure_ts";


ALTER VIEW "public"."vw_manifest_journey_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_manifest_passengers" AS
 SELECT "op"."order_id",
    "o"."route_id",
    "o"."journey_date",
    "op"."first_name",
    "op"."last_name",
    "op"."is_lead",
        CASE
            WHEN "op"."is_lead" THEN "o"."lead_email"
            ELSE NULL::"text"
        END AS "email",
        CASE
            WHEN "op"."is_lead" THEN "o"."lead_phone"
            ELSE NULL::"text"
        END AS "phone"
   FROM ("public"."order_passengers" "op"
     JOIN "public"."orders" "o" ON (("o"."id" = "op"."order_id")))
  WHERE ("o"."status" = 'paid'::"text");


ALTER VIEW "public"."vw_manifest_passengers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_paid_seats_by_route_date" AS
 WITH "paid_orders" AS (
         SELECT "orders"."route_id",
            "orders"."journey_date",
            COALESCE("sum"("orders"."qty"), (0)::bigint) AS "seats_paid"
           FROM "public"."orders"
          WHERE (("orders"."status" = 'paid'::"text") AND ("orders"."route_id" IS NOT NULL) AND ("orders"."journey_date" IS NOT NULL))
          GROUP BY "orders"."route_id", "orders"."journey_date"
        )
 SELECT "route_id",
    "journey_date",
    "seats_paid"
   FROM "paid_orders";


ALTER VIEW "public"."vw_paid_seats_by_route_date" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_per_boat_allocations" AS
 SELECT "rdc"."route_id",
    "rdc"."ymd",
    "x"."vehicle_id",
    "x"."vehicle_name",
    "x"."preferred",
    "x"."cap",
    "x"."used",
    "x"."remaining",
    "x"."groups"
   FROM ("public"."vw_route_day_capacity" "rdc"
     CROSS JOIN LATERAL "pace"."allocate_parties_to_boats"("rdc"."route_id", "rdc"."ymd") "x"("route_id", "ymd", "vehicle_id", "vehicle_name", "preferred", "cap", "used", "remaining", "groups"))
  WHERE true;


ALTER VIEW "public"."vw_per_boat_allocations" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_route_capacity" AS
 SELECT "rva"."route_id",
    COALESCE("sum"(COALESCE(NULLIF(("v"."maxseats")::integer, 0), 0)), (0)::bigint) AS "total_cap"
   FROM ("public"."route_vehicle_assignments" "rva"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "rva"."vehicle_id")))
  WHERE (("rva"."is_active" = true) AND ("v"."active" = true))
  GROUP BY "rva"."route_id";


ALTER VIEW "public"."vw_route_capacity" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_remaining_by_route_date" AS
 SELECT "p"."route_id",
    "p"."journey_date",
    "cap"."total_cap",
    "p"."seats_paid",
    GREATEST(("cap"."total_cap" - "p"."seats_paid"), (0)::bigint) AS "remaining",
    ("cap"."total_cap" <= "p"."seats_paid") AS "sold_out"
   FROM ("public"."vw_paid_seats_by_route_date" "p"
     JOIN "public"."vw_route_capacity" "cap" ON (("cap"."route_id" = "p"."route_id")));


ALTER VIEW "public"."vw_remaining_by_route_date" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_route_day_capacity_fixed" AS
 SELECT "base"."route_id",
    "base"."ymd",
    "base"."cap",
    COALESCE("s"."sold", 0) AS "sold",
    GREATEST(("base"."cap" - COALESCE("s"."sold", 0)), 0) AS "remaining"
   FROM ("public"."vw_route_day_capacity" "base"
     LEFT JOIN "public"."vw_booked_seats_by_route_day" "s" ON ((("s"."route_id" = "base"."route_id") AND ("s"."ymd" = "base"."ymd"))));


ALTER VIEW "public"."vw_route_day_capacity_fixed" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_seat_counts_by_vehicle" AS
 SELECT "j"."id" AS "journey_id",
    "j"."route_id",
    ("j"."departure_ts")::"date" AS "ymd",
    "b"."vehicle_id",
    "v"."name" AS "vehicle_name",
    ("sum"(COALESCE("b"."seats", 0)))::integer AS "seats"
   FROM (("public"."bookings" "b"
     JOIN "public"."journeys" "j" ON (("j"."id" = "b"."journey_id")))
     JOIN "public"."vehicles" "v" ON (("v"."id" = "b"."vehicle_id")))
  GROUP BY "j"."id", "j"."route_id", (("j"."departure_ts")::"date"), "b"."vehicle_id", "v"."name";


ALTER VIEW "public"."vw_seat_counts_by_vehicle" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_soldout_keys" AS
 SELECT DISTINCT "route_id",
    "ymd" AS "journey_date"
   FROM "public"."vw_route_day_capacity"
  WHERE ("remaining" <= 0);


ALTER VIEW "public"."vw_soldout_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wl_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wl_asset_id" "uuid" NOT NULL,
    "start_ts" timestamp with time zone NOT NULL,
    "end_ts" timestamp with time zone NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    CONSTRAINT "wl_avail_range" CHECK (("end_ts" > "start_ts"))
);


ALTER TABLE "public"."wl_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wl_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wl_day_charter_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "processor" "text",
    "processor_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wl_payments_kind_check" CHECK (("kind" = ANY (ARRAY['deposit'::"text", 'balance'::"text", 'refund_deposit'::"text", 'refund_balance'::"text", 'damage_charge'::"text"])))
);


ALTER TABLE "public"."wl_payments" OWNER TO "postgres";


ALTER TABLE ONLY "public"."cancellation_policy_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cancellation_policy_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_flags"
    ADD CONSTRAINT "app_flags_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."app_flags"
    ADD CONSTRAINT "app_flags_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."asset_blackouts"
    ADD CONSTRAINT "asset_blackouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_cancellations"
    ADD CONSTRAINT "booking_cancellations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_seat_counts_by_vehicle_base"
    ADD CONSTRAINT "booking_seat_counts_by_vehicle_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cancellation_policies"
    ADD CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cancellation_policy_rules"
    ADD CONSTRAINT "cancellation_policy_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."captain_journey_events"
    ADD CONSTRAINT "captain_journey_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."country_timezones"
    ADD CONSTRAINT "country_timezones_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."crew_assignments"
    ADD CONSTRAINT "crew_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crew_payouts"
    ADD CONSTRAINT "crew_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."destination_arrival"
    ADD CONSTRAINT "destination_arrival_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."destination_type"
    ADD CONSTRAINT "destination_type_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."destination_types"
    ADD CONSTRAINT "destination_types_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."destination_types"
    ADD CONSTRAINT "destination_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."destinations"
    ADD CONSTRAINT "destinations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journey_allocations"
    ADD CONSTRAINT "journey_allocations_pkey" PRIMARY KEY ("journey_id", "order_id");



ALTER TABLE ONLY "public"."journey_assignments"
    ADD CONSTRAINT "journey_assignments_journey_vehicle_key" UNIQUE ("journey_id", "vehicle_id");



ALTER TABLE ONLY "public"."journey_assignments"
    ADD CONSTRAINT "journey_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journey_boats"
    ADD CONSTRAINT "journey_boats_pkey" PRIMARY KEY ("journey_id", "vehicle_id");



ALTER TABLE ONLY "public"."journey_crew_assignments"
    ADD CONSTRAINT "journey_crew_assignments_journey_id_vehicle_id_staff_id_key" UNIQUE ("journey_id", "vehicle_id", "staff_id");



ALTER TABLE ONLY "public"."journey_crew_assignments"
    ADD CONSTRAINT "journey_crew_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journey_crew"
    ADD CONSTRAINT "journey_crew_no_dupes" UNIQUE ("journey_id", "vehicle_id", "staff_id");



ALTER TABLE ONLY "public"."journey_crew"
    ADD CONSTRAINT "journey_crew_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journey_inventory"
    ADD CONSTRAINT "journey_inventory_pkey" PRIMARY KEY ("journey_id");



ALTER TABLE ONLY "public"."journey_order_allocations"
    ADD CONSTRAINT "journey_order_allocations_pkey" PRIMARY KEY ("journey_id", "vehicle_id", "order_id");



ALTER TABLE ONLY "public"."journey_passenger_allocations"
    ADD CONSTRAINT "journey_passenger_allocations_pkey" PRIMARY KEY ("journey_id", "vehicle_id", "passenger_id");



ALTER TABLE ONLY "public"."journey_types"
    ADD CONSTRAINT "journey_types_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."journey_types"
    ADD CONSTRAINT "journey_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journey_vehicle_allocations"
    ADD CONSTRAINT "journey_vehicle_allocations_pkey" PRIMARY KEY ("journey_id", "vehicle_id", "order_id");



ALTER TABLE ONLY "public"."journey_vehicle_allocs"
    ADD CONSTRAINT "journey_vehicle_allocs_pkey" PRIMARY KEY ("journey_id", "vehicle_id");



ALTER TABLE ONLY "public"."journey_vehicle_overrides"
    ADD CONSTRAINT "journey_vehicle_overrides_pkey" PRIMARY KEY ("journey_id", "vehicle_id");



ALTER TABLE ONLY "public"."journey_vehicles"
    ADD CONSTRAINT "journey_vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journey_vehicles"
    ADD CONSTRAINT "journey_vehicles_route_id_journey_date_vehicle_id_key" UNIQUE ("route_id", "journey_date", "vehicle_id");



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operator_crew_codes"
    ADD CONSTRAINT "operator_crew_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."operator_crew_codes"
    ADD CONSTRAINT "operator_crew_codes_pkey" PRIMARY KEY ("operator_id");



ALTER TABLE ONLY "public"."operator_payout_items"
    ADD CONSTRAINT "operator_payout_items_pkey" PRIMARY KEY ("payout_id", "order_item_id");



ALTER TABLE ONLY "public"."operator_payouts"
    ADD CONSTRAINT "operator_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operator_transport_types"
    ADD CONSTRAINT "operator_transport_types_pkey" PRIMARY KEY ("operator_id", "journey_type_id");



ALTER TABLE ONLY "public"."operators"
    ADD CONSTRAINT "operators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_passenger_assignments"
    ADD CONSTRAINT "order_passenger_assignments_order_passenger_id_key" UNIQUE ("order_passenger_id");



ALTER TABLE ONLY "public"."order_passenger_assignments"
    ADD CONSTRAINT "order_passenger_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_passengers"
    ADD CONSTRAINT "order_passengers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_application_places"
    ADD CONSTRAINT "partner_application_places_pkey" PRIMARY KEY ("application_id", "place_id");



ALTER TABLE ONLY "public"."partner_applications"
    ADD CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."passenger_allocations"
    ADD CONSTRAINT "passenger_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."passenger_vehicle_assignments"
    ADD CONSTRAINT "passenger_vehicle_assignments_journey_vehicle_id_order_pass_key" UNIQUE ("journey_vehicle_id", "order_passenger_id");



ALTER TABLE ONLY "public"."passenger_vehicle_assignments"
    ADD CONSTRAINT "passenger_vehicle_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."passengers"
    ADD CONSTRAINT "passengers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pickup_points"
    ADD CONSTRAINT "pickup_points_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quote_intents"
    ADD CONSTRAINT "quote_intents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."route_day_inventory"
    ADD CONSTRAINT "route_day_inventory_pkey" PRIMARY KEY ("route_id", "journey_date");



ALTER TABLE ONLY "public"."route_departures"
    ADD CONSTRAINT "route_departures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."route_durations"
    ADD CONSTRAINT "route_durations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."route_durations"
    ADD CONSTRAINT "route_durations_route_id_transport_type_id_key" UNIQUE ("route_id", "transport_type_id");



ALTER TABLE ONLY "public"."route_inventory_status"
    ADD CONSTRAINT "route_inventory_status_pkey" PRIMARY KEY ("route_id");



ALTER TABLE ONLY "public"."route_transport_metrics"
    ADD CONSTRAINT "route_transport_metrics_pkey" PRIMARY KEY ("route_id", "transport_type_id");



ALTER TABLE ONLY "public"."route_transport_types"
    ADD CONSTRAINT "route_transport_types_pkey" PRIMARY KEY ("route_id", "transport_type_id");



ALTER TABLE ONLY "public"."route_vehicle_assignments"
    ADD CONSTRAINT "route_vehicle_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."route_vehicle_assignments"
    ADD CONSTRAINT "route_vehicle_assignments_route_id_vehicle_id_key" UNIQUE ("route_id", "vehicle_id");



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journeys"
    ADD CONSTRAINT "sailings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."secrets"
    ADD CONSTRAINT "secrets_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."soldout_overrides"
    ADD CONSTRAINT "soldout_overrides_pkey" PRIMARY KEY ("route_id", "journey_date");



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_staff_id_date_key" UNIQUE ("staff_id", "date");



ALTER TABLE ONLY "public"."operator_staff"
    ADD CONSTRAINT "staff_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_role_certifications"
    ADD CONSTRAINT "staff_role_certifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_fees"
    ADD CONSTRAINT "tax_fees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tips_ledger"
    ADD CONSTRAINT "tips_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_type_places"
    ADD CONSTRAINT "transport_type_places_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_type_places"
    ADD CONSTRAINT "transport_type_places_transport_type_id_name_key" UNIQUE ("transport_type_id", "name");



ALTER TABLE ONLY "public"."transport_type_roles"
    ADD CONSTRAINT "transport_type_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_type_roles"
    ADD CONSTRAINT "transport_type_roles_transport_type_id_role_key" UNIQUE ("transport_type_id", "role");



ALTER TABLE ONLY "public"."transport_types"
    ADD CONSTRAINT "transport_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."un_countries"
    ADD CONSTRAINT "un_countries_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."route_departures"
    ADD CONSTRAINT "uq_departure" UNIQUE ("route_id", "departure_ts");



ALTER TABLE ONLY "public"."staff_role_certifications"
    ADD CONSTRAINT "uq_src_staff_type_role" UNIQUE ("staff_id", "transport_type_id", "role_id");



ALTER TABLE ONLY "public"."transport_type_roles"
    ADD CONSTRAINT "uq_ttr_type_role" UNIQUE ("transport_type_id", "role");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_allocations"
    ADD CONSTRAINT "vehicle_allocations_pkey" PRIMARY KEY ("route_id", "ymd", "party_id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wl_assets"
    ADD CONSTRAINT "wl_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wl_assets"
    ADD CONSTRAINT "wl_assets_vehicle_id_owner_operator_id_key" UNIQUE ("vehicle_id", "owner_operator_id");



ALTER TABLE ONLY "public"."wl_availability"
    ADD CONSTRAINT "wl_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wl_day_charters"
    ADD CONSTRAINT "wl_day_charters_no_overlap" EXCLUDE USING "gist" ("wl_asset_id" WITH =, "tstzrange"("start_ts", "end_ts", '[)'::"text") WITH &&) WHERE (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"])));



ALTER TABLE ONLY "public"."wl_day_charters"
    ADD CONSTRAINT "wl_day_charters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wl_payments"
    ADD CONSTRAINT "wl_payments_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "app_flags_key_unique" ON "public"."app_flags" USING "btree" ("key");



CREATE INDEX "bookings_journey_id_idx" ON "public"."bookings" USING "btree" ("journey_id");



CREATE INDEX "bookings_journey_idx" ON "public"."bookings" USING "btree" ("journey_id");



CREATE UNIQUE INDEX "bookings_order_id_uidx" ON "public"."bookings" USING "btree" ("order_id") WHERE ("order_id" IS NOT NULL);



CREATE INDEX "bookings_status_idx" ON "public"."bookings" USING "btree" ("status");



CREATE INDEX "bookings_vehicle_id_idx" ON "public"."bookings" USING "btree" ("vehicle_id");



CREATE INDEX "idx_alloc_order" ON "public"."passenger_allocations" USING "btree" ("order_id");



CREATE INDEX "idx_alloc_vehicle" ON "public"."passenger_allocations" USING "btree" ("vehicle_id");



CREATE INDEX "idx_asset_blackouts_vehicle_range" ON "public"."asset_blackouts" USING "btree" ("vehicle_id", "start_ts", "end_ts");



CREATE INDEX "idx_blackouts_vehicle_time" ON "public"."asset_blackouts" USING "btree" ("vehicle_id", "start_ts", "end_ts");



CREATE INDEX "idx_booking_cx_booking" ON "public"."booking_cancellations" USING "btree" ("booking_id");



CREATE INDEX "idx_bookings_journey_active" ON "public"."bookings" USING "btree" ("journey_id") WHERE ("status" = ANY (ARRAY['Scheduled'::"public"."booking_status", 'Complete'::"public"."booking_status"]));



CREATE INDEX "idx_bookings_vehicle_id" ON "public"."bookings" USING "btree" ("vehicle_id");



CREATE INDEX "idx_bscbv_base_journey" ON "public"."booking_seat_counts_by_vehicle_base" USING "btree" ("journey_id");



CREATE INDEX "idx_bscbv_base_vehicle" ON "public"."booking_seat_counts_by_vehicle_base" USING "btree" ("vehicle_id");



CREATE INDEX "idx_cp_staff_period" ON "public"."crew_payouts" USING "btree" ("staff_id", "period_start", "period_end");



CREATE INDEX "idx_cpr_policy_days" ON "public"."cancellation_policy_rules" USING "btree" ("policy_id", "min_days_out", COALESCE("max_days_out", 99999));



CREATE INDEX "idx_departures_route" ON "public"."route_departures" USING "btree" ("route_id");



CREATE INDEX "idx_departures_window" ON "public"."route_departures" USING "btree" ("departure_ts");



CREATE INDEX "idx_jalloc_journey" ON "public"."journey_allocations" USING "btree" ("journey_id");



CREATE INDEX "idx_jalloc_order" ON "public"."journey_allocations" USING "btree" ("order_id");



CREATE INDEX "idx_jalloc_vehicle" ON "public"."journey_allocations" USING "btree" ("vehicle_id");



CREATE INDEX "idx_jca_journey" ON "public"."journey_crew_assignments" USING "btree" ("journey_id");



CREATE INDEX "idx_jca_staff" ON "public"."journey_crew_assignments" USING "btree" ("staff_id");



CREATE INDEX "idx_jca_vehicle" ON "public"."journey_crew_assignments" USING "btree" ("vehicle_id");



CREATE INDEX "idx_jcrew_journey_state" ON "public"."journey_crew" USING "btree" ("journey_id", "state");



CREATE INDEX "idx_jcrew_journey_vehicle" ON "public"."journey_crew" USING "btree" ("journey_id", "vehicle_id");



CREATE INDEX "idx_journeys_route_ymd_utc" ON "public"."journeys" USING "btree" ("route_id", ((("departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"));



CREATE INDEX "idx_jv_route_date" ON "public"."journey_vehicles" USING "btree" ("route_id", "journey_date");



CREATE INDEX "idx_jv_vehicle" ON "public"."journey_vehicles" USING "btree" ("vehicle_id");



CREATE INDEX "idx_jva_journey" ON "public"."journey_vehicle_allocs" USING "btree" ("journey_id");



CREATE INDEX "idx_jva_vehicle" ON "public"."journey_vehicle_allocs" USING "btree" ("vehicle_id");



CREATE INDEX "idx_ledger_created" ON "public"."ledger_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ledger_oper" ON "public"."ledger_transactions" USING "btree" ("operator_id");



CREATE INDEX "idx_ledger_operator" ON "public"."ledger_transactions" USING "btree" ("operator_id", "created_at" DESC);



CREATE INDEX "idx_ledger_order" ON "public"."ledger_transactions" USING "btree" ("order_id");



CREATE INDEX "idx_ledger_user" ON "public"."ledger_transactions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_opa_jv" ON "public"."order_passenger_assignments" USING "btree" ("journey_vehicle_id");



CREATE INDEX "idx_operator_staff_user" ON "public"."operator_staff" USING "btree" ("user_id") WHERE "active";



CREATE INDEX "idx_operator_transport_types_jt" ON "public"."operator_transport_types" USING "btree" ("journey_type_id");



CREATE INDEX "idx_operator_transport_types_op" ON "public"."operator_transport_types" USING "btree" ("operator_id");



CREATE INDEX "idx_operators_country" ON "public"."operators" USING "btree" ("country_id");



CREATE INDEX "idx_order_guests_order" ON "public"."order_guests" USING "btree" ("order_id");



CREATE INDEX "idx_order_items_occ" ON "public"."order_items" USING "btree" ("route_id", "vehicle_id", "departure_date");



CREATE INDEX "idx_order_items_order" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_order_passengers_order" ON "public"."order_passengers" USING "btree" ("order_id");



CREATE INDEX "idx_orders_created_at" ON "public"."orders" USING "btree" ("created_at");



CREATE INDEX "idx_orders_route_date" ON "public"."orders" USING "btree" ("route_id", "journey_date");



CREATE INDEX "idx_orders_route_date_status" ON "public"."orders" USING "btree" ("route_id", "journey_date", "status");



CREATE INDEX "idx_orders_user" ON "public"."orders" USING "btree" ("user_id");



CREATE INDEX "idx_orders_user_created" ON "public"."orders" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_partner_apps_country" ON "public"."partner_applications" USING "btree" ("country_id");



CREATE INDEX "idx_partner_apps_desttype" ON "public"."partner_applications" USING "btree" ("destination_type_id");



CREATE INDEX "idx_partner_apps_status" ON "public"."partner_applications" USING "btree" ("status");



CREATE INDEX "idx_partner_apps_transport" ON "public"."partner_applications" USING "btree" ("transport_type_id");



CREATE INDEX "idx_partner_apps_type" ON "public"."partner_applications" USING "btree" ("application_type");



CREATE INDEX "idx_passengers_item" ON "public"."passengers" USING "btree" ("order_item_id");



CREATE INDEX "idx_payments_order" ON "public"."payments" USING "btree" ("order_id");



CREATE INDEX "idx_pickup_points_country" ON "public"."pickup_points" USING "btree" ("country_id");



CREATE INDEX "idx_pva_jv" ON "public"."passenger_vehicle_assignments" USING "btree" ("journey_vehicle_id");



CREATE INDEX "idx_pva_pax" ON "public"."passenger_vehicle_assignments" USING "btree" ("order_passenger_id");



CREATE INDEX "idx_rdi_route_date" ON "public"."route_day_inventory" USING "btree" ("route_id", "journey_date");



CREATE INDEX "idx_rdi_status_date" ON "public"."route_day_inventory" USING "btree" ("status", "journey_date");



CREATE INDEX "idx_route_durations_route" ON "public"."route_durations" USING "btree" ("route_id");



CREATE INDEX "idx_route_durations_tt" ON "public"."route_durations" USING "btree" ("transport_type_id");



CREATE INDEX "idx_route_inventory_status_status" ON "public"."route_inventory_status" USING "btree" ("status");



CREATE INDEX "idx_route_inventory_status_updated_at" ON "public"."route_inventory_status" USING "btree" ("updated_at");



CREATE INDEX "idx_routes_country" ON "public"."routes" USING "btree" ("country_id");



CREATE INDEX "idx_routes_destination" ON "public"."routes" USING "btree" ("destination_id");



CREATE INDEX "idx_routes_journey_type" ON "public"."routes" USING "btree" ("journey_type_id");



CREATE INDEX "idx_routes_pickup" ON "public"."routes" USING "btree" ("pickup_id");



CREATE INDEX "idx_rva_active" ON "public"."route_vehicle_assignments" USING "btree" ("route_id", "vehicle_id") WHERE ("is_active" = true);



CREATE INDEX "idx_rva_route" ON "public"."route_vehicle_assignments" USING "btree" ("route_id");



CREATE INDEX "idx_rva_route_pref" ON "public"."route_vehicle_assignments" USING "btree" ("route_id", "preferred");



CREATE INDEX "idx_rva_vehicle" ON "public"."route_vehicle_assignments" USING "btree" ("vehicle_id");



CREATE INDEX "idx_tl_journey" ON "public"."tips_ledger" USING "btree" ("journey_id");



CREATE INDEX "idx_txn_operator" ON "public"."transactions" USING "btree" ("operator_id");



CREATE INDEX "idx_txn_order" ON "public"."transactions" USING "btree" ("order_id");



CREATE INDEX "idx_users_operator_id" ON "public"."users" USING "btree" ("operator_id");



CREATE INDEX "idx_vehicles_active" ON "public"."vehicles" USING "btree" ("active");



CREATE INDEX "idx_vehicles_operator" ON "public"."vehicles" USING "btree" ("operator_id");



CREATE INDEX "idx_wl_avail_asset_time" ON "public"."wl_availability" USING "btree" ("wl_asset_id", "start_ts", "end_ts");



CREATE INDEX "idx_wl_day_charters_asset_range" ON "public"."wl_day_charters" USING "btree" ("wl_asset_id", "start_ts", "end_ts");



CREATE INDEX "idx_wl_dc_asset_time" ON "public"."wl_day_charters" USING "btree" ("wl_asset_id", "start_ts", "end_ts");



CREATE INDEX "idx_wl_dc_lessee" ON "public"."wl_day_charters" USING "btree" ("lessee_operator_id");



CREATE INDEX "idx_wl_payments_dc" ON "public"."wl_payments" USING "btree" ("wl_day_charter_id");



CREATE UNIQUE INDEX "journey_assignments_lead_unique" ON "public"."journey_assignments" USING "btree" ("journey_id", "vehicle_id") WHERE "is_lead";



CREATE INDEX "journey_assignments_staff_time" ON "public"."journey_assignments" USING "btree" ("staff_id", "assigned_at");



CREATE INDEX "journeys_active_idx" ON "public"."journeys" USING "btree" ("is_active");



CREATE INDEX "journeys_operator_idx" ON "public"."journeys" USING "btree" ("operator_id");



CREATE INDEX "journeys_route_id_idx" ON "public"."journeys" USING "btree" ("route_id");



CREATE INDEX "journeys_route_idx" ON "public"."journeys" USING "btree" ("route_id");



CREATE UNIQUE INDEX "journeys_unique_route_day" ON "public"."journeys" USING "btree" ("route_id", ((("departure_ts" AT TIME ZONE 'UTC'::"text"))::"date"));



CREATE INDEX "journeys_vehicle_time_idx" ON "public"."journeys" USING "btree" ("vehicle_id", "departure_ts");



CREATE INDEX "orders_booking_id_idx" ON "public"."orders" USING "btree" ("booking_id");



CREATE INDEX "routes_active_idx" ON "public"."routes" USING "btree" ("is_active");



CREATE UNIQUE INDEX "u_jva_journey_vehicle" ON "public"."journey_vehicle_allocs" USING "btree" ("journey_id", "vehicle_id");



CREATE UNIQUE INDEX "uniq_cancellation_policy_name" ON "public"."cancellation_policies" USING "btree" ("name");



CREATE UNIQUE INDEX "uniq_jv_route_date_null_vehicle" ON "public"."journey_vehicles" USING "btree" ("route_id", "journey_date") WHERE ("vehicle_id" IS NULL);



CREATE UNIQUE INDEX "uniq_rva_one_pref_per_route" ON "public"."route_vehicle_assignments" USING "btree" ("route_id") WHERE ("preferred" = true);



CREATE UNIQUE INDEX "uniq_transport_types_name_lower" ON "public"."transport_types" USING "btree" ("lower"("name"));



CREATE UNIQUE INDEX "uniq_transport_types_slug" ON "public"."transport_types" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);



CREATE UNIQUE INDEX "uq_jalloc_one_row_per_order" ON "public"."journey_allocations" USING "btree" ("order_id");



CREATE UNIQUE INDEX "uq_jv_route_date_vehicle" ON "public"."journey_vehicles" USING "btree" ("route_id", "journey_date", "vehicle_id");



CREATE UNIQUE INDEX "ux_transport_type_roles" ON "public"."transport_type_roles" USING "btree" ("transport_type_id", "role");



CREATE UNIQUE INDEX "vehicles_name_key" ON "public"."vehicles" USING "btree" ("name");



CREATE OR REPLACE TRIGGER "bookings_recompute_rdi" AFTER INSERT OR DELETE OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_from_bookings"();



CREATE OR REPLACE TRIGGER "journeys_recompute_rdi" AFTER INSERT OR UPDATE ON "public"."journeys" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_from_journeys"();



CREATE OR REPLACE TRIGGER "qi_set_departure_ts_trg" BEFORE INSERT OR UPDATE OF "route_id", "date_iso" ON "public"."quote_intents" FOR EACH ROW EXECUTE FUNCTION "public"."qi_set_departure_ts"();



CREATE OR REPLACE TRIGGER "rva_recompute_rdi" AFTER INSERT OR DELETE OR UPDATE ON "public"."route_vehicle_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."trg_capacity_changed_rva"();



CREATE OR REPLACE TRIGGER "trg_app_flags_touch" BEFORE UPDATE ON "public"."app_flags" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_assert_one_lead" BEFORE INSERT OR UPDATE ON "public"."journey_crew_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."fn_assert_one_lead"();



CREATE OR REPLACE TRIGGER "trg_guard_journey_alloc_capacity" BEFORE INSERT OR UPDATE ON "public"."journey_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."fn_guard_journey_alloc_capacity"();



CREATE OR REPLACE TRIGGER "trg_jalloc_touch" BEFORE UPDATE ON "public"."journey_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."tg_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_orders_after_delete_jv" AFTER DELETE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."ps_orders_after_delete"();



CREATE OR REPLACE TRIGGER "trg_orders_after_insert_jv" AFTER INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."ps_orders_after_insert"();



CREATE OR REPLACE TRIGGER "trg_orders_fill_defaults" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."orders_fill_defaults"();



CREATE OR REPLACE TRIGGER "trg_partner_applications_updated_at" BEFORE UPDATE ON "public"."partner_applications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_route_inventory_status" BEFORE UPDATE ON "public"."route_inventory_status" FOR EACH ROW EXECUTE FUNCTION "public"."tg_touch_updated_at"();



CREATE OR REPLACE TRIGGER "vehicles_recompute_rdi" AFTER UPDATE OF "active", "maxseats" ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_capacity_changed_vehicle"();



ALTER TABLE ONLY "public"."asset_blackouts"
    ADD CONSTRAINT "asset_blackouts_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_cancellations"
    ADD CONSTRAINT "booking_cancellations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_cancellations"
    ADD CONSTRAINT "booking_cancellations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."cancellation_policies"("id");



ALTER TABLE ONLY "public"."booking_cancellations"
    ADD CONSTRAINT "booking_cancellations_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "public"."cancellation_policy_rules"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_journey_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."cancellation_policy_rules"
    ADD CONSTRAINT "cancellation_policy_rules_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."captain_journey_events"
    ADD CONSTRAINT "captain_journey_events_captain_staff_id_fkey" FOREIGN KEY ("captain_staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."captain_journey_events"
    ADD CONSTRAINT "captain_journey_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."captain_journey_events"
    ADD CONSTRAINT "captain_journey_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_code_fk" FOREIGN KEY ("code") REFERENCES "public"."un_countries"("code");



ALTER TABLE ONLY "public"."crew_assignments"
    ADD CONSTRAINT "crew_assignments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crew_assignments"
    ADD CONSTRAINT "crew_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."transport_type_roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crew_assignments"
    ADD CONSTRAINT "crew_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crew_assignments"
    ADD CONSTRAINT "crew_assignments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crew_assignments"
    ADD CONSTRAINT "crew_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crew_payouts"
    ADD CONSTRAINT "crew_payouts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."destinations"
    ADD CONSTRAINT "destinations_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "fk_bookings_route" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journeys"
    ADD CONSTRAINT "fk_journeys_vehicle" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journeys"
    ADD CONSTRAINT "fk_sailings_route" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_allocations"
    ADD CONSTRAINT "journey_allocations_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_allocations"
    ADD CONSTRAINT "journey_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_allocations"
    ADD CONSTRAINT "journey_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."journey_assignments"
    ADD CONSTRAINT "journey_assignments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_assignments"
    ADD CONSTRAINT "journey_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."transport_type_roles"("id");



ALTER TABLE ONLY "public"."journey_assignments"
    ADD CONSTRAINT "journey_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_assignments"
    ADD CONSTRAINT "journey_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_boats"
    ADD CONSTRAINT "journey_boats_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_boats"
    ADD CONSTRAINT "journey_boats_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."journey_crew_assignments"
    ADD CONSTRAINT "journey_crew_assignments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_crew_assignments"
    ADD CONSTRAINT "journey_crew_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."transport_type_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_crew_assignments"
    ADD CONSTRAINT "journey_crew_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_crew_assignments"
    ADD CONSTRAINT "journey_crew_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_crew"
    ADD CONSTRAINT "journey_crew_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_crew"
    ADD CONSTRAINT "journey_crew_staff_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journey_crew"
    ADD CONSTRAINT "journey_crew_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journey_inventory"
    ADD CONSTRAINT "journey_inventory_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_order_allocations"
    ADD CONSTRAINT "journey_order_allocations_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_order_allocations"
    ADD CONSTRAINT "journey_order_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_order_allocations"
    ADD CONSTRAINT "journey_order_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."journey_passenger_allocations"
    ADD CONSTRAINT "journey_passenger_allocations_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_passenger_allocations"
    ADD CONSTRAINT "journey_passenger_allocations_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "public"."order_passengers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_passenger_allocations"
    ADD CONSTRAINT "journey_passenger_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."journey_vehicle_allocations"
    ADD CONSTRAINT "journey_vehicle_allocations_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_vehicle_allocations"
    ADD CONSTRAINT "journey_vehicle_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journey_vehicle_allocations"
    ADD CONSTRAINT "journey_vehicle_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journey_vehicle_overrides"
    ADD CONSTRAINT "journey_vehicle_overrides_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_vehicle_overrides"
    ADD CONSTRAINT "journey_vehicle_overrides_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_vehicles"
    ADD CONSTRAINT "journey_vehicles_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journey_vehicles"
    ADD CONSTRAINT "journey_vehicles_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journey_vehicles"
    ADD CONSTRAINT "journey_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journeys"
    ADD CONSTRAINT "journeys_operator_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journeys"
    ADD CONSTRAINT "journeys_route_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operator_crew_codes"
    ADD CONSTRAINT "operator_crew_codes_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_payout_items"
    ADD CONSTRAINT "operator_payout_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."operator_payout_items"
    ADD CONSTRAINT "operator_payout_items_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "public"."operator_payouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_payouts"
    ADD CONSTRAINT "operator_payouts_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id");



ALTER TABLE ONLY "public"."operator_transport_types"
    ADD CONSTRAINT "operator_transport_types_journey_type_id_fkey" FOREIGN KEY ("journey_type_id") REFERENCES "public"."journey_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_transport_types"
    ADD CONSTRAINT "operator_transport_types_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operators"
    ADD CONSTRAINT "operators_cancellation_policy_id_fkey" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operators"
    ADD CONSTRAINT "operators_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_guests"
    ADD CONSTRAINT "order_guests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickup_points"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."order_passenger_assignments"
    ADD CONSTRAINT "order_passenger_assignments_journey_vehicle_id_fkey" FOREIGN KEY ("journey_vehicle_id") REFERENCES "public"."journey_vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_passenger_assignments"
    ADD CONSTRAINT "order_passenger_assignments_order_passenger_id_fkey" FOREIGN KEY ("order_passenger_id") REFERENCES "public"."order_passengers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_passengers"
    ADD CONSTRAINT "order_passengers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_application_places"
    ADD CONSTRAINT "partner_application_places_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_application_places"
    ADD CONSTRAINT "partner_application_places_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."transport_type_places"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_applications"
    ADD CONSTRAINT "partner_applications_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_applications"
    ADD CONSTRAINT "partner_applications_destination_type_id_fkey" FOREIGN KEY ("destination_type_id") REFERENCES "public"."destination_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_applications"
    ADD CONSTRAINT "partner_applications_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_applications"
    ADD CONSTRAINT "partner_applications_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."passenger_allocations"
    ADD CONSTRAINT "passenger_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."passenger_allocations"
    ADD CONSTRAINT "passenger_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."passenger_vehicle_assignments"
    ADD CONSTRAINT "passenger_vehicle_assignments_journey_vehicle_id_fkey" FOREIGN KEY ("journey_vehicle_id") REFERENCES "public"."journey_vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."passenger_vehicle_assignments"
    ADD CONSTRAINT "passenger_vehicle_assignments_order_passenger_id_fkey" FOREIGN KEY ("order_passenger_id") REFERENCES "public"."order_passengers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."passengers"
    ADD CONSTRAINT "passengers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pickup_points"
    ADD CONSTRAINT "pickup_points_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pickup_points"
    ADD CONSTRAINT "pickup_points_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pickup_points"
    ADD CONSTRAINT "pickup_points_transport_type_place_id_fkey" FOREIGN KEY ("transport_type_place_id") REFERENCES "public"."transport_type_places"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_day_inventory"
    ADD CONSTRAINT "route_day_inventory_route_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_departures"
    ADD CONSTRAINT "route_departures_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_durations"
    ADD CONSTRAINT "route_durations_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_durations"
    ADD CONSTRAINT "route_durations_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."route_inventory_status"
    ADD CONSTRAINT "route_inventory_status_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_transport_metrics"
    ADD CONSTRAINT "route_transport_metrics_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_transport_metrics"
    ADD CONSTRAINT "route_transport_metrics_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."route_transport_types"
    ADD CONSTRAINT "route_transport_types_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_transport_types"
    ADD CONSTRAINT "route_transport_types_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."route_vehicle_assignments"
    ADD CONSTRAINT "route_vehicle_assignments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_vehicle_assignments"
    ADD CONSTRAINT "route_vehicle_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_cancellation_policy_id_fkey" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_country_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_destination_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_journey_type_fk" FOREIGN KEY ("journey_type_id") REFERENCES "public"."journey_types"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_pickup_fk" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickup_points"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_staff"
    ADD CONSTRAINT "staff_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_role_certifications"
    ADD CONSTRAINT "staff_role_certifications_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."transport_type_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_role_certifications"
    ADD CONSTRAINT "staff_role_certifications_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."operator_staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_role_certifications"
    ADD CONSTRAINT "staff_role_certifications_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_fees"
    ADD CONSTRAINT "tax_fees_country_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tips_ledger"
    ADD CONSTRAINT "tips_ledger_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tips_ledger"
    ADD CONSTRAINT "tips_ledger_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tips_ledger"
    ADD CONSTRAINT "tips_ledger_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_type_places"
    ADD CONSTRAINT "transport_type_places_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_type_roles"
    ADD CONSTRAINT "transport_type_roles_transport_type_id_fkey" FOREIGN KEY ("transport_type_id") REFERENCES "public"."transport_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_operator_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vehicle_allocations"
    ADD CONSTRAINT "vehicle_allocations_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_allocations"
    ADD CONSTRAINT "vehicle_allocations_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_allocations"
    ADD CONSTRAINT "vehicle_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_operator_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wl_assets"
    ADD CONSTRAINT "wl_assets_owner_operator_id_fkey" FOREIGN KEY ("owner_operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wl_assets"
    ADD CONSTRAINT "wl_assets_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wl_availability"
    ADD CONSTRAINT "wl_availability_wl_asset_id_fkey" FOREIGN KEY ("wl_asset_id") REFERENCES "public"."wl_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wl_day_charters"
    ADD CONSTRAINT "wl_day_charters_lessee_operator_id_fkey" FOREIGN KEY ("lessee_operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wl_day_charters"
    ADD CONSTRAINT "wl_day_charters_wl_asset_id_fkey" FOREIGN KEY ("wl_asset_id") REFERENCES "public"."wl_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wl_payments"
    ADD CONSTRAINT "wl_payments_wl_day_charter_id_fkey" FOREIGN KEY ("wl_day_charter_id") REFERENCES "public"."wl_day_charters"("id") ON DELETE CASCADE;



CREATE POLICY "Allow anon read" ON "public"."routes" FOR SELECT USING (true);



CREATE POLICY "Allow anonymous insert bookings" ON "public"."bookings" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Allow anonymous read bookings" ON "public"."bookings" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."order_passengers" FOR SELECT USING (true);



CREATE POLICY "Public read tax_fees" ON "public"."tax_fees" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "allow insert via service role" ON "public"."journeys" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "allow select to public" ON "public"."journeys" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."countries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "countries read" ON "public"."countries" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "countries_delete_all" ON "public"."countries" FOR DELETE USING (true);



CREATE POLICY "countries_delete_auth" ON "public"."countries" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."crew_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crew_delete" ON "public"."crew_assignments" FOR DELETE TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "crew_insert" ON "public"."crew_assignments" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "crew_select" ON "public"."crew_assignments" FOR SELECT TO "authenticated" USING ((("staff_user_id" = "auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "crew_update" ON "public"."crew_assignments" FOR UPDATE TO "authenticated" USING (("public"."is_admin"("auth"."uid"()) OR ("staff_user_id" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"("auth"."uid"()) OR ("staff_user_id" = "auth"."uid"())));



ALTER TABLE "public"."destination_arrival" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."destination_type" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."destinations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "destinations delete" ON "public"."destinations" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "destinations insert" ON "public"."destinations" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "destinations read" ON "public"."destinations" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "destinations update" ON "public"."destinations" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "destinations_read_any" ON "public"."destinations" FOR SELECT USING (true);



CREATE POLICY "insert_countries_dev" ON "public"."countries" FOR INSERT WITH CHECK (true);



CREATE POLICY "insert_quote" ON "public"."quote_intents" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "insert_quote_anon" ON "public"."quote_intents" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "insert_quote_auth" ON "public"."quote_intents" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "ja_admin_all" ON "public"."journey_assignments" USING ((EXISTS ( SELECT 1
   FROM ("public"."vehicles" "v"
     JOIN "public"."operator_staff" "s" ON ((("s"."user_id" = "auth"."uid"()) AND ("s"."active" = true) AND ("s"."operator_id" = "v"."operator_id"))))
  WHERE ("v"."id" = "journey_assignments"."vehicle_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."vehicles" "v"
     JOIN "public"."operator_staff" "s" ON ((("s"."user_id" = "auth"."uid"()) AND ("s"."active" = true) AND ("s"."operator_id" = "v"."operator_id"))))
  WHERE ("v"."id" = "journey_assignments"."vehicle_id"))));



CREATE POLICY "ja_insert_same_operator" ON "public"."journey_assignments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."operator_staff" "s"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "journey_assignments"."vehicle_id")))
  WHERE (("s"."user_id" = "auth"."uid"()) AND ("s"."operator_id" = "v"."operator_id") AND "s"."active"))));



CREATE POLICY "ja_select_own" ON "public"."journey_assignments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."operator_staff" "s"
  WHERE (("s"."id" = "journey_assignments"."staff_id") AND ("s"."user_id" = "auth"."uid"()) AND ("s"."active" = true)))));



CREATE POLICY "ja_select_same_operator" ON "public"."journey_assignments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."operator_staff" "s"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "journey_assignments"."vehicle_id")))
  WHERE (("s"."user_id" = "auth"."uid"()) AND ("s"."active" = true) AND ("s"."operator_id" = "v"."operator_id")))));



CREATE POLICY "ja_update_assignee_self" ON "public"."journey_assignments" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operator_staff" "s"
  WHERE (("s"."user_id" = "auth"."uid"()) AND ("s"."id" = "journey_assignments"."staff_id") AND ("s"."active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operator_staff" "s"
  WHERE (("s"."user_id" = "auth"."uid"()) AND ("s"."id" = "journey_assignments"."staff_id") AND ("s"."active" = true)))));



CREATE POLICY "ja_update_own" ON "public"."journey_assignments" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."operator_staff" "s"
  WHERE (("s"."id" = "journey_assignments"."staff_id") AND ("s"."user_id" = "auth"."uid"()) AND ("s"."active" = true)))));



CREATE POLICY "ja_update_same_operator" ON "public"."journey_assignments" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."operator_staff" "s"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "journey_assignments"."vehicle_id")))
  WHERE (("s"."user_id" = "auth"."uid"()) AND ("s"."active" = true) AND ("s"."operator_id" = "v"."operator_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."operator_staff" "s"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "journey_assignments"."vehicle_id")))
  WHERE (("s"."user_id" = "auth"."uid"()) AND ("s"."active" = true) AND ("s"."operator_id" = "v"."operator_id")))));



ALTER TABLE "public"."journey_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."journeys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "journeys_select_all_anon" ON "public"."journeys" FOR SELECT TO "anon" USING (true);



CREATE POLICY "operator admins can read own vehicles" ON "public"."vehicles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND COALESCE("u"."operator_admin", false) AND ("u"."operator_id" = "vehicles"."operator_id")))));



ALTER TABLE "public"."operator_staff" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operator_staff_read" ON "public"."operator_staff" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."site_admin" IS TRUE)))) OR (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."operator_admin" IS TRUE) AND ("u"."operator_id" IS NOT NULL) AND ("u"."operator_id" = "operator_staff"."operator_id"))))));



ALTER TABLE "public"."operators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operators_delete_all" ON "public"."operators" FOR DELETE USING (true);



CREATE POLICY "operators_insert_all" ON "public"."operators" FOR INSERT WITH CHECK (true);



CREATE POLICY "operators_select_all" ON "public"."operators" FOR SELECT USING (true);



CREATE POLICY "operators_update_all" ON "public"."operators" FOR UPDATE USING (true);



CREATE POLICY "ops can read passengers via bookings" ON "public"."order_passengers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE ("b"."order_id" = "order_passengers"."order_id"))));



CREATE POLICY "ops can see passengers for their journeys" ON "public"."order_passengers" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM (((("public"."bookings" "b"
     JOIN "public"."journeys" "j" ON (("j"."id" = "b"."journey_id")))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "j"."vehicle_id")))
     JOIN "auth"."users" "au" ON (("au"."id" = "auth"."uid"())))
     JOIN "public"."users" "u" ON ((("u"."email")::"text" = ("au"."email")::"text")))
  WHERE (("b"."order_id" = "order_passengers"."order_id") AND COALESCE("u"."operator_admin", false) AND ((("v"."operator_id" IS NOT NULL) AND ("v"."operator_id" = "u"."operator_id")) OR (("j"."operator_id" IS NOT NULL) AND ("j"."operator_id" = "u"."operator_id")))))));



CREATE POLICY "ops ui can read orders via bookings" ON "public"."orders" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE ("b"."order_id" = "orders"."id"))));



CREATE POLICY "ops ui can read passengers via bookings" ON "public"."order_passengers" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE ("b"."order_id" = "order_passengers"."order_id"))));



CREATE POLICY "ops_ui_can_read_passengers_via_bookings" ON "public"."order_passengers" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."order_id" = "order_passengers"."order_id") AND ("b"."journey_id" IS NOT NULL)))));



CREATE POLICY "ops_ui_read_passengers_scoped" ON "public"."order_passengers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."bookings" "b"
     JOIN "public"."journeys" "j" ON (("j"."id" = "b"."journey_id")))
     JOIN "public"."vehicles" "v" ON (("v"."id" = "j"."vehicle_id"))))));



ALTER TABLE "public"."order_guests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_guests_insert_any" ON "public"."order_guests" FOR INSERT WITH CHECK (true);



CREATE POLICY "order_guests_insert_for_owner_or_guest" ON "public"."order_guests" FOR INSERT TO "authenticated", "anon" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_guests"."order_id") AND (("o"."user_id" = "auth"."uid"()) OR ("o"."user_id" = 'a9812683-a55b-46ae-965f-2a7b92179f8a'::"uuid"))))));



CREATE POLICY "order_guests_select_any" ON "public"."order_guests" FOR SELECT USING (true);



CREATE POLICY "order_guests_select_for_owner_or_guest" ON "public"."order_guests" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_guests"."order_id") AND (("o"."user_id" = "auth"."uid"()) OR ("o"."user_id" = 'a9812683-a55b-46ae-965f-2a7b92179f8a'::"uuid"))))));



ALTER TABLE "public"."order_passengers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_passengers_select_via_bookings" ON "public"."order_passengers" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE ("b"."order_id" = "order_passengers"."order_id"))));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_insert_anon" ON "public"."orders" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "orders_insert_any" ON "public"."orders" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("user_id" = "auth"."uid"()) OR ("user_id" = '00000000-0000-0000-0000-000000000000'::"uuid")));



CREATE POLICY "orders_insert_auth" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "orders_receipt_select" ON "public"."orders" FOR SELECT TO "authenticated", "anon" USING ((("id" = "id") AND ("success_token" IS NOT NULL)));



CREATE POLICY "orders_receipt_select_anon" ON "public"."orders" FOR SELECT USING (true);



CREATE POLICY "orders_receipt_select_auth" ON "public"."orders" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "orders_select_by_user" ON "public"."orders" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "orders_select_by_user_or_guest" ON "public"."orders" FOR SELECT TO "authenticated", "anon" USING ((("user_id" = "auth"."uid"()) OR ("user_id" = 'a9812683-a55b-46ae-965f-2a7b92179f8a'::"uuid")));



CREATE POLICY "orders_select_own" ON "public"."orders" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "orders_select_via_bookings" ON "public"."orders" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE ("b"."order_id" = "orders"."id"))));



CREATE POLICY "p_route_inventory_status_select" ON "public"."route_inventory_status" FOR SELECT TO "anon" USING (true);



CREATE POLICY "partner_app_places_insert_own" ON "public"."partner_application_places" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



ALTER TABLE "public"."partner_application_places" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partner_applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partner_apps_insert_any" ON "public"."partner_applications" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "partner_apps_select_own" ON "public"."partner_applications" FOR SELECT TO "authenticated" USING (("submitted_by" = "auth"."uid"()));



ALTER TABLE "public"."pickup_points" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pickup_points_read_any" ON "public"."pickup_points" FOR SELECT USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public read countries" ON "public"."countries" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public read departures" ON "public"."route_departures" FOR SELECT USING (true);



CREATE POLICY "public read pickup_points" ON "public"."pickup_points" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public read transport_type_places" ON "public"."transport_type_places" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public read transport_types" ON "public"."transport_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."quote_intents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rdi_read_all" ON "public"."route_day_inventory" FOR SELECT USING (true);



CREATE POLICY "rdi_select_public" ON "public"."route_day_inventory" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read bookings (ops ui)" ON "public"."bookings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read order_passengers (ops ui)" ON "public"."order_passengers" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read orders (ops ui)" ON "public"."orders" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "read_countries_dev" ON "public"."countries" FOR SELECT USING (true);



CREATE POLICY "read_quote" ON "public"."quote_intents" FOR SELECT TO "anon" USING (true);



CREATE POLICY "read_quote_anon" ON "public"."quote_intents" FOR SELECT TO "anon" USING (true);



CREATE POLICY "read_quote_auth" ON "public"."quote_intents" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_un_countries_dev" ON "public"."un_countries" FOR SELECT USING (true);



ALTER TABLE "public"."route_day_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."route_departures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."route_inventory_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "routes delete" ON "public"."routes" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "routes insert" ON "public"."routes" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "routes select" ON "public"."routes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "routes update" ON "public"."routes" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "routes_read_any" ON "public"."routes" FOR SELECT USING (true);



ALTER TABLE "public"."tax_fees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tax_fees_read_any" ON "public"."tax_fees" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "temp_allow_all_reads" ON "public"."order_passengers" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."transport_type_places" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transport_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_types_select_admin" ON "public"."transport_types" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND (COALESCE("u"."site_admin", false) = true)))));



CREATE POLICY "transport_types_select_public_active" ON "public"."transport_types" FOR SELECT USING (("is_active" = true));



CREATE POLICY "transport_types_write_admin" ON "public"."transport_types" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND (COALESCE("u"."site_admin", false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND (COALESCE("u"."site_admin", false) = true)))));



CREATE POLICY "two-step manifest read (broad)" ON "public"."order_passengers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE ("b"."order_id" = "order_passengers"."order_id"))));



ALTER TABLE "public"."un_countries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "update_countries_dev" ON "public"."countries" FOR UPDATE USING (true);



CREATE POLICY "update_quote_anon" ON "public"."quote_intents" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "update_quote_auth" ON "public"."quote_intents" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_select_self" ON "public"."users" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR ("lower"(("email")::"text") = "lower"(("auth"."jwt"() ->> 'email'::"text")))));



CREATE POLICY "users_self_read" ON "public"."users" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "users_update_self" ON "public"."users" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicles_op_admin_delete" ON "public"."vehicles" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND COALESCE("u"."operator_admin", false) AND ("u"."operator_id" = "vehicles"."operator_id")))));



CREATE POLICY "vehicles_op_admin_insert" ON "public"."vehicles" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND COALESCE("u"."operator_admin", false) AND ("u"."operator_id" = "vehicles"."operator_id")))));



CREATE POLICY "vehicles_op_admin_update" ON "public"."vehicles" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND COALESCE("u"."operator_admin", false) AND ("u"."operator_id" = "vehicles"."operator_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND COALESCE("u"."operator_admin", false) AND ("u"."operator_id" = "vehicles"."operator_id")))));



CREATE POLICY "vehicles_select_all_anon" ON "public"."vehicles" FOR SELECT TO "anon" USING (true);



CREATE POLICY "vehicles_site_admin_read" ON "public"."vehicles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND COALESCE("u"."site_admin", false)))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "app" TO "anon";
GRANT USAGE ON SCHEMA "app" TO "authenticated";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "service_role";



GRANT ALL ON TABLE "public"."operators" TO "anon";
GRANT ALL ON TABLE "public"."operators" TO "authenticated";
GRANT ALL ON TABLE "public"."operators" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."wl_assets" TO "anon";
GRANT ALL ON TABLE "public"."wl_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."wl_assets" TO "service_role";































































































































































GRANT ALL ON FUNCTION "public"."_booked_seats_for_route_day"("p_route" "uuid", "p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."_booked_seats_for_route_day"("p_route" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_booked_seats_for_route_day"("p_route" "uuid", "p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."_journey_date"("p_journey" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_journey_date"("p_journey" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_journey_date"("p_journey" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_journey_local_date"("p_journey" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_journey_local_date"("p_journey" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_journey_local_date"("p_journey" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_route_capacity"("p_route" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_route_capacity"("p_route" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_route_capacity"("p_route" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."allocate_and_book"("p_route_id" "uuid", "p_departure_ts" timestamp with time zone, "p_seats" integer, "p_customer_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."allocate_and_book"("p_route_id" "uuid", "p_departure_ts" timestamp with time zone, "p_seats" integer, "p_customer_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."allocate_and_book"("p_route_id" "uuid", "p_departure_ts" timestamp with time zone, "p_seats" integer, "p_customer_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."allocate_parties_to_vehicles"("p_route" "uuid", "p_ymd" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."allocate_parties_to_vehicles"("p_route" "uuid", "p_ymd" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."allocate_parties_to_vehicles"("p_route" "uuid", "p_ymd" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."allocate_vehicles_for_day"("_route_id" "uuid", "_ymd" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."allocate_vehicles_for_day"("_route_id" "uuid", "_ymd" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."allocate_vehicles_for_day"("_route_id" "uuid", "_ymd" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."api_finalize_checkout"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_lead_first" "text", "p_lead_last" "text", "p_lead_email" "text", "p_lead_phone" "text", "p_seat_count" integer, "p_unit_base_cents" integer, "p_unit_tax_cents" integer, "p_unit_fees_cents" integer, "p_quote_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."api_finalize_checkout"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_lead_first" "text", "p_lead_last" "text", "p_lead_email" "text", "p_lead_phone" "text", "p_seat_count" integer, "p_unit_base_cents" integer, "p_unit_tax_cents" integer, "p_unit_fees_cents" integer, "p_quote_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."api_finalize_checkout"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_lead_first" "text", "p_lead_last" "text", "p_lead_email" "text", "p_lead_phone" "text", "p_seat_count" integer, "p_unit_base_cents" integer, "p_unit_tax_cents" integer, "p_unit_fees_cents" integer, "p_quote_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."api_finalize_checkout"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_lead_first" "text", "p_lead_last" "text", "p_lead_email" "text", "p_lead_phone" "text", "p_seat_count" integer, "p_unit_base_cents" integer, "p_unit_tax_cents" integer, "p_unit_fees_cents" integer, "p_quote_token" "text") TO "service_role";



GRANT ALL ON TABLE "public"."route_vehicle_assignments" TO "anon";
GRANT ALL ON TABLE "public"."route_vehicle_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."route_vehicle_assignments" TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_vehicle_to_route"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_preferred" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."assign_vehicle_to_route"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_preferred" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_vehicle_to_route"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_preferred" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."booking_counts_delete_redirect"() TO "anon";
GRANT ALL ON FUNCTION "public"."booking_counts_delete_redirect"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."booking_counts_delete_redirect"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "postgres";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "anon";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_route_capacity"("p_route_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_route_capacity"("p_route_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_route_capacity"("p_route_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_operator_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_operator_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_operator_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "postgres";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "anon";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."effective_price"("p_base" numeric, "p_maxseatdiscount" numeric, "p_filled" integer, "p_capacity" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."effective_price"("p_base" numeric, "p_maxseatdiscount" numeric, "p_filled" integer, "p_capacity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."effective_price"("p_base" numeric, "p_maxseatdiscount" numeric, "p_filled" integer, "p_capacity" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."flag_enabled"("p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flag_enabled"("p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flag_enabled"("p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "postgres";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "anon";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "service_role";



GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_assert_one_lead"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_assert_one_lead"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_assert_one_lead"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_assign_seats"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_assign_seats"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_assign_seats"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_calculate_pricing"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_qty" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_calculate_pricing"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_qty" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_calculate_pricing"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_qty" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_guard_journey_alloc_capacity"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_guard_journey_alloc_capacity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_guard_journey_alloc_capacity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_operator_remove_vehicle"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_operator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_operator_remove_vehicle"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_operator_remove_vehicle"("p_journey_id" "uuid", "p_vehicle_id" "uuid", "p_operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_pick_vehicle_for_group"("p_journey" "uuid", "p_qty" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_pick_vehicle_for_group"("p_journey" "uuid", "p_qty" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_pick_vehicle_for_group"("p_journey" "uuid", "p_qty" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_seed_allocations_t72"("p_journey" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_seed_allocations_t72"("p_journey" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_seed_allocations_t72"("p_journey" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_seed_allocations_t72_by_route_date"("p_route" "uuid", "p_ymd" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_seed_allocations_t72_by_route_date"("p_route" "uuid", "p_ymd" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_seed_allocations_t72_by_route_date"("p_route" "uuid", "p_ymd" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_manifest_for_journey"("jid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_manifest_for_journey"("jid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_manifest_for_journey"("jid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_manifest_for_journey"("jid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "postgres";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "anon";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"("u" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("u" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("u" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."needs_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."needs_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."needs_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "postgres";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "anon";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "service_role";



GRANT ALL ON FUNCTION "public"."op_needing_assignments"("p_operator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."op_needing_assignments"("p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."op_needing_assignments"("p_operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."operator_create_journey"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_departure_ts" timestamp with time zone, "p_base_price_cents" integer, "p_currency" "text", "p_operator_secret" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."operator_create_journey"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_departure_ts" timestamp with time zone, "p_base_price_cents" integer, "p_currency" "text", "p_operator_secret" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."operator_create_journey"("p_route_id" "uuid", "p_vehicle_id" "uuid", "p_departure_ts" timestamp with time zone, "p_base_price_cents" integer, "p_currency" "text", "p_operator_secret" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."order_for_receipt_raw"("p_order_id" "uuid", "p_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."order_for_receipt_raw"("p_order_id" "uuid", "p_token" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."order_for_receipt_raw"("p_order_id" "uuid", "p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."order_for_receipt_raw"("p_order_id" "uuid", "p_token" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."order_receipt_v2"("p_order_id" "uuid", "p_token" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."order_receipt_v2"("p_order_id" "uuid", "p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."order_receipt_v2"("p_order_id" "uuid", "p_token" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."order_receipt_v3"("p_order_id" "uuid", "p_token" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."order_receipt_v3"("p_order_id" "uuid", "p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."order_receipt_v3"("p_order_id" "uuid", "p_token" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."orders_fill_defaults"() TO "anon";
GRANT ALL ON FUNCTION "public"."orders_fill_defaults"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."orders_fill_defaults"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pick_cancellation_rule"("_policy" "uuid", "_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."pick_cancellation_rule"("_policy" "uuid", "_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pick_cancellation_rule"("_policy" "uuid", "_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."price_quote"("journey_uuid" "uuid", "now_utc" timestamp with time zone, "depart_utc_override" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."price_quote"("journey_uuid" "uuid", "now_utc" timestamp with time zone, "depart_utc_override" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."price_quote"("journey_uuid" "uuid", "now_utc" timestamp with time zone, "depart_utc_override" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."price_quotes_for_route"("p_route_id" "uuid", "p_now" timestamp with time zone, "p_depart_utc_override" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."price_quotes_for_route"("p_route_id" "uuid", "p_now" timestamp with time zone, "p_depart_utc_override" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."price_quotes_for_route"("p_route_id" "uuid", "p_now" timestamp with time zone, "p_depart_utc_override" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_allocate_all_future"() TO "anon";
GRANT ALL ON FUNCTION "public"."ps_allocate_all_future"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_allocate_all_future"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_allocate_journey"("p_journey_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_allocate_journey"("p_journey_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_allocate_journey"("p_journey_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_allocate_unassigned"("journey_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_allocate_unassigned"("journey_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_allocate_unassigned"("journey_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_block_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_block_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_block_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_ensure_journey"("p_route_id" "uuid", "p_day" "date", "p_base_price_cents" integer, "p_currency" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_ensure_journey"("p_route_id" "uuid", "p_day" "date", "p_base_price_cents" integer, "p_currency" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_ensure_journey"("p_route_id" "uuid", "p_day" "date", "p_base_price_cents" integer, "p_currency" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_ensure_journey_for_order"("p_route_id" "uuid", "p_journey_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_ensure_journey_for_order"("p_route_id" "uuid", "p_journey_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_ensure_journey_for_order"("p_route_id" "uuid", "p_journey_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_ensure_journey_vehicle"() TO "anon";
GRANT ALL ON FUNCTION "public"."ps_ensure_journey_vehicle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_ensure_journey_vehicle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_journey_departure_ts"("p_journey_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_journey_departure_ts"("p_journey_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_journey_departure_ts"("p_journey_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_journey_horizon"("p_journey_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_journey_horizon"("p_journey_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_journey_horizon"("p_journey_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_make_departure_ts"("p_date" "date", "p_route_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_make_departure_ts"("p_date" "date", "p_route_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_make_departure_ts"("p_date" "date", "p_route_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_orders_after_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."ps_orders_after_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_orders_after_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_orders_after_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."ps_orders_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_orders_after_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_reconcile_journey"("p_journey_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_reconcile_journey"("p_journey_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_reconcile_journey"("p_journey_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_reconcile_upcoming"() TO "anon";
GRANT ALL ON FUNCTION "public"."ps_reconcile_upcoming"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_reconcile_upcoming"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_record_cancellation_settlement"("p_order_id" "uuid", "p_operator_id" "uuid", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_record_cancellation_settlement"("p_order_id" "uuid", "p_operator_id" "uuid", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_record_cancellation_settlement"("p_order_id" "uuid", "p_operator_id" "uuid", "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_recount_journey_vehicle"("p_route_id" "uuid", "p_journey_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."ps_recount_journey_vehicle"("p_route_id" "uuid", "p_journey_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_recount_journey_vehicle"("p_route_id" "uuid", "p_journey_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_select_pricing_vehicle"("p_route_id" "uuid", "p_journey_date" "date", "p_qty" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."ps_select_pricing_vehicle"("p_route_id" "uuid", "p_journey_date" "date", "p_qty" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_select_pricing_vehicle"("p_route_id" "uuid", "p_journey_date" "date", "p_qty" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_sync_jv_on_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."ps_sync_jv_on_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_sync_jv_on_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_tick_journey_status"("now_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."ps_tick_journey_status"("now_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_tick_journey_status"("now_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_unassigned_vehicle_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."ps_unassigned_vehicle_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_unassigned_vehicle_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ps_unblock_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."ps_unblock_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ps_unblock_vehicle"("p_vehicle_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."qi_set_departure_ts"() TO "anon";
GRANT ALL ON FUNCTION "public"."qi_set_departure_ts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."qi_set_departure_ts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_from_journey"("p_journey" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_from_journey"("p_journey" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_from_journey"("p_journey" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_route_day_inventory"("p_route" "uuid", "p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_route_day_inventory"("p_route" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_route_day_inventory"("p_route" "uuid", "p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_route_range"("p_route" "uuid", "p_from" "date", "p_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_route_range"("p_route" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_route_range"("p_route" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_inventory_window"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_inventory_window"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_inventory_window"() TO "service_role";



GRANT ALL ON FUNCTION "public"."replace_jva_for_journey"("p_journey_id" "uuid", "p_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_jva_for_journey"("p_journey_id" "uuid", "p_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_jva_for_journey"("p_journey_id" "uuid", "p_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_booking_financials"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_booking_financials"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_booking_financials"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_is_site_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_is_site_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_is_site_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_min_seats"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_min_seats"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_min_seats"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_min_seats_summary_v1"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_min_seats_summary_v1"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_min_seats_summary_v1"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_min_seats_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_min_seats_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_min_seats_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_min_seats_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_min_seats_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_min_seats_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_my_operator_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_my_operator_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_my_operator_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_operator_settlement"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_operator_settlement"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_operator_settlement"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_operator_settlement_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_operator_settlement_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_operator_settlement_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_operator_settlement_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_operator_settlement_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_operator_settlement_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_resolved_rates"("p_operator" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_resolved_rates"("p_operator" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_resolved_rates"("p_operator" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_revenue_by_route_date_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation_v2"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpt_seat_utilisation_v3"("p_operator" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_flag"("p_key" "text", "p_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_preferred_vehicle"("p_route_id" "uuid", "p_vehicle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_preferred_vehicle"("p_route_id" "uuid", "p_vehicle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_preferred_vehicle"("p_route_id" "uuid", "p_vehicle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_capacity_changed_rva"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_capacity_changed_rva"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_capacity_changed_rva"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_capacity_changed_vehicle"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_capacity_changed_vehicle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_capacity_changed_vehicle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recompute_from_bookings"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recompute_from_bookings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recompute_from_bookings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recompute_from_journeys"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recompute_from_journeys"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recompute_from_journeys"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."unassign_vehicle_from_route"("p_route_id" "uuid", "p_vehicle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unassign_vehicle_from_route"("p_route_id" "uuid", "p_vehicle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unassign_vehicle_from_route"("p_route_id" "uuid", "p_vehicle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."wl_asset_unavailability"("p_wl_asset_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."wl_asset_unavailability"("p_wl_asset_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."wl_asset_unavailability"("p_wl_asset_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."wl_confirm_booking"("p_charter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."wl_confirm_booking"("p_charter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."wl_confirm_booking"("p_charter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."wl_create_booking"("p_wl_asset_id" "uuid", "p_lessee_operator_id" "uuid", "p_start_ts" timestamp with time zone, "p_end_ts" timestamp with time zone, "p_terms_version" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."wl_create_booking"("p_wl_asset_id" "uuid", "p_lessee_operator_id" "uuid", "p_start_ts" timestamp with time zone, "p_end_ts" timestamp with time zone, "p_terms_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."wl_create_booking"("p_wl_asset_id" "uuid", "p_lessee_operator_id" "uuid", "p_start_ts" timestamp with time zone, "p_end_ts" timestamp with time zone, "p_terms_version" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."wl_market_for_operator"("p_operator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."wl_market_for_operator"("p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."wl_market_for_operator"("p_operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."wl_set_terms"("p_vehicle_id" "uuid", "p_owner_operator_id" "uuid", "p_day_rate_cents" integer, "p_deposit_cents" integer, "p_min_notice_hours" integer, "p_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."wl_set_terms"("p_vehicle_id" "uuid", "p_owner_operator_id" "uuid", "p_day_rate_cents" integer, "p_deposit_cents" integer, "p_min_notice_hours" integer, "p_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."wl_set_terms"("p_vehicle_id" "uuid", "p_owner_operator_id" "uuid", "p_day_rate_cents" integer, "p_deposit_cents" integer, "p_min_notice_hours" integer, "p_enabled" boolean) TO "service_role";












GRANT ALL ON TABLE "public"."asset_blackouts" TO "anon";
GRANT ALL ON TABLE "public"."asset_blackouts" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_blackouts" TO "service_role";



GRANT ALL ON TABLE "public"."wl_day_charters" TO "anon";
GRANT ALL ON TABLE "public"."wl_day_charters" TO "authenticated";
GRANT ALL ON TABLE "public"."wl_day_charters" TO "service_role";









GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."app_flags" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."app_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."app_flags" TO "service_role";



GRANT ALL ON TABLE "public"."app_flags_unified" TO "anon";
GRANT ALL ON TABLE "public"."app_flags_unified" TO "authenticated";
GRANT ALL ON TABLE "public"."app_flags_unified" TO "service_role";



GRANT ALL ON TABLE "public"."booking_cancellations" TO "anon";
GRANT ALL ON TABLE "public"."booking_cancellations" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_cancellations" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."journeys" TO "anon";
GRANT ALL ON TABLE "public"."journeys" TO "authenticated";
GRANT ALL ON TABLE "public"."journeys" TO "service_role";



GRANT ALL ON TABLE "public"."booking_seat_counts" TO "anon";
GRANT ALL ON TABLE "public"."booking_seat_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_seat_counts" TO "service_role";



GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle_base" TO "anon";
GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle_base" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle_base" TO "service_role";



GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle" TO "anon";
GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle" TO "service_role";



GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle_agg" TO "anon";
GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle_agg" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_seat_counts_by_vehicle_agg" TO "service_role";



GRANT ALL ON TABLE "public"."cancellation_policies" TO "anon";
GRANT ALL ON TABLE "public"."cancellation_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."cancellation_policies" TO "service_role";



GRANT ALL ON TABLE "public"."cancellation_policy_rules" TO "anon";
GRANT ALL ON TABLE "public"."cancellation_policy_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."cancellation_policy_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cancellation_policy_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cancellation_policy_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cancellation_policy_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."captain_journey_events" TO "anon";
GRANT ALL ON TABLE "public"."captain_journey_events" TO "authenticated";
GRANT ALL ON TABLE "public"."captain_journey_events" TO "service_role";



GRANT ALL ON TABLE "public"."countries" TO "anon";
GRANT ALL ON TABLE "public"."countries" TO "authenticated";
GRANT ALL ON TABLE "public"."countries" TO "service_role";



GRANT ALL ON TABLE "public"."destinations" TO "anon";
GRANT ALL ON TABLE "public"."destinations" TO "authenticated";
GRANT ALL ON TABLE "public"."destinations" TO "service_role";



GRANT ALL ON TABLE "public"."routes" TO "anon";
GRANT ALL ON TABLE "public"."routes" TO "authenticated";
GRANT ALL ON TABLE "public"."routes" TO "service_role";



GRANT ALL ON TABLE "public"."routes_on_sale_v" TO "anon";
GRANT ALL ON TABLE "public"."routes_on_sale_v" TO "authenticated";
GRANT ALL ON TABLE "public"."routes_on_sale_v" TO "service_role";



GRANT ALL ON TABLE "public"."country_destinations_on_sale_v" TO "anon";
GRANT ALL ON TABLE "public"."country_destinations_on_sale_v" TO "authenticated";
GRANT ALL ON TABLE "public"."country_destinations_on_sale_v" TO "service_role";



GRANT ALL ON TABLE "public"."country_timezones" TO "anon";
GRANT ALL ON TABLE "public"."country_timezones" TO "authenticated";
GRANT ALL ON TABLE "public"."country_timezones" TO "service_role";



GRANT ALL ON TABLE "public"."pickup_points" TO "anon";
GRANT ALL ON TABLE "public"."pickup_points" TO "authenticated";
GRANT ALL ON TABLE "public"."pickup_points" TO "service_role";



GRANT ALL ON TABLE "public"."transport_types" TO "anon";
GRANT ALL ON TABLE "public"."transport_types" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_types" TO "service_role";



GRANT ALL ON TABLE "public"."country_transport_types_on_sale_v" TO "anon";
GRANT ALL ON TABLE "public"."country_transport_types_on_sale_v" TO "authenticated";
GRANT ALL ON TABLE "public"."country_transport_types_on_sale_v" TO "service_role";



GRANT ALL ON TABLE "public"."crew_assignments" TO "anon";
GRANT ALL ON TABLE "public"."crew_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."crew_payouts" TO "anon";
GRANT ALL ON TABLE "public"."crew_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."destination_arrival" TO "anon";
GRANT ALL ON TABLE "public"."destination_arrival" TO "authenticated";
GRANT ALL ON TABLE "public"."destination_arrival" TO "service_role";



GRANT ALL ON SEQUENCE "public"."destination_arrival_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."destination_arrival_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."destination_arrival_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."destination_type" TO "anon";
GRANT ALL ON TABLE "public"."destination_type" TO "authenticated";
GRANT ALL ON TABLE "public"."destination_type" TO "service_role";



GRANT ALL ON SEQUENCE "public"."destination_type_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."destination_type_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."destination_type_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."destination_types" TO "anon";
GRANT ALL ON TABLE "public"."destination_types" TO "authenticated";
GRANT ALL ON TABLE "public"."destination_types" TO "service_role";



GRANT ALL ON TABLE "public"."flags_runtime" TO "anon";
GRANT ALL ON TABLE "public"."flags_runtime" TO "authenticated";
GRANT ALL ON TABLE "public"."flags_runtime" TO "service_role";



GRANT ALL ON TABLE "public"."journey_allocations" TO "anon";
GRANT ALL ON TABLE "public"."journey_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."journey_assignments" TO "anon";
GRANT ALL ON TABLE "public"."journey_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."journey_boats" TO "anon";
GRANT ALL ON TABLE "public"."journey_boats" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_boats" TO "service_role";



GRANT ALL ON TABLE "public"."journey_crew" TO "anon";
GRANT ALL ON TABLE "public"."journey_crew" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_crew" TO "service_role";



GRANT ALL ON TABLE "public"."journey_crew_assignments" TO "anon";
GRANT ALL ON TABLE "public"."journey_crew_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_crew_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."journey_inventory" TO "anon";
GRANT ALL ON TABLE "public"."journey_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."order_passengers" TO "anon";
GRANT ALL ON TABLE "public"."order_passengers" TO "authenticated";
GRANT ALL ON TABLE "public"."order_passengers" TO "service_role";



GRANT ALL ON TABLE "public"."journey_manifest" TO "anon";
GRANT ALL ON TABLE "public"."journey_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_manifest" TO "service_role";



GRANT ALL ON TABLE "public"."journey_order_allocations" TO "anon";
GRANT ALL ON TABLE "public"."journey_order_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_order_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."journey_order_manifest" TO "anon";
GRANT ALL ON TABLE "public"."journey_order_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_order_manifest" TO "service_role";



GRANT ALL ON TABLE "public"."journey_order_manifest_plus" TO "anon";
GRANT ALL ON TABLE "public"."journey_order_manifest_plus" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_order_manifest_plus" TO "service_role";



GRANT ALL ON TABLE "public"."journey_order_manifest_v2" TO "anon";
GRANT ALL ON TABLE "public"."journey_order_manifest_v2" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_order_manifest_v2" TO "service_role";



GRANT ALL ON TABLE "public"."journey_order_passenger_counts" TO "anon";
GRANT ALL ON TABLE "public"."journey_order_passenger_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_order_passenger_counts" TO "service_role";



GRANT ALL ON TABLE "public"."journey_passenger_allocations" TO "anon";
GRANT ALL ON TABLE "public"."journey_passenger_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_passenger_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."journey_pax_counts" TO "anon";
GRANT ALL ON TABLE "public"."journey_pax_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_pax_counts" TO "service_role";



GRANT ALL ON TABLE "public"."journey_types" TO "anon";
GRANT ALL ON TABLE "public"."journey_types" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_types" TO "service_role";



GRANT ALL ON TABLE "public"."journey_vehicle_allocations" TO "anon";
GRANT ALL ON TABLE "public"."journey_vehicle_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_vehicle_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."journey_vehicle_allocs" TO "anon";
GRANT ALL ON TABLE "public"."journey_vehicle_allocs" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_vehicle_allocs" TO "service_role";



GRANT ALL ON TABLE "public"."journey_vehicle_overrides" TO "anon";
GRANT ALL ON TABLE "public"."journey_vehicle_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_vehicle_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."journey_vehicles" TO "anon";
GRANT ALL ON TABLE "public"."journey_vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."journey_vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."journeys_needing_assignment" TO "anon";
GRANT ALL ON TABLE "public"."journeys_needing_assignment" TO "authenticated";
GRANT ALL ON TABLE "public"."journeys_needing_assignment" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_transactions" TO "anon";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."operator_available_journeys" TO "anon";
GRANT ALL ON TABLE "public"."operator_available_journeys" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_available_journeys" TO "service_role";



GRANT ALL ON TABLE "public"."operator_bookings_with_pax" TO "anon";
GRANT ALL ON TABLE "public"."operator_bookings_with_pax" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_bookings_with_pax" TO "service_role";



GRANT ALL ON TABLE "public"."operator_crew_codes" TO "anon";
GRANT ALL ON TABLE "public"."operator_crew_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_crew_codes" TO "service_role";



GRANT ALL ON TABLE "public"."operator_journeys_performed" TO "anon";
GRANT ALL ON TABLE "public"."operator_journeys_performed" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_journeys_performed" TO "service_role";



GRANT ALL ON TABLE "public"."operator_payout_items" TO "anon";
GRANT ALL ON TABLE "public"."operator_payout_items" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_payout_items" TO "service_role";



GRANT ALL ON TABLE "public"."operator_payouts" TO "anon";
GRANT ALL ON TABLE "public"."operator_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."operator_staff" TO "anon";
GRANT ALL ON TABLE "public"."operator_staff" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_staff" TO "service_role";



GRANT ALL ON TABLE "public"."operator_staff_active" TO "anon";
GRANT ALL ON TABLE "public"."operator_staff_active" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_staff_active" TO "service_role";



GRANT ALL ON TABLE "public"."operator_transport_types" TO "anon";
GRANT ALL ON TABLE "public"."operator_transport_types" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_transport_types" TO "service_role";



GRANT ALL ON TABLE "public"."order_guests" TO "anon";
GRANT ALL ON TABLE "public"."order_guests" TO "authenticated";
GRANT ALL ON TABLE "public"."order_guests" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."order_passenger_assignments" TO "anon";
GRANT ALL ON TABLE "public"."order_passenger_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."order_passenger_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."orders_paid_by_route_date" TO "anon";
GRANT ALL ON TABLE "public"."orders_paid_by_route_date" TO "authenticated";
GRANT ALL ON TABLE "public"."orders_paid_by_route_date" TO "service_role";



GRANT ALL ON TABLE "public"."partner_application_places" TO "anon";
GRANT ALL ON TABLE "public"."partner_application_places" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_application_places" TO "service_role";



GRANT ALL ON TABLE "public"."partner_applications" TO "anon";
GRANT ALL ON TABLE "public"."partner_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_applications" TO "service_role";



GRANT ALL ON TABLE "public"."passenger_allocations" TO "anon";
GRANT ALL ON TABLE "public"."passenger_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."passenger_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."passenger_vehicle_assignments" TO "anon";
GRANT ALL ON TABLE "public"."passenger_vehicle_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."passenger_vehicle_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."passengers" TO "anon";
GRANT ALL ON TABLE "public"."passengers" TO "authenticated";
GRANT ALL ON TABLE "public"."passengers" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."quote_intents" TO "anon";
GRANT ALL ON TABLE "public"."quote_intents" TO "authenticated";
GRANT ALL ON TABLE "public"."quote_intents" TO "service_role";



GRANT ALL ON TABLE "public"."route_capacity_active" TO "anon";
GRANT ALL ON TABLE "public"."route_capacity_active" TO "authenticated";
GRANT ALL ON TABLE "public"."route_capacity_active" TO "service_role";



GRANT ALL ON TABLE "public"."route_day_inventory" TO "anon";
GRANT ALL ON TABLE "public"."route_day_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."route_day_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."route_departures" TO "anon";
GRANT ALL ON TABLE "public"."route_departures" TO "authenticated";
GRANT ALL ON TABLE "public"."route_departures" TO "service_role";



GRANT ALL ON TABLE "public"."route_durations" TO "anon";
GRANT ALL ON TABLE "public"."route_durations" TO "authenticated";
GRANT ALL ON TABLE "public"."route_durations" TO "service_role";



GRANT ALL ON TABLE "public"."route_inventory_status" TO "anon";
GRANT ALL ON TABLE "public"."route_inventory_status" TO "authenticated";
GRANT ALL ON TABLE "public"."route_inventory_status" TO "service_role";



GRANT ALL ON TABLE "public"."route_transport_metrics" TO "anon";
GRANT ALL ON TABLE "public"."route_transport_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."route_transport_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."route_transport_types" TO "anon";
GRANT ALL ON TABLE "public"."route_transport_types" TO "authenticated";
GRANT ALL ON TABLE "public"."route_transport_types" TO "service_role";



GRANT ALL ON TABLE "public"."secrets" TO "anon";
GRANT ALL ON TABLE "public"."secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."secrets" TO "service_role";



GRANT ALL ON TABLE "public"."soldout_overrides" TO "anon";
GRANT ALL ON TABLE "public"."soldout_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."soldout_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."staff_availability" TO "anon";
GRANT ALL ON TABLE "public"."staff_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_availability" TO "service_role";



GRANT ALL ON TABLE "public"."staff_role_certifications" TO "anon";
GRANT ALL ON TABLE "public"."staff_role_certifications" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_role_certifications" TO "service_role";



GRANT ALL ON TABLE "public"."tax_fees" TO "anon";
GRANT ALL ON TABLE "public"."tax_fees" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_fees" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tax_fees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tax_fees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tax_fees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tips_ledger" TO "anon";
GRANT ALL ON TABLE "public"."tips_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."tips_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."transport_type_places" TO "anon";
GRANT ALL ON TABLE "public"."transport_type_places" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_type_places" TO "service_role";



GRANT ALL ON TABLE "public"."transport_type_roles" TO "anon";
GRANT ALL ON TABLE "public"."transport_type_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_type_roles" TO "service_role";



GRANT ALL ON TABLE "public"."un_countries" TO "anon";
GRANT ALL ON TABLE "public"."un_countries" TO "authenticated";
GRANT ALL ON TABLE "public"."un_countries" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT SELECT ON TABLE "public"."users" TO "authenticated";



GRANT UPDATE("first_name") ON TABLE "public"."users" TO "authenticated";



GRANT UPDATE("last_name") ON TABLE "public"."users" TO "authenticated";



GRANT UPDATE("mobile") ON TABLE "public"."users" TO "authenticated";



GRANT UPDATE("country_code") ON TABLE "public"."users" TO "authenticated";



GRANT ALL ON TABLE "public"."v_crew_assignments_min" TO "anon";
GRANT ALL ON TABLE "public"."v_crew_assignments_min" TO "authenticated";
GRANT ALL ON TABLE "public"."v_crew_assignments_min" TO "service_role";



GRANT ALL ON TABLE "public"."v_journey_ui_labels" TO "anon";
GRANT ALL ON TABLE "public"."v_journey_ui_labels" TO "authenticated";
GRANT ALL ON TABLE "public"."v_journey_ui_labels" TO "service_role";



GRANT ALL ON TABLE "public"."v_journey_vehicle_load" TO "anon";
GRANT ALL ON TABLE "public"."v_journey_vehicle_load" TO "authenticated";
GRANT ALL ON TABLE "public"."v_journey_vehicle_load" TO "service_role";



GRANT ALL ON TABLE "public"."v_occurrence_vehicle_stats" TO "anon";
GRANT ALL ON TABLE "public"."v_occurrence_vehicle_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."v_occurrence_vehicle_stats" TO "service_role";



GRANT ALL ON TABLE "public"."v_operator_codes" TO "anon";
GRANT ALL ON TABLE "public"."v_operator_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."v_operator_codes" TO "service_role";



GRANT ALL ON TABLE "public"."v_operator_journey_load" TO "anon";
GRANT ALL ON TABLE "public"."v_operator_journey_load" TO "authenticated";
GRANT ALL ON TABLE "public"."v_operator_journey_load" TO "service_role";



GRANT ALL ON TABLE "public"."v_operator_journey_status" TO "anon";
GRANT ALL ON TABLE "public"."v_operator_journey_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_operator_journey_status" TO "service_role";



GRANT ALL ON TABLE "public"."v_operator_occurrences_confirmed" TO "anon";
GRANT ALL ON TABLE "public"."v_operator_occurrences_confirmed" TO "authenticated";
GRANT ALL ON TABLE "public"."v_operator_occurrences_confirmed" TO "service_role";



GRANT ALL ON TABLE "public"."v_operator_occurrences_under_consideration" TO "anon";
GRANT ALL ON TABLE "public"."v_operator_occurrences_under_consideration" TO "authenticated";
GRANT ALL ON TABLE "public"."v_operator_occurrences_under_consideration" TO "service_role";



GRANT ALL ON TABLE "public"."v_operator_staff_min" TO "anon";
GRANT ALL ON TABLE "public"."v_operator_staff_min" TO "authenticated";
GRANT ALL ON TABLE "public"."v_operator_staff_min" TO "service_role";



GRANT ALL ON TABLE "public"."v_operator_unassigned_journeys" TO "anon";
GRANT ALL ON TABLE "public"."v_operator_unassigned_journeys" TO "authenticated";
GRANT ALL ON TABLE "public"."v_operator_unassigned_journeys" TO "service_role";



GRANT ALL ON TABLE "public"."v_order_history" TO "anon";
GRANT ALL ON TABLE "public"."v_order_history" TO "authenticated";
GRANT ALL ON TABLE "public"."v_order_history" TO "service_role";



GRANT ALL ON TABLE "public"."v_order_receipt" TO "anon";
GRANT ALL ON TABLE "public"."v_order_receipt" TO "authenticated";
GRANT ALL ON TABLE "public"."v_order_receipt" TO "service_role";



GRANT ALL ON TABLE "public"."v_route_legs" TO "anon";
GRANT ALL ON TABLE "public"."v_route_legs" TO "authenticated";
GRANT ALL ON TABLE "public"."v_route_legs" TO "service_role";



GRANT ALL ON TABLE "public"."v_vehicle_names" TO "anon";
GRANT ALL ON TABLE "public"."v_vehicle_names" TO "authenticated";
GRANT ALL ON TABLE "public"."v_vehicle_names" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_allocations" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."vw_route_day_capacity" TO "anon";
GRANT ALL ON TABLE "public"."vw_route_day_capacity" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_route_day_capacity" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_capacity_next_14d" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_capacity_next_14d" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_capacity_next_14d" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journey_capacity" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journey_capacity" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journey_capacity" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts_t24" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts_t24" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts_t24" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts_t72" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts_t72" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journey_headcounts_t72" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journey_manifest" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journey_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journey_manifest" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journey_manifest_v2" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journey_manifest_v2" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journey_manifest_v2" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journey_overview" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journey_overview" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journey_overview" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_groups" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_groups" TO "service_role";



GRANT ALL ON TABLE "public"."vw_route_day_groups" TO "anon";
GRANT ALL ON TABLE "public"."vw_route_day_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_route_day_groups" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_journeys_day" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_journeys_day" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_journeys_day" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_manifest" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_manifest" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_manifest_passengers" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_manifest_passengers" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_manifest_passengers" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_manifest_t24" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_manifest_t24" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_manifest_t24" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_manifest_t72" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_manifest_t72" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_manifest_t72" TO "service_role";



GRANT ALL ON TABLE "public"."vw_booked_seats_by_route_day" TO "anon";
GRANT ALL ON TABLE "public"."vw_booked_seats_by_route_day" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_booked_seats_by_route_day" TO "service_role";



GRANT ALL ON TABLE "public"."vw_booked_seats_by_route_day_fixed" TO "anon";
GRANT ALL ON TABLE "public"."vw_booked_seats_by_route_day_fixed" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_booked_seats_by_route_day_fixed" TO "service_role";



GRANT ALL ON TABLE "public"."vw_booking_seat_counts_by_vehicle" TO "anon";
GRANT ALL ON TABLE "public"."vw_booking_seat_counts_by_vehicle" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_booking_seat_counts_by_vehicle" TO "service_role";



GRANT ALL ON TABLE "public"."vw_groups_by_journey" TO "anon";
GRANT ALL ON TABLE "public"."vw_groups_by_journey" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_groups_by_journey" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_group_manifest" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_group_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_group_manifest" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_group_sizes" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_group_sizes" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_group_sizes" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_manifest" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_manifest" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_manifest_with_vehicle" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_manifest_with_vehicle" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_manifest_with_vehicle" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_passenger_manifest" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_passenger_manifest" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_passenger_manifest" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_vehicle_capacity" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_vehicle_capacity" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_vehicle_capacity" TO "service_role";



GRANT ALL ON TABLE "public"."vw_journey_vehicle_remaining" TO "anon";
GRANT ALL ON TABLE "public"."vw_journey_vehicle_remaining" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_journey_vehicle_remaining" TO "service_role";



GRANT ALL ON TABLE "public"."vw_manifest_journey_passengers" TO "anon";
GRANT ALL ON TABLE "public"."vw_manifest_journey_passengers" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_manifest_journey_passengers" TO "service_role";



GRANT ALL ON TABLE "public"."vw_manifest_journey_summary" TO "anon";
GRANT ALL ON TABLE "public"."vw_manifest_journey_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_manifest_journey_summary" TO "service_role";



GRANT ALL ON TABLE "public"."vw_manifest_passengers" TO "anon";
GRANT ALL ON TABLE "public"."vw_manifest_passengers" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_manifest_passengers" TO "service_role";



GRANT ALL ON TABLE "public"."vw_paid_seats_by_route_date" TO "anon";
GRANT ALL ON TABLE "public"."vw_paid_seats_by_route_date" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_paid_seats_by_route_date" TO "service_role";



GRANT ALL ON TABLE "public"."vw_per_boat_allocations" TO "anon";
GRANT ALL ON TABLE "public"."vw_per_boat_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_per_boat_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."vw_route_capacity" TO "anon";
GRANT ALL ON TABLE "public"."vw_route_capacity" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_route_capacity" TO "service_role";



GRANT ALL ON TABLE "public"."vw_remaining_by_route_date" TO "anon";
GRANT ALL ON TABLE "public"."vw_remaining_by_route_date" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_remaining_by_route_date" TO "service_role";



GRANT ALL ON TABLE "public"."vw_route_day_capacity_fixed" TO "anon";
GRANT ALL ON TABLE "public"."vw_route_day_capacity_fixed" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_route_day_capacity_fixed" TO "service_role";



GRANT ALL ON TABLE "public"."vw_seat_counts_by_vehicle" TO "anon";
GRANT ALL ON TABLE "public"."vw_seat_counts_by_vehicle" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_seat_counts_by_vehicle" TO "service_role";



GRANT ALL ON TABLE "public"."vw_soldout_keys" TO "anon";
GRANT ALL ON TABLE "public"."vw_soldout_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_soldout_keys" TO "service_role";



GRANT ALL ON TABLE "public"."wl_availability" TO "anon";
GRANT ALL ON TABLE "public"."wl_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."wl_availability" TO "service_role";



GRANT ALL ON TABLE "public"."wl_payments" TO "anon";
GRANT ALL ON TABLE "public"."wl_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."wl_payments" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
