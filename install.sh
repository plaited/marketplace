#!/bin/bash
# Install Plaited skills for AI coding agents supporting agent-skills-spec
# Supports: Gemini CLI, GitHub Copilot, Cursor, OpenCode, Amp, Goose, Factory, Codex, Windsurf, Claude Code
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
TEMP_PROJECTS_JSON=""  # Track if projects.json is a temp file that needs cleanup

# Security: Maximum file size for reading (100KB) to prevent resource exhaustion
MAX_FILE_SIZE=102400

# Windsurf workflow character limit (12000 with 500 char buffer for truncation message)
WINDSURF_CHAR_LIMIT=11500

# Safely read file contents with size limit check
# Get file size using stat (more efficient than wc -c as it doesn't read the file)
# Outputs file size in bytes to stdout
get_file_size() {
  local file="$1"
  local size

  # macOS uses -f%z, Linux uses -c%s
  if size=$(stat -f%z "$file" 2>/dev/null); then
    printf '%s' "$size"
  elif size=$(stat -c%s "$file" 2>/dev/null); then
    printf '%s' "$size"
  else
    # Fallback to wc -c if stat doesn't work
    wc -c < "$file" | tr -d ' '
  fi
}

safe_read_file() {
  local file="$1"
  local max_size="${2:-$MAX_FILE_SIZE}"

  if [ ! -f "$file" ]; then
    return 1
  fi

  local file_size
  file_size=$(get_file_size "$file")

  if [ "$file_size" -gt "$max_size" ]; then
    print_error "File exceeds size limit ($max_size bytes): $file"
    return 1
  fi

  cat "$file"
}

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
    codex)    echo ".codex/skills" ;;
    windsurf) echo ".windsurf/skills" ;;
    claude)   echo ".claude/skills" ;;
    *)        echo "" ;;
  esac
}

get_commands_dir() {
  case "$1" in
    gemini)   echo ".gemini/commands" ;;
    copilot)  echo "" ;;                   # Copilot doesn't support commands
    cursor)   echo ".cursor/commands" ;;
    opencode) echo ".opencode/command" ;;  # OpenCode uses 'command' (singular)
    amp)      echo ".amp/commands" ;;
    goose)    echo "" ;;                   # Goose doesn't support commands
    factory)  echo ".factory/commands" ;;
    codex)    echo "" ;;                   # Codex uses ~/.codex/prompts/ (user-scoped)
    windsurf) echo ".windsurf/workflows" ;; # Windsurf uses workflows, not commands
    claude)   echo ".claude/commands" ;;
    *)        echo "" ;;
  esac
}

# Get the prompts directory for agents that use user-scoped prompts
# Note: Codex uses a global ~/.codex/prompts directory (user-scoped, not project-local).
# This means all Codex projects share the same prompts. This is intentional as Codex
# custom prompts are designed to be user-level, not project-level. See Codex docs for details.
get_prompts_dir() {
  case "$1" in
    codex) echo "$HOME/.codex/prompts" ;;
    *)     echo "" ;;
  esac
}

supports_commands() {
  # Agents that support slash commands (native or converted)
  case "$1" in
    gemini|cursor|opencode|amp|factory|claude) return 0 ;;
    codex|windsurf) return 0 ;;  # Supported via conversion
    *) return 1 ;;
  esac
}

# Check if agent needs command format conversion
needs_command_conversion() {
  case "$1" in
    gemini|codex|windsurf) return 0 ;;
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
  # Clean up temp projects.json if it was fetched remotely
  if [ -n "$TEMP_PROJECTS_JSON" ] && [ -f "$TEMP_PROJECTS_JSON" ]; then
    rm -f "$TEMP_PROJECTS_JSON"
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

  # Validate against path traversal attacks
  if [[ "$repo" =~ \.\. ]]; then
    print_error "Invalid repository path (path traversal detected): $repo"
    return 1
  fi

  # Validate repo format (owner/repo)
  if ! [[ "$repo" =~ ^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$ ]]; then
    print_error "Invalid repository format: $repo (expected: owner/repo)"
    return 1
  fi

  echo "https://github.com/$repo.git" ".claude"
}

