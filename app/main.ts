import OpenAI from "openai";
import { readFileSync } from "fs";

function executeTool(name: string, args: any): string {
  try {
    if (name === "Read") {
      return readFileSync(args.file_path, "utf8");
    }
    
    return `Error: unknown tool ${name}`; 
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (flag !== "-p" || !prompt) {
    throw new Error("error: -p flag is required");
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];

  while (true) {
    const response = await client.chat.completions.create({
      // using anthropic/claude-haiku-4.5 and deepseek/deepseek-v4.1-flash-1017
      model: "anthropic/claude-haiku-4.5",
      messages,
      tools: [
        {
          type: "function",
          function: {
            name: "Read",
            description: "Read and return the contents of a file",
            parameters: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "The path to the file to read",
                }
              },
              required: ["file_path"],
            }
          }
        }
      ]
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      console.log(message.content);
      break;
    }

    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;

      const args = JSON.parse(call.function.arguments);
      const result = executeTool(call.function.name, args);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result, 
      });
    }
  }
}

main();
