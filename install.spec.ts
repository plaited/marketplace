/**
 * Plaited Skills Installer Test Suite
 *
 * Test coverage:
 * - projects.json validation and parsing
 * - Agent directory mappings (get_skills_dir)
 * - Source parsing and security validation
 * - JSON parsing (jq with awk fallback)
 * - Skill scoping functions (is_scoped_skill, get_scoped_skill_name)
 * - Skill installation integration
 * - Scoped content removal
 * - CLI argument parsing
 * - README consistency
 * - Edge cases and error handling
 *
 * Run with: bun test
 */

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
    codex)    echo ".codex/skills" ;;
    windsurf) echo ".windsurf/skills" ;;
    claude)   echo ".claude/skills" ;;
    *)        echo "" ;;
  esac
}

parse_source() {
  local repo="$1"
  echo "https://github.com/$repo.git" ".plaited"
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
    codex: ".codex/skills",
    windsurf: ".windsurf/skills",
    claude: ".claude/skills",
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

describe("install.sh - parse_source", () => {
  test("parses repo and always uses .plaited", async () => {
    const result = await callFunction(
      "parse_source",
      "plaited/typescript-lsp"
    );
    expect(result).toBe("https://github.com/plaited/typescript-lsp.git .plaited");
  });

  test("parses another repo format", async () => {
    const result = await callFunction(
      "parse_source",
      "plaited/acp-harness"
    );
    expect(result).toBe("https://github.com/plaited/acp-harness.git .plaited");
  });
});

describe("install.sh - security validation", () => {
  // Helper to run parse_source from actual install.sh (with security checks)
  async function runParseSource(repo: string): Promise<{ stdout: string; exitCode: number }> {
    const script = `
set -e
# Define print_error stub
print_error() { echo "ERROR: $1" >&2; }

# Define parse_source with security validation (copied from install.sh)
parse_source() {
  local repo="$1"

  # Validate against path traversal attacks
  if [[ "$repo" =~ \\.\\. ]]; then
    print_error "Invalid repository path (path traversal detected): $repo"
    return 1
  fi

  # Validate repo format (owner/repo)
  if ! [[ "$repo" =~ ^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$ ]]; then
    print_error "Invalid repository format: $repo (expected: owner/repo)"
    return 1
  fi

  echo "https://github.com/$repo.git" ".plaited"
}

parse_source "${repo}"
`;
    try {
      const result = await $`bash -c ${script.replace("${repo}", repo)}`.quiet();
      return { stdout: result.text().trim(), exitCode: 0 };
    } catch (error: unknown) {
      const err = error as { stdout?: { toString(): string }; exitCode?: number };
      return {
        stdout: err.stdout?.toString().trim() ?? "",
        exitCode: err.exitCode ?? 1,
      };
    }
  }

  test("rejects path traversal with ..", async () => {
    const result = await runParseSource("../../../etc/passwd");
    expect(result.exitCode).toBe(1);
  });

  test("rejects path traversal in middle of path", async () => {
    const result = await runParseSource("owner/../../../etc/passwd");
    expect(result.exitCode).toBe(1);
  });

  test("rejects path traversal with encoded dots", async () => {
    const result = await runParseSource("owner/..repo");
    expect(result.exitCode).toBe(1);
  });

  test("rejects invalid repo format - no slash", async () => {
    const result = await runParseSource("invalid-repo-no-slash");
    expect(result.exitCode).toBe(1);
  });

  test("rejects invalid repo format - multiple slashes", async () => {
    const result = await runParseSource("owner/repo/extra");
    expect(result.exitCode).toBe(1);
  });

  test("rejects invalid characters in repo", async () => {
    const result = await runParseSource("owner/repo;echo hacked");
    expect(result.exitCode).toBe(1);
  });

  test("accepts valid repo format", async () => {
    const result = await runParseSource("valid-owner/valid-repo");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("https://github.com/valid-owner/valid-repo.git");
  });

  test("accepts repo with dots (not traversal)", async () => {
    const result = await runParseSource("owner/repo.js");
    expect(result.exitCode).toBe(0);
  });

  test("accepts repo with underscores and hyphens", async () => {
    const result = await runParseSource("my_owner/my-repo_name");
    expect(result.exitCode).toBe(0);
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
    expect(output).toContain("--agents");
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
      await $`bash ${INSTALL_SCRIPT} --agents invalid-agent`.quiet();
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      const err = error as { exitCode: number; stderr: { toString(): string } };
      expect(err.exitCode).toBe(1);
      expect(err.stderr.toString()).toContain("Unknown agent");
    }
  });

  test("--agent is not a valid option (replaced by --agents)", async () => {
    try {
      await $`bash ${INSTALL_SCRIPT} --agent claude`.quiet();
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      const err = error as { exitCode: number; stderr: { toString(): string } };
      expect(err.exitCode).toBe(1);
      expect(err.stderr.toString()).toContain("Unknown option: --agent");
    }
  });

  test("--update is not a valid option (feature removed)", async () => {
    try {
      await $`bash ${INSTALL_SCRIPT} --update`.quiet();
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      const err = error as { exitCode: number; stderr: { toString(): string } };
      expect(err.exitCode).toBe(1);
      expect(err.stderr.toString()).toContain("Unknown option: --update");
    }
  });

  test("--help does not mention --update option", async () => {
    const result = await $`bash ${INSTALL_SCRIPT} --help`.quiet();
    const output = result.text();
    expect(output).not.toContain("--update");
  });

  test("headless mode without agents shows helpful error", async () => {
    const { mkdir, rm } = await import("fs/promises");
    const tmpDir = join(import.meta.dir, ".test-tmp-headless");
    await mkdir(tmpDir, { recursive: true });

    try {
      // Run in clean temp directory with no agent directories
      // Simulate headless mode by piping input (no TTY)
      await $`cd ${tmpDir} && echo "" | bash ${INSTALL_SCRIPT}`.quiet();
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      const err = error as { exitCode: number; stderr: { toString(): string }; stdout: { toString(): string } };
      expect(err.exitCode).toBe(1);
      const stderr = err.stderr.toString();
      const stdout = err.stdout.toString();
      // Error message goes to stderr
      expect(stderr).toContain("No agents specified");
      // Helpful hint goes to stdout via print_info
      expect(stdout).toContain("--agents");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
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
      ["gemini", ".gemini/skills"],
      ["copilot", ".github/skills"],
      ["cursor", ".cursor/skills"],
      ["opencode", ".opencode/skill"],
      ["amp", ".amp/skills"],
      ["goose", ".goose/skills"],
      ["factory", ".factory/skills"],
      ["codex", ".codex/skills"],
      ["windsurf", ".windsurf/skills"],
      ["claude", ".claude/skills"],
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


describe("install.sh - skill scoping functions", () => {
  // Helper to test is_scoped_skill (returns exit code 0 for true, 1 for false)
  async function isScopedSkill(skillName: string): Promise<boolean> {
    const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}
is_scoped_skill "${skillName}"
`;
    try {
      await $`bash -c ${script}`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  // Helper to test extract_org_from_repo
  async function extractOrgFromRepo(repo: string): Promise<string> {
    const script = `
extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}
extract_org_from_repo "${repo}"
`;
    const result = await $`bash -c ${script}`.quiet();
    return result.text().trim();
  }

  // Helper to test get_scoped_skill_name
  async function getScopedSkillName(skillName: string, repo: string): Promise<string> {
    const script = `
extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}
get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}
get_scoped_skill_name "${skillName}" "${repo}"
`;
    const result = await $`bash -c ${script}`.quiet();
    return result.text().trim();
  }

  describe("is_scoped_skill", () => {
    test("returns true for scoped skill name", async () => {
      expect(await isScopedSkill("typescript-lsp@plaited_development-skills")).toBe(true);
    });

    test("returns true for scoped skill with dots in org", async () => {
      expect(await isScopedSkill("my-skill@org.name_project")).toBe(true);
    });

    test("returns true for scoped skill with underscores", async () => {
      expect(await isScopedSkill("my_skill@my_org_my_project")).toBe(true);
    });

    test("returns false for unscoped skill name", async () => {
      expect(await isScopedSkill("typescript-lsp")).toBe(false);
    });

    test("returns false for skill name with @ but wrong format", async () => {
      expect(await isScopedSkill("skill@invalid")).toBe(false);
    });

    test("returns false for empty string", async () => {
      expect(await isScopedSkill("")).toBe(false);
    });

    test("returns false for skill with @ but no underscore after", async () => {
      expect(await isScopedSkill("skill@orgproject")).toBe(false);
    });
  });

  describe("extract_org_from_repo", () => {
    test("extracts org from simple repo path", async () => {
      expect(await extractOrgFromRepo("plaited/development-skills")).toBe("plaited");
    });

    test("extracts org from repo with hyphens", async () => {
      expect(await extractOrgFromRepo("my-org/my-project")).toBe("my-org");
    });

    test("extracts org from repo with underscores", async () => {
      expect(await extractOrgFromRepo("my_org/project_name")).toBe("my_org");
    });

    test("extracts org from repo with dots", async () => {
      expect(await extractOrgFromRepo("org.name/project")).toBe("org.name");
    });
  });

  describe("get_scoped_skill_name", () => {
    test("generates scoped name for simple skill", async () => {
      expect(await getScopedSkillName("typescript-lsp", "plaited/development-skills"))
        .toBe("typescript-lsp@plaited_development-skills");
    });

    test("generates scoped name preserving hyphens in project", async () => {
      expect(await getScopedSkillName("harness-skill", "plaited/acp-harness"))
        .toBe("harness-skill@plaited_acp-harness");
    });

    test("generates scoped name for skill with underscores", async () => {
      expect(await getScopedSkillName("my_skill", "org/project"))
        .toBe("my_skill@org_project");
    });

    test("generates scoped name preserving dots in org", async () => {
      expect(await getScopedSkillName("skill", "org.name/project"))
        .toBe("skill@org.name_project");
    });
  });

  describe("install_project scoping logic", () => {
    // This tests the actual logic flow in install_project:
    // - If skill is already scoped -> preserve as-is
    // - If skill is not scoped -> add scope
    async function simulateInstallSkill(skillName: string, repo: string): Promise<string> {
      const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}

get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}

# Simulate install_project logic
skill_name="${skillName}"
repo="${repo}"

if is_scoped_skill "$skill_name"; then
  # Already scoped - would copy as-is
  echo "$skill_name"
else
  # Not scoped - would rename with scope
  get_scoped_skill_name "$skill_name" "$repo"
fi
`;
      const result = await $`bash -c ${script}`.quiet();
      return result.text().trim();
    }

    test("does not double-scope an already scoped skill", async () => {
      // Simulating: acp-harness inherits code-documentation@plaited_development-skills
      // When installed from acp-harness, it should NOT become:
      // code-documentation@plaited_development-skills@plaited_acp-harness
      const result = await simulateInstallSkill(
        "code-documentation@plaited_development-skills",
        "plaited/acp-harness"
      );
      expect(result).toBe("code-documentation@plaited_development-skills");
      expect(result).not.toContain("@plaited_acp-harness");
    });

    test("does not double-scope inherited skill from different org", async () => {
      const result = await simulateInstallSkill(
        "my-skill@other-org_other-project",
        "plaited/acp-harness"
      );
      expect(result).toBe("my-skill@other-org_other-project");
    });

    test("scopes an unscoped skill from the installing project", async () => {
      // acp-harness's own skill (unscoped) should get scoped
      const result = await simulateInstallSkill(
        "harness-skill",
        "plaited/acp-harness"
      );
      expect(result).toBe("harness-skill@plaited_acp-harness");
    });

    test("scopes simple skill name", async () => {
      const result = await simulateInstallSkill(
        "typescript-lsp",
        "plaited/development-skills"
      );
      expect(result).toBe("typescript-lsp@plaited_development-skills");
    });
  });
});

