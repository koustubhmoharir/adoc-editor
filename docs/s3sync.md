# S3 Sync

## Introduction

Source control systems like git sync at the level of a project, not at the level of individual files. The S3 sync described here enables a system where individual files can be synced independently of each other if desired. The sync functionality builds on the versioned object store provided by S3 and syncs it with a directory in a file system. Object versioning must be enabled on the bucket. This is a hard requirement for efficient sync and also provides a configurable balance between protection against data loss and cost of storing data that is no longer needed.

Surfacing the full lineage of changes to a file that were ever recorded in S3 is out of scope of this system for two reasons. 
1. It is expected that lifecycle rules would be configured on the bucket to purge old versions, so there is no possibility of showing an accurate lineage.
2. This system is designed to be *simpler* than git. There is no support for branching, and decisions will be made on the basis of just 3 data points - base version, current local version, current remote version. The system does not care to explain how the current remote version came to be what it is, except for a hint that is accurate only if this same system is being used to modify the remote versions.

The system is designed to be implementable from within a browser-only application with the file system access API. Browser APIs like indexed db may be used for temporary storage and best-effort robustness against corruption, but any persistent data must be persisted within the local filesystem, to prevent data loss when browser history is cleared.

The system is intended to be used for the following use cases
1. Document or content repositories - primarily text, image, and perhaps video
2. Notes
3. Manual Deployment of simple static sites

The documents / notes use cases need manual conflict resolution. The deployment use case needs mirroring, not conflict resolution, but being able to see what will happen can help prevent mistakes.

## Prefix

A single bucket may be used for multiple purposes by partitioning its keys with prefixes.

Prefix for S3 keys: A prefix is either an empty string or a sequence of non-empty path segments separated by and ending with a `/`. A stand-alone `/` is not a valid prefix and will be normalized to an empty string. Any other prefix will be normalized to end with a `/`. Some examples of valid prefixes: the empty string, `a/`, `a/b/`. `a/b` will be normalized to `a/b/`. `a//` is invalid.

## Key to Path Mapping

The full S3 object key can be derived from a local file path relative to a sync root directory (a directory that contains a `.adoc-editor/s3sync.toml` file) by applying the key prefix. Conversely, the full file path can be derived from a S3 object key by removing the key prefix and applying the path of the root directory as a path prefix.

## Tracking Files for Move Detection (Optional and Best Effort)

Tracking files that have been moved or detecting moves is essential for robust conflict resolution. But without tight control over moves, it is not possible to track moves reliably. Tight control implies exclusive use of specific tools to manage files. This is undesirable. A best effort strategy needs to be used for tracking. This is enabled by setting `track_moves` to true in the `.adoc-editor/s3sync.toml` file.

The strategy for recording moves is to store a uuid in the S3 object metadata with name `x-amz-meta-uuid`. There is no way to reliably attach a uuid to a file in a local filesystem that maintains the desired intent. Even if custom metadata could be attached to or embedded within a file, common user actions like copying a file as a template for a new file would break the intent of the uuid. Attaching metadata to an S3 object is safer under the assumption that users will perform such actions locally, not directly on S3.

When a new object or new object version is created on S3 by the system for a move operation, the uuid of the source object version will be used. When the new object or object version is created for a new file, a new uuid will be generated. In other words, a new uuid is generated only at the time of creation of a new logical file on S3. Files on the local filesystem that have never been uploaded to S3 do not have a uuid associated with them.

A `.s3/uuids.<dir_uuid>.json` file will be maintained within each directory being synced. This file will map names of files to their associated uuids. These maps are updated when a move or rename operation is performed from within the system. Since the map is maintained within the directory itself, renaming or moving of directories does not break the association. The `dir_uuid` in the mapping file name ensures that directories can also be merged safely if file names don't conflict, and has no other significance. Thus renaming, moving, and conflict-free merging of directories does not lead to a loss of the uuid associations even when these operations are done with other tools. When the system finds more than one mapping json files for the same directory, it will combine them into a single file.

## Sync Data and Metadata

For each file, the last synced (also called base) content is maintained at `.s3/b/<relativePath>` within the sync root directory (b stands for base). To save space, the content may be compressed for files where compression is likely to be useful. Storing the content enables local reverts / restores which are critical for offline work.

