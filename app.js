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
    const {
      sessionId,
      pageUrl,
      currentPage,
      userAgent,
      viewport,
      clicks,
      mouseMovements,
      scrolls,
      timeOnPage,
      paymentId,
      timestamp,
      sessionStatus,
      conversionTime,
      rageClicks,
      isFinal
    } = req.body;
  
    // Validation omitted for clarity
  
    // --- NEW: Update eventCounts ---
  
    // Count by pageUrl
    if (pageUrl) {
      eventCounts["pages"] = eventCounts["pages"] || {};
      eventCounts["pages"][pageUrl] = (eventCounts["pages"][pageUrl] || 0) + 1;
    }
    // Count clicks for the page
    if (clicks && Array.isArray(clicks) && pageUrl) {
      eventCounts["clicks"] = eventCounts["clicks"] || {};
      eventCounts["clicks"][pageUrl] = (eventCounts["clicks"][pageUrl] || 0) + clicks.length;
    }
    // Count sessions
    if (sessionId) {
      eventCounts["sessions"] = eventCounts["sessions"] || {};
      if (!eventCounts["sessions"][sessionId]) {
        eventCounts["sessions"][sessionId] = 1;
      }
      // Optionally, you could store session-level details or just count unique sessions
    }
    // (Extend: Mouse moves, scrolls, rageClicks, etc.)
    // Example: Aggregate total events (optional)
    eventCounts["totalEvents"] = (eventCounts["totalEvents"] || 0) + 1;
  
    // --- Store in-memory for demo/demo analytics
    if (!global.fullEventStore) {
      global.fullEventStore = [];
    }
    global.fullEventStore.push(req.body);
  
    res.json({
      message: 'Event data received',
      received: req.body
    });
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
    // Split on double newlines, list numbers, or big bullets, but keep line order
    const sections = text
      .split(/\n{2,}|(?=\n?\d+\.\s)/)
      .filter(Boolean)
      .map(s => s.trim())
      .filter(Boolean);
  
    const results = [];
  
    for (let sec of sections) {
      // Remove leading list/bullet/number marker, extra markup
      sec = sec.replace(/^\s*-?\d+\.\s*/, '').replace(/^\s*\*\s*/, '').trim();
  
      // Try to segment out UX Suggestion, UX Recommendation, Recommendation, etc
      let suggestion = '';
      let insight = sec;
  
      // Handles: **UX Suggestion:**, UX Suggestion:, * UX Suggestion:
      const suggestionRegex = /(.*?)(?:[\n\*]*)?(?:\*\*?\s*)?(UX( |-)?)?Suggestion(s)?(:|：)?\*{0,2}\s*(.*)/i;
  
      let match = suggestionRegex.exec(sec);
      if (match && match[6]) {
        insight = (match[1] || '').replace(/[\*\-\s]+$/, '').trim();
        suggestion = match[6].trim();
      }
  
      // Further fallback: If suggestion is still empty, check for lines starting with Suggestion after an "Insight"
      if (!suggestion) {
        const lines = sec.split('\n').map(l => l.trim()).filter(Boolean);
        let found = false;
        lines.forEach(line => {
          if (/suggestion[:：]/i.test(line)) {
            suggestion = line.replace(/.*suggestion[:：]\s*/i, '').trim();
            found = true;
          }
        });
        if (found) {
          insight = lines.filter(line => !/suggestion[:：]/i.test(line)).join(' ');
        }
      }
  
      // Fallback: If only one line, treat as insight, empty suggestion
      if (!insight && suggestion) {
        insight = '';
      }
      if (!suggestion && insight) {
        // Try to split on ". " and treat first as insight if it looks like two sentences merged
        const split = insight.split(/\. (?![a-z])/i);
        if (split.length > 1) {
          insight = split[0] + '.';
          suggestion = split.slice(1).join('. ');
        }
      }
  
      // Clean up
      results.push({
        insight: insight.trim(),
        suggestion: suggestion.trim()
      });
    }
  
    return results.filter(pair => pair.insight || pair.suggestion);
  }
  
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
