# Scripts

This directory contains utility scripts for analyzing AsciiDoc files, generating test data, and running verification tests for the Monaco Editor syntax highlighting.

## Overview

| Script | Purpose |
| :--- | :--- |
| `generate_test_data.ts` | **Main Entry Point**. Orchestrates the entire test generation and verification process. |
| `generate_tokens.ts` | Uses Playwright to launch a browser and retrieve raw tokens from the Monaco Editor. |
| `analyze_adoc.ts` | Parses AsciiDoc files using `asciidoctor` to generate high-level token expectations. |
| `generate_expectations.ts` | Merges analysis data and raw tokens to create the final JSON test fixtures (`tests/fixtures/*.json`). |
| `build.ts` | Builds the application using `esbuild`. |

## Usage

### `generate_test_data.ts`

Use this script to update test fixtures and verify syntax highlighting.

```bash
# Process all .adoc files in tests/fixtures
node scripts/generate_test_data.ts --all

# Process a single file
node scripts/generate_test_data.ts my_test_case.adoc
```

### `generate_tokens.ts`

Standalone script to generate token files (`*-tokens.json`) using Playwright. Useful for debugging tokenization without running full verification.

```bash
node scripts/generate_tokens.ts file1.adoc file2.adoc
```

**Note**: Requires the dev server to be running (`npm start`) on a supported port (8000, 3000, 8080).

### `analyze_adoc.ts`

Analyzes AsciiDoc structure and creates `*-analysis.json` files.

```bash
node scripts/analyze_adoc.ts file.adoc
```

### `generate_expectations.ts`

Generates the final test expectations (`.json`) by matching analysis with tokens.

```bash
node scripts/generate_expectations.ts file.adoc
```

## Dependencies

- **Playwright**: Used by `generate_tokens.ts` and `generate_test_data.ts` (for verification).
- **Asciidoctor**: Used by `analyze_adoc.ts`.
- **Monaco Editor**: The target for token generation.