# ============================================================================
# Skill Scoping Functions
# ============================================================================

# Check if a skill folder is already scoped (has @org_project suffix)
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^.+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

# Extract org from repo path (e.g., "plaited" from "plaited/development-skills")
extract_org_from_repo() {
  local repo="$1"
  echo "${repo%%/*}"
}

# Generate scoped skill name: skill-name@org_project
get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="${repo##*/}"
  echo "${skill_name}@${org}_${project_name}"
}

# Generate command scope prefix from repo: org_project
get_command_scope_prefix() {
  local repo="$1"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="${repo##*/}"
  echo "${org}_${project_name}"
}

# Remove scoped commands for a project based on agent type
remove_scoped_commands() {
  local agent="$1"
  local scope="$2"
  local commands_dir="$3"

  [ -d "$commands_dir" ] || return 0

  case "$agent" in
    gemini)
      # Remove scope:*.toml files
      for cmd_file in "$commands_dir"/${scope}:*.toml; do
        [ -f "$cmd_file" ] || continue
        rm -f "$cmd_file"
        print_info "Removed command: $(basename "$cmd_file")"
      done
      ;;

    claude|opencode)
      # Remove scope/ folder
      if [ -d "$commands_dir/$scope" ]; then
        rm -rf "$commands_dir/$scope"
        print_info "Removed commands folder: $scope/"
      fi
      ;;

    cursor|factory|amp|windsurf)
      # Remove scope--*.md files
      for cmd_file in "$commands_dir"/${scope}--*.md; do
        [ -f "$cmd_file" ] || continue
        rm -f "$cmd_file"
        print_info "Removed command: $(basename "$cmd_file")"
      done
      ;;

    codex)
      # User-scoped prompts - don't remove on project uninstall
      ;;

    *)
      # Fallback: remove scope--*.md files
      for cmd_file in "$commands_dir"/${scope}--*.md; do
        [ -f "$cmd_file" ] || continue
        rm -f "$cmd_file"
        print_info "Removed command: $(basename "$cmd_file")"
      done
      ;;
  esac
}

