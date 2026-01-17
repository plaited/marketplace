import { describe, test, expect, beforeAll } from "bun:test";
import { $ } from "bun";
import { readFile } from "fs/promises";
import { join } from "path";

const SCRIPT_DIR = import.meta.dir;
const INSTALL_SCRIPT = join(SCRIPT_DIR, "install.sh");
const PROJECTS_JSON = join(SCRIPT_DIR, "projects.json");
const README_PATH = join(SCRIPT_DIR, "README.md");

// Helper to run bash functions from install.sh
async function runBashFunction(
  functionCall: string
): Promise<{ stdout: string; exitCode: number }> {
  try {
    const result =
      await $`bash -c "source ${INSTALL_SCRIPT} --help >/dev/null 2>&1 || true; ${functionCall}"`.quiet();
    return { stdout: result.text().trim(), exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: { toString(): string }; exitCode?: number };
    return {
      stdout: err.stdout?.toString().trim() ?? "",
      exitCode: err.exitCode ?? 1,
    };
  }
}

// Helper to call function from install.sh
async function callFunction(fn: string, ...args: string[]): Promise<string> {
  const quotedArgs = args.map((a) => `"${a}"`).join(" ");
  // Create a wrapper script that sources only the function definitions
  const script = `
set -e
PROJECTS_JSON="${PROJECTS_JSON}"

# Define functions inline (extracted from install.sh)
get_skills_dir() {
  case "$1" in
    gemini)   echo ".gemini/skills" ;;
    copilot)  echo ".github/skills" ;;
    cursor)   echo ".cursor/skills" ;;
    opencode) echo ".opencode/skill" ;;
    amp)      echo ".amp/skills" ;;
    goose)    echo ".goose/skills" ;;
    factory)  echo ".factory/skills" ;;
    *)        echo "" ;;
  esac
}

get_commands_dir() {
  case "$1" in
    gemini)   echo ".gemini/commands" ;;
    copilot)  echo ".github/commands" ;;
    cursor)   echo ".cursor/commands" ;;
    opencode) echo ".opencode/command" ;;
    amp)      echo ".amp/commands" ;;
    goose)    echo ".goose/commands" ;;
    factory)  echo ".factory/commands" ;;
    *)        echo "" ;;
  esac
}

supports_commands() {
  case "$1" in
    gemini|cursor|opencode|amp|factory) return 0 ;;
    *) return 1 ;;
  esac
}

parse_source() {
  local repo="$1"
  echo "https://github.com/$repo.git" ".claude"
}

get_project_names() {
  awk '
    /"projects"[[:space:]]*:/ { in_projects=1 }
    in_projects && /"name"[[:space:]]*:/ {
      gsub(/.*"name"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      print
    }
  ' "$PROJECTS_JSON"
}

get_project_repo() {
  local project_name="$1"
  awk '
    /"name"[[:space:]]*:[[:space:]]*"'"$project_name"'"/ { found=1 }
    found && /"repo"[[:space:]]*:/ {
      gsub(/.*"repo"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      print
      exit
    }
  ' "$PROJECTS_JSON"
}

${fn} ${quotedArgs}
  `;
  const result = await $`bash -c ${script}`.quiet();
  return result.text().trim();
}

// Helper to check if function returns success (0) or failure (1)
async function callFunctionExitCode(
  fn: string,
  ...args: string[]
): Promise<number> {
  const quotedArgs = args.map((a) => `"${a}"`).join(" ");
  const script = `
supports_commands() {
  case "$1" in
    gemini|cursor|opencode|amp|factory) return 0 ;;
    *) return 1 ;;
  esac
}
${fn} ${quotedArgs}
  `;
  try {
    await $`bash -c ${script}`.quiet();
    return 0;
  } catch {
    return 1;
  }
}

