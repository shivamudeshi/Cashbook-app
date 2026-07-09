// Claude API. The key comes off the device at call time (storage.js) and the
// only network destination in this app is api.anthropic.com.
import { loadApiKey } from "./storage.js";

export const MODEL = "claude-sonnet-5";

export async function askClaude(system, userText) {
  const key = await loadApiKey();
  if (!key) throw new Error("No API key — add one in Setup.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
