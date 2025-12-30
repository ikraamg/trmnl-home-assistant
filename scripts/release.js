#!/usr/bin/env bun

/**
 * Release script to bump version across project files
 * Usage: bun scripts/release.js [patch|minor|major]
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '..')
const GITHUB_REPO = 'usetrmnl/trmnl-home-assistant'

// File paths
const PATHS = {
  packageJson: join(ROOT_DIR, 'trmnl-ha/ha-trmnl/package.json'),
  configYaml: join(ROOT_DIR, 'trmnl-ha/config.yaml'),
  changelog: join(ROOT_DIR, 'trmnl-ha/CHANGELOG.md'),
}

/**
 * Bump a semantic version string
 */
function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number)

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    default:
      throw new Error(`Invalid bump type: ${type}. Use patch, minor, or major`)
  }
}

/**
 * Get current version from package.json
 */
function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(PATHS.packageJson, 'utf8'))
  return pkg.version
}

/**
 * Update package.json version
 */
function updatePackageJson(newVersion) {
  const pkg = JSON.parse(readFileSync(PATHS.packageJson, 'utf8'))
  pkg.version = newVersion
  writeFileSync(PATHS.packageJson, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`✅ Updated package.json to ${newVersion}`)
}

/**
 * Update config.yaml version
 */
function updateConfigYaml(newVersion) {
  let content = readFileSync(PATHS.configYaml, 'utf8')
  content = content.replace(/^version: ".*"$/m, `version: "${newVersion}"`)
  writeFileSync(PATHS.configYaml, content)
  console.log(`✅ Updated config.yaml to ${newVersion}`)
}

/**
 * Get commits since last tag, categorized by type
 */
