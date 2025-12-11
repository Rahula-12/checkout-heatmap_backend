import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { OpenRouter } from "@openrouter/sdk";

const openrouter = new OpenRouter({
  apiKey: process.env.API_KEY  // <-- Keep your key safe!
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

const eventCounts = {};

// POST /event
app.post('/event', (req, res) => {
  const { eventType } = req.body;
  if (!eventType) {
    return res.status(400).json({ message: 'Missing eventType' });
  }
  eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
  res.json({ message: 'Event recorded', eventCounts });
});

// GET /counts
app.get('/counts', (req, res) => {
  res.json(eventCounts);
});

// GET /insights
app.get('/insights', async (req, res) => {
  try {
    const eventSummary = Object.entries(eventCounts)
      .map(([event, count]) => `${event}: ${count}`)
      .join('; ');
    const prompt = `
You are an analytics assistant. Given these event counts: ${eventSummary}
Generate 1-2 actionable insights or UX improvement suggestions for the dashboard.
Format as a short paragraph.
`;
    const stream = await openrouter.chat.send({
      model: "arcee-ai/trinity-mini:free",
      messages: [
        { role: "user", content: prompt }
      ],
      stream: true,
      streamOptions: {
        includeUsage: true
      }
    });

    let insightText = "";
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        insightText += content;
      }
    }

    res.json({ insights: insightText, counts: eventCounts });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
