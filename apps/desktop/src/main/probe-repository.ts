/**
 * Collects the facts `detectAgents` needs from a real repository.
 *
 * This runs while the user is waiting to see their team, on a directory that
 * might be a small script folder or a monorepo with a million files, so the
 * walk is bounded in three independent ways: it skips directories that never
 * carry signal, it stops descending past a depth where nothing useful lives,
 * and it stops entirely once it has seen enough files to decide. Detection
 * needs the presence of a signal, never a complete inventory.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { IGNORED_DIRECTORIES, type RepositoryProbe } from "../shared/detect-agents";

/** Enough to see every signal in practice; small enough to finish instantly. */
const MAX_FILES = 4000;
/** Signals live near the top. Nothing at depth 8 changes the team. */
const MAX_DEPTH = 8;

const IGNORED = new Set(IGNORED_DIRECTORIES);

type Manifest = Readonly<{ file: string; parse: (source: string) => readonly string[] }>;

const MANIFESTS: readonly Manifest[] = Object.freeze([
  { file: "package.json", parse: parsePackageJson },
  { file: "requirements.txt", parse: parseRequirements },
  { file: "pyproject.toml", parse: parseLooseToml },
  { file: "Gemfile", parse: parseGemfile },
  { file: "go.mod", parse: parseGoMod },
  { file: "Cargo.toml", parse: parseLooseToml },
  { file: "composer.json", parse: parsePackageJson },
]);

export async function probeRepository(root: string): Promise<RepositoryProbe> {
  const files = await walk(root);
  const dependencies = await readDependencies(root, files);
  return { files, dependencies };
}

async function walk(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (queue.length > 0 && found.length < MAX_FILES) {
    const { directory, depth } = queue.shift() as { directory: string; depth: number };

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // An unreadable directory is not worth failing the whole probe over; the
      // team is simply decided from what could be read.
      continue;
    }

    for (const entry of entries) {
      if (found.length >= MAX_FILES) break;
      const absolute = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED.has(entry.name) || depth >= MAX_DEPTH) continue;
        queue.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      // Breadth-first, so a wide repository still reaches deep signals such as
      // db/migrations before the file budget runs out.
      found.push(relative(root, absolute).split(sep).join("/"));
    }
  }

  return found;
}

async function readDependencies(root: string, files: readonly string[]): Promise<readonly string[]> {
  const present = new Set(files);
  const names = new Set<string>();

  await Promise.all(
    MANIFESTS.map(async (manifest) => {
      // Manifests are read wherever they were found, so a workspace whose real
      // package.json sits in apps/desktop is not mistaken for a bare repository.
      const locations = files.filter((file) => file === manifest.file || file.endsWith(`/${manifest.file}`));
      if (locations.length === 0 && !present.has(manifest.file)) return;

      for (const location of locations.slice(0, 12)) {
        try {
          const source = await readFile(join(root, location), "utf8");
          for (const name of manifest.parse(source)) names.add(name);
        } catch {
          // A manifest that cannot be read or parsed contributes nothing.
        }
      }
    }),
  );

  return [...names];
}

function parsePackageJson(source: string): readonly string[] {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  const fields = ["dependencies", "devDependencies", "peerDependencies", "require", "require-dev"];
  const names: string[] = [];
  for (const field of fields) {
    const section = parsed[field];
    if (section && typeof section === "object") names.push(...Object.keys(section as object));
  }
  return names;
}

function parseRequirements(source: string): readonly string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    // Strips the version specifier and any extras: "django[argon2]>=4.2" -> "django".
    .map((line) => (/^[A-Za-z0-9._-]+/.exec(line) ?? [""])[0])
    .filter((name) => name.length > 0);
}

function parseLooseToml(source: string): readonly string[] {
  // Deliberately not a TOML parser: the only thing needed is which package
  // names appear as keys or in an array of requirement strings.
  const names: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;

    const quoted = /^"([A-Za-z0-9._-]+)"/.exec(trimmed);
    if (quoted) {
      names.push(quoted[1]);
      continue;
    }
    const key = /^([A-Za-z0-9._-]+)\s*=/.exec(trimmed);
    if (key) names.push(key[1]);
  }
  return names;
}

function parseGemfile(source: string): readonly string[] {
  return [...source.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((match) => match[1]);
}

function parseGoMod(source: string): readonly string[] {
  // The last path segment is what the rules match on: "github.com/x/testify".
  return [...source.matchAll(/^\s+([\w.-]+\/[^\s]+)\s+v/gm)].map((match) => {
    const path = match[1];
    return path.slice(path.lastIndexOf("/") + 1);
  });
}
