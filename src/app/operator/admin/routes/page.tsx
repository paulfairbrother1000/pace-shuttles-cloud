import { redirect } from "next/navigation";

type Search = { [key: string]: string | string[] | undefined };

export default function Page({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Search;
}) {
  const qs = new URLSearchParams(
    Object.entries(searchParams).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]
    ) as [string, string][]
  ).toString();

  redirect(`/operator-admin/routes/${params.id}${qs ? `?${qs}` : ""}`);
}
 