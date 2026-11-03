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

// turns "/apple do something" into the apple skill body followed by "do something"
export function expandSkillPrompt(prompt: string): string {
  if (!prompt.startsWith("/")) return prompt;

  const [command, ...rest] = prompt.slice(1).split(/\s+/);
  const body = loadSkill(command);
  if (body === null) return prompt; // not a skill, send the prompt unchanged

  return [body, rest.join(" ")].filter(Boolean).join("\n\n");
}
