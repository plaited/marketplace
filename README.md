# Plaited Marketplace

Aggregator for Plaited's Claude Code plugins.

## Installation

### Claude Code

```bash
claude plugins add github:plaited/marketplace
```

### Other AI Coding Agents

For agents supporting the AgentSkills spec (Gemini CLI, GitHub Copilot, Cursor, OpenCode, Amp, Goose, Factory):

```bash
# Install a specific plugin
curl -fsSL https://raw.githubusercontent.com/plaited/marketplace/main/install.sh | bash -s -- --agent <agent-name> --plugin development-skills
```

**Or clone and run locally:**

```bash
git clone https://github.com/plaited/marketplace.git
cd marketplace
./install.sh                              # Interactive mode
./install.sh --agent gemini               # Install all for Gemini CLI
./install.sh --agent cursor --plugin acp-harness  # Specific plugin
./install.sh --list                       # List available plugins
./install.sh --update                     # Update existing
./install.sh --uninstall                  # Remove all
```

**Supported agents:**

| Agent | Skills | Commands |
|-------|--------|----------|
| gemini | `.gemini/skills/` | - |
| copilot | `.github/skills/` | - |
| cursor | `.cursor/skills/` | `.cursor/commands/` |
| opencode | `.opencode/skill/` | `.opencode/command/` |
| amp | `.amp/skills/` | `.amp/commands/` |
| goose | `.goose/skills/` | - |
| factory | `.factory/skills/` | `.factory/commands/` |

## Available Plugins

| Plugin | Description |
|--------|-------------|
| **development-skills** | Development skills for Claude Code - TypeScript LSP, code documentation, and validation tools |
| **acp-harness** | ACP client and evaluation harness for agent testing |
| **plaited** | Plaited framework development tools - behavioral programming, UI patterns, and web components |

## Plugin Details

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
