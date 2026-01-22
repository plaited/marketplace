#!/bin/bash
# Install Plaited skills for AI coding agents supporting agent-skills-spec
# Supports: Gemini CLI, GitHub Copilot, Cursor, OpenCode, Amp, Goose, Factory, Codex, Windsurf, Claude Code
#
# Usage:
#   ./install.sh                              # Interactive: asks which agent
#   ./install.sh --agent gemini               # Direct: install for Gemini CLI
#   ./install.sh --project development-skills # Install specific project only
#   ./install.sh --list                       # List available projects
#   ./install.sh --uninstall                  # Remove installation

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
    # Fallback to ls -ln (doesn't read file content, parses metadata)
    # Format: -rw-r--r-- 1 uid gid SIZE date time file
    ls -ln "$file" 2>/dev/null | awk '{print $5}'
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
# Projects JSON Parsing (jq with awk fallback)
# ============================================================================

# Track if we've shown the jq fallback message
JQ_FALLBACK_WARNED=""

# Check if jq is available
has_jq() {
  command -v jq >/dev/null 2>&1
}

# Show one-time info message when falling back to awk
warn_jq_fallback() {
  if [ -z "$JQ_FALLBACK_WARNED" ]; then
    JQ_FALLBACK_WARNED="1"
    print_info "jq not found, using awk fallback for JSON parsing"
  fi
}

# Cache for project names (avoids re-parsing projects.json on every call)
CACHED_PROJECT_NAMES=""