describe("install.sh - symlink functions", () => {
  // Helper to test get_relative_symlink_path
  async function getRelativeSymlinkPath(agentSkillsDir: string, skillName: string): Promise<string> {
    const script = `
CENTRAL_SKILLS_DIR=".plaited/skills"

get_relative_symlink_path() {
  local agent_skills_dir="$1"
  local skill_name="$2"

  local depth
  depth=$(echo "$agent_skills_dir" | tr '/' '\\n' | grep -c .)

  local rel_path=""
  local i
  for ((i=0; i<depth; i++)); do
    rel_path="../$rel_path"
  done

  echo "\${rel_path}\${CENTRAL_SKILLS_DIR}/\${skill_name}"
}

get_relative_symlink_path "${agentSkillsDir}" "${skillName}"
`;
    const result = await $`bash -c ${script}`.quiet();
    return result.text().trim();
  }

  describe("get_relative_symlink_path", () => {
    test("calculates correct path for .claude/skills", async () => {
      const result = await getRelativeSymlinkPath(".claude/skills", "my-skill@org_proj");
      expect(result).toBe("../../.plaited/skills/my-skill@org_proj");
    });

    test("calculates correct path for .gemini/skills", async () => {
      const result = await getRelativeSymlinkPath(".gemini/skills", "my-skill@org_proj");
      expect(result).toBe("../../.plaited/skills/my-skill@org_proj");
    });

    test("calculates correct path for .github/skills (copilot)", async () => {
      const result = await getRelativeSymlinkPath(".github/skills", "my-skill@org_proj");
      expect(result).toBe("../../.plaited/skills/my-skill@org_proj");
    });

    test("calculates correct path for .opencode/skill (singular)", async () => {
      const result = await getRelativeSymlinkPath(".opencode/skill", "my-skill@org_proj");
      expect(result).toBe("../../.plaited/skills/my-skill@org_proj");
    });
  });

  describe("symlink creation integration", () => {
    const tmpDir = join(import.meta.dir, ".test-tmp-symlink");

    test("creates symlinks from agent dir to central storage", async () => {
      const { mkdir, rm, readdir, readlink, writeFile } = await import("fs/promises");

      // Setup
      const centralDir = join(tmpDir, ".plaited/skills");
      const agentDir = join(tmpDir, ".claude/skills");
      await mkdir(centralDir, { recursive: true });
      await mkdir(agentDir, { recursive: true });

      // Create a skill in central storage
      const skillDir = join(centralDir, "test-skill@org_project");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "skill.md"), "# Test Skill");

      // Create symlink manually (simulating create_agent_symlinks behavior)
      const symlinkPath = join(agentDir, "test-skill@org_project");
      const relativePath = "../../.plaited/skills/test-skill@org_project";
      await $`ln -s ${relativePath} ${symlinkPath}`.quiet();

      // Verify symlink was created
      const items = await readdir(agentDir);
      expect(items).toContain("test-skill@org_project");

      // Verify it's a symlink pointing to correct target
      const target = await readlink(symlinkPath);
      expect(target).toBe(relativePath);

      // Cleanup
      await rm(tmpDir, { recursive: true, force: true });
    });
  });
});

describe("install.sh - skill installation integration", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-install");

  // Integration test that simulates the actual install_project skill copying behavior
  async function testSkillInstallation(
    sourceSkills: string[],  // skill folder names in source
    repo: string             // repo path like "plaited/acp-harness"
  ): Promise<string[]> {
    const { mkdir, rm, readdir } = await import("fs/promises");

    // Setup directories
    const sourceDir = join(tmpDir, "source-skills");
    const destDir = join(tmpDir, "dest-skills");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create source skill folders
    for (const skill of sourceSkills) {
      await mkdir(join(sourceDir, skill), { recursive: true });
    }

    // Run the skill installation logic (extracted from install.sh)
    const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}

get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}

source_skills="${sourceDir}"
skills_dir="${destDir}"
repo="${repo}"

