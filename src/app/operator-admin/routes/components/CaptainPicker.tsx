"use client";

import React from "react";

type UUID = string;

export type CaptainCandidate = {
  id: UUID;
  first_name: string | null;
  last_name: string | null;
  // Optional: if you have a numeric score, you can map it to this before passing in
  fairuse_level?: "low" | "medium" | "high";
};

type Props = {
  /** List of eligible captains to choose from */
  candidates: CaptainCandidate[];
  /** Currently selected captain id (if any) */
  value?: UUID | "";
  /** Called when a different captain is selected */
  onChange: (id: UUID | "") => void;
  /** Called when the Assign button is pressed */
  onAssign: () => void;
  /** Disable the controls */
  disabled?: boolean;
  /** Show “Assigning…” state */
  assigning?: boolean;
};

/** Small pill showing fair-use status for the selected captain */
function FairUseBadge({ level }: { level?: "low" | "medium" | "high" }) {
  if (!level) return null;

  const tone =
    level === "low"
      ? { bg: "#dcfce7", fg: "#166534", label: "Fair-use: low" }
      : level === "medium"
      ? { bg: "#fef3c7", fg: "#92400e", label: "Fair-use: medium" }
      : { bg: "#fee2e2", fg: "#991b1b", label: "Fair-use: high" };

  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[11px]"
      style={{ background: tone.bg, color: tone.fg }}
      title="Based on the fair-use window (last 30 days / 20 assignments fallback)"
    >
      {tone.label}
    </span>
  );
}

/**
 * CaptainPicker
 * A compact selector + Assign button, with a fair-use badge for the selected captain.
 * Works inside tables (Operator Admin page) and simple forms.
 */
export default function CaptainPicker({
  candidates,
  value = "",
  onChange,
  onAssign,
  disabled = false,
  assigning = false,
}: Props) {
  const selected = candidates.find((c) => c.id === value);

  return (
    <div className="flex items-center gap-2">
      <select
        className="border rounded px-2 py-1 text-sm min-w-48"
        value={value}
        onChange={(e) => onChange((e.target.value as UUID) || "")}
        disabled={disabled || candidates.length === 0}
      >
        <option value="">{candidates.length ? "Select captain…" : "No captains"}</option>
        {candidates.map((c) => {
          const name = `${c.last_name || ""} ${c.first_name || ""}`.trim() || "Unnamed";
          // we can hint fair-use in the option label text as well
          const hint =
            c.fairuse_level === "high"
              ? " (high)"
              : c.fairuse_level === "medium"
              ? " (med)"
              : c.fairuse_level === "low"
              ? " (low)"
              : "";
          return (
            <option key={c.id} value={c.id}>
              {name}
              {hint}
            </option>
          );
        })}
      </select>

      <button
        className="px-2 py-1 rounded text-xs text-white disabled:opacity-40"
        style={{ backgroundColor: "#111827" }}
        disabled={disabled || assigning || !value}
        onClick={onAssign}
      >
        {assigning ? "Assigning…" : "Assign"}
      </button>

      {/* Fair-use badge for the currently selected captain */}
      {selected && <FairUseBadge level={selected.fairuse_level} />}
    </div>
  );
}
