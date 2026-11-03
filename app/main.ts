import OpenAI from "openai";
import { readFileSync, writeFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import {
  expandSkillPrompt,
  fillSkill,
  loadSkill,
  runsInSubagent,
  scanSkills,
  substituteArguments,
} from "./skill";

const execAsync = promisify(exec);

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
  },
  {
    type: "function",
    function: {
      name: "Skill",
      description: "Load a skill's instructions into the conversation",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the skill to use",
          },
          args: {
            type: "string",
            description: "Optional arguments for the skill",
          }
        },
        required: ["name"],
      }
    }
  }
];

async function executeTool(
  client: OpenAI,
  name: string,
  args: any,
): Promise<string> {
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

      case "Skill": {
        const body = loadSkill(args.name);
        if (body === null) return `Error: unknown skill ${args.name}`;

        const skillArgs = (args.args ?? "").split(/\s+/).filter(Boolean);

        if (runsInSubagent(args.name)) {
          // the subagent gets only the skill body, in a conversation of its own
          const answer = await runAgent(client, [
            { role: "user", content: substituteArguments(body, skillArgs) },
          ]);
          return `Skill ${args.name} ran in a separate context and returned: ${answer}`;
        }

        return fillSkill(args.name, body, skillArgs);
      }

      default:
        return `Error: unknown tool ${name}`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// runs the agent loop over the given conversation and returns the final answer
async function runAgent(client: OpenAI, messages: Messages): Promise<string> {
  while (true) {
    const response = await client.chat.completions.create({
      // using anthropic/claude-haiku-4.5 and deepseek/deepseek-v4.1-flash-1017
      model: "anthropic/claude-haiku-4.5",
      messages,
      tools,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content ?? "";
    }

    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;

      const args = JSON.parse(call.function.arguments);
      const result = await executeTool(client, call.function.name, args);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
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

  const messages: Messages = [
    ...(skills ? [{ role: "system" as const, content: skills }] : []),
    ...expandSkillPrompt(prompt).map((content) => ({
      role: "user" as const,
      content,
    })),
  ];

  console.log(await runAgent(client, messages));
}

main();
