#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rmdir, unlink, writeFile, cp } from "node:fs/promises";
import path from "node:path";

type Options = {
  clean: boolean;
  install: boolean;
  only: Set<string> | null;
  outDir: string;
};

const root = process.cwd();
const sourceDir = path.join(root, "skills");
const generatedDir = path.join(root, "generated", "codex-skills");
const installDir = path.join(root, ".agents", "skills");

function parseArgs(argv: string[]): Options {
  const options: Options = {
    clean: false,
    install: false,
    only: null,
    outDir: generatedDir,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--clean") {
      options.clean = true;
    } else if (arg === "--install") {
      options.install = true;
    } else if (arg === "--only") {
      const value = argv[i + 1];
      if (!value) throw new Error("--only requires a comma-separated list");
      options.only = new Set(value.split(",").map((x) => x.trim()).filter(Boolean));
      i += 1;
    } else if (arg.startsWith("--only=")) {
      const value = arg.slice("--only=".length);
      options.only = new Set(value.split(",").map((x) => x.trim()).filter(Boolean));
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out requires a directory");
      options.outDir = path.resolve(root, value);
      i += 1;
    } else if (arg.startsWith("--out=")) {
      options.outDir = path.resolve(root, arg.slice("--out=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function listSkillNames(only: Set<string> | null): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(sourceDir, name, "SKILL.md")))
    .filter((name) => !only || only.has(name))
    .sort();

  if (only) {
    const missing = [...only].filter((name) => !names.includes(name));
    if (missing.length > 0) {
      throw new Error(`Unknown skill(s): ${missing.join(", ")}`);
    }
  }

  return names;
}

function titleize(name: string): string {
  return name
    .replace(/^ae-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildOpenAiYaml(name: string, description: string, shortDescription?: string): string {
  const displayName = titleize(name);
  const safeShort = shortDescription || description;
  return [
    "interface:",
    `  display_name: ${JSON.stringify(displayName)}`,
    `  short_description: ${JSON.stringify(safeShort)}`,
    `  default_prompt: ${JSON.stringify(`Use $${name}.`)}`,
    "",
  ].join("\n");
}

function parseSkillFrontmatter(raw: string): { name?: string; description?: string; shortDescription?: string } {
  if (!raw.startsWith("---\n")) {
    throw new Error("SKILL.md must start with YAML frontmatter");
  }

  const end = raw.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter is missing closing ---");
  }

  const frontmatter = raw.slice(4, end);
  const result: { name?: string; description?: string; shortDescription?: string } = {};
  const lines = frontmatter.split(/\r?\n/);
  let inMetadata = false;

  for (const line of lines) {
    if (/^\s*$/.test(line)) continue;
    if (/^\S/.test(line)) inMetadata = false;

    const topLevel = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (topLevel) {
      const [, key, value] = topLevel;
      if (key === "metadata") {
        inMetadata = true;
      } else if (key === "name") {
        result.name = value.trim().replace(/^["']|["']$/g, "");
      } else if (key === "description") {
        result.description = value.trim().replace(/^["']|["']$/g, "");
      }
      continue;
    }

    const metadata = line.match(/^\s+short-description:\s*(.*)$/);
    if (inMetadata && metadata) {
      result.shortDescription = metadata[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  return result;
}

async function syncOne(name: string, targetRoot: string): Promise<void> {
  const sourceSkillDir = path.join(sourceDir, name);
  const targetSkillDir = path.join(targetRoot, name);
  const sourceSkillPath = path.join(sourceSkillDir, "SKILL.md");
  const targetSkillPath = path.join(targetSkillDir, "SKILL.md");
  const sourceOpenAiPath = path.join(sourceSkillDir, "agents", "openai.yaml");
  const targetOpenAiPath = path.join(targetSkillDir, "agents", "openai.yaml");

  const raw = await readFile(sourceSkillPath, "utf8");
  const parsed = parseSkillFrontmatter(raw);
  if (!parsed.name || !parsed.description) {
    throw new Error(`${sourceSkillPath} must have frontmatter name and description`);
  }
  if (parsed.name !== name) {
    throw new Error(`${sourceSkillPath} name (${parsed.name}) does not match directory (${name})`);
  }

  await mkdir(path.join(targetSkillDir, "agents"), { recursive: true });
  await writeFile(targetSkillPath, raw);

  if (existsSync(sourceOpenAiPath)) {
    await cp(sourceOpenAiPath, targetOpenAiPath);
  } else {
    await writeFile(
      targetOpenAiPath,
      buildOpenAiYaml(name, parsed.description, parsed.shortDescription),
    );
  }
}

async function syncAll(names: string[], targetRoot: string, clean: boolean): Promise<void> {
  if (clean) {
    if (existsSync(targetRoot)) {
      const entries = await readdir(targetRoot);
      for (const entry of entries) {
        await removeRecursive(path.join(targetRoot, entry));
      }
    }
  }
  await mkdir(targetRoot, { recursive: true });
  for (const name of names) {
    await syncOne(name, targetRoot);
  }
}

async function removeRecursive(target: string): Promise<void> {
  const entries = await readdir(target, { withFileTypes: true }).catch(async () => {
    await unlink(target).catch(() => undefined);
    return null;
  });

  if (!entries) return;

  for (const entry of entries) {
    await removeRecursive(path.join(target, entry.name));
  }
  await rmdir(target).catch(() => undefined);
}

const options = parseArgs(Bun.argv.slice(2));
const names = await listSkillNames(options.only);

await syncAll(names, options.outDir, options.clean);
console.log(`Synced ${names.length} skill(s) to ${path.relative(root, options.outDir)}`);

if (options.install) {
  await syncAll(names, installDir, options.clean);
  console.log(`Installed ${names.length} skill(s) to ${path.relative(root, installDir)}`);
}
