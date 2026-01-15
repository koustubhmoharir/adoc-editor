---
trigger: always_on
---

# Agent Shell Environment
When executing any terminal or shell commands, you must ensure the following environment variables are set in your session:

- `CI`: "true"
- `FORCE_COLOR`: "0"

For every command execution, prefix the command with these variables or export them at the start of your task sequence.