for skill_folder in "$source_skills"/*; do
  [ -d "$skill_folder" ] || continue

  skill_name=$(basename "$skill_folder")

  if is_scoped_skill "$skill_name"; then
    # Already scoped - copy as-is (inherited skill)
    cp -r "$skill_folder" "$skills_dir/"
  else
    # Not scoped - rename with scope
    scoped_name=$(get_scoped_skill_name "$skill_name" "$repo")
    cp -r "$skill_folder" "$skills_dir/$scoped_name"
  fi
done
`;

    await $`bash -c ${script}`.quiet();

    // Get resulting skill folder names
    const installed = await readdir(destDir);
    await rm(tmpDir, { recursive: true, force: true });

    return installed.sort();
  }

  test("installs both inherited scoped skills and own skills with correct names", async () => {
    // Simulating acp-harness with:
    // - inherited: code-documentation@plaited_development-skills
    // - inherited: typescript-lsp@plaited_development-skills
    // - own skill: harness-skill (should become harness-skill@plaited_acp-harness)
    const sourceSkills = [
      "code-documentation@plaited_development-skills",
      "typescript-lsp@plaited_development-skills",
      "harness-skill"
    ];

    const installed = await testSkillInstallation(sourceSkills, "plaited/acp-harness");

    expect(installed).toEqual([
      "code-documentation@plaited_development-skills",  // preserved
      "harness-skill@plaited_acp-harness",              // scoped
      "typescript-lsp@plaited_development-skills"       // preserved
    ]);
  });

  test("installs all skills from a project with no inherited skills", async () => {
    const sourceSkills = [
      "skill-a",
      "skill-b",
      "skill-c"
    ];

    const installed = await testSkillInstallation(sourceSkills, "plaited/development-skills");

    expect(installed).toEqual([
      "skill-a@plaited_development-skills",
      "skill-b@plaited_development-skills",
      "skill-c@plaited_development-skills"
    ]);
  });

  test("installs only inherited skills when project has no own skills", async () => {
    const sourceSkills = [
      "inherited-a@org_project-a",
      "inherited-b@org_project-b"
    ];

    const installed = await testSkillInstallation(sourceSkills, "plaited/consumer-project");

    expect(installed).toEqual([
      "inherited-a@org_project-a",
      "inherited-b@org_project-b"
    ]);
  });

  test("handles mixed inheritance from multiple sources", async () => {
    // Project inherits from two different sources and has own skill
    const sourceSkills = [
      "skill-from-dev@plaited_development-skills",
      "skill-from-tools@acme_shared-tools",
      "my-own-skill"
    ];

    const installed = await testSkillInstallation(sourceSkills, "plaited/my-project");

    expect(installed).toEqual([
      "my-own-skill@plaited_my-project",
      "skill-from-dev@plaited_development-skills",
      "skill-from-tools@acme_shared-tools"
    ]);
  });
});

describe("install.sh - replace-on-install behavior", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-replace");

  test("replaces existing skill folder with fresh copy", async () => {
    const { mkdir, rm, readdir, writeFile, readFile } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-skills");
    const destDir = join(tmpDir, "dest-skills");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create source skill folder with original content
    const sourceSkillDir = join(sourceDir, "my-skill");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "index.md"), "# Original Content");

    // Create existing (modified) skill folder at destination
    const existingSkillDir = join(destDir, "my-skill@org_project");
    await mkdir(existingSkillDir, { recursive: true });
    await writeFile(join(existingSkillDir, "index.md"), "# Modified Content");
    await writeFile(join(existingSkillDir, "extra-file.txt"), "This should be removed");

    // Run installation logic with atomic replace-on-install behavior (matches actual implementation)
    const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}

get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}

validate_path_within_dir() {
  local parent_dir="$1"
  local target_path="$2"
  local resolved_parent resolved_target
  resolved_parent=$(cd "$parent_dir" 2>/dev/null && pwd -P)
  resolved_target=$(cd "$(dirname "$target_path")" 2>/dev/null && pwd -P)/$(basename "$target_path")
  case "$resolved_target" in
    "$resolved_parent"/*) return 0 ;;
    *) return 1 ;;
  esac
}

source_skills="${sourceDir}"
skills_dir="${destDir}"
repo="org/project"

for skill_folder in "$source_skills"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")

  # Determine target path
  local target_path
  if is_scoped_skill "$skill_name"; then
    target_path="$skills_dir/$skill_name"
  else
    scoped_name=$(get_scoped_skill_name "$skill_name" "$repo")
    target_path="$skills_dir/$scoped_name"
  fi

  # Security: validate target path stays within skills_dir
  if ! validate_path_within_dir "$skills_dir" "$target_path"; then
    continue
  fi

  # Check if replacing existing skill
  local replacing=false
  if [ -d "$target_path" ]; then
    replacing=true
  fi

  # Atomic replace: copy to temp, remove old, move new
  local temp_dir temp_target
  temp_dir=$(mktemp -d "\${skills_dir}/.install-tmp.XXXXXX")
  temp_target="$temp_dir/$(basename "$target_path")"

  if ! cp -r "$skill_folder" "$temp_target"; then
    rm -rf "$temp_dir" 2>/dev/null
    continue
  fi

  if [ "$replacing" = true ]; then
    if ! rm -rf "$target_path"; then
      rm -rf "$temp_dir" 2>/dev/null
      continue
    fi
  fi

  if ! mv "$temp_target" "$target_path"; then
    rm -rf "$temp_dir" 2>/dev/null
    continue
  fi

  rm -rf "$temp_dir" 2>/dev/null
done
`;

    await $`bash -c ${script}`.quiet();

    // Verify the skill folder was replaced
    const installedSkills = await readdir(destDir);
    expect(installedSkills).toEqual(["my-skill@org_project"]);

    // Verify original content was restored (not the modified content)
    const content = await readFile(join(destDir, "my-skill@org_project", "index.md"), "utf-8");
    expect(content).toBe("# Original Content");

    // Verify extra file from modified folder was removed
    const { access } = await import("fs/promises");
    let extraFileExists = true;
    try {
      await access(join(destDir, "my-skill@org_project", "extra-file.txt"));
    } catch {
      extraFileExists = false;
    }
    expect(extraFileExists).toBe(false);

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("replaces existing scoped skill folder (inherited skill)", async () => {
    const { mkdir, rm, readdir, writeFile, readFile } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-scoped");
    const destDir = join(tmpDir, "dest-scoped");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create source skill folder (already scoped - inherited)
    const sourceSkillDir = join(sourceDir, "inherited@other_project");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "skill.md"), "# Fresh Version");

    // Create existing skill folder at destination (out of date)
    const existingSkillDir = join(destDir, "inherited@other_project");
    await mkdir(existingSkillDir, { recursive: true });
    await writeFile(join(existingSkillDir, "skill.md"), "# Old Version");

    // Use atomic implementation matching actual code
    const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

source_skills="${sourceDir}"
skills_dir="${destDir}"

for skill_folder in "$source_skills"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")

  local target_path
  if is_scoped_skill "$skill_name"; then
    target_path="$skills_dir/$skill_name"
  else
    target_path="$skills_dir/$skill_name"
  fi

  # Atomic replace: copy to temp, remove old, move new
  local temp_dir temp_target
  temp_dir=$(mktemp -d "\${skills_dir}/.install-tmp.XXXXXX")
  temp_target="$temp_dir/$(basename "$target_path")"

  cp -r "$skill_folder" "$temp_target" || { rm -rf "$temp_dir"; continue; }

  if [ -d "$target_path" ]; then
    rm -rf "$target_path" || { rm -rf "$temp_dir"; continue; }
  fi

  mv "$temp_target" "$target_path" || { rm -rf "$temp_dir"; continue; }
  rm -rf "$temp_dir" 2>/dev/null
done
`;

    await $`bash -c ${script}`.quiet();

    // Verify the content was replaced with fresh version
    const content = await readFile(join(destDir, "inherited@other_project", "skill.md"), "utf-8");
    expect(content).toBe("# Fresh Version");

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("installs fresh when no existing folder present", async () => {
    const { mkdir, rm, readdir, writeFile, readFile } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-fresh");
    const destDir = join(tmpDir, "dest-fresh");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create source skill folder
    const sourceSkillDir = join(sourceDir, "new-skill");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "index.md"), "# New Skill");

    // No existing folder at destination - test atomic fresh install

    const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}

get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}

source_skills="${sourceDir}"
skills_dir="${destDir}"
repo="org/project"

for skill_folder in "$source_skills"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")

  local target_path
  if is_scoped_skill "$skill_name"; then
    target_path="$skills_dir/$skill_name"
  else
    scoped_name=$(get_scoped_skill_name "$skill_name" "$repo")
    target_path="$skills_dir/$scoped_name"
  fi

  # Atomic install: copy to temp, then move
  local temp_dir temp_target
  temp_dir=$(mktemp -d "\${skills_dir}/.install-tmp.XXXXXX")
  temp_target="$temp_dir/$(basename "$target_path")"

  cp -r "$skill_folder" "$temp_target" || { rm -rf "$temp_dir"; continue; }
  mv "$temp_target" "$target_path" || { rm -rf "$temp_dir"; continue; }
  rm -rf "$temp_dir" 2>/dev/null
done
`;

    await $`bash -c ${script}`.quiet();

    // Verify the skill was installed
    const installedSkills = await readdir(destDir);
    expect(installedSkills).toEqual(["new-skill@org_project"]);

    const content = await readFile(join(destDir, "new-skill@org_project", "index.md"), "utf-8");
    expect(content).toBe("# New Skill");

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("install.sh - error handling", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-errors");

  test("handles copy failure gracefully", async () => {
    const { mkdir, rm, readdir, chmod } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-err");
    const destDir = join(tmpDir, "dest-err");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create source skill folder
    const sourceSkillDir = join(sourceDir, "my-skill");
    await mkdir(sourceSkillDir, { recursive: true });

    // Make dest dir read-only to cause copy failure
    await chmod(destDir, 0o444);

    const script = `
skills_dir="${destDir}"
skill_folder="${sourceSkillDir}"
skill_name="my-skill"
target_path="$skills_dir/my-skill@org_project"

# Atomic install attempt
temp_dir=$(mktemp -d "\${skills_dir}/.install-tmp.XXXXXX" 2>/dev/null)
if [ -z "$temp_dir" ]; then
  echo "COPY_FAILED"
  exit 0
fi

temp_target="$temp_dir/$(basename "$target_path")"

if ! cp -r "$skill_folder" "$temp_target" 2>/dev/null; then
  rm -rf "$temp_dir" 2>/dev/null
  echo "COPY_FAILED"
  exit 0
fi

echo "COPY_SUCCESS"
`;

    const result = await $`bash -c ${script}`.quiet();
    expect(result.text().trim()).toBe("COPY_FAILED");

    // Restore permissions and cleanup
    await chmod(destDir, 0o755);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("cleans up temp files on move failure", async () => {
    const { mkdir, rm, readdir, writeFile } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-mv-err");
    const destDir = join(tmpDir, "dest-mv-err");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create source skill folder
    const sourceSkillDir = join(sourceDir, "my-skill");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "index.md"), "# Test");

    const script = `
skills_dir="${destDir}"
skill_folder="${sourceSkillDir}"
target_path="$skills_dir/my-skill@org_project"

# Atomic install with simulated move failure
temp_dir=$(mktemp -d "\${skills_dir}/.install-tmp.XXXXXX")
temp_target="$temp_dir/$(basename "$target_path")"

cp -r "$skill_folder" "$temp_target"

# Simulate move failure and verify cleanup
if ! false; then  # Always fails
  rm -rf "$temp_dir" 2>/dev/null
  echo "CLEANUP_DONE"
  exit 0
fi
`;

    const result = await $`bash -c ${script}`.quiet();
    expect(result.text().trim()).toBe("CLEANUP_DONE");

    // Verify no temp directories left behind
    const files = await readdir(destDir);
    const tempDirs = files.filter(f => f.startsWith(".install-tmp"));
    expect(tempDirs.length).toBe(0);

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("handles mktemp failure gracefully", async () => {
    const { mkdir, rm } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-mktemp");
    await mkdir(sourceDir, { recursive: true });

    // Create source skill folder
    const sourceSkillDir = join(sourceDir, "my-skill");
    await mkdir(sourceSkillDir, { recursive: true });

    // Use non-existent directory for skills_dir to cause mktemp failure
    const nonExistentDir = join(tmpDir, "non-existent-dir");

    const script = `
print_error() { echo "ERROR: $1" >&2; }

skills_dir="${nonExistentDir}"
skill_name="my-skill"

# Attempt mktemp in non-existent directory (will fail)
temp_dir=$(mktemp -d "\${skills_dir}/.install-tmp.XXXXXX" 2>/dev/null)
if [ -z "$temp_dir" ] || [ ! -d "$temp_dir" ]; then
  print_error "  Failed to create temp directory: $skill_name"
  echo "MKTEMP_FAILED"
  exit 0
fi

echo "MKTEMP_SUCCESS"
`;

    const result = await $`bash -c ${script}`.quiet();
    expect(result.text().trim()).toBe("MKTEMP_FAILED");

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("path validation rejects traversal attempts", async () => {
    const { mkdir, rm } = await import("fs/promises");

    // Create actual test directories
    const testDir = join(tmpDir, "path-validation");
    const skillsDir = join(testDir, "skills");
    await mkdir(skillsDir, { recursive: true });

    const script = `
validate_path_within_dir() {
  local parent_dir="$1"
  local target_path="$2"

  local resolved_parent
  resolved_parent=$(cd "$parent_dir" 2>/dev/null && pwd -P)
  [ -z "$resolved_parent" ] && return 1

  local basename
  basename=$(basename "$target_path")
  if [[ "$basename" =~ / ]] || [[ "$basename" =~ \\.\\. ]] || [ -z "$basename" ]; then
    return 1
  fi

  local expected_target="$resolved_parent/$basename"
  local actual_target
  actual_target=$(cd "$parent_dir" && cd "$(dirname "$target_path")" 2>/dev/null && pwd -P)/$(basename "$target_path")

  if [ -z "$actual_target" ]; then
    [ "$target_path" = "$resolved_parent/$basename" ]
    return $?
  fi

  [ "$actual_target" = "$expected_target" ]
}

skills_dir="${skillsDir}"

# Test valid path (direct child of skills_dir)
if validate_path_within_dir "$skills_dir" "$skills_dir/my-skill@org_project"; then
  echo "VALID_PATH_OK"
else
  echo "VALID_PATH_FAIL"
fi

# Test traversal attempt (trying to escape skills_dir)
if validate_path_within_dir "$skills_dir" "$skills_dir/../etc/passwd"; then
  echo "TRAVERSAL_ALLOWED"
else
  echo "TRAVERSAL_BLOCKED"
fi

# Test path with .. in basename
if validate_path_within_dir "$skills_dir" "$skills_dir/.."; then
  echo "DOTDOT_ALLOWED"
else
  echo "DOTDOT_BLOCKED"
fi
`;

    const result = await $`bash -c ${script}`.quiet();
    const output = result.text().trim();
    expect(output).toContain("VALID_PATH_OK");
    expect(output).toContain("TRAVERSAL_BLOCKED");
    expect(output).toContain("DOTDOT_BLOCKED");

    await rm(tmpDir, { recursive: true, force: true });
  });
});


describe("install.sh - scoped content removal integration", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-removal");

  // Integration test for remove_project_scoped_content behavior
  async function testScopedSkillRemoval(
    existingSkills: string[],  // skill folder names already installed
    scopeToRemove: string      // scope pattern like "plaited_development-skills"
  ): Promise<string[]> {
    const { mkdir, rm, readdir } = await import("fs/promises");

    const skillsDir = join(tmpDir, "skills");
    await mkdir(skillsDir, { recursive: true });

    // Create existing skill folders
    for (const skill of existingSkills) {
      await mkdir(join(skillsDir, skill), { recursive: true });
    }

    // Run the removal logic (extracted from install.sh)
    const script = `
shopt -s nullglob

skills_dir="${skillsDir}"
scope_pattern="@${scopeToRemove}$"

for skill_folder in "$skills_dir"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")
  if [[ "$skill_name" =~ $scope_pattern ]]; then
    rm -rf "$skill_folder"
  fi
done
`;

    await $`bash -c ${script}`.quiet();

    // Get remaining skill folder names
    const remaining = await readdir(skillsDir);
    await rm(tmpDir, { recursive: true, force: true });

    return remaining.sort();
  }

  test("removes only skills matching the scope pattern", async () => {
    const existing = [
      "typescript-lsp@plaited_development-skills",
      "code-documentation@plaited_development-skills",
      "harness-skill@plaited_acp-harness",
      "unscoped-skill"
    ];

    const remaining = await testScopedSkillRemoval(
      existing,
      "plaited_development-skills"
    );

    expect(remaining).toEqual([
      "harness-skill@plaited_acp-harness",
      "unscoped-skill"
    ]);
  });

  test("preserves all skills when scope doesn't match", async () => {
    const existing = [
      "typescript-lsp@plaited_development-skills",
      "harness-skill@plaited_acp-harness"
    ];

    const remaining = await testScopedSkillRemoval(
      existing,
      "other_project"
    );

    expect(remaining).toEqual([
      "harness-skill@plaited_acp-harness",
      "typescript-lsp@plaited_development-skills"
    ]);
  });

  test("handles empty skills directory gracefully", async () => {
    const remaining = await testScopedSkillRemoval([], "plaited_development-skills");
    expect(remaining).toEqual([]);
  });
});

describe("install.sh - edge cases", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-edge");

  describe("skill scoping edge cases", () => {
    async function testScopedName(skillName: string, repo: string): Promise<string> {
      const script = `
extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}
get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}
get_scoped_skill_name "${skillName}" "${repo}"
`;
      const result = await $`bash -c ${script}`.quiet();
      return result.text().trim();
    }

    test("handles skill name with numbers", async () => {
      const result = await testScopedName("skill123", "org/project");
      expect(result).toBe("skill123@org_project");
    });

    test("handles skill name starting with number", async () => {
      const result = await testScopedName("123skill", "org/project");
      expect(result).toBe("123skill@org_project");
    });

    test("handles skill name with consecutive hyphens", async () => {
      const result = await testScopedName("my--skill", "org/project");
      expect(result).toBe("my--skill@org_project");
    });

    test("handles single character skill name", async () => {
      const result = await testScopedName("a", "org/project");
      expect(result).toBe("a@org_project");
    });

    test("handles single character org and project", async () => {
      const result = await testScopedName("skill", "a/b");
      expect(result).toBe("skill@a_b");
    });

    test("handles repo with version numbers", async () => {
      const result = await testScopedName("skill", "org/project-v2");
      expect(result).toBe("skill@org_project-v2");
    });
  });

  describe("is_scoped_skill pattern matching", () => {
    async function isScopedSkill(skillName: string): Promise<boolean> {
      const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}
is_scoped_skill "${skillName}"
`;
      try {
        await $`bash -c ${script}`.quiet();
        return true;
      } catch {
        return false;
      }
    }

    test("rejects empty org component", async () => {
      expect(await isScopedSkill("skill@_project")).toBe(false);
    });

    test("rejects empty project component", async () => {
      expect(await isScopedSkill("skill@org_")).toBe(false);
    });

    test("rejects multiple @ symbols", async () => {
      // Strict pattern requires skill name to be alphanumeric only (no @)
      expect(await isScopedSkill("skill@org@another_project")).toBe(false);
    });

    test("rejects spaces in skill name", async () => {
      // Strict pattern only allows alphanumeric, dots, hyphens, underscores
      expect(await isScopedSkill("my skill@org_project")).toBe(false);
    });

    test("accepts skill with numbers in all parts", async () => {
      expect(await isScopedSkill("skill123@org456_project789")).toBe(true);
    });

    test("accepts very long valid scoped name", async () => {
      const longName = "a".repeat(50) + "@" + "b".repeat(50) + "_" + "c".repeat(50);
      expect(await isScopedSkill(longName)).toBe(true);
    });
  });

  describe("skill installation with special folder structures", () => {
    async function testSkillInstallation(
      sourceSkills: string[],
      repo: string
    ): Promise<string[]> {
      const { mkdir, rm, readdir, writeFile } = await import("fs/promises");

      const sourceDir = join(tmpDir, "source-skills");
      const destDir = join(tmpDir, "dest-skills");
      await mkdir(sourceDir, { recursive: true });
      await mkdir(destDir, { recursive: true });

      // Create source skill folders with content
      for (const skill of sourceSkills) {
        const skillDir = join(sourceDir, skill);
        await mkdir(skillDir, { recursive: true });
        // Add a file inside to simulate real skill content
        await writeFile(join(skillDir, "index.md"), `# ${skill}\n`);
      }

      const script = `
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}

get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}

source_skills="${sourceDir}"
skills_dir="${destDir}"
repo="${repo}"

for skill_folder in "$source_skills"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")
  if is_scoped_skill "$skill_name"; then
    cp -r "$skill_folder" "$skills_dir/"
  else
    scoped_name=$(get_scoped_skill_name "$skill_name" "$repo")
    cp -r "$skill_folder" "$skills_dir/$scoped_name"
  fi
done
`;

      await $`bash -c ${script}`.quiet();

      const installed = await readdir(destDir);
      await rm(tmpDir, { recursive: true, force: true });

      return installed.sort();
    }

    test("preserves nested content in skill folders", async () => {
      const { mkdir, rm, readdir, readFile, writeFile } = await import("fs/promises");

      const sourceDir = join(tmpDir, "source-nested");
      const destDir = join(tmpDir, "dest-nested");
      await mkdir(sourceDir, { recursive: true });
      await mkdir(destDir, { recursive: true });

      // Create skill with nested structure
      const skillDir = join(sourceDir, "complex-skill");
      await mkdir(join(skillDir, "subdir"), { recursive: true });
      await writeFile(join(skillDir, "index.md"), "# Main");
      await writeFile(join(skillDir, "subdir", "nested.md"), "# Nested");

      const script = `
is_scoped_skill() {
  [[ "$1" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}
extract_org_from_repo() { echo "\${1%%/*}"; }
get_scoped_skill_name() {
  local org; org=$(extract_org_from_repo "$2")
  echo "\${1}@\${org}_\${2##*/}"
}

