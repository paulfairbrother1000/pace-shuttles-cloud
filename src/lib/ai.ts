// src/lib/ai.ts
export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input: texts,
      model: "text-embedding-3-small", // 1536 dims
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "Embedding failed");
  return json.data.map((d: any) => d.embedding as number[]);
}

export async function chatComplete(messages: Array<{role:"system"|"user"|"assistant"; content:string}>) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "Completion failed");
  return json.choices[0]?.message?.content || "";
}
