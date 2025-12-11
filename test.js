import { OpenRouter } from "@openrouter/sdk";

const openrouter = new OpenRouter({
  apiKey: "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"
});

// Stream the response to get reasoning tokens in usage
const stream = await openrouter.chat.send({
  model: "arcee-ai/trinity-mini:free",
  messages: [
    {
      role: "user",
      content: "explaij me quantum computing. "
    }
  ],
  stream: true,
  streamOptions: {
    includeUsage: true
  }
});

let response = "";
for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    response += content;
    process.stdout.write(content);
  }
  
  // Usage information comes in the final chunk
  if (chunk.usage) {
    console.log("\nReasoning tokens:", chunk.usage.reasoningTokens);
  }
}