for skill_folder in "${sourceDir}"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")
  scoped_name=$(get_scoped_skill_name "$skill_name" "org/project")
  cp -r "$skill_folder" "${destDir}/$scoped_name"
done
`;

      await $`bash -c ${script}`.quiet();

      const installed = await readdir(destDir);
      expect(installed).toEqual(["complex-skill@org_project"]);

      // Verify nested content was preserved
      const nestedContent = await readFile(
        join(destDir, "complex-skill@org_project", "subdir", "nested.md"),
        "utf-8"
      );
      expect(nestedContent).toBe("# Nested");

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("handles large number of skills", async () => {
      const skills = Array.from({ length: 50 }, (_, i) => `skill-${i}`);
      const installed = await testSkillInstallation(skills, "org/project");

      expect(installed.length).toBe(50);
      expect(installed[0]).toBe("skill-0@org_project");
      expect(installed[49]).toBe("skill-9@org_project"); // sorted alphabetically
    });

    test("handles skill with only files (no subdirectories)", async () => {
      const installed = await testSkillInstallation(["simple-skill"], "org/project");
      expect(installed).toEqual(["simple-skill@org_project"]);
    });
  });

  describe("agent detection edge cases", () => {
    test("detect_agent returns empty for clean directory", async () => {
      const { mkdir, rm } = await import("fs/promises");
      const testDir = join(tmpDir, "clean-dir");
      await mkdir(testDir, { recursive: true });

      const script = `
