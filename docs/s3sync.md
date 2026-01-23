# S3 Sync

## Assumptions

The bucket has versioned objects.


## Structure of sync state

A directory that has a .adoc-editor/s3sync.toml file is a sync-root.
A sync-root directory is allowed to have another sync-root within it.
A file belongs to the closest containing directory that is a sync-root and will be synced with the settings of that sync-root.

Each file will have a uuid associated with it.
The uuid will be generated at the time of first upload to s3 and stored in the **s3 object metadata** (x-amz-meta-uuid).
A `syncversion` (integer) will also be stored in the **s3 object metadata** (x-amz-meta-syncversion) to handle conflict resolution.
A file uploaded to s3 should have a json file created locally at sync-root/.adoc-editor/s3/base/uuid.json
The content of this file will have the keys {path,key,version,syncversion,etag,sha256,mtime}
path is the relative path from sync-root
key is the absolute key in the s3 bucket including any prefix configured in s3sync.toml
mtime is the time in UTC at which s3 recorded the file as successfully uploaded
version will be the **S3 Object Version ID** (string). The bucket **must** have versioning enabled.
syncversion is a monotonically increasing integer managed by the application.
A copy of the local file is also stored at uuid.content to enable diffs and revert functionality

When a file is moved locally (rename is a move) for the first time after an upload, its uuid can be found from sync-root/.adoc-editor/s3/base (This may be stored in memory as a map to make this lookup fast). The path within uuid.json is updated.
If a file is moved without the knowledge of adoc-editor, the uuid.json will be orphaned and the user will need to re-establish the link manually, else the moved file will be treated as a new file and the original file as a deleted file.

When the s3 bucket is scanned during a sync, json files will be created locally at sync-root/.adoc-editor/s3/remote/uuid.json
path in the json will be constructed from the key by removing the prefix configured in sync-root (if any)
**Optimization**: If a local base state exists for the path derived from the S3 key AND the S3 Object Version ID matches the base version, we assume the UUID and syncversion match the base state. If they do not match, a HEAD request is made to fetch uuid and syncversion from metadata.
If remote/uuid.json is different from base/uuid.json, the s3 object will be downloaded at remote/uuid.content

## Proposed actions during sync

During a sync, proposed actions will be shown to the user.
Note: Comparisons (Matches, Lower, Higher) are done using `syncversion`.

base/uuid.json matches remote/uuid.json
    - local file exists at path, and content matches base/uuid.content -> nothing to be done
    - local file exists at path, and content is different from base/uuid.content -> upload new version
    - local file does not exist at path -> delete remote version

base/uuid.json syncversion is lower than remote/uuid.json syncversion:
    - local file exists at path, and content matches base/uuid.content -> replace local with remote
    - local file exists at path, and content matches remote/uuid.content -> no change, but update base
    - local file exists at path, and content is different from base/uuid.content -> conflict (local and remote changes)
    - local file does not exist at path -> conflict (local delete, remote change)

base/uuid.json syncversion is higher than remote/uuid.json syncversion:
    - local file exists at path, and content matches base/uuid.content -> replace local with remote (version was reverted on remote)
    - local file exists at path, and content matches remote/uuid.content -> no change, but update base
    - local file exists at path, and content is different from both base and remote -> conflict (local change, remote revert)
    - local file does not exist at path -> conflict (local delete, remote revert)

local path does not match any path in base
    - local path does not match any path in remote -> upload new file to remote
    - local path matches a path in remote and content matches remote/uuid.content -> no change but update base
    - local path matches a path in remote and content is different from remote/uuid.content -> conflict (local and remote creation)