import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️  OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.");
}

app.post("/api/claude", async (req, res) => {
  const { system, message } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
	const response = await fetch("https://api.openai.com/v1/chat/completions", {
	  method: "POST",
	  headers: {
		"Content-Type": "application/json",
		"Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
	  },
	  body: JSON.stringify({
		model: OPENAI_MODEL,
		max_tokens: 1000,
		messages: [
		  { role: "system", content: system },
		  { role: "user", content: message },
		],
	  }),
	});

	const data = await response.json();
	if (!response.ok) {
	  console.error("OpenAI API error:", data);
	  return res.status(response.status).json({ error: data });
	}

	res.json({ text: data.choices?.[0]?.message?.content || "" });
  } catch (err) {
	console.error("Failed to reach OpenAI API:", err);
	res.status(500).json({ error: "Failed to reach OpenAI API" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`VibeForge API server running at http://localhost:${PORT}`));