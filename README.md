# Plaited Skills Installer

[![CI](https://github.com/plaited/skills-installer/actions/workflows/ci.yml/badge.svg)](https://github.com/plaited/skills-installer/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Install Plaited skills for AI coding agents supporting the agent-skills-spec.

## Installation

For agents supporting the agent-skills-spec (Gemini CLI, GitHub Copilot, Cursor, OpenCode, Amp, Goose, Factory, Codex, Windsurf, Claude Code):

```bash
# Install for multiple agents
curl -fsSL https://raw.githubusercontent.com/plaited/skills-installer/main/install.sh | bash -s -- --agents claude,gemini

# Install a specific project
curl -fsSL https://raw.githubusercontent.com/plaited/skills-installer/main/install.sh | bash -s -- --agents claude --project development-skills
```

**Or clone and run locally:**

```bash
git clone https://github.com/plaited/skills-installer.git
cd skills-installer
./install.sh                              # Interactive mode (multi-select agents)
./install.sh --agents claude,gemini       # Install for multiple agents
./install.sh --agents cursor --project agent-eval-harness  # Specific project
./install.sh --list                       # List available projects
./install.sh --uninstall                  # Remove all
```

## Architecture

Skills are installed to a central `.plaited/skills/` directory and symlinked to each agent's skills directory:

```
.plaited/skills/                          # Central storage (single copy)
  skill-name@org_project/

.claude/skills/                           # Symlinks
  skill-name@org_project -> ../../.plaited/skills/skill-name@org_project

.gemini/skills/                           # Symlinks
  skill-name@org_project -> ../../.plaited/skills/skill-name@org_project
```

This approach:
- Saves disk space when supporting multiple agents
- Ensures all agents use identical skill versions
- Makes updates simpler (update once, all agents see changes)

**Supported agents:**

| Agent | Skills Directory |
|-------|------------------|
| gemini | `.gemini/skills/` |
| copilot | `.github/skills/` |
| cursor | `.cursor/skills/` |
| opencode | `.opencode/skill/` |
| amp | `.amp/skills/` |
| goose | `.goose/skills/` |
| factory | `.factory/skills/` |
| codex | `.codex/skills/` |
| windsurf | `.windsurf/skills/` |
| claude | `.claude/skills/` |

## Available Projects

| Project | Source |
|---------|--------|
| **development-skills** | [plaited/development-skills](https://github.com/plaited/development-skills) |
| **agent-eval-harness** | [plaited/agent-eval-harness](https://github.com/plaited/agent-eval-harness) |
| **plaited** | [plaited/plaited](https://github.com/plaited/plaited) |

## Skill Scoping

Skills are automatically scoped during installation to prevent naming collisions when multiple projects provide skills with the same name.

**Skill folders** are renamed using the pattern: `<skill-name>@<org>_<project>`

Example: `typescript-lsp` from `plaited/development-skills` becomes `typescript-lsp@plaited_development-skills`

**Inherited skills** (already scoped from another project) preserve their original scope to prevent double-scoping.

**Note:** Org and project names may contain alphanumeric characters, dots, hyphens, and underscores. Some tools using dot-notation for namespacing may interpret dots specially.

### Upgrading from Previous Versions

**Breaking change:** Skills are now stored in `.plaited/skills/` (previously copied directly to agent directories).

To upgrade from a previous installation:

```bash
./install.sh --uninstall
./install.sh --agents claude,gemini  # or your preferred agents
```

### Replace-on-Install Behavior

Running `./install.sh` replaces existing skill folders with fresh copies from the source repository. This ensures skills are always up-to-date but will overwrite any local modifications. The installer will display "Replaced" for skills that were updated and "Installed" for new skills.

**Note:** If you have local modifications you want to preserve, back them up before reinstalling.

## Project Details

### development-skills

Development tools including:

- **typescript-lsp** - LSP-based code exploration for TypeScript/JavaScript
- **code-documentation** - Code documentation generation
- **validate-skill** - Skill validation tools

**Source:** [plaited/development-skills](https://github.com/plaited/development-skills)

### agent-eval-harness

CLI tool for evaluating AI agents by capturing execution trajectories:

- Capture full execution traces (thoughts, messages, tool calls, plans)
- Run pass@k evaluations with customizable grading functions
- Schema-driven adapters for any CLI agent producing JSON output
- Unix-style composable pipelines (run → extract → grade → format)

**Source:** [plaited/agent-eval-harness](https://github.com/plaited/agent-eval-harness)

### plaited

Development tools for the Plaited behavioral programming framework:

- **loom** - Templating and component library
- **plaited-behavioral-core** - Behavioral programming patterns
- **plaited-standards** - Code conventions and standards
- **plaited-ui-patterns** - UI templates and styling
- **plaited-web-patterns** - Web component patterns

**Source:** [plaited/plaited](https://github.com/plaited/plaited)

## License

ISC
