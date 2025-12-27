# Release Scripts

## release.js

Automates the version bump process across all project files.

### What it does

1. Bumps version in `package.json`, `config.yaml`, and `CHANGELOG.md`
2. Creates a git commit with the changes
3. Tags the commit with the new version
4. Optionally pushes to remote

### Usage

From the project root:

```bash
# Using npm scripts (recommended)
cd trmnl-ha/ha-trmnl
npm run release:patch     # 0.0.1 -> 0.0.2
npm run release:minor     # 0.0.1 -> 0.1.0
npm run release:major     # 0.0.1 -> 1.0.0
npm run release:dry       # See what would change

# Direct script usage
bun scripts/release.js patch
bun scripts/release.js minor --dry-run
bun scripts/release.js major --push
```

### Options

- `--dry-run`, `-d` - Preview changes without modifying files
- `--push`, `-p` - Push commit and tags to remote after release

### Examples

```bash
# Preview a patch release
npm run release:dry

# Create a patch release (bug fixes)
npm run release:patch

# Create a minor release (new features) and push
bun scripts/release.js minor --push

# Create a major release (breaking changes)
npm run release:major
```

### Before releasing

Make sure you have:
1. Updated the `[Unreleased]` section in CHANGELOG.md with your changes
2. Committed all your work (script checks for uncommitted changes)
3. Updated your GitHub username in CHANGELOG.md URLs

### After releasing

If you didn't use `--push`, remember to:
```bash
git push && git push --tags
```