function getCommitsSinceLastTag() {
  let lastTag
  try {
    // Use git tag with sort to get most recent tag reliably
    lastTag = execSync('git tag -l --sort=-creatordate | head -1', {
      encoding: 'utf8',
      shell: true,
    }).trim()
  } catch {
    // No tags yet
    lastTag = ''
  }

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  let commits
  try {
    commits = execSync(`git log ${range} --pretty=format:"%s" --no-merges`, {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return { added: [], changed: [], fixed: [], other: [] }
  }

  // Categorize commits by conventional commit prefixes
  const categories = {
    added: [],
    changed: [],
    fixed: [],
    other: [],
  }

  for (const commit of commits) {
    const lower = commit.toLowerCase()
    // Skip release commits
    if (lower.startsWith('release ')) continue

    if (
      lower.startsWith('feat:') ||
      lower.startsWith('feat(') ||
      lower.startsWith('add:') ||
      lower.startsWith('add ')
    ) {
      categories.added.push(cleanCommitMessage(commit))
    } else if (
      lower.startsWith('fix:') ||
      lower.startsWith('fix(') ||
      lower.startsWith('bugfix:')
    ) {
      categories.fixed.push(cleanCommitMessage(commit))
    } else if (
      lower.startsWith('change:') ||
      lower.startsWith('refactor:') ||
      lower.startsWith('update:') ||
      lower.startsWith('improve:')
    ) {
      categories.changed.push(cleanCommitMessage(commit))
    } else {
      categories.other.push(cleanCommitMessage(commit))
    }
  }

  return categories
}

/**
 * Clean up commit message for changelog
 */
function cleanCommitMessage(message) {
  return (
    message
      // Remove conventional commit prefixes
      .replace(
        /^(feat|fix|change|refactor|update|add|improve)(\([^)]+\))?:\s*/i,
        ''
      )
      // Capitalize first letter
      .replace(/^./, (c) => c.toUpperCase())
      // Remove trailing period if present (we'll add our own)
      .replace(/\.$/, '')
  )
}

/**
 * Format changelog entries for a version
 */
function formatChangelogEntries(categories) {
  const sections = []

  if (categories.added.length > 0) {
    sections.push(
      '### Added\n\n' + categories.added.map((c) => `- ${c}`).join('\n')
    )
  }
  if (categories.changed.length > 0 || categories.other.length > 0) {
    const allChanged = [...categories.changed, ...categories.other]
    sections.push(
      '### Changed\n\n' + allChanged.map((c) => `- ${c}`).join('\n')
    )
  }
  if (categories.fixed.length > 0) {
    sections.push(
      '### Fixed\n\n' + categories.fixed.map((c) => `- ${c}`).join('\n')
    )
  }

  return sections.join('\n\n')
}

/**
 * Update CHANGELOG.md with commits since last tag
 * @param {string} newVersion - The new version number
 * @param {string} previousVersion - The previous version number
 * @param {string} entries - Pre-formatted changelog entries
 */
function updateChangelog(newVersion, previousVersion, entries) {
  const content = readFileSync(PATHS.changelog, 'utf8')
  const today = new Date().toISOString().split('T')[0]

  if (!entries) {
    console.log('⚠️  No commits found to add to changelog')
    return
  }

  // Build new version section
  const newSection = `## [${newVersion}] - ${today}\n\n${entries}`

  // Find where to insert (after the header, before first version)
  const headerEnd = content.indexOf('\n## [')
  if (headerEnd === -1) {
    console.error('❌ Could not find version section in CHANGELOG.md')
    return
  }

  const header = content.slice(0, headerEnd)
  const rest = content.slice(headerEnd)

  // Update comparison links at the bottom
  const newLink = `[${newVersion}]: https://github.com/${GITHUB_REPO}/compare/v${previousVersion}...v${newVersion}`

  // Find where links section starts (after ---)
  const linksStart = rest.lastIndexOf('\n[')
  let updatedRest
  if (linksStart !== -1) {
    updatedRest =
      rest.slice(0, linksStart + 1) + newLink + rest.slice(linksStart)
  } else {
    updatedRest = rest + `\n${newLink}\n`
  }

  const updated = header + '\n' + newSection + updatedRest

  writeFileSync(PATHS.changelog, updated)
  console.log(`✅ Updated CHANGELOG.md with version ${newVersion}`)
}

/**
 * Create git commit and tag
 */
function gitCommitAndTag(version, dryRun = false) {
  const commands = [
    `git add ${PATHS.packageJson} ${PATHS.configYaml} ${PATHS.changelog}`,
    `git commit -m "Release ${version}"`,
    `git tag -a v${version} -m "Release ${version}"`,
  ]

  if (dryRun) {
    console.log('\n🔍 Dry run - would execute:')
    commands.forEach((cmd) => console.log(`  ${cmd}`))
    return
  }

  commands.forEach((cmd) => {
    try {
      execSync(cmd, { stdio: 'inherit' })
    } catch (error) {
      console.error(`❌ Failed to execute: ${cmd}`)
      throw error
    }
  })

  console.log(`✅ Created git commit and tag v${version}`)
}

/**
 * Main release function
 */
function release(bumpType, options = {}) {
  const { dryRun = false, push = false } = options

  console.log(`\n🚀 Starting release process (${bumpType})\n`)

  // Get current and new version
  const currentVersion = getCurrentVersion()
  const newVersion = bumpVersion(currentVersion, bumpType)

  console.log(`📦 Current version: ${currentVersion}`)
  console.log(`📦 New version: ${newVersion}\n`)

  // Capture commits BEFORE creating any tags (to avoid race condition)
  const categories = getCommitsSinceLastTag()
  const entries = formatChangelogEntries(categories)
  const totalCommits =
    categories.added.length +
    categories.changed.length +
    categories.fixed.length +
    categories.other.length

  if (totalCommits > 0) {
    console.log(`📝 Found ${totalCommits} commits since last tag`)
    if (categories.added.length)
      console.log(`   Added: ${categories.added.length}`)
    if (categories.changed.length)
      console.log(`   Changed: ${categories.changed.length}`)
    if (categories.fixed.length)
      console.log(`   Fixed: ${categories.fixed.length}`)
    if (categories.other.length)
      console.log(`   Other (→ Changed): ${categories.other.length}`)
    console.log('')
  }

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - no files will be modified\n')

    if (entries) {
      console.log('📝 Changelog entries that would be added:\n')
      console.log(entries)
      console.log('')
    } else {
      console.log('⚠️  No commits found to add to changelog\n')
    }

    gitCommitAndTag(newVersion, true)
    console.log(`\n💡 To execute, run: bun scripts/release.js ${bumpType}`)
    return
  }

  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --')
  } catch {
    console.error(
      '❌ You have uncommitted changes. Commit or stash them first.'
    )
    process.exit(1)
  }

  // Update all files
  updatePackageJson(newVersion)
  updateConfigYaml(newVersion)
  updateChangelog(newVersion, currentVersion, entries)

  // Git commit and tag
  gitCommitAndTag(newVersion)

  if (push) {
    console.log('\n📤 Pushing to remote...')
    // Push commit and ONLY the new tag (not all tags)
    execSync(`git push && git push origin v${newVersion}`, { stdio: 'inherit' })
    console.log('✅ Pushed commit and tag to remote')

    // Create GitHub release with changelog notes (using pre-captured entries)
    console.log('\n📦 Creating GitHub release...')
    const releaseNotes = entries || `Release ${newVersion}`

    try {
      execSync(
        `gh release create v${newVersion} --title "v${newVersion}" -R ${GITHUB_REPO} --notes "${releaseNotes.replace(
          /"/g,
          '\\"'
        )}"`,
        {
          stdio: 'inherit',
        }
      )
      console.log(
        '✅ GitHub release created - Docker images will build automatically'
      )
    } catch {
      console.error(
        '⚠️  Failed to create GitHub release. Create manually with:'
      )
      console.log(
        `   gh release create v${newVersion} --title "v${newVersion}" -R ${GITHUB_REPO}`
      )
    }
  } else {
    console.log(`\n💡 To push: git push && git push origin v${newVersion}`)
    console.log(
      `💡 Then create release: gh release create v${newVersion} -R ${GITHUB_REPO}`
    )
  }

  console.log(`\n🎉 Release ${newVersion} complete!\n`)
}

// Parse CLI arguments
const args = process.argv.slice(2)
const bumpType = args[0]
const flags = {
  dryRun: args.includes('--dry-run') || args.includes('-d'),
  push: args.includes('--push') || args.includes('-p'),
}

if (!bumpType || !['patch', 'minor', 'major'].includes(bumpType)) {
  console.error(`
Usage: bun scripts/release.js [patch|minor|major] [options]

Bump types:
  patch   0.0.1 -> 0.0.2 (bug fixes)
  minor   0.0.1 -> 0.1.0 (new features, backwards compatible)
  major   0.0.1 -> 1.0.0 (breaking changes)

Options:
  --dry-run, -d    Show what would be changed without modifying files
  --push, -p       Push commit and tags to remote after release

Examples:
  bun scripts/release.js patch
  bun scripts/release.js minor --dry-run
  bun scripts/release.js major --push
`)
  process.exit(1)
}

// Run release
try {
  release(bumpType, flags)
} catch (error) {
  console.error('\n❌ Release failed:', error.message)
  process.exit(1)
}
