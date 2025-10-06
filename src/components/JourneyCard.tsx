"use client";

import Image from "next/image";

export function JourneyCard(props: {
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
}) {
  const {
    pickupName, pickupImg, destName, destImg, dateISO, timeStr,
    durationMins, vehicleType, soldOut, priceLabel, lowSeats,
    errorMsg, seats, onSeatsChange, onContinue, continueDisabled
  } = props;

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="flex">
        <div className="w-1/2 relative aspect-[4/3]">
          <Image
            src={pickupImg || "/placeholder.png"}
            alt={pickupName}
            fill
            unoptimized
            className="object-cover"
            sizes="50vw"
          />
        </div>
        <div className="w-1/2 relative aspect-[4/3]">
          <Image
            src={destImg || "/placeholder.png"}
            alt={destName}
            fill
            unoptimized
            className="object-cover"
            sizes="50vw"
          />
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="text-sm font-medium">
          {pickupName} → {destName}
        </div>

        <div className="text-xs text-neutral-600" suppressHydrationWarning>
          {new Date(dateISO + "T12:00:00").toLocaleDateString()} · {timeStr}
          {typeof durationMins === "number" ? ` · ${durationMins} mins` : ""}
        </div>

        <div className="text-xs text-neutral-600">{vehicleType}</div>

        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{soldOut ? "Sold out" : priceLabel}</div>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={seats}
            onChange={(e) => onSeatsChange(parseInt(e.target.value))}
            disabled={soldOut}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
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
          className="w-full mt-1 px-3 py-2 rounded-lg text-white text-sm"
          onClick={onContinue}
          disabled={!!continueDisabled}
          style={{ backgroundColor: continueDisabled ? "#9ca3af" : "#2563eb" }}
        >
          {soldOut ? "Sold out" : "Continue"}
        </button>
      </div>
    </div>
  );
}
