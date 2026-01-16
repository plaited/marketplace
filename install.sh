#!/bin/bash
# Install Plaited plugins for AI coding agents supporting agent-skills-spec
# Supports: Gemini CLI, GitHub Copilot, Cursor, OpenCode, Amp, Goose, Factory
#
# NOTE: Claude Code users should use the plugin marketplace instead:
#   claude plugins add github:plaited/marketplace
#
# Usage:
#   ./install.sh                         # Interactive: asks which agent
#   ./install.sh --agent gemini          # Direct: install for Gemini CLI
#   ./install.sh --plugin typescript-lsp # Install specific plugin only
#   ./install.sh --list                  # List available plugins
#   ./install.sh --update                # Update existing installation
#   ./install.sh --uninstall             # Remove installation

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKETPLACE_JSON="$SCRIPT_DIR/.claude-plugin/marketplace.json"
BRANCH="main"
TEMP_DIR=""

# ============================================================================
# Agent Directory Mappings (functions for bash 3.x compatibility)
# ============================================================================

get_skills_dir() {
  case "$1" in
    gemini)   echo ".gemini/skills" ;;
    copilot)  echo ".github/skills" ;;
    cursor)   echo ".cursor/skills" ;;
    opencode) echo ".opencode/skill" ;;    # OpenCode uses 'skill' (singular)
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
    opencode) echo ".opencode/command" ;;  # OpenCode uses 'command' (singular)
    amp)      echo ".amp/commands" ;;
    goose)    echo ".goose/commands" ;;
    factory)  echo ".factory/commands" ;;
    *)        echo "" ;;
  esac
}

supports_commands() {
  # Agents that support slash commands
  case "$1" in
    cursor|opencode|amp|factory) return 0 ;;
    *) return 1 ;;
  esac
}

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Plaited Marketplace Installer"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

print_success() {
  echo "✓ $1"
}

print_info() {
  echo "→ $1"
}

print_error() {
  echo "✗ $1" >&2
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

# ============================================================================
# Marketplace JSON Parsing
# ============================================================================

# Parse marketplace.json without jq (for broader compatibility)
# Only extracts plugin names (entries with both "name" and "source" fields)
get_plugin_names() {
  # Use awk to find plugin entries (those with source field nearby)
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
  # Find the plugin block and extract its source.repo value
  # Source is now an object: { "source": "github", "repo": "org/repo" }
  awk -v name="$plugin_name" '
    /"name"[[:space:]]*:[[:space:]]*"'"$plugin_name"'"/ { found=1 }
    found && /"repo"[[:space:]]*:/ {
      gsub(/.*"repo"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      print
      exit
    }
  ' "$MARKETPLACE_JSON"
}

get_plugin_description() {
  local plugin_name="$1"
  awk -v name="$plugin_name" '
    /"name"[[:space:]]*:[[:space:]]*"'"$plugin_name"'"/ { found=1 }
    found && /"description"[[:space:]]*:/ {
      gsub(/.*"description"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      print
      exit
    }
  ' "$MARKETPLACE_JSON"
}

# Parse source repo like "plaited/development-skills"
# Returns: repo_url sparse_path (always .claude)
parse_source() {
  local repo="$1"
  echo "https://github.com/$repo.git" ".claude"
}

# ============================================================================
# Agent Detection
# ============================================================================

detect_agent() {
  if [ -d ".gemini" ]; then
    echo "gemini"
  elif [ -d ".github" ]; then
    echo "copilot"
  elif [ -d ".cursor" ]; then
    echo "cursor"
  elif [ -d ".opencode" ]; then
    echo "opencode"
  elif [ -d ".amp" ]; then
    echo "amp"
  elif [ -d ".goose" ]; then
    echo "goose"
  elif [ -d ".factory" ]; then
    echo "factory"
  else
    echo ""
  fi
}

ask_agent() {
  local detected
  detected=$(detect_agent)

  echo "Which AI coding agent are you using?"
  echo ""
  echo "  ┌─────────────┬──────────────────┐"
  echo "  │ Agent       │ Directory        │"
  echo "  ├─────────────┼──────────────────┤"
  echo "  │ 1) Gemini   │ .gemini/skills   │"
  echo "  │ 2) Copilot  │ .github/skills   │"
  echo "  │ 3) Cursor   │ .cursor/skills   │"
  echo "  │ 4) OpenCode │ .opencode/skill  │"
  echo "  │ 5) Amp      │ .amp/skills      │"
  echo "  │ 6) Goose    │ .goose/skills    │"
  echo "  │ 7) Factory  │ .factory/skills  │"
  echo "  └─────────────┴──────────────────┘"
  echo ""
  echo "  Claude Code? Use: claude plugins add github:plaited/marketplace"
  echo ""

  if [ -n "$detected" ]; then
    echo "  Detected: $detected"
    echo ""
  fi

  printf "Select agent [1-7]: "
  read choice

  case "$choice" in
    1) echo "gemini" ;;
    2) echo "copilot" ;;
    3) echo "cursor" ;;
    4) echo "opencode" ;;
    5) echo "amp" ;;
    6) echo "goose" ;;
    7) echo "factory" ;;
    *)
      print_error "Invalid choice"
      exit 1
      ;;
  esac
}