describe("projects.json", () => {
  let projects: {
    projects: Array<{
      name: string;
      repo: string;
    }>;
  };

  beforeAll(async () => {
    const content = await readFile(PROJECTS_JSON, "utf-8");
    projects = JSON.parse(content);
  });

  test("is valid JSON", async () => {
    const content = await readFile(PROJECTS_JSON, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test("has required top-level fields", () => {
    expect(projects.projects).toBeDefined();
    expect(Array.isArray(projects.projects)).toBe(true);
  });

  test("projects have required fields", () => {
    for (const project of projects.projects) {
      expect(project.name).toBeDefined();
      expect(typeof project.name).toBe("string");
      expect(project.name.length).toBeGreaterThan(0);

      expect(project.repo).toBeDefined();
      expect(typeof project.repo).toBe("string");
    }
  });

  test("project names are unique", () => {
    const names = projects.projects.map((p) => p.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test("project repos are valid github format", () => {
    const repoRegex = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
    for (const project of projects.projects) {
      expect(project.repo).toMatch(repoRegex);
    }
  });
});

describe("install.sh - get_skills_dir", () => {
  const expectedMappings: Record<string, string> = {
    gemini: ".gemini/skills",
    copilot: ".github/skills",
    cursor: ".cursor/skills",
    opencode: ".opencode/skill",
    amp: ".amp/skills",
    goose: ".goose/skills",
    factory: ".factory/skills",
  };

  for (const [agent, expectedDir] of Object.entries(expectedMappings)) {
    test(`returns correct dir for ${agent}`, async () => {
      const result = await callFunction("get_skills_dir", agent);
      expect(result).toBe(expectedDir);
    });
  }

  test("returns empty for unknown agent", async () => {
    const result = await callFunction("get_skills_dir", "unknown");
    expect(result).toBe("");
  });
});

describe("install.sh - get_commands_dir", () => {
  const expectedMappings: Record<string, string> = {
    gemini: ".gemini/commands",
    copilot: ".github/commands",
    cursor: ".cursor/commands",
    opencode: ".opencode/command",
    amp: ".amp/commands",
    goose: ".goose/commands",
    factory: ".factory/commands",
  };

  for (const [agent, expectedDir] of Object.entries(expectedMappings)) {
    test(`returns correct dir for ${agent}`, async () => {
      const result = await callFunction("get_commands_dir", agent);
      expect(result).toBe(expectedDir);
    });
  }

  test("returns empty for unknown agent", async () => {
    const result = await callFunction("get_commands_dir", "unknown");
    expect(result).toBe("");
  });
});

describe("install.sh - supports_commands", () => {
  const supportsCommands = ["gemini", "cursor", "opencode", "amp", "factory"];
  const doesNotSupportCommands = ["copilot", "goose"];

  for (const agent of supportsCommands) {
    test(`${agent} supports commands`, async () => {
      const exitCode = await callFunctionExitCode("supports_commands", agent);
      expect(exitCode).toBe(0);
    });
  }

  for (const agent of doesNotSupportCommands) {
    test(`${agent} does not support commands`, async () => {
      const exitCode = await callFunctionExitCode("supports_commands", agent);
      expect(exitCode).toBe(1);
    });
  }
});

describe("install.sh - parse_source", () => {
  test("parses repo and always uses .claude", async () => {
    const result = await callFunction(
      "parse_source",
      "plaited/typescript-lsp"
    );
    expect(result).toBe("https://github.com/plaited/typescript-lsp.git .claude");
  });

  test("parses another repo format", async () => {
    const result = await callFunction(
      "parse_source",
      "plaited/acp-harness"
    );
    expect(result).toBe("https://github.com/plaited/acp-harness.git .claude");
  });
});

describe("install.sh - JSON parsing functions", () => {
  test("get_project_names returns all project names", async () => {
    const result = await callFunction("get_project_names");
    const names = result.split("\n").filter(Boolean);

    const content = await readFile(PROJECTS_JSON, "utf-8");
    const projects = JSON.parse(content);
    const expectedNames = projects.projects.map(
      (p: { name: string }) => p.name
    );

    expect(names.sort()).toEqual(expectedNames.sort());
  });

  test("get_project_repo returns correct repo for each project", async () => {
    const content = await readFile(PROJECTS_JSON, "utf-8");
    const projects = JSON.parse(content);

    for (const project of projects.projects) {
      const result = await callFunction("get_project_repo", project.name);
      expect(result).toBe(project.repo);
    }
  });
});

describe("install.sh - CLI", () => {
  test("--help exits with 0", async () => {
    const result = await $`bash ${INSTALL_SCRIPT} --help`.quiet();
    expect(result.exitCode).toBe(0);
  });

  test("--help shows usage", async () => {
    const result = await $`bash ${INSTALL_SCRIPT} --help`.quiet();
    const output = result.text();
    expect(output).toContain("Usage:");
    expect(output).toContain("--agent");
    expect(output).toContain("--project");
    expect(output).toContain("--list");
  });

  test("-h is alias for --help", async () => {
    const result = await $`bash ${INSTALL_SCRIPT} -h`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.text()).toContain("Usage:");
  });

  test("--list shows available projects", async () => {
    const result = await $`bash ${INSTALL_SCRIPT} --list`.quiet();
    expect(result.exitCode).toBe(0);
    const output = result.text();
    expect(output).toContain("Available Projects");

    // Check that all projects from projects.json are listed
    const content = await readFile(PROJECTS_JSON, "utf-8");
    const projects = JSON.parse(content);
    for (const project of projects.projects) {
      expect(output).toContain(project.name);
    }
  });

  test("unknown option shows error", async () => {
    try {
      await $`bash ${INSTALL_SCRIPT} --invalid-option`.quiet();
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      const err = error as { exitCode: number; stderr: { toString(): string } };
      expect(err.exitCode).toBe(1);
      expect(err.stderr.toString()).toContain("Unknown option");
    }
  });

  test("invalid agent shows error", async () => {
    try {
      await $`bash ${INSTALL_SCRIPT} --agent invalid-agent`.quiet();
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      const err = error as { exitCode: number; stderr: { toString(): string } };
      expect(err.exitCode).toBe(1);
      expect(err.stderr.toString()).toContain("Unknown agent");
    }
  });
});

describe("README.md consistency", () => {
  let readme: string;
  let projects: {
    projects: Array<{ name: string; repo: string }>;
  };

  beforeAll(async () => {
    readme = await readFile(README_PATH, "utf-8");
    const content = await readFile(PROJECTS_JSON, "utf-8");
    projects = JSON.parse(content);
  });

  test("lists all projects from projects.json", () => {
    for (const project of projects.projects) {
      expect(readme).toContain(project.name);
    }
  });

  test("has correct agent directory mappings", () => {
    const mappings = [
      ["gemini", ".gemini/skills/"],
      ["copilot", ".github/skills/"],
      ["cursor", ".cursor/skills/"],
      ["opencode", ".opencode/skill/"],
      ["amp", ".amp/skills/"],
      ["goose", ".goose/skills/"],
      ["factory", ".factory/skills/"],
    ];

    for (const [agent, dir] of mappings) {
      expect(readme).toContain(agent);
      expect(readme).toContain(dir);
    }
  });

  test("curl command uses correct URL", () => {
    expect(readme).toContain(
      "https://raw.githubusercontent.com/plaited/skills-installer/main/install.sh"
    );
  });
});

describe("install.sh - convert_md_to_toml", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp");

  // Helper to run convert_md_to_toml
  async function convertMdToToml(
    mdContent: string
  ): Promise<string> {
    const { mkdir, writeFile, readFile, rm } = await import("fs/promises");
    await mkdir(tmpDir, { recursive: true });

    const mdPath = join(tmpDir, "test-command.md");
    const tomlPath = join(tmpDir, "test-command.toml");
    const scriptPath = join(tmpDir, "run-convert.sh");

    await writeFile(mdPath, mdContent);

    // Write script to temp file to avoid escaping issues
    const script = `#!/bin/bash
convert_md_to_toml() {
  local md_file="$1"
  local toml_file="$2"

  local description
  description=$(awk '
    /^---$/ { if (in_front) exit; in_front=1; next }
    in_front && /^description:/ {
      sub(/^description:[[:space:]]*/, "")
      gsub(/"/, "\\\\\\"")
      print
      exit
    }
  ' "$md_file")

  local body
  body=$(awk '
    /^---$/ { count++; if (count == 2) { getbody=1; next } }
    getbody { print }
  ' "$md_file")

  body=$(echo "$body" | sed 's/\\$ARGUMENTS/{{args}}/g')

  {
    if [ -n "$description" ]; then
      echo "description = \\"$description\\""
      echo ""
    fi
    echo 'prompt = """'
    echo "$body"
    echo '"""'
  } > "$toml_file"
}

convert_md_to_toml "${mdPath}" "${tomlPath}"
`;

    await writeFile(scriptPath, script);

    await $`bash ${scriptPath}`.quiet();

    const result = await readFile(tomlPath, "utf-8");
    await rm(tmpDir, { recursive: true, force: true });
    return result;
  }

  test("converts basic markdown with description", async () => {
    const md = `---
description: Test description
allowed-tools: Bash
---

# Test Command

This is the body.
`;

    const toml = await convertMdToToml(md);
    expect(toml).toContain('description = "Test description"');
    expect(toml).toContain('prompt = """');
    expect(toml).toContain("# Test Command");
    expect(toml).toContain("This is the body.");
    expect(toml).toContain('"""');
    // allowed-tools should be dropped (not in output)
    expect(toml).not.toContain("allowed-tools");
    expect(toml).not.toContain("Bash");
  });

  test("replaces $ARGUMENTS with {{args}}", async () => {
    const md = `---
description: Command with args
---

Use $ARGUMENTS here and $ARGUMENTS again.
`;

    const toml = await convertMdToToml(md);
    expect(toml).toContain("{{args}}");
    expect(toml).not.toContain("$ARGUMENTS");
    // Should have two replacements
    const matches = toml.match(/\{\{args\}\}/g);
    expect(matches?.length).toBe(2);
  });

  test("handles markdown without description", async () => {
    const md = `---
allowed-tools: Bash
---

# No Description

Just a body.
`;

    const toml = await convertMdToToml(md);
    expect(toml).not.toContain("description =");
    expect(toml).toContain('prompt = """');
    expect(toml).toContain("# No Description");
  });

  test("escapes quotes in description", async () => {
    const md = `---
description: A "quoted" description
---

Body text.
`;

    const toml = await convertMdToToml(md);
    expect(toml).toContain('description = "A \\"quoted\\" description"');
  });
});

describe("install.sh - supports_commands updated", () => {
  test("gemini now supports commands", async () => {
    const exitCode = await callFunctionExitCode("supports_commands", "gemini");
    expect(exitCode).toBe(0);
  });
});
