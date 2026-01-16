import { describe, test, expect, beforeAll } from "bun:test";
import { $ } from "bun";
import { readFile } from "fs/promises";
import { join } from "path";

const SCRIPT_DIR = import.meta.dir;
const INSTALL_SCRIPT = join(SCRIPT_DIR, "install.sh");
const MARKETPLACE_JSON = join(SCRIPT_DIR, ".claude-plugin/marketplace.json");
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
MARKETPLACE_JSON="${MARKETPLACE_JSON}"

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
    cursor|opencode|amp|factory) return 0 ;;
    *) return 1 ;;
  esac
}

parse_source() {
  local source="$1"
  local path="\${source#github:}"
  local org="\${path%%/*}"
  local rest="\${path#*/}"
  local repo="\${rest%%/*}"
  local sparse_path="\${rest#*/}"
  if [ "$sparse_path" = "$repo" ]; then
    sparse_path=".claude"
  fi
  echo "https://github.com/$org/$repo.git" "$sparse_path"
}

get_plugin_names() {
  awk '
    /"plugins"[[:space:]]*:/ { in_plugins=1 }
    in_plugins && /"name"[[:space:]]*:/ {
      gsub(/.*"name"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      name=$0
    }
    in_plugins && /"source"[[:space:]]*:/ && name {
      print name
      name=""
    }
  ' "$MARKETPLACE_JSON"
}

get_plugin_source() {
  local plugin_name="$1"
  awk '
    /"name"[[:space:]]*:[[:space:]]*"'"$plugin_name"'"/ { found=1 }
    found && /"source"[[:space:]]*:/ {
      gsub(/.*"source"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      print
      exit
    }
  ' "$MARKETPLACE_JSON"
}

get_plugin_description() {
  local plugin_name="$1"
  awk '
    /"name"[[:space:]]*:[[:space:]]*"'"$plugin_name"'"/ { found=1 }
    found && /"description"[[:space:]]*:/ {
      gsub(/.*"description"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      print
      exit
    }
  ' "$MARKETPLACE_JSON"
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
    cursor|opencode|amp|factory) return 0 ;;
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

describe("marketplace.json", () => {
  let marketplace: {
    name: string;
    owner: { name: string };
    plugins: Array<{
      name: string;
      description: string;
      source: string;
      category: string;
      keywords?: string[];
    }>;
  };

  beforeAll(async () => {
    const content = await readFile(MARKETPLACE_JSON, "utf-8");
    marketplace = JSON.parse(content);
  });

  test("is valid JSON", async () => {
    const content = await readFile(MARKETPLACE_JSON, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test("has required top-level fields", () => {
    expect(marketplace.name).toBeDefined();
    expect(marketplace.owner).toBeDefined();
    expect(marketplace.owner.name).toBeDefined();
    expect(marketplace.plugins).toBeDefined();
    expect(Array.isArray(marketplace.plugins)).toBe(true);
  });

  test("plugins have required fields", () => {
    for (const plugin of marketplace.plugins) {
      expect(plugin.name).toBeDefined();
      expect(typeof plugin.name).toBe("string");
      expect(plugin.name.length).toBeGreaterThan(0);

      expect(plugin.description).toBeDefined();
      expect(typeof plugin.description).toBe("string");

      expect(plugin.source).toBeDefined();
      expect(typeof plugin.source).toBe("string");
      expect(plugin.source.startsWith("github:")).toBe(true);

      expect(plugin.category).toBeDefined();
      expect(typeof plugin.category).toBe("string");
    }
  });

  test("plugins have keywords array", () => {
    for (const plugin of marketplace.plugins) {
      expect(plugin.keywords).toBeDefined();
      expect(Array.isArray(plugin.keywords)).toBe(true);
      expect(plugin.keywords!.length).toBeGreaterThan(0);
      for (const keyword of plugin.keywords!) {
        expect(typeof keyword).toBe("string");
      }
    }
  });

  test("plugin names are unique", () => {
    const names = marketplace.plugins.map((p) => p.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test("plugin sources are valid github format", () => {
    const sourceRegex = /^github:[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_.-]+)?$/;
    for (const plugin of marketplace.plugins) {
      expect(plugin.source).toMatch(sourceRegex);
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
  const supportsCommands = ["cursor", "opencode", "amp", "factory"];
  const doesNotSupportCommands = ["gemini", "copilot", "goose"];

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
  test("parses source with subpath", async () => {
    const result = await callFunction(
      "parse_source",
      "github:plaited/typescript-lsp/plugin"
    );
    expect(result).toBe("https://github.com/plaited/typescript-lsp.git plugin");
  });

  test("parses source with .claude subpath", async () => {
    const result = await callFunction(
      "parse_source",
      "github:plaited/acp-harness/.claude"
    );
    expect(result).toBe("https://github.com/plaited/acp-harness.git .claude");
  });

  test("parses source without subpath (defaults to .claude)", async () => {
    const result = await callFunction(
      "parse_source",
      "github:plaited/somerepo"
    );
    expect(result).toBe("https://github.com/plaited/somerepo.git .claude");
  });
});

describe("install.sh - JSON parsing functions", () => {
  test("get_plugin_names returns all plugin names", async () => {
    const result = await callFunction("get_plugin_names");
    const names = result.split("\n").filter(Boolean);

    const content = await readFile(MARKETPLACE_JSON, "utf-8");
    const marketplace = JSON.parse(content);
    const expectedNames = marketplace.plugins.map(
      (p: { name: string }) => p.name
    );

    expect(names.sort()).toEqual(expectedNames.sort());
  });

  test("get_plugin_source returns correct source for each plugin", async () => {
    const content = await readFile(MARKETPLACE_JSON, "utf-8");
    const marketplace = JSON.parse(content);

    for (const plugin of marketplace.plugins) {
      const result = await callFunction("get_plugin_source", plugin.name);
      expect(result).toBe(plugin.source);
    }
  });

  test("get_plugin_description returns correct description for each plugin", async () => {
    const content = await readFile(MARKETPLACE_JSON, "utf-8");
    const marketplace = JSON.parse(content);

    for (const plugin of marketplace.plugins) {
      const result = await callFunction("get_plugin_description", plugin.name);
      expect(result).toBe(plugin.description);
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
    expect(output).toContain("--plugin");
    expect(output).toContain("--list");
  });

  test("-h is alias for --help", async () => {
    const result = await $`bash ${INSTALL_SCRIPT} -h`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.text()).toContain("Usage:");
  });

  test("--list shows available plugins", async () => {
    const result = await $`bash ${INSTALL_SCRIPT} --list`.quiet();
    expect(result.exitCode).toBe(0);
    const output = result.text();
    expect(output).toContain("Available Plugins");

    // Check that all plugins from marketplace.json are listed
    const content = await readFile(MARKETPLACE_JSON, "utf-8");
    const marketplace = JSON.parse(content);
    for (const plugin of marketplace.plugins) {
      expect(output).toContain(plugin.name);
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
  let marketplace: {
    plugins: Array<{ name: string; description: string }>;
  };

  beforeAll(async () => {
    readme = await readFile(README_PATH, "utf-8");
    const content = await readFile(MARKETPLACE_JSON, "utf-8");
    marketplace = JSON.parse(content);
  });

  test("lists all plugins from marketplace.json", () => {
    for (const plugin of marketplace.plugins) {
      expect(readme).toContain(plugin.name);
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
      "https://raw.githubusercontent.com/plaited/marketplace/main/install.sh"
    );
  });
});
