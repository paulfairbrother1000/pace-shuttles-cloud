"use client";

import Image from "next/image";

export type TilePickerItem = {
  id: string;
  name: string;
  description?: string;
  image?: string;
};

export function TilePicker({
  title,
  items,
  selectedId,
  onChoose,
  includeAll = false,
}: {
  title: string;
  items: TilePickerItem[];
  selectedId: string | null;
  onChoose: (id: string | null) => void;
  includeAll?: boolean;
}) {
  return (
    <div className="border-t pt-4">
      <div className="mb-3 text-sm text-neutral-700">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {includeAll && (
          <button
            className={`text-left rounded-2xl border bg-white p-3 hover:shadow-sm transition ${
              !selectedId ? "ring-2 ring-blue-600" : ""
            }`}
            onClick={() => onChoose(null)}
          >
            <div className="font-medium">All</div>
            <div className="text-xs text-neutral-600 mt-1">No filter</div>
          </button>
        )}
        {items.map((it) => (
          <button
            key={it.id}
            className={`text-left rounded-2xl border bg-white overflow-hidden p-0 hover:shadow-sm transition ${
              selectedId === it.id ? "ring-2 ring-blue-600" : ""
            }`}
            onClick={() => onChoose(it.id)}
          >
            <div className="relative w-full">
              <div className="aspect-[4/3]">
                {it.image ? (
                  <Image
                    src={it.image}
                    alt={it.name}
                    fill
                    unoptimized
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                ) : (
                  <div className="h-full w-full bg-neutral-100" />
                )}
              </div>
            </div>
            <div className="p-3">
              <div className="font-medium">{it.name}</div>
              {it.description && (
                <div className="text-xs text-neutral-600 mt-1 line-clamp-3">
                  {it.description}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
