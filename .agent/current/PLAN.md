# Replace ignore.toml with .gitignore

Status: implementation authorized. The user approved the design and confirmed there are no migration or compatibility constraints.

## Objective

Use `.gitignore` files for workspace filtering, with predictable path matching and inheritance. Apply the resulting policy consistently to the sidebar, filename search, and S3 synchronization. Preserve browser-only operation using File System Access API handles.

## Current mechanism

| Area | Current implementation |
| --- | --- |
| Rules and defaults | `src/file_system/IgnoreSettings.ts` defines directory lists, extension lists, dotfile/directory flags, an extensionless-file flag, compilation, merging, and template generation. |
| Loading and inheritance | `DirectoryNodeModel.readSettings()` in `src/store/FileSystemModels.ts` reads `.adoc-editor/ignore.toml` in each visited directory and inherits its parent's effective settings. The same method also loads S3 configuration. |
| Traversal | `FileSystemStore.readDirectory()` calls `readSettings()`, filters each entry by its basename, and recursively visits accepted directories. Excluded directories never become models and are not traversed. |
| Search | `FileSystemStore.allFiles` and `searchResults` use the filtered tree. Ignored entries are absent from filename search. |
| Editing | The directory context menu calls `editIgnoreFile()`, which creates a commented TOML template if needed and opens it as an `ExternalFileModel`. External files require explicit saving and use the unsaved-changes guard. |
| Refresh | Tree scans reread configuration. Saving a configuration file does not itself refresh the tree. Subtree refresh inherits the parent's existing settings, which can be stale after an external ancestor edit. |
| S3 | `scanLocalFiles()` in `src/store/S3SyncLogic.ts` scans model children, skips `.adoc-editor`, `.s3`, and nested sync roots, and separately includes `.adoc-editor/ignore.toml` from disk at every visited directory. Its UUID key is that relative configuration path. |

Defaults hide dotfiles and dot directories; common dependency/output directories such as `node_modules`, `dist`, `build`, `target`, and `vendor`; and binary, archive, database, and log extensions. Underscore directories and extensionless files are allowed by default.

Current precedence is explicit inclusion, then boolean exclusions, then explicit exclusion lists. This differs from ordered gitignore rules.

### Confirmed defects and limitations

- Directory regular expressions do not work: `compileSettings()` creates compiled arrays, but `shouldIgnoreDirectory()` passes the original strings to `matchesPattern()`. The advertised `/pattern/` syntax is therefore checked as a literal directory name.
- Directory lists are concatenated, but extension lists are replaced by the child object spread in `mergeSettings()`. Generated configuration comments incorrectly promise that all lists append.
- Matching receives only entry names, so anchored paths, directory-relative paths, and normal gitignore globs are unavailable.
- `parseIgnoreSettings()` swallows all errors and casts parsed TOML to `any`. Invalid configuration can silently fall back, and unexpected value types are not validated.
- Local S3 filtering is asymmetric: `scanAndCalculateStatus()` still passes all base and remote records into `matchRecords()`. Excluding a local path can produce deletion/download actions instead of taking the path out of synchronization.

Existing coverage is concentrated in `tests/editor_filtering.spec.ts`, with configuration-editing tests in `tests/editor_external_files.spec.ts`, dotfile setup in `tests/editor_file_types.spec.ts` and `tests/editor_filesystem_ops.spec.ts`, and a special configuration-sync case in `tests/s3_logic.spec.ts`.

## Confirmed default behavior

Use a default `.gitignore` rule set when the opened workspace has no root `.gitignore`. The existing exclusion-file creation action must pre-populate a newly created `.gitignore` with active default rules, which the user can then edit. Preserve existing `.gitignore` content; do not append defaults to it. An existing empty file is an intentional configuration and disables the root fallback.

