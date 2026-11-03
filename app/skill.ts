import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export function scanSkills(skillsDir = join(".claude", "skills")): string {
  if (!existsSync(skillsDir)) return "";

  const lines: string[] = [];

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    // read name and description from the frontmatter between the --- lines
    const frontmatter = readFileSync(skillFile, "utf8").match(
      /^---\r?\n([\s\S]*?)\r?\n---/,
    )?.[1];
    if (!frontmatter) continue;

    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1].trim();
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1].trim();
    if (!name || !description) continue;

    lines.push(`- ${name}: ${description}`);
  }

  if (lines.length === 0) return "";

  return `You have access to the following skills:\n\n${lines.join("\n")}`;
}

// returns the body of a skill (everything after the frontmatter), or null if it doesn't exist
export function loadSkill(
  name: string,
  skillsDir = join(".claude", "skills"),
): string | null {
  const skillFile = join(skillsDir, name, "SKILL.md");
  if (!existsSync(skillFile)) return null;

  return readFileSync(skillFile, "utf8")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trim();
}

// turns "/apple a b" into the apple skill body with the arguments filled in:
// $ARGUMENTS becomes "a b", $1 becomes "a", $2 becomes "b" (missing ones become "").
// if the body has no placeholder, the arguments are appended after it instead.
export function expandSkillPrompt(prompt: string): string {
  if (!prompt.startsWith("/")) return prompt;

  const [command, ...args] = prompt.slice(1).trim().split(/\s+/);
  const body = loadSkill(command);
  if (body === null) return prompt; // not a skill, send the prompt unchanged

  const hasPlaceholder = /\$ARGUMENTS|\$\d/.test(body);
  if (!hasPlaceholder) {
    return [body, args.join(" ")].filter(Boolean).join("\n\n");
  }

  return body
    .replaceAll("$ARGUMENTS", args.join(" "))
    .replace(/\$(\d)/g, (_, n) => args[Number(n) - 1] ?? "");
}