# ============================================================================
# Installation Functions
# ============================================================================

clone_plugin() {
  local plugin_name="$1"
  local source="$2"

  # Parse source into repo URL and sparse path
  read repo_url sparse_path <<< "$(parse_source "$source")"

  print_info "Cloning $plugin_name from $repo_url..."

  local plugin_temp="$TEMP_DIR/$plugin_name"
  mkdir -p "$plugin_temp"

  git clone --depth 1 --filter=blob:none --sparse "$repo_url" "$plugin_temp" --branch "$BRANCH" 2>/dev/null

  cd "$plugin_temp"
  # Fetch both skills and commands directories
  git sparse-checkout set "$sparse_path/skills" "$sparse_path/commands" 2>/dev/null
  cd - > /dev/null

  # Store the sparse path for later use
  echo "$sparse_path" > "$plugin_temp/.sparse_path"

  print_success "Cloned $plugin_name"
}

install_plugin() {
  local plugin_name="$1"
  local skills_dir="$2"
  local commands_dir="$3"

  local plugin_temp="$TEMP_DIR/$plugin_name"
  local sparse_path
  sparse_path=$(cat "$plugin_temp/.sparse_path")

  local source_skills="$plugin_temp/$sparse_path/skills"
  local source_commands="$plugin_temp/$sparse_path/commands"

  if [ -d "$source_skills" ]; then
    print_info "Installing skills from $plugin_name..."
    cp -r "$source_skills/"* "$skills_dir/"
    print_success "Installed $plugin_name skills"
  else
    print_info "No skills directory in $plugin_name ($sparse_path/skills)"
  fi

  if [ -n "$commands_dir" ] && [ -d "$source_commands" ]; then
    print_info "Installing commands from $plugin_name..."
    cp -r "$source_commands/"* "$commands_dir/"
    print_success "Installed $plugin_name commands"
  fi
}

# ============================================================================
# Main Installation
# ============================================================================