Keep one canonical default text for both the in-memory fallback and newly created files. Loading a workspace must not create files on disk. Descendants inherit the root fallback just as they inherit a real root `.gitignore`; a missing nested file adds no rules. Do not inject defaults again at each missing nested file, because that would undo ancestor customization. Creating a nested `.gitignore` through the action pre-populates the same defaults, which then act as explicit local rules.

Translate the current defaults as follows:

- `.*` excludes dotfiles and dot directories. Include a documented `!.gitignore` exception so users can see and edit the rule file. Existing handling of configuration inside excluded directories still applies.
- Directory-only patterns such as `node_modules/`, `dist/`, `build/`, and `vendor/` cover every entry in the current `ignored_directories` list.
- Patterns such as `*.exe`, `*.zip`, `*.sqlite`, and `*.log` cover the current extension exclusions; preserve `.DS_Store` as a filename pattern.
- Do not add underscore-directory or extensionless-file exclusions: their current defaults are false.

Default patterns are ordinary ordered gitignore rules, editable and overridable with Git's parent-directory constraints. Document any approximation rather than retaining hidden legacy matching logic. If a workspace already has a `.gitignore`, its rules replace the fallback, so some formerly default-hidden entries may become visible.

## Policy decisions to resolve before implementation

The user approved the proposed design. Apply these policies:

1. **Metadata exceptions:** retain explicit application metadata exclusions for `.git`, `.adoc-editor`, and `.s3` at every depth, independently of the configurable defaults. Include the `.git` file used by worktrees. The default rule text itself is user-configurable as confirmed above.
2. **Legacy files:** remove `ignore.toml` support outright. No migration tools, compatibility code, or migration documentation are needed.
3. **Previously synced files:** take ignored paths out of sync comparison, leaving local copies, remote objects, base metadata, and UUID history untouched. The alternative is continuing to sync previously known paths, which requires a separate tracked-file policy.

Additional approved behavior:

- Always load `.gitignore` in a traversed directory even if a pattern matches the configuration file itself. Keep it editable through the context menu. Preserve the existing configuration-sync exception by always syncing these `.gitignore` files once per path; a `.gitignore` inside an excluded directory is neither discovered nor synced.
- Use case-sensitive matching consistently. Do not infer Git's `core.ignorecase` from the operating system.
- Apply patterns to all workspace files; do not consult the Git index for tracked-file exceptions. The opened directory is the boundary: no access to parent `.gitignore` files, global Git excludes, or `.git/info/exclude`.
- Keep explicit single-file opening available for ignored files. Ignoring controls discovery and synchronization rather than access to file handles.
- Keep the current explicit-save behavior for context-menu configuration editing. Use F5/Refresh to apply changes, and ensure entering S3 sync uses a fresh root scan. Immediate application after save can be added later if desired.

## Matching design

Use the established `ignore` package behind a small application adapter rather than implementing glob parsing. Verify the selected version's TypeScript imports and browser bundling before integration. The package exposes `.test()` results distinguishing exclusion, explicit inclusion, and no match; configure `ignorecase: false`. See the [maintainer documentation](https://github.com/kaelzhang/node-ignore).

