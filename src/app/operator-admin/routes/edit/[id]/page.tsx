import { redirect } from "next/navigation";
export default function Page({ params, searchParams }:{params:{id:string},searchParams:Record<string,string>}) {
  const q = new URLSearchParams(searchParams).toString();
  redirect(`/admin/routes/edit/${params.id}${q ? `?${q}` : ""}`);
}