do_install() {
  local agent="$1"
  local specific_plugin="$2"

  local skills_dir commands_dir
  skills_dir=$(get_skills_dir "$agent")
  commands_dir=$(get_commands_dir "$agent")

  if [ -z "$skills_dir" ]; then
    print_error "Unknown agent: $agent"
    return 1
  fi

  print_info "Installing for: $agent"
  print_info "Skills: $skills_dir/"
  if supports_commands "$agent"; then
    print_info "Commands: $commands_dir/"
  fi
  echo ""

  TEMP_DIR=$(mktemp -d)
  mkdir -p "$skills_dir"
  if supports_commands "$agent" && [ -n "$commands_dir" ]; then
    mkdir -p "$commands_dir"
  fi

  local plugins_installed=0

  # Get all plugin names
  local plugin_names
  plugin_names=$(get_plugin_names)

  for plugin_name in $plugin_names; do
    # Skip if specific plugin requested and this isn't it
    if [ -n "$specific_plugin" ] && [ "$plugin_name" != "$specific_plugin" ]; then
      continue
    fi

    local source
    source=$(get_plugin_source "$plugin_name")

    if [ -z "$source" ]; then
      print_error "Could not find source for $plugin_name"
      continue
    fi

    clone_plugin "$plugin_name" "$source"
    install_plugin "$plugin_name" "$skills_dir" "$commands_dir"
    plugins_installed=$((plugins_installed + 1))
  done

  if [ "$plugins_installed" -eq 0 ]; then
    if [ -n "$specific_plugin" ]; then
      print_error "Plugin not found: $specific_plugin"
    else
      print_error "No plugins installed"
    fi
    return 1
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Installation Complete!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Agent: $agent"
  echo "  Plugins installed: $plugins_installed"
  echo ""
  echo "  Locations:"
  echo "    • Skills:   $skills_dir/"
  if supports_commands "$agent" && [ -d "$commands_dir" ] && [ "$(ls -A "$commands_dir" 2>/dev/null)" ]; then
    echo "    • Commands: $commands_dir/"
  fi
  echo ""
  echo "  Next steps:"
  echo "    1. Restart your AI coding agent to load the new skills"
  echo "    2. Skills are auto-discovered and activated when relevant"
  echo ""
}

# ============================================================================
# List Plugins
# ============================================================================

do_list() {
  echo ""
  echo "Available Plugins:"
  echo ""
  echo "  ┌────────────────────┬────────────────────────────────────────────────────┐"
  echo "  │ Plugin             │ Description                                        │"
  echo "  ├────────────────────┼────────────────────────────────────────────────────┤"

  local plugin_names
  plugin_names=$(get_plugin_names)

  for plugin_name in $plugin_names; do
    local description
    description=$(get_plugin_description "$plugin_name")
    printf "  │ %-18s │ %-50s │\n" "$plugin_name" "${description:0:50}"
  done

  echo "  └────────────────────┴────────────────────────────────────────────────────┘"
  echo ""
  echo "Install a specific plugin:"
  echo "  ./install.sh --agent gemini --plugin typescript-lsp"
  echo ""
}

# ============================================================================
# Update
# ============================================================================

do_update() {
  local specific_plugin="$1"
  local agent
  agent=$(detect_agent)

  if [ -z "$agent" ]; then
    print_error "No existing installation detected"
    print_info "Run without --update to install"
    exit 1
  fi

  print_info "Updating installation for: $agent"

  local skills_dir
  skills_dir=$(get_skills_dir "$agent")

  # Get all plugin names and remove their skill directories
  local plugin_names
  plugin_names=$(get_plugin_names)

  for plugin_name in $plugin_names; do
    if [ -n "$specific_plugin" ] && [ "$plugin_name" != "$specific_plugin" ]; then
      continue
    fi

    # Each plugin may install multiple skills - we need to check what was installed
    # For now, remove known skill directories
    [ -d "$skills_dir/$plugin_name" ] && rm -rf "$skills_dir/$plugin_name"
  done

  # Reinstall
  do_install "$agent" "$specific_plugin"
}

# ============================================================================
# Uninstall
# ============================================================================

do_uninstall() {
  local specific_plugin="$1"
  local agent
  agent=$(detect_agent)

  if [ -z "$agent" ]; then
    print_error "No existing installation detected"
    exit 1
  fi

  print_info "Uninstalling for: $agent"

  local skills_dir
  skills_dir=$(get_skills_dir "$agent")

  local plugin_names
  plugin_names=$(get_plugin_names)
  local removed=0

  for plugin_name in $plugin_names; do
    if [ -n "$specific_plugin" ] && [ "$plugin_name" != "$specific_plugin" ]; then
      continue
    fi

    if [ -d "$skills_dir/$plugin_name" ]; then
      rm -rf "$skills_dir/$plugin_name"
      print_success "Removed $skills_dir/$plugin_name/"
      removed=$((removed + 1))
    fi
  done

  if [ "$removed" -eq 0 ]; then
    print_info "No Plaited plugins found in $skills_dir/"
  else
    echo ""
    print_success "Uninstalled $removed plugin(s)"
  fi
}

# ============================================================================
# CLI Parsing
# ============================================================================