cd "${testDir}"
detect_agent() {
  local agents=".gemini:gemini .github:copilot .cursor:cursor .opencode:opencode .amp:amp .goose:goose .factory:factory .codex:codex .windsurf:windsurf .claude:claude"
  for entry in $agents; do
    local dir="\${entry%%:*}"
    local agent="\${entry#*:}"
    if [ -d "$dir" ]; then
      echo "$agent"
      return 0
    fi
  done
  echo ""
}
detect_agent
`;
      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("");

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("detect_agent prioritizes first match", async () => {
      const { mkdir, rm } = await import("fs/promises");
      const testDir = join(tmpDir, "multi-agent-dir");
      await mkdir(join(testDir, ".gemini"), { recursive: true });
      await mkdir(join(testDir, ".cursor"), { recursive: true });

      const script = `
cd "${testDir}"
detect_agent() {
  local agents=".gemini:gemini .github:copilot .cursor:cursor .opencode:opencode .amp:amp .goose:goose .factory:factory .codex:codex .windsurf:windsurf .claude:claude"
  for entry in $agents; do
    local dir="\${entry%%:*}"
    local agent="\${entry#*:}"
    if [ -d "$dir" ]; then
      echo "$agent"
      return 0
    fi
  done
  echo ""
}
detect_agent
`;
      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("gemini");

      await rm(tmpDir, { recursive: true, force: true });
    });
  });

  describe("get_skill_scope_prefix validation", () => {
    async function getSkillScopePrefix(repo: string): Promise<{ output: string; exitCode: number }> {
      const script = `
print_error() { echo "ERROR: $1" >&2; }

validate_scope_component() {
  local component="$1"
  if [ -z "$component" ] || [[ "$component" =~ \\.\\. ]] || [[ "$component" =~ ^/ ]]; then
    return 1
  fi
  return 0
}

extract_org_from_repo() {
  local repo="$1"
  local org="\${repo%%/*}"
  if ! validate_scope_component "$org"; then
    echo ""
    return 1
  fi
  echo "$org"
}

get_skill_scope_prefix() {
  local repo="$1"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  if ! validate_scope_component "$org" || ! validate_scope_component "$project_name"; then
    echo ""
    return 1
  fi
  echo "\${org}_\${project_name}"
}

get_skill_scope_prefix "${repo}"
`;
      try {
        const result = await $`bash -c ${script}`.quiet();
        return { output: result.text().trim(), exitCode: 0 };
      } catch (error: unknown) {
        const err = error as { stdout?: { toString(): string }; exitCode?: number };
        return {
          output: err.stdout?.toString().trim() ?? "",
          exitCode: err.exitCode ?? 1,
        };
      }
    }

    test("generates valid scope for normal repo", async () => {
      const result = await getSkillScopePrefix("org/project");
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe("org_project");
    });

    test("rejects repo with path traversal in org", async () => {
      const result = await getSkillScopePrefix("../etc/passwd");
      expect(result.output).toBe("");
    });

    test("rejects repo with absolute path", async () => {
      const result = await getSkillScopePrefix("/absolute/path");
      expect(result.output).toBe("");
    });

    test("handles repo with dots (not traversal)", async () => {
      const result = await getSkillScopePrefix("org.name/project.name");
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe("org.name_project.name");
    });
  });
});

describe("install.sh - JSON parsing (jq/awk)", () => {
  // Test that JSON parsing works correctly regardless of jq availability
  describe("get_project_names", () => {
    test("returns project names using jq when available", async () => {
      const script = `
