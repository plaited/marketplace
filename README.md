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
| **acp-harness** | [plaited/acp-harness](https://github.com/plaited/acp-harness) |
| **plaited** | [plaited/plaited](https://github.com/plaited/plaited) |

## Skill Scoping

Skills are automatically scoped during installation to prevent naming collisions when multiple projects provide skills with the same name.

**Skill folders** are renamed using the pattern: `<skill-name>@<org>_<project>`

Example: `typescript-lsp` from `plaited/development-skills` becomes `typescript-lsp@plaited_development-skills`

**Inherited skills** (already scoped from another project) preserve their original scope to prevent double-scoping.

**Note:** Org and project names may contain alphanumeric characters, dots, hyphens, and underscores. Some tools using dot-notation for namespacing may interpret dots specially.

### Upgrading from Unscoped Installations

If you previously installed skills without scoping, run `--uninstall` first to remove unscoped skills, then reinstall:

```bash
./install.sh --uninstall --agent <agent-name>
./install.sh --agent <agent-name>
```

This ensures a clean installation with properly scoped skill names.

## Project Details

### development-skills

Development tools including:

- **typescript-lsp** - LSP-based code exploration for TypeScript/JavaScript
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
