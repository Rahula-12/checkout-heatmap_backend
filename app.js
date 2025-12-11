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

    // Post-process output
    insightText = insightText.trim().replace(/^[\\s\\n]+|[\\s\\n]+$/g, ''); // remove excess newlines/space
    // Optionally replace double newline with single for compactness
    insightText = insightText.replace(/\\n{2,}/g, '\\n');
    let response=beautifyAndSegregateInsights(insightText);

    if (!insightText) {
      insightText = "No insights generated. There may not be enough event data yet.";
    }

    res.json(response);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

function beautifyAndSegregateInsights(text) {
    // 1. Normalize text and split into logical sections (by numbering or newlines)
    const sections = text.split(/\n{2,}|\r\n\r\n|(?=\n?\d+\.\s)/).filter(Boolean);
    const results = [];
  
    // 2. Parse each section for insight/suggestion pairs
    for (let sec of sections) {
      // Remove leading numbering or bullets
      sec = sec.replace(/^\s*-?\d+\.\s*/, '').trim();
  
      // Try to find Insight and Suggestion pairs
      let insight = null, suggestion = null;
  
      // Most common pattern: "**Insight:** ... **UX Suggestion:** ..."
      // or "Insight: ..." or "* Insight: ..."
      let insightMatch = sec.match(/(?:\*+|\s*)Insight:?\*+?\s*(.*?)(?:\n|$)/i);
      if (insightMatch) {
        insight = insightMatch[1].trim();
        // Look for suggestion immediately after
        let suggMatch = sec.match(/(UX|User.*?)?(Suggestion)[:：]?\*+?\s*(.*)/i);
        if (suggMatch) suggestion = suggMatch[3].trim();
      } else {
        // Try splitting by lines and keywords if markdown not present
        const lines = sec.split(/\n|\r\n/).map(l => l.trim()).filter(Boolean);
        lines.forEach(line => {
          if (!insight && /insight/i.test(line)) {
            insight = line.replace(/insight[:：]?\s*/i, '').replace(/^\W+/, '').trim();
          }
          if (!suggestion && /suggestion/i.test(line)) {
            suggestion = line.replace(/(ux|user)?.*suggestion[:：]?\s*/i, '').replace(/^\W+/, '').trim();
          }
        });
      }
  
      // If not structured, just grab first half as insight, second as suggestion as fallback
      if (!insight || !suggestion) {
        const fallback = sec.split(/[\*\:]\s?/).map(l => l.trim()).filter(Boolean);
        insight = insight || fallback[0] || '';
        suggestion = suggestion || fallback.slice(1).join(' ') || '';
      }
  
      // Clean up any leading markdown or bullet chars
      if (insight) insight = insight.replace(/^[\*\-\s]+/, '').trim();
      if (suggestion) suggestion = suggestion.replace(/^[\*\-\s]+/, '').trim();
  
      // Push if at least one field is non-empty
      if (insight || suggestion) {
        results.push({
          insight,
          suggestion
        });
      }
    }
    return results;
  }
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
