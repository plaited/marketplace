#!/bin/bash
# Install Plaited skills for AI coding agents supporting agent-skills-spec
# Supports: Gemini CLI, GitHub Copilot, Cursor, OpenCode, Amp, Goose, Factory
#
# Usage:
#   ./install.sh                         # Interactive: asks which agent
#   ./install.sh --agent gemini          # Direct: install for Gemini CLI
#   ./install.sh --project development-skills # Install specific project only
#   ./install.sh --list                  # List available projects
#   ./install.sh --update                # Update existing installation
#   ./install.sh --uninstall             # Remove installation

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS_JSON="$SCRIPT_DIR/projects.json"
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
    gemini|cursor|opencode|amp|factory) return 0 ;;
    *) return 1 ;;
  esac
}

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Plaited Skills Installer"
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
# Projects JSON Parsing
# ============================================================================

# Parse projects.json without jq (for broader compatibility)
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
  awk -v name="$project_name" '
    /"name"[[:space:]]*:[[:space:]]*"'"$project_name"'"/ { found=1 }
    found && /"repo"[[:space:]]*:/ {
      gsub(/.*"repo"[[:space:]]*:[[:space:]]*"/, "")
      gsub(/".*/, "")
      print
      exit
    }
  ' "$PROJECTS_JSON"
}

# Parse source repo like "plaited/development-skills"
# Returns: repo_url sparse_path (always .claude)
parse_source() {
  local repo="$1"
  echo "https://github.com/$repo.git" ".claude"
}

# ============================================================================
# Format Conversion
# ============================================================================

# Convert markdown command to Gemini TOML format
convert_md_to_toml() {
  local md_file="$1"
  local toml_file="$2"

  # Extract description from YAML frontmatter
  local description
  description=$(awk '
    /^---$/ { if (in_front) exit; in_front=1; next }
    in_front && /^description:/ {
      sub(/^description:[[:space:]]*/, "")
      gsub(/"/, "\\\"")
      print
      exit
    }
  ' "$md_file")

  # Get body (everything after second ---)
  local body
  body=$(awk '
    /^---$/ { count++; if (count == 2) { getbody=1; next } }
    getbody { print }
  ' "$md_file")

  # Replace $ARGUMENTS with {{args}}
  body=$(echo "$body" | sed 's/\$ARGUMENTS/{{args}}/g')

  # Write TOML file
  {
    if [ -n "$description" ]; then
      echo "description = \"$description\""
      echo ""
    fi
    echo "prompt = \"\"\""
    echo "$body"
    echo "\"\"\""
  } > "$toml_file"
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

clone_project() {
  local project_name="$1"
  local source="$2"

  # Parse source into repo URL and sparse path
  read repo_url sparse_path <<< "$(parse_source "$source")"

  print_info "Cloning $project_name from $repo_url..."

  local project_temp="$TEMP_DIR/$project_name"
  mkdir -p "$project_temp"

  git clone --depth 1 --filter=blob:none --sparse "$repo_url" "$project_temp" --branch "$BRANCH" 2>/dev/null

  cd "$project_temp"
  # Fetch both skills and commands directories
  git sparse-checkout set "$sparse_path/skills" "$sparse_path/commands" 2>/dev/null
  cd - > /dev/null

  # Store the sparse path for later use
  echo "$sparse_path" > "$project_temp/.sparse_path"

  print_success "Cloned $project_name"
}

install_project() {
  local project_name="$1"
  local skills_dir="$2"
  local commands_dir="$3"
  local agent="$4"

  local project_temp="$TEMP_DIR/$project_name"
  local sparse_path
  sparse_path=$(cat "$project_temp/.sparse_path")

  local source_skills="$project_temp/$sparse_path/skills"
  local source_commands="$project_temp/$sparse_path/commands"

  if [ -d "$source_skills" ]; then
    print_info "Installing skills from $project_name..."
    cp -r "$source_skills/"* "$skills_dir/"
    print_success "Installed $project_name skills"
  else
    print_info "No skills directory in $project_name ($sparse_path/skills)"
  fi

  if [ -n "$commands_dir" ] && [ -d "$source_commands" ]; then
    print_info "Installing commands from $project_name..."

    if [ "$agent" = "gemini" ]; then
      # Convert .md to .toml for Gemini CLI
      for md_file in "$source_commands"/*.md; do
        [ -f "$md_file" ] || continue
        local basename
        basename=$(basename "$md_file" .md)
        convert_md_to_toml "$md_file" "$commands_dir/$basename.toml"
      done
      print_success "Converted and installed $project_name commands (TOML)"
    else
      # Direct copy for other agents
      cp -r "$source_commands/"* "$commands_dir/"
      print_success "Installed $project_name commands"
    fi
  fi
}

# ============================================================================
# Main Installation
# ============================================================================

do_install() {
  local agent="$1"
  local specific_project="$2"

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

  local projects_installed=0

  # Get all project names
  local project_names
  project_names=$(get_project_names)

  for project_name in $project_names; do
    # Skip if specific project requested and this isn't it
    if [ -n "$specific_project" ] && [ "$project_name" != "$specific_project" ]; then
      continue
    fi

    local source
    source=$(get_project_repo "$project_name")

    if [ -z "$source" ]; then
      print_error "Could not find source for $project_name"
      continue
    fi

    clone_project "$project_name" "$source"
    install_project "$project_name" "$skills_dir" "$commands_dir" "$agent"
    projects_installed=$((projects_installed + 1))
  done

  if [ "$projects_installed" -eq 0 ]; then
    if [ -n "$specific_project" ]; then
      print_error "Project not found: $specific_project"
    else
      print_error "No projects installed"
    fi
    return 1
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Installation Complete!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Agent: $agent"
  echo "  Projects installed: $projects_installed"
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
# List Projects
# ============================================================================

do_list() {
  echo ""
  echo "Available Projects:"
  echo ""

  local project_names
  project_names=$(get_project_names)

  for project_name in $project_names; do
    echo "  - $project_name"
  done

  echo ""
  echo "Install a specific project:"
  echo "  ./install.sh --agent gemini --project development-skills"
  echo ""
}

# ============================================================================
# Update
# ============================================================================

do_update() {
  local specific_project="$1"
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

  # Get all project names and remove their skill directories
  local project_names
  project_names=$(get_project_names)

  for project_name in $project_names; do
    if [ -n "$specific_project" ] && [ "$project_name" != "$specific_project" ]; then
      continue
    fi

    # Each project may install multiple skills - we need to check what was installed
    # For now, remove known skill directories
    [ -d "$skills_dir/$project_name" ] && rm -rf "$skills_dir/$project_name"
  done

  # Reinstall
  do_install "$agent" "$specific_project"
}

# ============================================================================
# Uninstall
# ============================================================================

do_uninstall() {
  local specific_project="$1"
  local agent
  agent=$(detect_agent)

  if [ -z "$agent" ]; then
    print_error "No existing installation detected"
    exit 1
  fi

  print_info "Uninstalling for: $agent"

  local skills_dir
  skills_dir=$(get_skills_dir "$agent")

  local project_names
  project_names=$(get_project_names)
  local removed=0

  for project_name in $project_names; do
    if [ -n "$specific_project" ] && [ "$project_name" != "$specific_project" ]; then
      continue
    fi

    if [ -d "$skills_dir/$project_name" ]; then
      rm -rf "$skills_dir/$project_name"
      print_success "Removed $skills_dir/$project_name/"
      removed=$((removed + 1))
    fi
  done

  if [ "$removed" -eq 0 ]; then
    print_info "No Plaited projects found in $skills_dir/"
  else
    echo ""
    print_success "Uninstalled $removed project(s)"
  fi
}

# ============================================================================
# CLI Parsing
# ============================================================================

show_help() {
  echo "Usage: install.sh [OPTIONS]"
  echo ""
  echo "Install Plaited skills for AI coding agents supporting agent-skills-spec."
  echo ""
  echo "Options:"
  echo "  --agent <name>      Install for specific agent"
  echo "  --project <name>    Install specific project only"
  echo "  --list              List available projects"
  echo "  --update            Update existing installation"
  echo "  --uninstall         Remove installation"
  echo "  --help              Show this help message"
  echo ""
  echo "Supported Agents:"
  echo ""
  echo "  ┌─────────────┬──────────────────────┬──────────────────────┐"
  echo "  │ Agent       │ Skills               │ Commands             │"
  echo "  ├─────────────┼──────────────────────┼──────────────────────┤"
  echo "  │ gemini      │ .gemini/skills       │ .gemini/commands     │"
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
  echo "  ./install.sh --agent cursor --project development-skills"
  echo "  ./install.sh --list                       # List available projects"
  echo "  ./install.sh --update                     # Update existing"
  echo "  ./install.sh --uninstall                  # Remove all"
}

main() {
  local agent=""
  local project=""
  local action="install"

  while [ $# -gt 0 ]; do
    case "$1" in
      --agent)
        agent="$2"
        shift 2
        ;;
      --project)
        project="$2"
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

  # Check projects.json exists, fetch from GitHub if not found (for curl | bash usage)
  if [ ! -f "$PROJECTS_JSON" ]; then
    PROJECTS_JSON=$(mktemp)
    curl -fsSL "https://raw.githubusercontent.com/plaited/skills-installer/main/projects.json" -o "$PROJECTS_JSON" 2>/dev/null
    if [ ! -s "$PROJECTS_JSON" ]; then
      print_error "Could not fetch projects.json"
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

      # Validate agent
      local skills_dir
      skills_dir=$(get_skills_dir "$agent")
      if [ -z "$skills_dir" ]; then
        print_error "Unknown agent: $agent"
        print_info "Valid agents: gemini, copilot, cursor, opencode, amp, goose, factory"
        exit 1
      fi

      do_install "$agent" "$project"
      ;;
    update)
      do_update "$project"
      ;;
    uninstall)
      do_uninstall "$project"
      ;;
  esac
}

main "$@"