# Remove all scoped skills and commands for a project
# Used by both update and uninstall operations
# Echoes the count of removed skills to stdout
remove_project_scoped_content() {
  local agent="$1"
  local project_name="$2"
  local skills_dir="$3"
  local commands_dir="$4"
  local removed=0

  local repo
  repo=$(get_project_repo "$project_name")
  if [ -z "$repo" ]; then
    print_info "Could not find repository for project: $project_name, skipping removal"
    echo "0"
    return 0
  fi

  local org project_suffix scope_pattern scope
  org=$(extract_org_from_repo "$repo")
  project_suffix="${repo##*/}"
  scope_pattern="@${org}_${project_suffix}$"
  scope="${org}_${project_suffix}"

  # Remove scoped skills
  for skill_folder in "$skills_dir"/*; do
    [ -d "$skill_folder" ] || continue
    local skill_name
    skill_name=$(basename "$skill_folder")
    if [[ "$skill_name" =~ $scope_pattern ]]; then
      rm -rf "$skill_folder"
      print_info "Removed skill: $skill_name"
      removed=$((removed + 1))
    fi
  done

  # Remove scoped commands
  if [ -n "$commands_dir" ]; then
    remove_scoped_commands "$agent" "$scope" "$commands_dir"
  fi

  echo "$removed"
}

# ============================================================================
# Format Conversion
# ============================================================================
#
# Conversion Algorithm Overview:
# -----------------------------
# Different AI agents expect commands/prompts in different formats.
# These functions convert from the standard agent-skills-spec markdown format
# to each agent's native format.
#
# Source format (agent-skills-spec):
#   - Markdown file with optional YAML frontmatter (---)
#   - Frontmatter may contain: name, description, allowed-tools
#   - Body contains the prompt/command instructions
#   - May use $ARGUMENTS placeholder for user input
#
# Target formats:
#   1. Gemini TOML: description + prompt fields in TOML syntax
#   2. Codex prompt: Markdown with description/argument-hint frontmatter
#   3. Windsurf workflow: Structured markdown with title, description, steps
#
# Security considerations:
#   - All file reads go through safe_read_file() with size limits
#   - No shell expansion of file content (uses printf, not echo)
#   - AWK patterns are static, not user-controlled
# ============================================================================

# Shared frontmatter extraction helpers (reduces code duplication)

# Check if file has YAML frontmatter (starts with ---)
has_frontmatter() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return 1
  fi
  head -1 "$file" 2>/dev/null | grep -q '^---$'
}

# Extract a field from YAML frontmatter
# Usage: extract_frontmatter_field "file.md" "description"
# Returns: field value on stdout, exit code 0 on success
# Note: Returns empty string (not error) if field not found - this is intentional
extract_frontmatter_field() {
  local file="$1"
  local field="$2"
  local strip_quotes="${3:-true}"

  if [ ! -f "$file" ]; then
    print_error "File not found: $file"
    return 1
  fi

  local result
  if ! result=$(awk -v field="$field" -v strip="$strip_quotes" '
    /^---$/ { if (in_front) exit; in_front=1; next }
    in_front && $0 ~ "^" field ":" {
      sub("^" field ":[[:space:]]*", "")
      if (strip == "true") {
        gsub(/^["'"'"']|["'"'"']$/, "")
      }
      print
      exit
    }
  ' "$file" 2>&1); then
    print_error "AWK parsing failed for $file: $result"
    return 1
  fi

  printf '%s' "$result"
}

# Extract body content (everything after YAML frontmatter)
# Returns: body content on stdout, exit code 0 on success
extract_body() {
  local file="$1"

  if [ ! -f "$file" ]; then
    print_error "File not found: $file"
    return 1
  fi

  # Run AWK directly to preserve output formatting (including newlines)
  awk '
    /^---$/ { count++; if (count == 2) { getbody=1; next } }
    getbody { print }
  ' "$file"
}

# Convert markdown command to Gemini TOML format
convert_md_to_toml() {
  local md_file="$1"
  local toml_file="$2"

  # Extract description from YAML frontmatter (escape quotes for TOML)
  local description
  description=$(extract_frontmatter_field "$md_file" "description" "false" | sed 's/"/\\"/g')

  # Get body (everything after second ---)
  local body
  body=$(extract_body "$md_file")

  # Replace $ARGUMENTS with {{args}}
  # Use printf instead of echo to safely handle arbitrary input (avoids command injection)
  body=$(printf '%s\n' "$body" | sed 's/\$ARGUMENTS/{{args}}/g')

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

# Convert markdown command to Codex custom prompt format
# Input: plain markdown or markdown with YAML frontmatter
# Output: markdown with required YAML frontmatter (description, argument-hint)
convert_md_to_codex_prompt() {
  local md_file="$1"
  local prompt_file="$2"

  local description=""
  local body=""

  if has_frontmatter "$md_file"; then
    # Extract existing description using shared helper
    description=$(extract_frontmatter_field "$md_file" "description")
    # Get body using shared helper
    body=$(extract_body "$md_file")
  else
    # No frontmatter - use filename as basis for description
    local basename
    basename=$(basename "$md_file" .md)
    description=$(echo "$basename" | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
    if ! body=$(safe_read_file "$md_file"); then
      return 1
    fi
  fi

  # If still no description, extract from first line of body
  if [ -z "$description" ]; then
    description=$(printf '%s\n' "$body" | head -1 | sed 's/^#* *//' | cut -c1-80)
  fi

  # Detect if command uses arguments (look for placeholders like $1, $FILE, etc.)
  local argument_hint=""
  if printf '%s\n' "$body" | grep -qE '\$[0-9]|\$[A-Z_]+'; then
    # Extract named placeholders
    local placeholders
    placeholders=$(printf '%s\n' "$body" | grep -oE '\$[A-Z_]+' | sort -u | tr '\n' ' ')
    if [ -n "$placeholders" ]; then
      argument_hint=$(echo "$placeholders" | sed 's/\$\([A-Z_]*\)/\1=<value>/g' | tr -s ' ')
    fi
  fi

  # Write Codex prompt file with frontmatter
  {
    echo "---"
    echo "description: $description"
    if [ -n "$argument_hint" ]; then
      echo "argument-hint: $argument_hint"
    fi
    echo "---"
    echo ""
    echo "$body"
  } > "$prompt_file"
}

