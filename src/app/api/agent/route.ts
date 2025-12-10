// ...existing imports & helpers remain unchanged...

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tools = buildTools({ baseUrl, supabase });

    const userMessage = body.messages.findLast(m => m.role === "user");
    if (!userMessage) {
      return NextResponse.json({ error: "No user message" }, { status: 400 });
    }

    const systemPrompt =
      "You are the Pace Shuttles concierge. " +
      "Use the provided tools as your source of truth for where we operate, routes, destinations, pickups, bookings, and vehicle categories. " +
      "Pace Shuttles is a luxury, semi-private transfer service connecting premium coastal destinations (beach clubs, restaurants, islands, marinas) – not a city bus or generic airport shuttle. " +
      "Never invent or reveal operator names or vessel names, even if the user asks; always talk in terms of generic transport categories instead (e.g. luxury boat, helicopter, premium vehicle). " +
      "Keep answers concise, factual, and grounded in tool output or the brand description.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: systemPrompt },
        ...body.messages.map(m => ({
          role: m.role,
          content: m.content
        })),
      ],
      tools: tools.map(t => t.spec),
      tool_choice: "auto"
    });

    const msg = completion.choices[0]?.message;
    if (!msg) {
      return NextResponse.json({ error: "No message returned" }, { status: 500 });
    }

    // tool-call + plain-message handling stays the same...
    if (msg.tool_calls?.length) {
      const toolCall = msg.tool_calls[0];
      const impl = tools.find(t => t.spec.function?.name === toolCall.function.name);

      if (!impl) {
        return NextResponse.json({
          content: `Unknown tool: ${toolCall.function.name}`
        });
      }

      const args = JSON.parse(toolCall.function.arguments || "{}");
      const result: ToolExecutionResult = await impl.run(args);

      const toolMessage: AgentMessage = {
        role: "tool",
        name: toolCall.function.name,
        content: JSON.stringify(result)
      };

      return NextResponse.json<AgentResponse>({
        messages: [...body.messages, toolMessage],
        choices: result.choices || []
      });
    }

    const finalMessage: AgentMessage = {
      role: "assistant",
      content: msg.content || ""
    };

    return NextResponse.json<AgentResponse>({
      messages: [...body.messages, finalMessage],
      choices: []
    });
  } catch (err: any) {
    console.error("Agent error:", err);
    return NextResponse.json(
      { error: err?.message || "Agent failed" },
      { status: 500 }
    );
  }
}