Follow the [Git pattern specification](https://git-scm.com/docs/gitignore): patterns are scoped to their file's directory; ordering matters; deeper files can override ancestor rules; `/` anchors paths, trailing `/` targets directories, and `!` negates. An excluded parent prevents traversal and descendant re-inclusion. Cover comments, escaping, whitespace, wildcards, and `**` as part of the contract.

Represent each loaded file as an immutable scope containing its workspace-relative directory and compiled matcher, linked to its parent scope. Retain scopes only for the current scan/tree generation. Do not concatenate or prefix raw patterns: doing so can alter anchors and escaping.

For each candidate:

1. Apply the explicit metadata exclusion policy.
2. Evaluate applicable scopes from root to deepest, using the candidate path relative to each scope and a trailing slash for directories. A match updates the current decision; a genuine no-match preserves the inherited decision.
3. Prune excluded directories before reading their contents or configuration. For arbitrary paths from S3/base records, evaluate directory prefixes first to enforce the same pruning semantics.
4. Treat `.gitignore` as a configuration entry under the agreed exception, after verifying its ancestor directories are traversable.

Do not use `!matcher.ignores(path)` as proof of an explicit inclusion when combining scopes. Add focused cases for ancestor exclusion with child no-match and explicit child negation; validate the scope-composition algorithm against those cases before wiring it into traversal.

## Implementation sequence

### 1. Introduce the matcher adapter

- Add `ignore` through pnpm and update `package.json` and `pnpm-lock.yaml`.
- Replace `IgnoreSettings.ts` with a scoped gitignore module exposing rule loading, child-scope construction, and path classification for files and directories.
- Use normalized workspace-relative `/` paths, without `./`, leading `/`, or `..`. Anchors belong to patterns, not matcher input paths.
- Read `.gitignore` directly from directory handles. A missing root file uses the canonical default text in memory; a missing nested file adds no local rules. An existing file, including an empty one, supplies its own rules. Surface other read/permission errors with the affected path; do not silently treat an unreadable configuration as missing and proceed into sync with unintended exclusions.
- Compile each file once per scan; share unchanged ancestor scopes with descendants. Clear scan-owned state on root replacement and refresh rather than retaining a global regex cache.

### 2. Integrate tree loading and refresh

- Replace `effIgnoreSettings` and `parseIgnoreSettings()` in `FileSystemModels.ts` with the scoped matcher context. Keep loading `.adoc-editor/s3sync.toml` independently even though `.adoc-editor` is excluded from normal traversal.
- Replace basename checks in `FileSystemStore.readDirectory()` with path/type classification. Read the current directory's `.gitignore` before enumerating/filtering children.
- Remove obsolete pattern-cache resets and TOML parsing imports used only for ignore settings. Retain `smol-toml`: S3 settings still use it.
- For the initial implementation, make directory refresh rebuild from the opened root so externally changed ancestor rules cannot leave stale visible siblings or descendants. Preserve the requested focus target and collapsed paths. Optimize refresh scope only if profiling justifies it.
- Preserve dirty editor content during refresh. If the current internal file becomes excluded, retain it as an external file and clear its stale tree highlight; do not discard or reload unsaved content.
- Confirm filename search reflects the rebuilt tree without another filtering implementation.

### 3. Update configuration editing

- Change the context menu label to `Edit .gitignore`, retaining `ctx-edit-ignore` unless a test needs a new identifier.
- Open/create `.gitignore` directly in the selected directory; never create `.adoc-editor` for this action.
- Preserve existing content exactly. Pre-populate every newly created file with the canonical active default rules and short comments describing scope, ordered rules, negation, and Refresh. Use exactly the same text as the root fallback so creating the root file alone does not change filtering.
- Keep the external-file unsaved-changes guard and explicit save semantics. Preserve that mode across refresh even if the same handle appears in the tree, avoiding an accidental switch to autosave.
- Report creation/opening failures to the user with the affected directory.

### 4. Integrate S3 using the same path policy

- Replace `S3Paths.ignoreConfigPath` with `.gitignore` and include the configuration once per traversed directory. If it is also a model child, avoid a duplicate record. Use `.gitignore` as its per-directory UUID-map key; do not reuse the legacy configuration's UUID for a different file.
- Retain nested sync-root boundaries and explicit metadata exclusions. Carry workspace scope into a nested sync root and translate sync-relative record paths back to workspace-relative paths before matching; ancestor rules must not disappear when sync starts below the opened root.
- Under the recommended exclusion policy, filter local, base, and remote candidates consistently before generating actions. Classify remote-only paths even when no corresponding file or directory model exists. Use currently available local configuration; do not read ignored remote directories just to fetch rules.
- Handle records joined by UUID whose old and new paths cross the ignored boundary explicitly. Recommended rule: defer a correlated group if any participating path is excluded, preventing partial rename/delete actions. Preserve its metadata for a later scan after rules change.
- Remove the special legacy `ignore.toml` inclusion. Its historical remote/base records fall under the `.adoc-editor` metadata exclusion rather than becoming deletion candidates.
- Sync downloaded/edited `.gitignore` content using the scan's rule snapshot, then refresh/recalculate before any subsequent batch. A newly downloaded rule file must not silently change the meaning of an already reviewed batch halfway through execution.

### 5. Migrate coverage and documentation

- Replace TOML filtering cases with gitignore scenarios, including the selected no-config defaults. Update incidental legacy fixture setup in file-type and filesystem-operation tests.
- Add focused matcher coverage in an editor-prefixed spec and integration cases in existing suites. Read `.agent/skills/editor-test/SKILL.md` before creating tests and follow the project fixtures and dialog helpers.
- Update `DEVELOPER_GUIDE.md` with rule scope, the metadata/configuration exceptions, refresh behavior, and S3 behavior. Include examples of directory patterns, extension globs, and ordered negation. Explain that ignored ancestors must be reopened before their descendants.
- Document the fallback and creation behavior, including that an existing `.gitignore` replaces the fallback and can expose previously hidden entries or increase traversal and sync scope. Do not modify this repository's own `.gitignore` merely to mask the change.

## Verification and acceptance criteria

The test changes above are part of this implementation plan. Validate behavior rather than reproducing the adapter's internals:

- Missing root config applies defaults without writing a file; an existing empty root config disables the fallback; existing custom root rules receive no implicit defaults.
- Root file creation writes the same defaults as the fallback and preserves filtering; nested file creation writes defaults as local rules; missing nested files inherit without reinserting defaults or undoing parent negations.
- Root and nested rules, sibling isolation, rule order, child no-match versus explicit inclusion; default directory and extension exclusions, dotfiles, and visible `.gitignore`.
- Root anchoring, nested path patterns, directory-only rules versus files with the same name, basename patterns, `*`, `?`, character classes, and `**`.
- Comments, escaped `#`/`!`, escaped spaces, trailing whitespace, CRLF, and case sensitivity.
- Excluded-directory pruning, impossible descendant re-inclusion, and valid reopening of the parent followed by selective child inclusion.
- `.gitignore` editing/creation, existing-content preservation, save/discard/cancel behavior, metadata exclusions, and the self-ignored configuration exception.
- Refresh after rule edit, deletion, or rename; external ancestor edits followed by subtree refresh; filename-search updates; dirty content retention when its path becomes excluded.
- Root/nested `.gitignore` synced once, metadata not synced, nested sync-root isolation, ancestor rules at a nested sync root, and remote-only ignored paths.
- Previously synced paths becoming ignored produce no transfer or deletion actions; removing an exclusion resumes comparison using preserved history; UUID-linked moves across the boundary follow the agreed group policy.
- Receiving `.gitignore` causes the next scan to use the downloaded rules.

Before running tests, run `pnpm exec tsc --noEmit` and resolve errors. Run the relevant suites together in one invocation:

```sh
pnpm run test -- tests/editor_filtering.spec.ts tests/editor_external_files.spec.ts tests/editor_file_types.spec.ts tests/editor_filesystem_ops.spec.ts tests/editor_sidebar_refresh.spec.ts tests/editor_filename_search.spec.ts tests/editor_s3_sync.spec.ts tests/s3_logic.spec.ts
```

Include any newly added matcher spec in that same invocation. Run `pnpm run build` to verify browser bundling. If tests fail, use the project's debug workflow to resolve the first failure before rerunning others. A full-suite run is unnecessary unless implementation expands beyond these consumers or the user requests it.

Completion requires agreement on the policy choices, passing focused checks, and a review of all changes. This planning task itself changes documentation only; no tests or type checks are needed to validate a Markdown plan.
