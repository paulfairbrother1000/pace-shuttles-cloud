// src/lib/agent/tools/bookings.ts
import type { ToolDefinition, ToolContext } from "./index";
import { choice } from "@/lib/agent/agent-schema";

export function bookingTools({ supabase }: ToolContext): ToolDefinition[] {
  return [
    {
      spec: {
        type: "function",
        function: {
          name: "my_bookings",
          description: "List bookings for logged-in user",
          parameters: {}
        }
      },
      run: async (_args, ctx) => {
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) {
          return {
            messages: [
              { role: "assistant", content: "Please sign in to see your bookings." }
            ]
          };
        }

        const { data, error } = await supabase
          .from("v_order_history")
          .select("*")
          .eq("user_id", user.id)
          .order("booked_at", { ascending: false });

        if (error) throw error;

        if (!data?.length) {
          return {
            messages: [
              { role: "assistant", content: "You have no bookings yet." }
            ]
          };
        }

        return {
          messages: [
            { role: "assistant", content: "Here are your bookings:" }
          ],
          choices: data.map((row: any) =>
            choice(`${row.pickup_name} → ${row.destination_name}`, {
              type: "booking_detail",
              payload: row
            })
          )
        };
      }
    }
  ];
}
