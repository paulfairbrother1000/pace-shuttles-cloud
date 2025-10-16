// src/components/Nav/RoleSwitch.tsx
"use client";

type Role = "operator" | "site";

type Props = {
  active: Role;                 // "operator" | "site"
  show?: boolean;               // set true only if the user has both roles
  operatorHref?: string;        // default "/operator/admin"
  siteHref?: string;            // default "/admin"
  className?: string;
};

export default function RoleSwitch({
  active,
  show = false,
  operatorHref = "/operator/admin",
  siteHref = "/admin",
  className = "",
}: Props) {
  if (!show) return null;

  return (
    <div className={"mt-14 mx-4 inline-flex p-1 rounded-2xl bg-neutral-100 border border-neutral-200 shadow-inner " + className}
         role="tablist" aria-label="Admin role">
      <a
        href={operatorHref}
        role="tab"
        aria-selected={active === "operator"}
        className={
          "px-4 py-2 rounded-2xl text-sm font-medium transition " +
          (active === "operator" ? "bg-white border border-neutral-200 shadow" : "text-neutral-600 hover:bg-white/60")
        }
      >
        Operator Admin
      </a>
      <a
        href={siteHref}
        role="tab"
        aria-selected={active === "site"}
        className={
          "px-4 py-2 rounded-2xl text-sm font-medium transition " +
          (active === "site" ? "bg-white border border-neutral-200 shadow" : "text-neutral-600 hover:bg-white/60")
        }
      >
        Site Admin
      </a>
    </div>
  );
}
