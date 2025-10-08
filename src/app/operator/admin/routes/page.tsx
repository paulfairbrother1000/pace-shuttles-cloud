import { redirect } from "next/navigation";

export default function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams(
    Object.entries(searchParams).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]
    ) as [string, string][]
  ).toString();

  redirect(`/operator-admin/routes${qs ? `?${qs}` : ""}`);
}