PROJECTS_JSON="${PROJECTS_JSON}"
has_jq() { command -v jq >/dev/null 2>&1; }
get_project_names() {
  if has_jq; then
    jq -r '.projects[].name' "$PROJECTS_JSON"
  else
    awk '
      /"projects"[[:space:]]*:/ { in_projects=1 }
      in_projects && /"name"[[:space:]]*:/ {
        gsub(/.*"name"[[:space:]]*:[[:space:]]*"/, "")
        gsub(/".*/, "")
        print
      }
    ' "$PROJECTS_JSON"
  fi
}
get_project_names
`;
      const result = await $`bash -c ${script}`.quiet();
      const names = result.text().trim().split("\n").filter(Boolean);

      // Should return at least one project name
      expect(names.length).toBeGreaterThan(0);

      // Verify against JSON content
      const content = await readFile(PROJECTS_JSON, "utf-8");
      const projects = JSON.parse(content);
      const expectedNames = projects.projects.map((p: { name: string }) => p.name);
      expect(names.sort()).toEqual(expectedNames.sort());
    });

    test("awk fallback produces same results as jq", async () => {
      // Force awk fallback by overriding has_jq
      const awkScript = `
PROJECTS_JSON="${PROJECTS_JSON}"
awk '
  /"projects"[[:space:]]*:/ { in_projects=1 }
  in_projects && /"name"[[:space:]]*:/ {
    gsub(/.*"name"[[:space:]]*:[[:space:]]*"/, "")
    gsub(/".*/, "")
    print
  }
' "$PROJECTS_JSON"
`;
      const awkResult = await $`bash -c ${awkScript}`.quiet();
      const awkNames = awkResult.text().trim().split("\n").filter(Boolean);

      // Compare with JSON content
      const content = await readFile(PROJECTS_JSON, "utf-8");
      const projects = JSON.parse(content);
      const expectedNames = projects.projects.map((p: { name: string }) => p.name);

      expect(awkNames.sort()).toEqual(expectedNames.sort());
    });
  });

  describe("get_project_repo", () => {
    test("returns correct repo for each project", async () => {
      const content = await readFile(PROJECTS_JSON, "utf-8");
      const projects = JSON.parse(content);

      for (const project of projects.projects) {
        const script = `
PROJECTS_JSON="${PROJECTS_JSON}"
has_jq() { command -v jq >/dev/null 2>&1; }
get_project_repo() {
  local project_name="$1"
  if has_jq; then
    jq -r --arg name "$project_name" '.projects[] | select(.name == $name) | .repo' "$PROJECTS_JSON"
  else
    awk -v name="$project_name" '
      /"name"[[:space:]]*:[[:space:]]*"'"$project_name"'"/ { found=1 }
      found && /"repo"[[:space:]]*:/ {
        gsub(/.*"repo"[[:space:]]*:[[:space:]]*"/, "")
        gsub(/".*/, "")
        print
        exit
      }
    ' "$PROJECTS_JSON"
  fi
}
get_project_repo "${project.name}"
`;
        const result = await $`bash -c ${script}`.quiet();
        expect(result.text().trim()).toBe(project.repo);
      }
    });

    test("awk fallback returns correct repo for each project", async () => {
      const content = await readFile(PROJECTS_JSON, "utf-8");
      const projects = JSON.parse(content);

      for (const project of projects.projects) {
        const awkScript = `
PROJECTS_JSON="${PROJECTS_JSON}"
project_name="${project.name}"
awk -v name="$project_name" '
  /"name"[[:space:]]*:[[:space:]]*"'"$project_name"'"/ { found=1 }
  found && /"repo"[[:space:]]*:/ {
    gsub(/.*"repo"[[:space:]]*:[[:space:]]*"/, "")
    gsub(/".*/, "")
    print
    exit
  }
' "$PROJECTS_JSON"
`;
        const result = await $`bash -c ${awkScript}`.quiet();
        expect(result.text().trim()).toBe(project.repo);
      }
    });

    test("returns empty for non-existent project", async () => {
      const script = `
PROJECTS_JSON="${PROJECTS_JSON}"
has_jq() { command -v jq >/dev/null 2>&1; }
get_project_repo() {
  local project_name="$1"
  if has_jq; then
    jq -r --arg name "$project_name" '.projects[] | select(.name == $name) | .repo' "$PROJECTS_JSON"
  else
    awk -v name="$project_name" '
      /"name"[[:space:]]*:[[:space:]]*"'"$project_name"'"/ { found=1 }
      found && /"repo"[[:space:]]*:/ {
        gsub(/.*"repo"[[:space:]]*:[[:space:]]*"/, "")
        gsub(/".*/, "")
        print
        exit
      }
    ' "$PROJECTS_JSON"
  fi
}
get_project_repo "non-existent-project-xyz"
`;
      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("");
    });
  });

  describe("has_jq detection", () => {
    test("correctly detects jq availability", async () => {
      const script = `
has_jq() { command -v jq >/dev/null 2>&1; }
if has_jq; then echo "jq-available"; else echo "jq-not-available"; fi
`;
      const result = await $`bash -c ${script}`.quiet();
      const output = result.text().trim();

      // Check if jq is actually available on this system
      let jqAvailable = false;
      try {
        await $`which jq`.quiet();
        jqAvailable = true;
      } catch {
        jqAvailable = false;
      }

      if (jqAvailable) {
        expect(output).toBe("jq-available");
      } else {
        expect(output).toBe("jq-not-available");
      }
    });
  });
});

describe("install.sh - checksum verification", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-checksum");

  test("checksum mismatch is detected", async () => {
    const { mkdir, writeFile, rm } = await import("fs/promises");
    await mkdir(tmpDir, { recursive: true });

    // Create a test projects.json
    const testProjectsJson = join(tmpDir, "projects.json");
    const testChecksumFile = join(tmpDir, "projects.json.sha256");

    await writeFile(testProjectsJson, '{"projects":[{"name":"test","repo":"org/repo"}]}');
    // Write an incorrect checksum
    await writeFile(testChecksumFile, "0000000000000000000000000000000000000000000000000000000000000000  projects.json");

    // Simulate checksum verification logic
    const script = `
set -e
print_error() { echo "ERROR: $1" >&2; }

PROJECTS_JSON="${testProjectsJson}"
checksum_file="${testChecksumFile}"

expected_checksum=$(awk '{print $1}' "$checksum_file")
actual_checksum=$(shasum -a 256 "$PROJECTS_JSON" 2>/dev/null | awk '{print $1}')

if [ "$expected_checksum" != "$actual_checksum" ]; then
  echo "CHECKSUM_MISMATCH"
  exit 1
else
  echo "CHECKSUM_OK"
fi
`;

    try {
      await $`bash -c ${script}`.quiet();
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: unknown) {
      const err = error as { stdout?: { toString(): string }; exitCode?: number };
      expect(err.stdout?.toString()).toContain("CHECKSUM_MISMATCH");
      expect(err.exitCode).toBe(1);
    }

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("valid checksum passes verification", async () => {
    const { mkdir, writeFile, rm } = await import("fs/promises");
    await mkdir(tmpDir, { recursive: true });

    // Create a test projects.json
    const testProjectsJson = join(tmpDir, "projects.json");
    const testChecksumFile = join(tmpDir, "projects.json.sha256");
    const content = '{"projects":[{"name":"test","repo":"org/repo"}]}';

    await writeFile(testProjectsJson, content);

    // Generate correct checksum
    const checksumResult = await $`shasum -a 256 ${testProjectsJson}`.quiet();
    const checksum = checksumResult.text().split(" ")[0];
    await writeFile(testChecksumFile, `${checksum}  projects.json`);

    // Simulate checksum verification logic
    const script = `
set -e
PROJECTS_JSON="${testProjectsJson}"
checksum_file="${testChecksumFile}"

expected_checksum=$(awk '{print $1}' "$checksum_file")
actual_checksum=$(shasum -a 256 "$PROJECTS_JSON" 2>/dev/null | awk '{print $1}')

if [ "$expected_checksum" != "$actual_checksum" ]; then
  echo "CHECKSUM_MISMATCH"
  exit 1
else
  echo "CHECKSUM_OK"
fi
`;

    const result = await $`bash -c ${script}`.quiet();
    expect(result.text().trim()).toBe("CHECKSUM_OK");

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("install.sh - path validation with relative skills_dir (Issue #9 fix)", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-issue9");

  test("validates target path when skills_dir is relative", async () => {
    const { mkdir, rm } = await import("fs/promises");

    // Create test directories to simulate real scenario
    const testDir = join(tmpDir, "project");
    const skillsDir = join(testDir, ".claude", "skills");
    await mkdir(skillsDir, { recursive: true });

    // Test from within the project directory with relative path
    const script = `
cd "${testDir}"

validate_path_within_dir() {
  local parent_dir="$1"
  local target_path="$2"

  local resolved_parent
  resolved_parent=$(cd "$parent_dir" 2>/dev/null && pwd -P)
  [ -z "$resolved_parent" ] && return 1

  local basename
  basename=$(basename "$target_path")
  if [[ "$basename" =~ / ]] || [[ "$basename" =~ \\.\\. ]] || [ -z "$basename" ]; then
    return 1
  fi

  local expected_target="$resolved_parent/$basename"
  local actual_target
  # Fixed: Resolve dirname of target_path from original working directory
  local target_dirname
  target_dirname=$(cd "$(dirname "$target_path")" 2>/dev/null && pwd -P)
  actual_target="$target_dirname/$basename"

  if [ -z "$actual_target" ]; then
    [ "$target_path" = "$resolved_parent/$basename" ]
    return $?
  fi

  [ "$actual_target" = "$expected_target" ]
}

skills_dir=".claude/skills"
target_path=".claude/skills/my-skill@org_project"

if validate_path_within_dir "$skills_dir" "$target_path"; then
  echo "VALIDATION_PASSED"
else
  echo "VALIDATION_FAILED"
fi
`;

    const result = await $`bash -c ${script}`.quiet();
    expect(result.text().trim()).toBe("VALIDATION_PASSED");

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("still rejects traversal attempts with relative skills_dir", async () => {
    const { mkdir, rm } = await import("fs/promises");

    const testDir = join(tmpDir, "project-traversal");
    const skillsDir = join(testDir, ".claude", "skills");
    await mkdir(skillsDir, { recursive: true });

    const script = `
cd "${testDir}"

validate_path_within_dir() {
  local parent_dir="$1"
  local target_path="$2"

  local resolved_parent
  resolved_parent=$(cd "$parent_dir" 2>/dev/null && pwd -P)
  [ -z "$resolved_parent" ] && return 1

  local basename
  basename=$(basename "$target_path")
  if [[ "$basename" =~ / ]] || [[ "$basename" =~ \\.\\. ]] || [ -z "$basename" ]; then
    return 1
  fi

  local expected_target="$resolved_parent/$basename"
  local actual_target
  local target_dirname
  target_dirname=$(cd "$(dirname "$target_path")" 2>/dev/null && pwd -P)
  actual_target="$target_dirname/$basename"

  if [ -z "$actual_target" ]; then
    [ "$target_path" = "$resolved_parent/$basename" ]
    return $?
  fi

  [ "$actual_target" = "$expected_target" ]
}

skills_dir=".claude/skills"

# Test 1: path with .. in basename should be rejected
if validate_path_within_dir "$skills_dir" ".claude/skills/.."; then
  echo "DOTDOT_ALLOWED"
else
  echo "DOTDOT_BLOCKED"
fi

# Test 2: traversal path should be rejected (actual_target won't match expected)
if validate_path_within_dir "$skills_dir" ".claude/skills/../../../etc/passwd"; then
  echo "TRAVERSAL_ALLOWED"
else
  echo "TRAVERSAL_BLOCKED"
fi
`;

    const result = await $`bash -c ${script}`.quiet();
    const output = result.text().trim();
    expect(output).toContain("DOTDOT_BLOCKED");
    expect(output).toContain("TRAVERSAL_BLOCKED");

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("install.sh - dependency detection functions", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-deps");

  describe("get_skill_source_project", () => {
    async function getSkillSourceProject(skillName: string, projectsJson: string): Promise<string> {
      const script = `
PROJECTS_JSON="${projectsJson}"

is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
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

get_skill_source_project() {
  local skill_name="$1"

  if ! is_scoped_skill "$skill_name"; then
    echo ""
    return 1
  fi

  local scope_part="\${skill_name##*@}"
  local project_name="\${scope_part#*_}"

  local known_projects
  known_projects=$(get_project_names)
  for known in $known_projects; do
    if [ "$known" = "$project_name" ]; then
      echo "$project_name"
      return 0
    fi
  done

  echo ""
  return 1
}

get_skill_source_project "${skillName}" || true
`;
      try {
        const result = await $`bash -c ${script}`.quiet();
        return result.text().trim();
      } catch (error: unknown) {
        const err = error as { stdout?: { toString(): string } };
        return err.stdout?.toString().trim() ?? "";
      }
    }

    test("detects source project from scoped skill name", async () => {
      const result = await getSkillSourceProject(
        "typescript-lsp@plaited_development-skills",
        PROJECTS_JSON
      );
      expect(result).toBe("development-skills");
    });

    test("returns empty for unscoped skill", async () => {
      const result = await getSkillSourceProject("typescript-lsp", PROJECTS_JSON);
      expect(result).toBe("");
    });

    test("returns empty for scoped skill with unknown project", async () => {
      const result = await getSkillSourceProject(
        "my-skill@org_unknown-project",
        PROJECTS_JSON
      );
      expect(result).toBe("");
    });

    test("detects agent-eval-harness as source project", async () => {
      const result = await getSkillSourceProject(
        "some-skill@plaited_agent-eval-harness",
        PROJECTS_JSON
      );
      expect(result).toBe("agent-eval-harness");
    });
  });

  describe("project installation tracking", () => {
    test("is_project_installed returns false for uninstalled project", async () => {
      const script = `
INSTALLED_PROJECTS=""

is_project_installed() {
  local project="$1"
  [[ " $INSTALLED_PROJECTS " =~ " $project " ]]
}

if is_project_installed "development-skills"; then
  echo "INSTALLED"
else
  echo "NOT_INSTALLED"
fi
`;
      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("NOT_INSTALLED");
    });

    test("is_project_installed returns true after marking", async () => {
      const script = `
INSTALLED_PROJECTS=""

is_project_installed() {
  local project="$1"
  [[ " $INSTALLED_PROJECTS " =~ " $project " ]]
}

mark_project_installed() {
  INSTALLED_PROJECTS="$INSTALLED_PROJECTS $1"
}

mark_project_installed "development-skills"

if is_project_installed "development-skills"; then
  echo "INSTALLED"
else
  echo "NOT_INSTALLED"
fi
`;
      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("INSTALLED");
    });

    test("tracks multiple installed projects", async () => {
      const script = `
INSTALLED_PROJECTS=""

is_project_installed() {
  local project="$1"
  [[ " $INSTALLED_PROJECTS " =~ " $project " ]]
}

mark_project_installed() {
  INSTALLED_PROJECTS="$INSTALLED_PROJECTS $1"
}

mark_project_installed "project-a"
mark_project_installed "project-b"
mark_project_installed "project-c"

results=""
if is_project_installed "project-a"; then results="$results A"; fi
if is_project_installed "project-b"; then results="$results B"; fi
if is_project_installed "project-c"; then results="$results C"; fi
if is_project_installed "project-d"; then results="$results D"; fi

echo "$results"
`;
      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("A B C");
    });
  });

  describe("get_project_dependencies", () => {
    test("detects dependencies from scoped skills", async () => {
      const { mkdir, rm, writeFile } = await import("fs/promises");

      const projectTemp = join(tmpDir, "test-project");
      const skillsDir = join(projectTemp, ".claude", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(projectTemp, ".sparse_path"), ".claude");

      // Create scoped skill folders (inherited skills)
      await mkdir(join(skillsDir, "typescript-lsp@plaited_development-skills"), { recursive: true });
      await mkdir(join(skillsDir, "code-review@plaited_development-skills"), { recursive: true });
      await mkdir(join(skillsDir, "own-skill"), { recursive: true }); // unscoped

      const script = `
PROJECTS_JSON="${PROJECTS_JSON}"

is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
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

get_skill_source_project() {
  local skill_name="$1"

  if ! is_scoped_skill "$skill_name"; then
    echo ""
    return 1
  fi

  local scope_part="\${skill_name##*@}"
  local project_name="\${scope_part#*_}"

  local known_projects
  known_projects=$(get_project_names)
  for known in $known_projects; do
    if [ "$known" = "$project_name" ]; then
      echo "$project_name"
      return 0
    fi
  done

  echo ""
  return 1
}

get_project_dependencies() {
  local project_temp="$1"
  local sparse_path
  sparse_path=$(cat "$project_temp/.sparse_path")
  local source_skills="$project_temp/$sparse_path/skills"
  local dependencies=""

  if [ ! -d "$source_skills" ]; then
    echo ""
    return 0
  fi

  for skill_folder in "$source_skills"/*; do
    [ -d "$skill_folder" ] || continue
    local skill_name
    skill_name=$(basename "$skill_folder")

    local source_project
    source_project=$(get_skill_source_project "$skill_name")
    if [ -n "$source_project" ]; then
      if ! [[ " $dependencies " =~ " $source_project " ]]; then
        dependencies="$dependencies $source_project"
      fi
    fi
  done

  echo "$dependencies"
}

get_project_dependencies "${projectTemp}"
`;

      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("development-skills");

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("returns empty for project with no dependencies", async () => {
      const { mkdir, rm, writeFile } = await import("fs/promises");

      const projectTemp = join(tmpDir, "no-deps-project");
      const skillsDir = join(projectTemp, ".claude", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(projectTemp, ".sparse_path"), ".claude");

      // Create only unscoped skills (no inherited dependencies)
      await mkdir(join(skillsDir, "skill-a"), { recursive: true });
      await mkdir(join(skillsDir, "skill-b"), { recursive: true });

      const script = `
PROJECTS_JSON="${PROJECTS_JSON}"

is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
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

get_skill_source_project() {
  local skill_name="$1"

  if ! is_scoped_skill "$skill_name"; then
    echo ""
    return 1
  fi

  local scope_part="\${skill_name##*@}"
  local project_name="\${scope_part#*_}"

  local known_projects
  known_projects=$(get_project_names)
  for known in $known_projects; do
    if [ "$known" = "$project_name" ]; then
      echo "$project_name"
      return 0
    fi
  done

  echo ""
  return 1
}

get_project_dependencies() {
  local project_temp="$1"
  local sparse_path
  sparse_path=$(cat "$project_temp/.sparse_path")
  local source_skills="$project_temp/$sparse_path/skills"
  local dependencies=""

  if [ ! -d "$source_skills" ]; then
    echo ""
    return 0
  fi

  for skill_folder in "$source_skills"/*; do
    [ -d "$skill_folder" ] || continue
    local skill_name
    skill_name=$(basename "$skill_folder")

    local source_project
    source_project=$(get_skill_source_project "$skill_name")
    if [ -n "$source_project" ]; then
      if ! [[ " $dependencies " =~ " $source_project " ]]; then
        dependencies="$dependencies $source_project"
      fi
    fi
  done

  echo "$dependencies"
}

get_project_dependencies "${projectTemp}"
`;

      const result = await $`bash -c ${script}`.quiet();
      expect(result.text().trim()).toBe("");

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("deduplicates multiple skills from same source project", async () => {
      const { mkdir, rm, writeFile } = await import("fs/promises");

      const projectTemp = join(tmpDir, "dedup-project");
      const skillsDir = join(projectTemp, ".claude", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(projectTemp, ".sparse_path"), ".claude");

      // Create multiple skills from the same source project
      await mkdir(join(skillsDir, "skill-a@plaited_development-skills"), { recursive: true });
      await mkdir(join(skillsDir, "skill-b@plaited_development-skills"), { recursive: true });
      await mkdir(join(skillsDir, "skill-c@plaited_development-skills"), { recursive: true });

      const script = `
PROJECTS_JSON="${PROJECTS_JSON}"

is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
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

get_skill_source_project() {
  local skill_name="$1"

  if ! is_scoped_skill "$skill_name"; then
    echo ""
    return 1
  fi

  local scope_part="\${skill_name##*@}"
  local project_name="\${scope_part#*_}"

  local known_projects
  known_projects=$(get_project_names)
  for known in $known_projects; do
    if [ "$known" = "$project_name" ]; then
      echo "$project_name"
      return 0
    fi
  done

  echo ""
  return 1
}

get_project_dependencies() {
  local project_temp="$1"
  local sparse_path
  sparse_path=$(cat "$project_temp/.sparse_path")
  local source_skills="$project_temp/$sparse_path/skills"
  local dependencies=""

  if [ ! -d "$source_skills" ]; then
    echo ""
    return 0
  fi

  for skill_folder in "$source_skills"/*; do
    [ -d "$skill_folder" ] || continue
    local skill_name
    skill_name=$(basename "$skill_folder")

    local source_project
    source_project=$(get_skill_source_project "$skill_name")
    if [ -n "$source_project" ]; then
      if ! [[ " $dependencies " =~ " $source_project " ]]; then
        dependencies="$dependencies $source_project"
      fi
    fi
  done

  echo "$dependencies"
}

deps=$(get_project_dependencies "${projectTemp}")
# Count number of words (should be 1, not 3)
count=$(echo "$deps" | wc -w | tr -d ' ')
echo "COUNT:$count DEPS:$deps"
`;

      const result = await $`bash -c ${script}`.quiet();
      const output = result.text().trim();
      expect(output).toContain("COUNT:1");
      expect(output).toContain("development-skills");

      await rm(tmpDir, { recursive: true, force: true });
    });
  });
});

describe("install.sh - inherited skill skipping", () => {
  const tmpDir = join(import.meta.dir, ".test-tmp-skip");

  test("skips inherited skills that reference known projects", async () => {
    const { mkdir, rm, writeFile, readdir } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-skills");
    const destDir = join(tmpDir, "dest-skills");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create skill folders: one inherited (should be skipped), one own (should be installed)
    await mkdir(join(sourceDir, "typescript-lsp@plaited_development-skills"), { recursive: true });
    await writeFile(
      join(sourceDir, "typescript-lsp@plaited_development-skills", "index.md"),
      "# Inherited skill"
    );
    await mkdir(join(sourceDir, "own-skill"), { recursive: true });
    await writeFile(join(sourceDir, "own-skill", "index.md"), "# Own skill");

    const script = `
PROJECTS_JSON="${PROJECTS_JSON}"

is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
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

get_skill_source_project() {
  local skill_name="$1"

  if ! is_scoped_skill "$skill_name"; then
    echo ""
    return 1
  fi

  local scope_part="\${skill_name##*@}"
  local project_name="\${scope_part#*_}"

  local known_projects
  known_projects=$(get_project_names)
  for known in $known_projects; do
    if [ "$known" = "$project_name" ]; then
      echo "$project_name"
      return 0
    fi
  done

  echo ""
  return 1
}

extract_org_from_repo() {
  local repo="$1"
  echo "\${repo%%/*}"
}

get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="\${repo##*/}"
  echo "\${skill_name}@\${org}_\${project_name}"
}

source_skills="${sourceDir}"
skills_dir="${destDir}"
repo="plaited/my-project"

for skill_folder in "$source_skills"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")

  if is_scoped_skill "$skill_name"; then
    source_project=$(get_skill_source_project "$skill_name")
    if [ -n "$source_project" ]; then
      echo "SKIPPED: $skill_name (dependency: $source_project)"
      continue
    fi
    target_path="$skills_dir/$skill_name"
  else
    scoped_name=$(get_scoped_skill_name "$skill_name" "$repo")
    target_path="$skills_dir/$scoped_name"
  fi

  cp -r "$skill_folder" "$target_path"
  echo "INSTALLED: $(basename "$target_path")"
done
`;

    const result = await $`bash -c ${script}`.quiet();
    const output = result.text().trim();

    expect(output).toContain("SKIPPED: typescript-lsp@plaited_development-skills");
    expect(output).toContain("INSTALLED: own-skill@plaited_my-project");

    // Verify only own skill was installed
    const installed = await readdir(destDir);
    expect(installed).toEqual(["own-skill@plaited_my-project"]);

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("installs inherited skills from unknown sources", async () => {
    const { mkdir, rm, writeFile, readdir } = await import("fs/promises");

    const sourceDir = join(tmpDir, "source-unknown");
    const destDir = join(tmpDir, "dest-unknown");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destDir, { recursive: true });

    // Create skill from unknown source (not in projects.json)
    await mkdir(join(sourceDir, "external-skill@external-org_unknown-project"), { recursive: true });
    await writeFile(
      join(sourceDir, "external-skill@external-org_unknown-project", "index.md"),
      "# External skill"
    );

    const script = `
PROJECTS_JSON="${PROJECTS_JSON}"

is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
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

get_skill_source_project() {
  local skill_name="$1"

  if ! is_scoped_skill "$skill_name"; then
    echo ""
    return 1
  fi

  local scope_part="\${skill_name##*@}"
  local project_name="\${scope_part#*_}"

  local known_projects
  known_projects=$(get_project_names)
  for known in $known_projects; do
    if [ "$known" = "$project_name" ]; then
      echo "$project_name"
      return 0
    fi
  done

  echo ""
  return 1
}

source_skills="${sourceDir}"
skills_dir="${destDir}"

for skill_folder in "$source_skills"/*; do
  [ -d "$skill_folder" ] || continue
  skill_name=$(basename "$skill_folder")

  if is_scoped_skill "$skill_name"; then
    source_project=$(get_skill_source_project "$skill_name")
    if [ -n "$source_project" ]; then
      echo "SKIPPED: $skill_name"
      continue
    fi
    # Unknown source - copy as-is
    target_path="$skills_dir/$skill_name"
  else
    target_path="$skills_dir/$skill_name"
  fi

  cp -r "$skill_folder" "$target_path"
  echo "INSTALLED: $(basename "$target_path")"
done
`;

    const result = await $`bash -c ${script}`.quiet();
    expect(result.text().trim()).toBe("INSTALLED: external-skill@external-org_unknown-project");

    const installed = await readdir(destDir);
    expect(installed).toEqual(["external-skill@external-org_unknown-project"]);

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("install.sh - sparse_path security validation", () => {
  async function validateSparsePath(sparsePath: string): Promise<boolean> {
    // Escape the sparse path for safe bash inclusion
    const escapedPath = sparsePath.replace(/'/g, "'\\''");
    const script = `
validate_sparse_path() {
  local sparse_path="$1"

  if [ -z "$sparse_path" ]; then
    return 1
  fi

  if [[ "$sparse_path" =~ \\.\\. ]]; then
    return 1
  fi

  if [[ "$sparse_path" =~ ^/ ]]; then
    return 1
  fi

  if [[ "$sparse_path" =~ [^a-zA-Z0-9._/-] ]]; then
    return 1
  fi

  return 0
}

validate_sparse_path '${escapedPath}'
`;
    try {
      await $`bash -c ${script}`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  test("accepts valid sparse path", async () => {
    expect(await validateSparsePath(".claude")).toBe(true);
    expect(await validateSparsePath(".github/skills")).toBe(true);
    expect(await validateSparsePath("src/skills")).toBe(true);
    expect(await validateSparsePath("my-project_v2.0")).toBe(true);
  });

  test("rejects empty sparse path", async () => {
    expect(await validateSparsePath("")).toBe(false);
  });

  test("rejects path traversal attempts", async () => {
    expect(await validateSparsePath("..")).toBe(false);
    expect(await validateSparsePath("../etc")).toBe(false);
    expect(await validateSparsePath(".claude/../..")).toBe(false);
    expect(await validateSparsePath("foo/../../bar")).toBe(false);
  });

  test("rejects absolute paths", async () => {
    expect(await validateSparsePath("/etc/passwd")).toBe(false);
    expect(await validateSparsePath("/")).toBe(false);
  });

  test("rejects command injection attempts", async () => {
    expect(await validateSparsePath("; rm -rf /")).toBe(false);
    expect(await validateSparsePath("$(whoami)")).toBe(false);
    expect(await validateSparsePath("`id`")).toBe(false);
    expect(await validateSparsePath("foo|bar")).toBe(false);
    expect(await validateSparsePath("foo&bar")).toBe(false);
    expect(await validateSparsePath("foo;bar")).toBe(false);
  });

  test("rejects special characters", async () => {
    expect(await validateSparsePath("foo bar")).toBe(false);
    expect(await validateSparsePath("foo\tbar")).toBe(false);
    expect(await validateSparsePath("foo'bar")).toBe(false);
    expect(await validateSparsePath('foo"bar')).toBe(false);
  });
});