Metadata for the last synced version is maintained within a `.s3/m/<parentDirectoryRelativePath>.index.json` (m stands for metadata, parentDirectoryRelativePath is empty or ends with a slash) that contains metadata for all files in a directory (non-recursive). A single file is used per directory to avoid creating a large number of small files. The content can be read into indexed db, modified there, and then written back to disk at the end of a sync operation.
Metadata contains
- versionId: object version in S3
- uuid: stored / retrieved from object metadata `x-amz-meta-uuid`. This may not always be present. Even if present, it is possible that objects at two different keys / paths have the same uuid if external tools are used to work with the S3 bucket.
- syncVersion: stored / retrieved from object metadata `x-amz-meta-syncversion`. This is expected to be present on S3 and to be reliable only if the file was uploaded by this system. It serves as a hint in conflict resolution.
- deviceName: stored / retrieved from object metadata `x-amz-meta-devicename`
- etag: S3 etag without the extra quotes. Useful for conditional PUT and DELETE operations to avoid concurrency bugs.
- sha256: S3 `ChecksumSHA256`. This is expected to be present on S3 if the file was uploaded by this system. If present, it is assumed to be reliable.
- contentLength: S3 content length.
- lastModified: S3 last modified
- lastModifiedLocal: The last modified value of the local file at a point when its content matched the last synced content. If the content length of the local file is different from the saved contentLength, the file is definitely dirty and this check is not required. If the local file is modified, a comparison with this value is a hint whether it is dirty or not. For a fast (but unsafe) comparison, equality can be assumed to mean the absence of local changes. lastModifiedLocal can be reset to the local last modified time if it is determined that there are no changes based on a (slow) hash + size comparison. It can be reset to any value older than the local last modified time or to an empty string if there are definite changes.
- compressionMethod: The method used for compression if the base content is compressed. It will be empty if the base content is not compressed.

## Sync Status Detection

A status detection step must be performed to determine the actions required for an actual sync and to provide an opportunity to the user to resolve conflicts. Unless the user simply wants to mirror the entire sync root from local to remote or remote to local, conflicts must be resolved manually. The status detection can be done at any level from the entire sync root to a single file. If new files or deleted files are detected on local or on remote, the user will be prompted to repeat the status detection at the sync root level to ensure that moves / renames are detected correctly. The actual sync can be done on any selected subset of files if desired.

To perform status detection for a directory, a ListObjectsV2 request is made to S3 with an appropriate prefix for the directory. For each object in the response, the local relative path is derived from the key and corresponding metadata is placed in a map.
- versionId: object version in S3
- etag: S3 etag with quotes removed. May or may not be present in the response. 
- contentLength: size if present in the response
- lastModified: if present in the response

If the versionId matches the versionId for the same relative path within `.s3/m/<parentDirectoryRelativePath>.index.json`, all metadata fields are copied from this json if they are not present in the response. This is safe because content and metadata are immutable for an object version in S3. If the json does not exist or the relative path is not found within it or the versionId does not match, the file `.s3/mc/<parentDirectoryRelativePath>.index.json` is tried (mc stands for metadata cache). If that also fails, a head request is made to get the values for these fields, and the file `.s3/mc/<parentDirectoryRelativePath>.index.json` is updated to improve the likelihood of finding metadata in the cache for the next sync in the event that this sync is interrupted, cancelled, or only partially completed. The `.s3/mc/<parentDirectoryRelativePath>.index.json` should also be read into indexed db, updated there, and then written back at the end of a scan.

To perform status detection for a single file, a head request is made to S3 to get the values for all these fields and the caches in the description above are updated if necessary. If sha256 is missing and the file is not too large, the object is downloaded at `.s3/r/<relativePath>` and the hash is calculated. The calculated hash is stored in `.s3/mc/<parentDirectoryRelativePath>.index.json`. If the file is large, the status detection logic will operate without the hash and the user can choose to download the file explicitly.

### Base vs Remote Matching

The goal of this logic is to construct (base, remote) pairs with high confidence in multiple steps. The records used in each step are removed from consideration in subsequent steps. In these steps path refers to relative path.

1. Group base records and remote records by uuid separately, and construct (base, remote) pairs from single element groups where base uuid matches remote uuid.