# Convert markdown command to Windsurf workflow format
# Input: plain markdown or markdown with YAML frontmatter
# Output: markdown structured as workflow (title, description, numbered steps)
convert_md_to_windsurf_workflow() {
  local md_file="$1"
  local workflow_file="$2"

  local name=""
  local description=""
  local body=""

  if has_frontmatter "$md_file"; then
    # Extract name and description using shared helpers
    name=$(extract_frontmatter_field "$md_file" "name")
    description=$(extract_frontmatter_field "$md_file" "description")
    # Get body using shared helper
    body=$(extract_body "$md_file")
  else
    # No frontmatter - derive from filename
    local basename
    basename=$(basename "$md_file" .md)
    name=$(echo "$basename" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')
    if ! body=$(safe_read_file "$md_file"); then
      return 1
    fi
  fi

  # If still no name, extract from first heading
  if [ -z "$name" ]; then
    name=$(printf '%s\n' "$body" | grep -m1 '^#' | sed 's/^#* *//')
  fi

  # If still no description, use first non-heading line
  if [ -z "$description" ]; then
    description=$(printf '%s\n' "$body" | grep -v '^#' | grep -v '^$' | head -1 | cut -c1-100)
  fi

  # Check content length (Windsurf has 12000 char limit)
  local content_length
  content_length=$(printf '%s' "$body" | wc -c)
  if [ "$content_length" -gt "$WINDSURF_CHAR_LIMIT" ]; then
    print_info "Warning: $md_file exceeds Windsurf 12k char limit, truncating"
    body=$(printf '%s' "$body" | head -c "$WINDSURF_CHAR_LIMIT")
    body="$body"$'\n\n'"[Content truncated - see original skill for full instructions]"
  fi

  # Check if body already has numbered steps structure
  local has_steps
  has_steps=$(printf '%s\n' "$body" | grep -cE '^[0-9]+\.' || true)

  # Write Windsurf workflow file
  {
    echo "# $name"
    echo ""
    if [ -n "$description" ]; then
      echo "$description"
      echo ""
    fi

    if [ "$has_steps" -gt 0 ]; then
      # Already has numbered steps, use as-is
      echo "$body"
    else
      # Wrap content as workflow instructions
      echo "## Instructions"
      echo ""
      echo "$body"
    fi
  } > "$workflow_file"
}

# ============================================================================
# Agent Detection
# ============================================================================

detect_agent() {
  # Agent detection: directory -> agent name mapping
  # Using loop for maintainability (easier to add new agents)
  local agents=".gemini:gemini .github:copilot .cursor:cursor .opencode:opencode .amp:amp .goose:goose .factory:factory .codex:codex .windsurf:windsurf .claude:claude"

  for entry in $agents; do
    local dir="${entry%%:*}"
    local agent="${entry#*:}"
    if [ -d "$dir" ]; then
      echo "$agent"
      return 0
    fi
  done

  echo ""
}

ask_agent() {
  local detected
  detected=$(detect_agent)

  echo "Which AI coding agent are you using?"
  echo ""
  echo "  ┌──────────────┬────────────────────┐"
  echo "  │ Agent        │ Directory          │"
  echo "  ├──────────────┼────────────────────┤"
  echo "  │ 1) Gemini    │ .gemini/skills     │"
  echo "  │ 2) Copilot   │ .github/skills     │"
  echo "  │ 3) Cursor    │ .cursor/skills     │"
  echo "  │ 4) OpenCode  │ .opencode/skill    │"
  echo "  │ 5) Amp       │ .amp/skills        │"
  echo "  │ 6) Goose     │ .goose/skills      │"
  echo "  │ 7) Factory   │ .factory/skills    │"
  echo "  │ 8) Codex     │ .codex/skills      │"
  echo "  │ 9) Windsurf  │ .windsurf/skills   │"
  echo "  │ 10) Claude   │ .claude/skills     │"
  echo "  └──────────────┴────────────────────┘"
  echo ""

  if [ -n "$detected" ]; then
    echo "  Detected: $detected"
    echo ""
  fi

  printf "Select agent [1-10]: "
  read choice

  case "$choice" in
    1) echo "gemini" ;;
    2) echo "copilot" ;;
    3) echo "cursor" ;;
    4) echo "opencode" ;;
    5) echo "amp" ;;
    6) echo "goose" ;;
    7) echo "factory" ;;
    8) echo "codex" ;;
    9) echo "windsurf" ;;
    10) echo "claude" ;;
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
  local parse_result
  if ! parse_result=$(parse_source "$source"); then
    return 1
  fi
  read repo_url sparse_path <<< "$parse_result"

  print_info "Cloning $project_name from $repo_url..."

  local project_temp="$TEMP_DIR/$project_name"
  mkdir -p "$project_temp"

  local clone_output
  if ! clone_output=$(git clone --depth 1 --filter=blob:none --sparse "$repo_url" "$project_temp" --branch "$BRANCH" 2>&1); then
    print_error "Failed to clone $project_name from $repo_url"
    print_error "Git error: $clone_output"
    rm -rf "$project_temp"
    return 1
  fi

  cd "$project_temp" || {
    print_error "Failed to access cloned directory: $project_temp"
    return 1
  }

  # Fetch both skills and commands directories
  local sparse_output
  if ! sparse_output=$(git sparse-checkout set "$sparse_path/skills" "$sparse_path/commands" 2>&1); then
    print_error "Failed to set sparse checkout for $project_name"
    print_error "Git error: $sparse_output"
    cd - > /dev/null
    rm -rf "$project_temp"
    return 1
  fi
  cd - > /dev/null

  # Store the sparse path for later use
  printf '%s' "$sparse_path" > "$project_temp/.sparse_path"

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

  # Get repo once for both skills and commands scoping
  local repo
  repo=$(get_project_repo "$project_name")
  if [ -z "$repo" ]; then
    print_error "Could not find repository for project: $project_name"
    return 1
  fi

  if [ -d "$source_skills" ]; then
    print_info "Installing skills from $project_name..."

    for skill_folder in "$source_skills"/*; do
      [ -d "$skill_folder" ] || continue

      local skill_name
      skill_name=$(basename "$skill_folder")

      if is_scoped_skill "$skill_name"; then
        # Already scoped - copy as-is (inherited skill)
        cp -r "$skill_folder" "$skills_dir/"
        print_info "  Preserved: $skill_name"
      else
        # Not scoped - rename with scope
        local scoped_name
        scoped_name=$(get_scoped_skill_name "$skill_name" "$repo")
        cp -r "$skill_folder" "$skills_dir/$scoped_name"
        print_info "  Installed: $scoped_name"
      fi
    done

    print_success "Installed $project_name skills"
  else
    print_info "No skills directory in $project_name ($sparse_path/skills)"
  fi

  if [ -d "$source_commands" ]; then
    print_info "Installing commands from $project_name..."

    local scope
    scope=$(get_command_scope_prefix "$repo")

    # Skip if agent doesn't support commands
    if [ -z "$commands_dir" ]; then
      print_info "Agent $agent does not support commands, skipping..."
    else
      case "$agent" in
        gemini)
          # Convert .md to .toml for Gemini CLI (scope:command.toml)
          mkdir -p "$commands_dir"
          for md_file in "$source_commands"/*.md; do
            [ -f "$md_file" ] || continue
            local cmd_name
            cmd_name=$(basename "$md_file" .md)
            local scoped_name="${scope}:${cmd_name}"
            convert_md_to_toml "$md_file" "$commands_dir/$scoped_name.toml"
            print_info "  Installed: /$scoped_name"
          done
          print_success "Converted and installed $project_name commands (TOML)"
          ;;

        codex)
          # Convert to Codex custom prompts (user-scoped, no project scoping)
          local prompts_dir
          prompts_dir=$(get_prompts_dir "$agent")
          mkdir -p "$prompts_dir"
          for md_file in "$source_commands"/*.md; do
            [ -f "$md_file" ] || continue
            local cmd_name
            cmd_name=$(basename "$md_file" .md)
            convert_md_to_codex_prompt "$md_file" "$prompts_dir/$cmd_name.md"
            print_info "  Installed: $cmd_name"
          done
          print_success "Converted and installed $project_name prompts → $prompts_dir/"
          ;;

        windsurf)
          # Convert to Windsurf workflows (scope--workflow.md)
          mkdir -p "$commands_dir"
          for md_file in "$source_commands"/*.md; do
            [ -f "$md_file" ] || continue
            local cmd_name
            cmd_name=$(basename "$md_file" .md)
            local scoped_name="${scope}--${cmd_name}"
            convert_md_to_windsurf_workflow "$md_file" "$commands_dir/$scoped_name.md"
            print_info "  Installed: /$scoped_name"
          done
          print_success "Converted and installed $project_name workflows"
          ;;

        claude|opencode)
          # Folder-based scoping for Claude/OpenCode (scope/command.md)
          local scoped_dir="$commands_dir/$scope"
          mkdir -p "$scoped_dir"
          for md_file in "$source_commands"/*.md; do
            [ -f "$md_file" ] || continue
            local cmd_name
            cmd_name=$(basename "$md_file" .md)
            cp "$md_file" "$scoped_dir/$cmd_name.md"
            print_info "  Installed: /$scope/$cmd_name"
          done
          print_success "Installed $project_name commands"
          ;;

        cursor|factory|amp)
          # Flat structure with prefix (scope--command.md)
          mkdir -p "$commands_dir"
          for md_file in "$source_commands"/*.md; do
            [ -f "$md_file" ] || continue
            local cmd_name
            cmd_name=$(basename "$md_file" .md)
            local scoped_name="${scope}--${cmd_name}"
            cp "$md_file" "$commands_dir/$scoped_name.md"
            print_info "  Installed: /$scoped_name"
          done
        print_success "Installed $project_name commands"
        ;;

      *)
        # Fallback: direct copy with prefix for unknown agents
        mkdir -p "$commands_dir"
        for md_file in "$source_commands"/*.md; do
          [ -f "$md_file" ] || continue
          local cmd_name
          cmd_name=$(basename "$md_file" .md)
          local scoped_name="${scope}--${cmd_name}"
          cp "$md_file" "$commands_dir/$scoped_name.md"
          print_info "  Installed: /$scoped_name"
        done
        print_success "Installed $project_name commands"
        ;;
      esac
    fi
  fi
}

# ============================================================================
# Main Installation
# ============================================================================

do_install() {
  local agent="$1"
  local specific_project="$2"
  local skills_dir_override="$3"
  local commands_dir_override="$4"

  local skills_dir commands_dir
  # Use overrides if provided, otherwise get from agent
  if [ -n "$skills_dir_override" ]; then
    skills_dir="$skills_dir_override"
  else
    skills_dir=$(get_skills_dir "$agent")
  fi

  if [ -n "$commands_dir_override" ]; then
    commands_dir="$commands_dir_override"
  else
    commands_dir=$(get_commands_dir "$agent")
  fi

  if [ -z "$skills_dir" ]; then
    print_error "Unknown agent: $agent (use --skills-dir to specify custom directory)"
    return 1
  fi

  print_info "Installing for: $agent"
  print_info "Skills: $skills_dir/"
  if [ -n "$commands_dir" ]; then
    print_info "Commands: $commands_dir/"
  fi
  echo ""

  TEMP_DIR=$(mktemp -d)
  mkdir -p "$skills_dir"
  if [ -n "$commands_dir" ]; then
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

    if ! clone_project "$project_name" "$source"; then
      continue
    fi
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

  # Show commands/prompts/workflows location based on agent
  case "$agent" in
    codex)
      local prompts_dir
      prompts_dir=$(get_prompts_dir "$agent")
      if [ -d "$prompts_dir" ] && [ "$(ls -A "$prompts_dir" 2>/dev/null)" ]; then
        echo "    • Prompts:  $prompts_dir/ (converted from commands)"
      fi
      ;;
    windsurf)
      if [ -d "$commands_dir" ] && [ "$(ls -A "$commands_dir" 2>/dev/null)" ]; then
        echo "    • Workflows: $commands_dir/ (converted from commands)"
      fi
      ;;
    *)
      if supports_commands "$agent" && [ -d "$commands_dir" ] && [ "$(ls -A "$commands_dir" 2>/dev/null)" ]; then
        echo "    • Commands: $commands_dir/"
      fi
      ;;
  esac

  echo ""
  echo "  Next steps:"
  echo "    1. Restart your AI coding agent to load the new skills"
  echo "    2. Skills are auto-discovered and activated when relevant"
  if [ "$agent" = "codex" ]; then
    echo "    3. Prompts are invoked via /prompts:<name> in Codex"
  elif [ "$agent" = "windsurf" ]; then
    echo "    3. Workflows are invoked via /<workflow-name> in Cascade"
  fi
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
  local agent="$1"
  local specific_project="$2"
  local skills_dir_override="$3"
  local commands_dir_override="$4"

  # Use provided agent or detect from existing installation
  if [ -z "$agent" ]; then
    agent=$(detect_agent)
    if [ -z "$agent" ]; then
      print_error "No existing installation detected"
      print_info "Run without --update to install, or specify --agent"
      exit 1
    fi
  fi

  print_info "Updating installation for: $agent"

  local skills_dir commands_dir
  # Use overrides if provided, otherwise get from agent
  if [ -n "$skills_dir_override" ]; then
    skills_dir="$skills_dir_override"
  else
    skills_dir=$(get_skills_dir "$agent")
  fi

  if [ -n "$commands_dir_override" ]; then
    commands_dir="$commands_dir_override"
  else
    commands_dir=$(get_commands_dir "$agent")
  fi

  # Get all project names and remove their skill directories
  local project_names
  project_names=$(get_project_names)

  for project_name in $project_names; do
    if [ -n "$specific_project" ] && [ "$project_name" != "$specific_project" ]; then
      continue
    fi
    remove_project_scoped_content "$agent" "$project_name" "$skills_dir" "$commands_dir"
  done

  # Reinstall
  do_install "$agent" "$specific_project" "$skills_dir_override" "$commands_dir_override"
}

# ============================================================================
# Uninstall
# ============================================================================

do_uninstall() {
  local agent="$1"
  local specific_project="$2"
  local skills_dir_override="$3"
  local commands_dir_override="$4"

  # Use provided agent or detect from existing installation
  if [ -z "$agent" ]; then
    agent=$(detect_agent)
    if [ -z "$agent" ]; then
      print_error "No existing installation detected"
      print_info "Specify --agent to uninstall a specific agent"
      exit 1
    fi
  fi

  print_info "Uninstalling for: $agent"

  local skills_dir commands_dir
  # Use overrides if provided, otherwise get from agent
  if [ -n "$skills_dir_override" ]; then
    skills_dir="$skills_dir_override"
  else
    skills_dir=$(get_skills_dir "$agent")
  fi

  if [ -n "$commands_dir_override" ]; then
    commands_dir="$commands_dir_override"
  else
    commands_dir=$(get_commands_dir "$agent")
  fi

  local project_names
  project_names=$(get_project_names)
  local removed=0

  for project_name in $project_names; do
    if [ -n "$specific_project" ] && [ "$project_name" != "$specific_project" ]; then
      continue
    fi
    local count
    count=$(remove_project_scoped_content "$agent" "$project_name" "$skills_dir" "$commands_dir")
    removed=$((removed + count))
  done

  if [ "$removed" -eq 0 ]; then
    print_info "No Plaited skills found in $skills_dir/"
  else
    echo ""
    print_success "Uninstalled $removed skill(s)"
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
  echo "  --agent <name>       Install for specific agent"
  echo "  --project <name>     Install specific project only"
  echo "  --skills-dir <path>  Override skills directory"
  echo "  --commands-dir <path> Override commands directory"
  echo "  --list               List available projects"
  echo "  --update             Update existing installation"
  echo "  --uninstall          Remove installation"
  echo "  --help               Show this help message"
  echo ""
  echo "Supported Agents:"
  echo ""
  echo "  ┌──────────────┬──────────────────────┬────────────────────────────┐"
  echo "  │ Agent        │ Skills               │ Commands                   │"
  echo "  ├──────────────┼──────────────────────┼────────────────────────────┤"
  echo "  │ gemini       │ .gemini/skills       │ .gemini/commands (→TOML)   │"
  echo "  │ copilot      │ .github/skills       │ -                          │"
  echo "  │ cursor       │ .cursor/skills       │ .cursor/commands           │"
  echo "  │ opencode     │ .opencode/skill      │ .opencode/command          │"
  echo "  │ amp          │ .amp/skills          │ .amp/commands              │"
  echo "  │ goose        │ .goose/skills        │ -                          │"
  echo "  │ factory      │ .factory/skills      │ .factory/commands          │"
  echo "  │ codex        │ .codex/skills        │ ~/.codex/prompts (→prompt) │"
  echo "  │ windsurf     │ .windsurf/skills     │ .windsurf/workflows        │"
  echo "  │ claude       │ .claude/skills       │ .claude/commands           │"
  echo "  └──────────────┴──────────────────────┴────────────────────────────┘"
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
  local skills_dir_override=""
  local commands_dir_override=""
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
      --skills-dir)
        skills_dir_override="$2"
        shift 2
        ;;
      --commands-dir)
        commands_dir_override="$2"
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
    TEMP_PROJECTS_JSON="$PROJECTS_JSON"  # Mark for cleanup on exit
    local checksum_file
    checksum_file=$(mktemp)

    # Fetch both projects.json and its checksum
    curl -fsSL "https://raw.githubusercontent.com/plaited/skills-installer/main/projects.json" -o "$PROJECTS_JSON" 2>/dev/null
    curl -fsSL "https://raw.githubusercontent.com/plaited/skills-installer/main/projects.json.sha256" -o "$checksum_file" 2>/dev/null

    if [ ! -s "$PROJECTS_JSON" ]; then
      print_error "Could not fetch projects.json"
      rm -f "$checksum_file"
      exit 1
    fi

    # Verify checksum (mandatory - security: prevent tampered downloads)
    if [ ! -s "$checksum_file" ]; then
      print_error "Could not fetch checksum file - cannot verify projects.json integrity"
      print_error "This is a security requirement. Aborting."
      rm -f "$PROJECTS_JSON"
      exit 1
    fi

    local expected_checksum actual_checksum
    expected_checksum=$(awk '{print $1}' "$checksum_file")
    actual_checksum=$(shasum -a 256 "$PROJECTS_JSON" 2>/dev/null | awk '{print $1}')

    if [ -z "$actual_checksum" ]; then
      print_error "Could not compute checksum - shasum not available"
      rm -f "$checksum_file" "$PROJECTS_JSON"
      exit 1
    fi

    if [ "$expected_checksum" != "$actual_checksum" ]; then
      print_error "Checksum verification failed for projects.json"
      print_error "Expected: $expected_checksum"
      print_error "Got: $actual_checksum"
      rm -f "$checksum_file" "$PROJECTS_JSON"
      exit 1
    fi
    print_info "Checksum verified for projects.json"
    rm -f "$checksum_file"
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

      # Validate agent (unless custom dirs provided)
      if [ -z "$skills_dir_override" ]; then
        local skills_dir
        skills_dir=$(get_skills_dir "$agent")
        if [ -z "$skills_dir" ]; then
          print_error "Unknown agent: $agent"
          print_info "Valid agents: gemini, copilot, cursor, opencode, amp, goose, factory, codex, windsurf, claude"
          exit 1
        fi
      fi

      do_install "$agent" "$project" "$skills_dir_override" "$commands_dir_override"
      ;;
    update)
      do_update "$agent" "$project" "$skills_dir_override" "$commands_dir_override"
      ;;
    uninstall)
      do_uninstall "$agent" "$project" "$skills_dir_override" "$commands_dir_override"
      ;;
  esac
}

main "$@"
