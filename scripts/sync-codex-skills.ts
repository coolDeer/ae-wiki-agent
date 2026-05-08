import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

type SkillFrontmatter = {
  name?: string;
  description?: string;
  metadata?: {
    ["short-description"]?: string;
    shortDescription?: string;
  };
};

type SkillSummary = {
  name: string;
  sourceDir: string;
  targetDir: string;
  generatedMetadata: boolean;
};

function extractSkillFrontmatter(skillText: string): SkillFrontmatter {
  const lines = skillText.split(/\r?\n/);
  const meta: SkillFrontmatter = {};
  let inMetadata = false;

  for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;
    if (line === "---") continue;
    if (rawLine.startsWith("# ") && i > 0) break;

    const nameMatch = rawLine.match(/^(?:##\s*)?name:\s*(.+)$/);
    if (nameMatch) {
      meta.name = nameMatch[1].trim();
      inMetadata = false;
      continue;
    }

    const descriptionMatch = rawLine.match(/^description:\s*(.+)$/);
    if (descriptionMatch) {
      meta.description = descriptionMatch[1].trim();
      inMetadata = false;
      continue;
    }

    if (line === "metadata:") {
      meta.metadata ??= {};
      inMetadata = true;
      continue;
    }

    if (inMetadata) {
      const shortDescriptionMatch = rawLine.match(/^\s+short-description:\s*(.+)$/);
      if (shortDescriptionMatch) {
        meta.metadata ??= {};
        meta.metadata["short-description"] = shortDescriptionMatch[1].trim();
        continue;
      }
    }

    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
      inMetadata = false;
    }
  }

  return meta;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  bun scripts/sync-codex-skills.ts [--out DIR] [--only skill-a,skill-b] [--clean]",
      "  bun scripts/sync-codex-skills.ts --install [--only skill-a,skill-b]",
      "",
      "Defaults:",
      "  --out generated/codex-skills",
      "  --install writes to ~/.codex/skills",
    ].join("\n"),
  );
  process.exit(1);
}

function titleize(name: string): string {
  return name
    .replace(/^ae-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function parseArgs(argv: string[]) {
  let outDir: string | null = null;
  let install = false;
  let clean = false;
  let only: string[] | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      outDir = argv[i + 1] ?? usage();
      i += 1;
      continue;
    }
    if (arg === "--only") {
      only = (argv[i + 1] ?? usage())
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--install") {
      install = true;
      continue;
    }
    if (arg === "--clean") {
      clean = true;
      continue;
    }
    usage();
  }

  if (install && outDir) {
    usage();
  }

  const targetDir = install
    ? path.join(Bun.env.HOME ?? usage(), ".codex", "skills")
    : path.resolve(outDir ?? path.join("generated", "codex-skills"));

  return { targetDir, install, clean, only };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

async function removeDirIfExists(dirPath: string) {
  if (await exists(dirPath)) {
    await rm(dirPath, { recursive: true, force: true });
  }
}

function buildOpenAiYaml(frontmatter: SkillFrontmatter): string {
  const name = frontmatter.name;
  const description = frontmatter.description;

  if (!name || !description) {
    throw new Error("Skill frontmatter must include name and description.");
  }

  const shortDescription =
    frontmatter.metadata?.["short-description"] ??
    frontmatter.metadata?.shortDescription ??
    description;

  const doc = {
    interface: {
      display_name: titleize(name),
      short_description: shortDescription,
      default_prompt: `Use $${name} to ${description}`,
    },
  };

  return YAML.stringify(doc);
}

async function copySkill(sourceDir: string, targetRoot: string): Promise<SkillSummary> {
  const skillMdPath = path.join(sourceDir, "SKILL.md");
  const skillText = await readFile(skillMdPath, "utf8");
  const frontmatter = extractSkillFrontmatter(skillText);
  const name = frontmatter.name;

  if (!name) {
    throw new Error(`Missing "name" in ${skillMdPath}`);
  }
  if (!frontmatter.description) {
    throw new Error(`Missing "description" in ${skillMdPath}`);
  }

  const targetDir = path.join(targetRoot, name);
  const agentsDir = path.join(targetDir, "agents");
  const sourceOpenAiYaml = path.join(sourceDir, "agents", "openai.yaml");
  const targetOpenAiYaml = path.join(agentsDir, "openai.yaml");
  const hasSourceMetadata = await exists(sourceOpenAiYaml);

  await ensureDir(targetDir);
  await writeFile(path.join(targetDir, "SKILL.md"), skillText, "utf8");
  await ensureDir(agentsDir);

  if (hasSourceMetadata) {
    await writeFile(targetOpenAiYaml, await readFile(sourceOpenAiYaml, "utf8"), "utf8");
  } else {
    await writeFile(targetOpenAiYaml, buildOpenAiYaml(frontmatter), "utf8");
  }

  return {
    name,
    sourceDir,
    targetDir,
    generatedMetadata: !hasSourceMetadata,
  };
}

async function main() {
  const { targetDir, clean, only } = parseArgs(Bun.argv.slice(2));
  const skillsRoot = path.resolve("skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const selected = only ? new Set(only) : null;

  await ensureDir(targetDir);

  const summaries: SkillSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (selected && !selected.has(entry.name)) continue;

    const sourceDir = path.join(skillsRoot, entry.name);
    const skillMdPath = path.join(sourceDir, "SKILL.md");
    if (!(await exists(skillMdPath))) continue;

    const targetSkillDir = path.join(targetDir, entry.name);
    if (clean) {
      await removeDirIfExists(targetSkillDir);
    }

    summaries.push(await copySkill(sourceDir, targetDir));
  }

  if (selected) {
    const copied = new Set(summaries.map((item) => item.name));
    const missing = [...selected].filter((name) => !copied.has(name));
    if (missing.length > 0) {
      throw new Error(`Requested skills not found: ${missing.join(", ")}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        targetDir,
        count: summaries.length,
        skills: summaries,
      },
      null,
      2,
    ),
  );
}

await main();