2. Construct (base, remote) pairs where base path matches remote path and base uuid does not mis-match remote uuid. Missing uuids are allowed on either side, but if both uuids are present they must match.

3. Construct (base, remote) pairs where contentLength > 0 and base sha256 matches remote sha256 and base uuid does not mis-match remote uuid.

4. The remaining records on both sides will remain unmatched. Construct (base, null remote) and (null base, remote) pairs for all the remaining records.

### Base vs Local Matching

Use the `.s3/uuids.<dir_uuid>.json` files to associate a uuid with local files. There may be orphaned entries in the json file and local files that have no entry in the json.

The same 4 steps as in the previous section are carried out with local instead of remote to get pairs of (base, local), (base, null local), and (null base, local). 

### Three way matching

The pairs constructed in the previous sections are joined by base path to construct triplets. Pairs that have a null base are joined by local path matching remote path. Unjoined pairs will result in (null base, local, null remote) or (null base, null local, remote) triplets.

- If both base and remote exist in a triplet, the sha256 and syncversion are compared if available. The possible remote status values are
    - sha256 available and matches -> Unchanged
    - remote syncversion unavailable -> Unknown
    - base syncversion < remote syncversion -> Changed
    - base syncversion > remote syncversion -> Reverted
    - If base path is different from remote path, the remote status is suffixed with Moved

- If base is null and remote exists, the remote status is New.

- If base exists and remote is null, the remote status is Deleted.

- If both base and local exist in a triplet, the content is compared with a fast check and verified with a slow check if the fast check reports Changed or if the remote status is other than Unchanged. If base path is different from local path, the local status is suffixed with Moved.

- If base is null and local exists, the local status is New. 

- If base exists and remote is null, the local status is Deleted.

### Actions available on triplets

Path Actions
- If exactly one of local status and remote status has the Moved suffix, the default Path Action will be to apply the Move.
- If both local status and remote status have the Moved suffix, there is a path conflict and the user will be responsible for choosing between Use Local Path OR Use Remote Path.

Content Actions
- (base, local, remote)
    - Local: Unchanged, Remote: Unchanged ->  
        None
    - Local: Unchanged, Remote: Changed ->  
        Use Local OR Use Remote (default)  
        Display diff of base vs remote (not editable)
    - Local: Changed, Remote: Unchanged ->  
        Use Local (default) OR Use Remote  
        Display diff of base vs local (editable)
    - Local: Unchanged, Remote: Reverted ->  
        Use Local OR Use Remote (default), Warning  
        Display diff of base vs remote (not editable)
    - Local: Unchanged, Remote: Unknown ->  
        Use Local OR Use Remote, Warning (needs user input)
    - Other combinations ->  
        Use Local OR Use Remote, Conflict (needs user input)  
        Display 3 way diff with local editable

- (base, local, null remote)
    - Local: Unchanged, Remote: Deleted ->  
        Use Local OR Use Remote (default), Warning  
        Display local (editable)
    - Local: Changed, Remote: Deleted ->  
        Use Local OR Use Remote, Conflict (needs user input)  
        Display diff of base vs local (editable)

- (base, null local, remote)
    - Local: Deleted, Remote: Unchanged ->  
        Use Local (default) OR Use Remote, Warning  
        Display remote version (not editable)
    - Other combinations ->  
        Use Local OR Use Remote, Conflict (needs user input)  
        Display diff of base vs remote (not editable)

- (base, null local, null remote)
    - Local: Deleted, Remote: Deleted ->  
        None (default) OR Use Base, Warning  
        Display base (not editable)

- (null base, local, null remote)
    - Local: New ->  
        Use Local (default)  
        Display local file (editable)

- (null base, null local, remote)
    - Remote: New ->  
        Use Remote (default)  
        Display remote file (not editable)

- (null base, local, remote)
    - Local: New, Remote: New ->  
        Use Local OR Use Remote, Conflict (needs user input)  
        Display remote vs local (editable)

## Implementation Notes

- File IO must integrate with the beforeUnload event to prevent corruption.
- Case sensitivity of filenames and disallowed characters in file names will need to be handled.
- Garbage collection and integrity checking of .s3 directory needs to be implemented.
- Concurrent sync from the same device should be prevented with a lockfile for the sync root directory.