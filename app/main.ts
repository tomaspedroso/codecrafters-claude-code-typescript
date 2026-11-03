import OpenAI from "openai";
import { readFileSync, writeFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { expandSkillPrompt, scanSkills } from "./skill";

const execAsync = promisify(exec);

async function executeTool(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case "Read":
        return readFileSync(args.file_path, "utf8");

      case "Write":
        writeFileSync(args.file_path, args.content);
        return `Wrote ${args.content.length} characters to ${args.file_path}`;

      case "Bash": {
        try {
          const { stdout, stderr } = await execAsync(args.command);
          return `${stdout}${stderr}`;
        } catch (err: any) {
          // exec rejects on a non-zero exit; keep the output so the model sees the failure
          return `${err.stdout ?? ""}${err.stderr ?? ""}\nExit code: ${err.code}`;
        }
      }

      default:
        return `Error: unknown tool ${name}`;
    }
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

  const skills = scanSkills();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...(skills ? [{ role: "system" as const, content: skills }] : []),
    { role: "user", content: expandSkillPrompt(prompt) },
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
        },
        {
          type: "function",
          function: {
            name: "Write",
            description: "Write content to a file",
            parameters: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "The path of the file to write to",
                },
                content: {
                  type: "string",
                  description: "The content to write to the file",
                }
              },
              required: ["file_path", "content"],
            }
          }
        },
        {
          type: "function",
          function: {
            name: "Bash",
            description: "Execute a shell command",
            parameters: {
              type: "object",
              properties: {
                command: {
                  type: "string",
                  description: "The command to execute",
                }
              },
              required: ["command"],
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
      const result = await executeTool(call.function.name, args);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result, 
      });
    }
  }
}

main();
