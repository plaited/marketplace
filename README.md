# Plaited Skills Installer

[![CI](https://github.com/plaited/skills-installer/actions/workflows/ci.yml/badge.svg)](https://github.com/plaited/skills-installer/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Install Plaited skills for AI coding agents supporting the agent-skills-spec.

## Installation

For agents supporting the agent-skills-spec (Gemini CLI, GitHub Copilot, Cursor, OpenCode, Amp, Goose, Factory, Codex, Windsurf, Claude Code):

```bash
# Install all projects
curl -fsSL https://raw.githubusercontent.com/plaited/skills-installer/main/install.sh | bash -s -- --agent <agent-name>

# Install a specific project
curl -fsSL https://raw.githubusercontent.com/plaited/skills-installer/main/install.sh | bash -s -- --agent <agent-name> --project development-skills
```

**Or clone and run locally:**

```bash
git clone https://github.com/plaited/skills-installer.git
cd skills-installer
./install.sh                              # Interactive mode
./install.sh --agent gemini               # Install all for Gemini CLI
./install.sh --agent cursor --project acp-harness  # Specific project
./install.sh --list                       # List available projects
./install.sh --update                     # Update existing
./install.sh --uninstall                  # Remove all
```

**Supported agents:**

| Agent | Skills | Commands |
|-------|--------|----------|
| gemini | `.gemini/skills/` | `.gemini/commands/` (→TOML) |
| copilot | `.github/skills/` | - |
| cursor | `.cursor/skills/` | `.cursor/commands/` |
| opencode | `.opencode/skill/` | `.opencode/command/` |
| amp | `.amp/skills/` | `.amp/commands/` |
| goose | `.goose/skills/` | - |
| factory | `.factory/skills/` | `.factory/commands/` |
| codex | `.codex/skills/` | `~/.codex/prompts/` (→prompt) |
| windsurf | `.windsurf/skills/` | `.windsurf/workflows/` |
| claude | `.claude/skills/` | `.claude/commands/` |

## Available Projects

| Project | Source |
|---------|--------|
| **development-skills** | [plaited/development-skills](https://github.com/plaited/development-skills) |
| **acp-harness** | [plaited/acp-harness](https://github.com/plaited/acp-harness) |
| **plaited** | [plaited/plaited](https://github.com/plaited/plaited) |

## Skill Scoping

Skills are automatically scoped during installation to prevent naming collisions when multiple projects provide skills with the same name.

**Skill folders** are renamed using the pattern: `<skill-name>@<org>_<project>`

Example: `typescript-lsp` from `plaited/development-skills` becomes `typescript-lsp@plaited_development-skills`

**Commands** are scoped per agent type:

| Agent | Command Scoping |
|-------|-----------------|
| gemini | `org_project:command.toml` |
| claude, opencode | `org_project/command.md` (folder) |
| cursor, factory, amp, windsurf | `org_project--command.md` |
| codex | No scoping (user-level prompts) |

**Inherited skills** (already scoped from another project) preserve their original scope to prevent double-scoping.

## Project Details

### development-skills

Development tools including:

- **typescript-lsp** - LSP-based code exploration for TypeScript/JavaScript
  - `/lsp-hover` - Get type information at a position
  - `/lsp-find` - Search for symbols across workspace
  - `/lsp-refs` - Find all references to a symbol
  - `/lsp-analyze` - Batch analysis of a file
- **code-documentation** - Code documentation generation
- **validate-skill** - Skill validation tools

**Source:** [plaited/development-skills](https://github.com/plaited/development-skills)

### acp-harness

Unified toolkit for ACP client usage and agent evaluation:

- Connect to ACP-compatible agents programmatically
- Capture full trajectories (tools, thoughts, plans)
- Run evaluations and generate training data

**Source:** [plaited/acp-harness](https://github.com/plaited/acp-harness)

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