# Get all project names from projects.json (cached for performance)
get_project_names() {
  # Return cached result if available
  if [ -n "$CACHED_PROJECT_NAMES" ]; then
    echo "$CACHED_PROJECT_NAMES"
    return 0
  fi

  local names
  if has_jq; then
    names=$(jq -r '.projects[].name' "$PROJECTS_JSON")
  else
    warn_jq_fallback
    # Fallback: parse with awk
    names=$(awk '
      /"projects"[[:space:]]*:/ { in_projects=1 }
      in_projects && /"name"[[:space:]]*:/ {
        gsub(/.*"name"[[:space:]]*:[[:space:]]*"/, "")
        gsub(/".*/, "")
        print
      }
    ' "$PROJECTS_JSON")
  fi

  # Cache the result
  CACHED_PROJECT_NAMES="$names"
  echo "$names"
}

# Get repository path for a project
get_project_repo() {
  local project_name="$1"
  if has_jq; then
    jq -r --arg name "$project_name" '.projects[] | select(.name == $name) | .repo' "$PROJECTS_JSON"
  else
    warn_jq_fallback
    # Fallback: parse with awk (use awk variable consistently)
    awk -v name="$project_name" '
      $0 ~ "\"name\"[[:space:]]*:[[:space:]]*\"" name "\"" { found=1 }
      found && /"repo"[[:space:]]*:/ {
        gsub(/.*"repo"[[:space:]]*:[[:space:]]*"/, "")
        gsub(/".*/, "")
        print
        exit
      }
    ' "$PROJECTS_JSON"
  fi
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
# Pattern: skill-name@org_project where all parts are alphanumeric with dots, hyphens, underscores
is_scoped_skill() {
  local skill_name="$1"
  [[ "$skill_name" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+_[a-zA-Z0-9._-]+$ ]]
}

# Validate scope component doesn't contain path traversal sequences
validate_scope_component() {
  local component="$1"
  # Reject empty, path traversal, or absolute paths
  if [ -z "$component" ] || [[ "$component" =~ \.\. ]] || [[ "$component" =~ ^/ ]]; then
    return 1
  fi
  return 0
}

# Validate sparse_path content for security
# Prevents command injection and path traversal attacks
validate_sparse_path() {
  local sparse_path="$1"

  # Reject empty
  if [ -z "$sparse_path" ]; then
    return 1
  fi

  # Reject path traversal sequences
  if [[ "$sparse_path" =~ \.\. ]]; then
    return 1
  fi

  # Reject absolute paths
  if [[ "$sparse_path" =~ ^/ ]]; then
    return 1
  fi

  # Reject shell special characters that could enable command injection
  # This includes: $, `, (, ), |, &, ;, <, >, ', ", \, !, space, tab, newline
  if [[ "$sparse_path" =~ [\$\`\(\)\|\&\;\<\>\'\"\\\!\[:space:]] ]]; then
    return 1
  fi

  # Only allow safe characters: alphanumeric, dots, hyphens, underscores, forward slashes
  if [[ "$sparse_path" =~ [^a-zA-Z0-9._/-] ]]; then
    return 1
  fi

  return 0
}

# Validate that a target path is safely within a parent directory
# Prevents path traversal attacks before rm -rf operations
validate_path_within_dir() {
  local parent_dir="$1"
  local target_path="$2"

  # Resolve parent to absolute path
  local resolved_parent
  resolved_parent=$(cd "$parent_dir" 2>/dev/null && pwd -P)
  [ -z "$resolved_parent" ] && return 1

  # Get the basename (skill folder name) and check it's simple (no slashes or ..)
  local basename
  basename=$(basename "$target_path")
  if [[ "$basename" =~ / ]] || [[ "$basename" =~ \.\. ]] || [ -z "$basename" ]; then
    return 1
  fi

  # Target must be direct child of parent (parent_dir/basename)
  local expected_target="$resolved_parent/$basename"

  # Resolve dirname of target_path from original working directory
  # This handles both relative and absolute paths correctly
  local target_dirname
  target_dirname=$(cd "$(dirname "$target_path")" 2>/dev/null && pwd -P)

  # If dirname resolution failed (directory doesn't exist), reject
  # This is a security measure - we only accept paths where the parent exists
  if [ -z "$target_dirname" ]; then
    return 1
  fi

  # Construct and compare canonical paths
  local actual_target="$target_dirname/$basename"
  [ "$actual_target" = "$expected_target" ]
}

# Extract org from repo path (e.g., "plaited" from "plaited/development-skills")
extract_org_from_repo() {
  local repo="$1"
  local org="${repo%%/*}"
  # Validate extracted org
  if ! validate_scope_component "$org"; then
    echo ""
    return 1
  fi
  echo "$org"
}

# Generate scoped skill name: skill-name@org_project
get_scoped_skill_name() {
  local skill_name="$1"
  local repo="$2"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="${repo##*/}"
  # Validate components
  if ! validate_scope_component "$org" || ! validate_scope_component "$project_name"; then
    echo "$skill_name"  # Return unscoped name on validation failure
    return 1
  fi
  echo "${skill_name}@${org}_${project_name}"
}

# Generate scope prefix from repo: org_project
get_skill_scope_prefix() {
  local repo="$1"
  local org project_name
  org=$(extract_org_from_repo "$repo")
  project_name="${repo##*/}"
  # Validate components
  if ! validate_scope_component "$org" || ! validate_scope_component "$project_name"; then
    echo ""
    return 1
  fi
  echo "${org}_${project_name}"
}


# ============================================================================
# Dependency Detection and Tracking
# ============================================================================

# Track which projects have been installed to prevent infinite loops
INSTALLED_PROJECTS=""
# Track which projects failed to install (to avoid retry loops and report at end)
FAILED_PROJECTS=""

# Check if a project has already been installed in this session
is_project_installed() {
  local project="$1"
  [[ " $INSTALLED_PROJECTS " =~ " $project " ]]
}

# Check if a project has already failed in this session
is_project_failed() {
  local project="$1"
  [[ " $FAILED_PROJECTS " =~ " $project " ]]
}

# Mark a project as installed
mark_project_installed() {
  INSTALLED_PROJECTS="$INSTALLED_PROJECTS $1"
}

# Mark a project as failed
mark_project_failed() {
  FAILED_PROJECTS="$FAILED_PROJECTS $1"
}

# Check if a scoped skill references a project in projects.json
# Returns the project name if found, empty otherwise
# Example: "typescript-lsp@plaited_development-skills" -> "development-skills"
get_skill_source_project() {
  local skill_name="$1"  # e.g., "typescript-lsp@plaited_development-skills"

  # Only process scoped skills (validates format: name@org_project)
  if ! is_scoped_skill "$skill_name"; then
    echo ""
    return 1
  fi

  # Extract scope part (after @)
  local scope_part="${skill_name##*@}"  # "plaited_development-skills"

  # Validate scope contains underscore (org_project format)
  if [[ ! "$scope_part" =~ _ ]]; then
    echo ""
    return 1
  fi

  # Extract project name (after first underscore)
  local project_name="${scope_part#*_}" # "development-skills"

  # Validate extracted project name is not empty
  if [ -z "$project_name" ]; then
    echo ""
    return 1
  fi

  # Check if this project exists in projects.json
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

# Scan a project's skills directory for dependencies (referenced projects)
# Returns space-separated list of project names that should be installed first
get_project_dependencies() {
  local project_temp="$1"

  # Check .sparse_path file exists
  if [ ! -f "$project_temp/.sparse_path" ]; then
    print_info "No .sparse_path file found in $project_temp"
    echo ""
    return 0
  fi

  local sparse_path
  sparse_path=$(cat "$project_temp/.sparse_path")

  # Security: validate sparse_path content
  if ! validate_sparse_path "$sparse_path"; then
    print_error "Invalid .sparse_path content in $project_temp (security check failed)"
    echo ""
    return 1
  fi

  local source_skills="$project_temp/$sparse_path/skills"
  local dependencies=""

  if [ ! -d "$source_skills" ]; then
    print_info "No skills directory found at $source_skills"
    echo ""
    return 0
  fi

  for skill_folder in "$source_skills"/*; do
    [ -d "$skill_folder" ] || continue
    local skill_name
    skill_name=$(basename "$skill_folder")

    # Check if this scoped skill references a known project
    local source_project
    source_project=$(get_skill_source_project "$skill_name")
    if [ -n "$source_project" ]; then
      # Add to dependencies if not already there
      if ! [[ " $dependencies " =~ " $source_project " ]]; then
        dependencies="$dependencies $source_project"
      fi
    fi
  done

  echo "$dependencies"
}

# ============================================================================
# Scoped Content Removal
# ============================================================================

# Remove all scoped skills for a project
# Used by both update and uninstall operations
# Echoes the count of removed skills to stdout
remove_project_scoped_content() {
  local agent="$1"
  local project_name="$2"
  local skills_dir="$3"
  local removed=0

  local repo
  repo=$(get_project_repo "$project_name")
  if [ -z "$repo" ]; then
    print_info "Could not find repository for project: $project_name, skipping removal"
    echo "0"
    return 0
  fi

  # Calculate scope for this project
  local scope scope_pattern
  if ! scope=$(get_skill_scope_prefix "$repo"); then
    print_info "Could not generate scope for project: $project_name, skipping removal"
    echo "0"
    return 0
  fi
  scope_pattern="@${scope}$"

  # Remove scoped skills (only if directory exists)
  if [ -d "$skills_dir" ]; then
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
  fi

  echo "$removed"
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

  # Fetch skills directory
  local sparse_output
  if ! sparse_output=$(git sparse-checkout set "$sparse_path/skills" 2>&1); then
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

  local project_temp="$TEMP_DIR/$project_name"
  local sparse_path
  sparse_path=$(cat "$project_temp/.sparse_path")

  # Security: validate sparse_path content
  if ! validate_sparse_path "$sparse_path"; then
    print_error "Invalid .sparse_path content for $project_name (security check failed)"
    return 1
  fi

  local source_skills="$project_temp/$sparse_path/skills"

  # Get repo for skill scoping
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

      # Determine target path
      local target_path
      if is_scoped_skill "$skill_name"; then
        # Check if this inherited skill comes from a project we'll install separately
        local source_project
        source_project=$(get_skill_source_project "$skill_name")
        if [ -n "$source_project" ]; then
          # Skip - this skill will be (or was) installed from its source project
          print_info "  Skipped: $skill_name (will install from $source_project)"
          continue
        fi
        # Already scoped but from unknown source - copy as-is
        target_path="$skills_dir/$skill_name"
      else
        # Not scoped - rename with scope
        local scoped_name
        if ! scoped_name=$(get_scoped_skill_name "$skill_name" "$repo"); then
          print_error "  Skipped: $skill_name (invalid scope components)"
          continue
        fi
        target_path="$skills_dir/$scoped_name"
      fi

      # Security: validate target path stays within skills_dir before any rm operations
      if ! validate_path_within_dir "$skills_dir" "$target_path"; then
        print_error "  Skipped: $skill_name (invalid target path)"
        continue
      fi

      # Check if replacing existing skill
      local replacing=false
      if [ -d "$target_path" ]; then
        replacing=true
      fi

      # Atomic replace-on-install strategy:
      # 1. Copy new content to temp directory (preserves old if copy fails)
      # 2. Remove old directory (temp exists if this fails, user can retry)
      # 3. Move temp to final location (atomic on same filesystem)
      #
      # Error recovery: On any failure, we clean up temp and skip this skill.
      # The worst case is partial state where old was removed but move failed,
      # leaving no skill installed. Recovery: simply re-run the installer to
      # complete the installation - it will install the missing skill fresh.

      # Use mktemp for unique temp name (more robust than PID-based naming)
      local temp_dir temp_target
      temp_dir=$(mktemp -d "${skills_dir}/.install-tmp.XXXXXX" 2>/dev/null)
      if [ -z "$temp_dir" ] || [ ! -d "$temp_dir" ]; then
        print_error "  Failed to create temp directory: $skill_name"
        continue
      fi
      temp_target="$temp_dir/$(basename "$target_path")"

      if ! cp -r "$skill_folder" "$temp_target"; then
        print_error "  Failed to copy: $skill_name"
        rm -rf "$temp_dir" 2>/dev/null
        continue
      fi

      if [ "$replacing" = true ]; then
        if ! rm -rf "$target_path"; then
          print_error "  Failed to remove existing: $skill_name"
          rm -rf "$temp_dir" 2>/dev/null
          continue
        fi
      fi

      if ! mv "$temp_target" "$target_path"; then
        print_error "  Failed to install: $skill_name"
        rm -rf "$temp_dir" 2>/dev/null
        continue
      fi

      # Clean up temp directory (now empty after successful mv)
      rm -rf "$temp_dir" 2>/dev/null

      # Report what was done
      local display_name
      if is_scoped_skill "$skill_name"; then
        display_name="$skill_name"
      else
        display_name="$scoped_name"
      fi

      if [ "$replacing" = true ]; then
        print_info "  Replaced: $display_name"
      else
        print_info "  Installed: $display_name"
      fi
    done

    print_success "Installed $project_name skills"
  else
    print_info "No skills directory in $project_name ($sparse_path/skills)"
  fi
}

# ============================================================================
# Main Installation
# ============================================================================

# Install a project with its dependencies (recursive)
# This function handles the recursive dependency resolution
install_project_with_dependencies() {
  local project_name="$1"
  local skills_dir="$2"

  # Skip if already installed in this session
  if is_project_installed "$project_name"; then
    return 0
  fi

  # Skip if already failed (prevents retry loops)
  if is_project_failed "$project_name"; then
    return 1
  fi

  # Get repo and clone
  local source
  source=$(get_project_repo "$project_name")
  if [ -z "$source" ]; then
    print_error "Could not find source for $project_name"
    mark_project_failed "$project_name"
    return 1
  fi

  if ! clone_project "$project_name" "$source"; then
    mark_project_failed "$project_name"
    return 1
  fi

  # Detect dependencies from scoped skills in this project
  local project_temp="$TEMP_DIR/$project_name"
  local dependencies
  dependencies=$(get_project_dependencies "$project_temp")

  # Install dependencies first (recursively)
  local dep_failed=false
  for dep in $dependencies; do
    if ! is_project_installed "$dep" && ! is_project_failed "$dep"; then
      print_info "Installing dependency: $dep (required by $project_name)"
      if ! install_project_with_dependencies "$dep" "$skills_dir"; then
        print_error "Failed to install dependency $dep for $project_name"
        dep_failed=true
        # Continue - the inherited skills will be skipped
      fi
    fi
  done

  # Now install this project's skills
  install_project "$project_name" "$skills_dir"
  mark_project_installed "$project_name"

  # Return failure status if any dependencies failed (for reporting)
  if [ "$dep_failed" = true ]; then
    return 2  # Partial success - project installed but some deps failed
  fi
  return 0
}

do_install() {
  local agent="$1"
  local specific_project="$2"
  local skills_dir_override="$3"

  local skills_dir
  # Use override if provided, otherwise get from agent
  if [ -n "$skills_dir_override" ]; then
    skills_dir="$skills_dir_override"
  else
    skills_dir=$(get_skills_dir "$agent")
  fi

  if [ -z "$skills_dir" ]; then
    print_error "Unknown agent: $agent (use --skills-dir to specify custom directory)"
    return 1
  fi

  print_info "Installing for: $agent"
  print_info "Skills: $skills_dir/"
  echo ""

  TEMP_DIR=$(mktemp -d)
  mkdir -p "$skills_dir"

  # Reset tracking for this session
  INSTALLED_PROJECTS=""
  FAILED_PROJECTS=""

  local projects_installed=0

  # Get all project names
  local project_names
  project_names=$(get_project_names)

  for project_name in $project_names; do
    # Skip if specific project requested and this isn't it
    if [ -n "$specific_project" ] && [ "$project_name" != "$specific_project" ]; then
      continue
    fi

    # Skip if already installed as a dependency
    if is_project_installed "$project_name"; then
      projects_installed=$((projects_installed + 1))
      continue
    fi

    # Install project with dependencies
    # Return codes: 0=success, 1=failure, 2=partial (project ok, some deps failed)
    install_project_with_dependencies "$project_name" "$skills_dir"
    local install_result=$?

    if [ "$install_result" -eq 1 ]; then
      # Complete failure - skip this project
      continue
    fi
    # Return 0 or 2 both mean the project was installed
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
  echo "  Location: $skills_dir/"

  # Report any failed dependencies
  if [ -n "$FAILED_PROJECTS" ]; then
    echo ""
    echo "  Warning: Some dependencies failed to install:"
    for failed in $FAILED_PROJECTS; do
      echo "    - $failed"
    done
    echo ""
    echo "  Some inherited skills may be missing. Re-run to retry."
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
# Uninstall
# ============================================================================

do_uninstall() {
  local agent="$1"
  local specific_project="$2"
  local skills_dir_override="$3"

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

  local skills_dir
  # Use override if provided, otherwise get from agent
  if [ -n "$skills_dir_override" ]; then
    skills_dir="$skills_dir_override"
  else
    skills_dir=$(get_skills_dir "$agent")
  fi

  local project_names
  project_names=$(get_project_names)
  local removed=0

  for project_name in $project_names; do
    if [ -n "$specific_project" ] && [ "$project_name" != "$specific_project" ]; then
      continue
    fi
    local count
    count=$(remove_project_scoped_content "$agent" "$project_name" "$skills_dir")
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
  echo "  --list               List available projects"
  echo "  --uninstall          Remove installation"
  echo "  --help               Show this help message"
  echo ""
  echo "Supported Agents:"
  echo ""
  echo "  ┌──────────────┬──────────────────────┐"
  echo "  │ Agent        │ Skills Directory     │"
  echo "  ├──────────────┼──────────────────────┤"
  echo "  │ gemini       │ .gemini/skills       │"
  echo "  │ copilot      │ .github/skills       │"
  echo "  │ cursor       │ .cursor/skills       │"
  echo "  │ opencode     │ .opencode/skill      │"
  echo "  │ amp          │ .amp/skills          │"
  echo "  │ goose        │ .goose/skills        │"
  echo "  │ factory      │ .factory/skills      │"
  echo "  │ codex        │ .codex/skills        │"
  echo "  │ windsurf     │ .windsurf/skills     │"
  echo "  │ claude       │ .claude/skills       │"
  echo "  └──────────────┴──────────────────────┘"
  echo ""
  echo "Examples:"
  echo "  ./install.sh                              # Interactive mode"
  echo "  ./install.sh --agent gemini               # Install all for Gemini"
  echo "  ./install.sh --agent cursor --project development-skills"
  echo "  ./install.sh --list                       # List available projects"
  echo "  ./install.sh --uninstall                  # Remove all"
}

main() {
  local agent=""
  local project=""
  local skills_dir_override=""
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
      --list)
        action="list"
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

      # Validate agent (unless custom dir provided)
      if [ -z "$skills_dir_override" ]; then
        local skills_dir
        skills_dir=$(get_skills_dir "$agent")
        if [ -z "$skills_dir" ]; then
          print_error "Unknown agent: $agent"
          print_info "Valid agents: gemini, copilot, cursor, opencode, amp, goose, factory, codex, windsurf, claude"
          exit 1
        fi
      fi

      do_install "$agent" "$project" "$skills_dir_override"
      ;;
    uninstall)
      do_uninstall "$agent" "$project" "$skills_dir_override"
      ;;
  esac
}

main "$@"