show_help() {
  echo "Usage: install.sh [OPTIONS]"
  echo ""
  echo "Install Plaited plugins for AI coding agents supporting agent-skills-spec."
  echo ""
  echo "NOTE: Claude Code users should use the plugin marketplace instead:"
  echo "  claude plugins add github:plaited/marketplace"
  echo ""
  echo "Options:"
  echo "  --agent <name>      Install for specific agent"
  echo "  --plugin <name>     Install specific plugin only"
  echo "  --list              List available plugins"
  echo "  --update            Update existing installation"
  echo "  --uninstall         Remove installation"
  echo "  --help              Show this help message"
  echo ""
  echo "Supported Agents:"
  echo ""
  echo "  ┌─────────────┬──────────────────────┬──────────────────────┐"
  echo "  │ Agent       │ Skills               │ Commands             │"
  echo "  ├─────────────┼──────────────────────┼──────────────────────┤"
  echo "  │ gemini      │ .gemini/skills       │ -                    │"
  echo "  │ copilot     │ .github/skills       │ -                    │"
  echo "  │ cursor      │ .cursor/skills       │ .cursor/commands     │"
  echo "  │ opencode    │ .opencode/skill      │ .opencode/command    │"
  echo "  │ amp         │ .amp/skills          │ .amp/commands        │"
  echo "  │ goose       │ .goose/skills        │ -                    │"
  echo "  │ factory     │ .factory/skills      │ .factory/commands    │"
  echo "  └─────────────┴──────────────────────┴──────────────────────┘"
  echo ""
  echo "Examples:"
  echo "  ./install.sh                              # Interactive mode"
  echo "  ./install.sh --agent gemini               # Install all for Gemini"
  echo "  ./install.sh --agent cursor --plugin typescript-lsp"
  echo "  ./install.sh --list                       # List available plugins"
  echo "  ./install.sh --update                     # Update existing"
  echo "  ./install.sh --uninstall                  # Remove all"
}

main() {
  local agent=""
  local plugin=""
  local action="install"

  while [ $# -gt 0 ]; do
    case "$1" in
      --agent)
        agent="$2"
        shift 2
        ;;
      --plugin)
        plugin="$2"
        shift 2
        ;;
      --list)
        action="list"
        shift
        ;;
      --update)
        action="update"
        shift
        ;;
      --uninstall)
        action="uninstall"
        shift
        ;;
      --help|-h)
        show_help
        exit 0
        ;;
      *)
        print_error "Unknown option: $1"
        show_help
        exit 1
        ;;
    esac
  done

  # Check marketplace.json exists, fetch from GitHub if not found (for curl | bash usage)
  if [ ! -f "$MARKETPLACE_JSON" ]; then
    MARKETPLACE_JSON=$(mktemp)
    curl -fsSL "https://raw.githubusercontent.com/plaited/marketplace/main/.claude-plugin/marketplace.json" -o "$MARKETPLACE_JSON" 2>/dev/null
    if [ ! -s "$MARKETPLACE_JSON" ]; then
      print_error "Could not fetch marketplace.json"
      exit 1
    fi
  fi

  print_header

  case "$action" in
    list)
      do_list
      ;;
    install)
      if [ -z "$agent" ]; then
        agent=$(ask_agent)
      fi

      # Redirect Claude users to marketplace
      if [ "$agent" = "claude" ]; then
        echo ""
        print_info "Claude Code users should use the plugin marketplace:"
        echo ""
        echo "  claude plugins add github:plaited/marketplace"
        echo ""
        exit 0
      fi

      # Validate agent
      local skills_dir
      skills_dir=$(get_skills_dir "$agent")
      if [ -z "$skills_dir" ]; then
        print_error "Unknown agent: $agent"
        print_info "Valid agents: gemini, copilot, cursor, opencode, amp, goose, factory"
        print_info "Claude Code? Use: claude plugins add github:plaited/marketplace"
        exit 1
      fi

      do_install "$agent" "$plugin"
      ;;
    update)
      do_update "$plugin"
      ;;
    uninstall)
      do_uninstall "$plugin"
      ;;
  esac
}

main "$@"
