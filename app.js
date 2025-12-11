import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { OpenRouter } from "@openrouter/sdk";


const openrouter = new OpenRouter({
  apiKey: process.env.API_KEY
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

if (!global.fullEventStore) {
  global.fullEventStore = [];
}

// Store raw event data
app.post('/event', (req, res) => {
  // You can add validation here if needed!
  global.fullEventStore.push(req.body);
  res.json({ message: 'Event data received', received: req.body });
});

// COUNTS API: Return aggregate stats
app.get('/counts', (req, res) => {
  const events = global.fullEventStore; // all stored events

  const sessions = new Set();
  const clicks = [];
  const mouseMovements = [];
  const scrolls = [];
  const rageClicks = [];
  let totalTimeOnPage = 0;
  let totalConversionTime = 0;
  let conversionCount = 0;

  const pages = {};
  let viewportSum = { width: 0, height: 0 };
  let viewportCount = 0;
  let completedSessions = 0, activeSessions = 0, abandonedSessions = 0;

  events.forEach(ev => {
    sessions.add(ev.sessionId);
    (ev.clicks || []).forEach(c => 
      clicks.push({
        x: c.x, y: c.y, currentPage: c.currentPage, timestamp: c.timestamp
      }));
    (ev.mouseMovements || []).forEach(m => mouseMovements.push(m));
    (ev.scrolls || []).forEach(s => scrolls.push(s));
    (ev.rageClicks || []).forEach(r => rageClicks.push(r));
    const pg = ev.currentPage;
    if (!pages[pg]) pages[pg] = { clicks: 0, sessions: 0 };
    pages[pg].clicks += (ev.clicks ? ev.clicks.length : 0);
    pages[pg].sessions += 1;
    if (ev.timeOnPage) totalTimeOnPage += Number(ev.timeOnPage);
    if (ev.viewport && ev.viewport.width && ev.viewport.height) {
      viewportSum.width += Number(ev.viewport.width);
      viewportSum.height += Number(ev.viewport.height);
      viewportCount++;
    }
    if (ev.conversionTime != null) {
      totalConversionTime += Number(ev.conversionTime);
      conversionCount++;
    }
    if (ev.sessionStatus === 'completed') completedSessions++;
    else if (ev.sessionStatus === 'active') activeSessions++;
    else if (ev.sessionStatus === 'abandoned') abandonedSessions++;
  });

  const averageViewport = {
    width: viewportCount ? Math.round(viewportSum.width / viewportCount) : 0,
    height: viewportCount ? Math.round(viewportSum.height / viewportCount) : 0,
  };
  const averageTimeOnPage = events.length ? Math.round(totalTimeOnPage / events.length) : 0;
  const averageClicks = events.length ? (clicks.length / events.length) : 0;
  const averageTimeToConvert = conversionCount ? Math.round(totalConversionTime / conversionCount) : null;
  const dropOffRate = events.length ? Math.round((abandonedSessions / events.length) * 1000) / 10 : 0;
  const conversionRate = events.length ? Math.round((completedSessions / events.length) * 1000) / 10 : 0;

  const recentClicks = clicks.slice(-50);
  const recentMouseMovements = mouseMovements.slice(-50);
  const recentScrolls = scrolls.slice(-50);
  const recentRageClicks = rageClicks.slice(-50);

  res.json({
    data: {
      totalSessions: sessions.size,
      totalClicks: clicks.length,
      totalMouseMovements: mouseMovements.length,
      totalScrolls: scrolls.length,
      totalTimeOnPage,
      clicks: recentClicks,
      mouseMovements: recentMouseMovements,
      scrolls: recentScrolls,
      rageClicks: recentRageClicks,
      pages,
      averageViewport,
      totalRageClicks: rageClicks.length,
      activeSessions,
      completedSessions,
      abandonedSessions,
      averageTimeToConvert,
      dropOffRate,
      conversionRate,
      averageClicks,
      averageTimeOnPage
    }
  });
});

// INSIGHTS API
app.get('/insights', async (req, res) => {
  try {
    // Generate a summary of events for AI, or use the count data:
    const events = global.fullEventStore;
    const summary = `sessions: ${new Set(events.map(e => e.sessionId)).size}, clicks: ${events.reduce((sum, e) => sum + ((e.clicks || []).length), 0)}, ...`;
    const prompt = `
You are an analytics assistant. Given these event stats: ${summary}
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

    insightText = insightText.trim().replace(/^[\s\n]+|[\s\n]+$/g, '');
    insightText = insightText.replace(/\n{2,}/g, '\n');
    let response = beautifyAndSegregateInsights(insightText);

    if (!insightText) {
      insightText = "No insights generated. There may not be enough event data yet.";
    }

    res.json(response);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
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
