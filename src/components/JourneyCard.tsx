// src/components/JourneyCard.tsx
"use client";

import Image from "next/image";

type Props = {
  pickupName: string;
  pickupImg?: string;
  destName: string;
  destImg?: string;
  dateISO: string;
  timeStr: string;
  durationMins?: number;
  vehicleType: string;
  soldOut: boolean;
  priceLabel: string;
  lowSeats?: number;
  errorMsg?: string;
  seats: number;
  onSeatsChange: (n: number) => void;
  onContinue: () => void;
  continueDisabled?: boolean;

  /** Drill-down handlers (optional) */
  onOpenPickup?: () => void;
  onOpenDestination?: () => void;
};

export function JourneyCard({
  pickupName,
  pickupImg,
  destName,
  destImg,
  dateISO,
  timeStr,
  durationMins,
  vehicleType,
  soldOut,
  priceLabel,
  lowSeats,
  errorMsg,
  seats,
  onSeatsChange,
  onContinue,
  continueDisabled,
  onOpenPickup,
  onOpenDestination,
}: Props) {
  const pickupSrc = pickupImg || "/placeholder.png";
  const destSrc = destImg || "/placeholder.png";

  const pickupClickable = !!onOpenPickup;
  const destClickable = !!onOpenDestination;

  return (
    <div className="rounded-2xl border bg-white overflow-hidden shadow">
      {/* Top images (clickable if handlers provided) */}
      <div className="grid grid-cols-2 gap-0">
        <button
          type="button"
          onClick={onOpenPickup ?? undefined}
          disabled={!pickupClickable}
          className={`relative aspect-[4/3] overflow-hidden border-r focus:outline-none ${
            pickupClickable ? "focus:ring-2 focus:ring-blue-500 cursor-pointer" : "cursor-default"
          }`}
          aria-label="View pick-up details"
          title={pickupClickable ? "View pick-up details" : undefined}
        >
          <Image
            src={pickupSrc}
            alt={pickupName}
            fill
            unoptimized
            className="object-cover"
            sizes="50vw"
          />
        </button>

        <button
          type="button"
          onClick={onOpenDestination ?? undefined}
          disabled={!destClickable}
          className={`relative aspect-[4/3] overflow-hidden focus:outline-none ${
            destClickable ? "focus:ring-2 focus:ring-blue-500 cursor-pointer" : "cursor-default"
          }`}
          aria-label="View destination details"
          title={destClickable ? "View destination details" : undefined}
        >
          <Image
            src={destSrc}
            alt={destName}
            fill
            unoptimized
            className="object-cover"
            sizes="50vw"
          />
        </button>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        <div className="text-sm font-medium">
          {pickupName} → {destName}
        </div>

        <div className="text-xs text-neutral-600" suppressHydrationWarning>
          {new Date(dateISO + "T12:00:00").toLocaleDateString()} · {timeStr}
          {typeof durationMins === "number" ? ` · ${durationMins} mins` : ""}
        </div>

        {/* vehicle type */}
        <div className="text-xs text-neutral-600">{vehicleType}</div>

        {/* mobile captions: price/seat labels inside the card (brighter + slightly larger) */}
        <div className="mt-1 flex items-center justify-between md:hidden">
          <span className="text-[12px] font-medium text-neutral-300">
            Seat price (incl. tax &amp; fees)
          </span>
          <span className="text-[12px] font-medium text-neutral-300">Seats</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{soldOut ? "Sold out" : priceLabel}</div>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={seats}
            onChange={(e) => onSeatsChange(parseInt(e.target.value))}
            disabled={soldOut}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {lowSeats && !soldOut && (
          <div className="text-[11px] text-amber-700">
            Only {lowSeats} seat{lowSeats === 1 ? "" : "s"} left
          </div>
        )}

        {errorMsg && !soldOut && (
          <div className="text-[11px] text-amber-700">{errorMsg}</div>
        )}

        <button
          className="w-full mt-1 px-3 py-2 rounded-lg text-white text-sm disabled:opacity-60"
          onClick={onContinue}
          disabled={!!continueDisabled}
          style={{ backgroundColor: continueDisabled ? "#9ca3af" : "#2563eb" }}
          aria-disabled={!!continueDisabled}
        >
          {soldOut ? "Sold out" : "Continue"}
        </button>
      </div>
    </div>
  );
}
