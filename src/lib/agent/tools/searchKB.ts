// src/lib/agent/tools/searchKB.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/**
 * Simple knowledge tool for:
 * - Pace Shuttles overview (static, brand copy)
 * - Destination descriptions (dynamic, from DB)
 *
 * This should be used for conceptual “tell me about…” questions.
 */

const PACE_SHUTTLES_OVERVIEW =
  "Pace Shuttles is a per-seat, semi-private shuttle service linking marinas, hotels and beach clubs across premium coastal and island destinations. Instead of chartering a whole boat or vehicle, guests simply book individual seats on scheduled departures — giving a private-charter feel at a shared price. Routes, pricing and service quality are managed by Pace Shuttles, while trusted local operators run the journeys. This ensures a smooth, reliable, luxury transfer experience every time.";

/**
 * Try to build a human-readable description from a destination row.
 * We deliberately keep this generic and only use data that actually exists
 * on the row, so it will adapt as you enrich the table over time.
 */
function buildDestinationDescription(row: any): string {
  const parts: string[] = [];

  const name = row.name || row.display_name || "This destination";
  parts.push(`${name} is one of the destinations served by Pace Shuttles.`);

  const locBits: string[] = [];
  if (row.town || row.city) locBits.push(row.town || row.city);
  if (row.region || row.island) locBits.push(row.region || row.island);
  if (row.country_name || row.country) {
    locBits.push(row.country_name || row.country);
  }
  if (locBits.length) {
    parts.push(`It is located in ${locBits.join(", ")}.`);
  }

  if (row.description || row.long_description || row.summary) {
    parts.push(String(row.description || row.long_description || row.summary));
  }

  const website =
    row.website || row.website_url || row.url || row.booking_url || null;
  if (website) {
    parts.push(
      `For more details you can visit the destination’s own website: ${website}.`
    );
  }

  parts.push(
    "If you’d like, I can also show you current shuttle journeys serving this destination on specific dates."
  );

  return parts.join(" ");
}

export function kbTools(ctx: ToolContext): ToolDefinition[] {
  const { supabase } = ctx;

  const answerFromKB: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "answerFromKB",
        description:
          "Answer conceptual questions about Pace Shuttles (what it is, how it works, brand positioning) and destinations (e.g. The Cliff, Nobu, Boom, Loose Canon) using a curated overview plus live data from the destinations table. Use this instead of guessing whenever the user says things like 'tell me about Pace Shuttles' or 'what is The Cliff in Barbados like?'.",
        parameters: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description:
                "Required. Short summary of what the user is asking, e.g. 'tell me about Pace Shuttles' or 'tell me about The Cliff in Barbados'.",
            },
            destinationName: {
              type: "string",
              description:
                "If the user is asking about a specific destination or pickup/drop-off point, put the best-guess name here (e.g. 'The Cliff', 'Nobu Antigua', 'Boom').",
            },
          },
          required: ["topic"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const rawTopic = String(args.topic || "").trim();
      const destNameRaw =
        typeof args.destinationName === "string"
          ? args.destinationName.trim()
          : "";

      const topicLower = rawTopic.toLowerCase();
      const searchTerm =
        destNameRaw || rawTopic || ""; // best-effort search string

      // 1) Pace Shuttles overview – always use the short locked-in spiel.
      if (topicLower.includes("pace shuttles")) {
        return {
          messages: [
            {
              role: "assistant",
              content: PACE_SHUTTLES_OVERVIEW,
            },
          ],
        };
      }

      // 2) Destination path – query the destinations table dynamically.
      if (searchTerm) {
        try {
          // Adjust "destinations" and "name" if your schema uses different names.
          const { data, error } = await supabase
            .from("destinations")
            .select("*")
            .ilike("name", `%${searchTerm}%`)
            .limit(5);

          if (error) {
            console.error("answerFromKB destinations error:", error);
            return {
              messages: [
                {
                  role: "assistant",
                  content:
                    "I tried to look that destination up in our catalog but ran into a system error. You can still ask me about routes or dates, or try again in a moment.",
                },
              ],
            };
          }

          if (data && data.length === 1) {
            const desc = buildDestinationDescription(data[0]);
            return {
              messages: [{ role: "assistant", content: desc }],
            };
          }

          if (data && data.length > 1) {
            // Multiple matches – list them and let the model / user disambiguate.
            const names = data
              .map((row: any) => row.name || row.display_name)
              .filter(Boolean);
            return {
              messages: [
                {
                  role: "assistant",
                  content:
                    "I found several destinations that could match what you asked for: " +
                    names.join(" • ") +
                    ". Please tell me which one you mean, and I’ll describe it in more detail.",
                },
              ],
            };
          }

          // No matches in DB
          if (destNameRaw) {
            return {
              messages: [
                {
                  role: "assistant",
                  content:
                    `${destNameRaw} doesn’t appear in our live destinations catalog yet, or it may be stored under a slightly different name. If you tell me the country or nearby area, I can try again or suggest similar stops we do serve.`,
                },
              ],
            };
          }
        } catch (e) {
          console.error("answerFromKB destinations exception:", e);
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "Something went wrong while I was checking our destinations catalog. Please try again in a moment.",
              },
            ],
          };
        }
      }

      // 3) Generic fallback if it’s neither clearly Pace Shuttles nor a known destination.
      return {
        messages: [
          {
            role: "assistant",
            content:
              "I don’t have specific knowledge about that yet, but I can still help with routes, dates or availability if you tell me where and when you’d like to travel.",
          },
        ],
      };
    },
  };

  return [answerFromKB];
}
