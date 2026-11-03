import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const SKILLS_DIR = join(".claude", "skills");

export function scanSkills(skillsDir = SKILLS_DIR): string {
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

  return (
    `You have access to the following skills:\n\n${lines.join("\n")}\n\n` +
    "If a skill matches the user's request, call the Skill tool with its name\n" +
    "and follow the instructions it returns."
  );
}

// returns the body of a skill (everything after the frontmatter), or null if it doesn't exist
export function loadSkill(name: string, skillsDir = SKILLS_DIR): string | null {
  const skillFile = join(skillsDir, name, "SKILL.md");
  if (!existsSync(skillFile)) return null;

  return readFileSync(skillFile, "utf8")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trim();
}

// "/apple /grape a b" -> one message per leading skill, with the rest ("a b") as its arguments.
// $ARGUMENTS is "a b", $0 is "a", $1 is "b"; without a placeholder the arguments are appended.
// each message starts with the skill's folder so the body can use paths relative to it.
export function expandSkillPrompt(prompt: string): string[] {
  const tokens = prompt.trim().split(/\s+/);

  const skills: { name: string; body: string }[] = [];
  while (skills.length < tokens.length && tokens[skills.length].startsWith("/")) {
    const name = tokens[skills.length].slice(1);
    const body = loadSkill(name);
    if (body === null) break;
    skills.push({ name, body });
  }
  if (skills.length === 0) return [prompt];

  const args = tokens.slice(skills.length);

  return skills.map(({ name, body }) => fillSkill(name, body, args));
}

// fills in the arguments, or appends them when the body has no placeholder
export function substituteArguments(body: string, args: string[]): string {
  const hasPlaceholder = /\$ARGUMENTS|\$\d/.test(body);

  return hasPlaceholder
    ? body
        .replaceAll("$ARGUMENTS", args.join(" "))
        .replace(/\$(\d)/g, (_, n) => args[Number(n)] ?? "")
    : [body, args.join(" ")].filter(Boolean).join("\n\n");
}

// fills in the arguments and puts the skill's folder in front of the body
export function fillSkill(name: string, body: string, args: string[]): string {
  const header =
    `Skill: ${name} (located at ${join(SKILLS_DIR, name)})\n` +
    "Paths in the instructions below are relative to that folder.";

  return `${header}\n\n${substituteArguments(body, args)}`;
}

// true if the skill's frontmatter has "context: fork", i.e. it runs in a subagent
export function runsInSubagent(name: string, skillsDir = SKILLS_DIR): boolean {
  const skillFile = join(skillsDir, name, "SKILL.md");
  if (!existsSync(skillFile)) return false;

  const frontmatter = readFileSync(skillFile, "utf8").match(
    /^---\r?\n([\s\S]*?)\r?\n---/,
  )?.[1];

  return /^context:\s*fork\s*$/m.test(frontmatter ?? "");
}
