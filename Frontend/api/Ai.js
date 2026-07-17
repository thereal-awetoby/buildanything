const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseImageDataUrl(image) {
  if (!image || typeof image !== "string") return null;
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function callGeminiWithRetry(system, message, jsonMode, image, retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const parts = [{ text: message }];
  const parsedImage = parseImageDataUrl(image);
  if (parsedImage) {
    parts.push({ inline_data: { mime_type: parsedImage.mimeType, data: parsedImage.data } });
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 1000,
          ...(jsonMode ? { response_mime_type: "application/json" } : {}),
        },
      }),
    });

    if ((response.status === 503 || response.status === 429) && attempt < retries) {
      const delay = 500 * Math.pow(2, attempt);
      console.warn(`Gemini busy (${response.status}), retrying in ${delay}ms…`);
      await sleep(delay);
      continue;
    }

    return response;
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { system, message, jsonMode, image } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set in this Vercel project's environment variables.");
    return res.status(500).json({ error: "Server is missing its API key." });
  }

  try {
    const response = await callGeminiWithRetry(system, message, jsonMode, image);
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
    res.status(200).json({ text });
  } catch (err) {
    console.error("Failed to reach Gemini API:", err);
    res.status(500).json({ error: "Failed to reach Gemini API" });
  }
}