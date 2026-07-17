import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiWithRetry(system, message, jsonMode, retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          ...(jsonMode ? { response_mime_type: "application/json" } : {}),
        },
      }),
    });

    // 503 = model overloaded ("high demand"). Retry with a short backoff.
    // 429 = rate limited. Also worth a brief retry.
    if ((response.status === 503 || response.status === 429) && attempt < retries) {
      const delay = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
      console.warn(`Gemini busy (${response.status}), retrying in ${delay}ms… (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
      continue;
    }

    return response;
  }
}

app.post("/api/claude", async (req, res) => {
  const { system, message, jsonMode } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    const response = await callGeminiWithRetry(system, message, jsonMode);
    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);
      const friendly =
        response.status === 503
          ? "Gemini is at capacity right now — try again in a moment."
          : "Gemini API request failed.";
      return res.status(response.status).json({ error: friendly, details: data });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    res.json({ text });
  } catch (err) {
    console.error("Failed to reach Gemini API:", err);
    res.status(500).json({ error: "Failed to reach Gemini API" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`VibeForge API server running at http://localhost:${PORT}`));