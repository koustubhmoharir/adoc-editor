# Testing Methodology

This document outlines the testing strategy for verifying AsciiDoc syntax highlighting in the Monaco Editor.

## Overview

The project uses **Playwright** to run end-to-end tests that verify the correct tokenization of AsciiDoc content within the Monaco Editor. The tests load the editor in a browser environment, inject AsciiDoc content, and use Monaco's internal API (`monaco.editor.tokenize`) to retrieve the generated tokens. These tokens are then compared against a set of expected values defined in JSON fixture files.

## Test Structure

- **Test Runner used**: `tests/syntax_verification.spec.ts`
  - This file iterates through all `.adoc` files in the `tests/fixtures` directory.
  - For each `.adoc` file, it runs a dynamically generated test case.
- **Fixtures Directory**: `tests/fixtures/`
  - Contains `.adoc` files (the input text).
  - Contains `.json` files (the expected token structure).
  - Contains `-tokens.json` files (generated debug output showing actual tokens).

## Verification Logic

The verification process for each test case is as follows:

1.  **Tokenization**: The `.adoc` content is tokenized by Monaco.
2.  **Sequential Matching**: The test iterates through the checks defined in the `.json` fixture.
3.  **Token Lookup**: For each check:
    - It looks at the specified `line`.
    - It searches for the *first* token that matches the `tokenContent` string.
    - **Crucially**, the search resumes *after* the index of the previously matched token on that line. This ensures that duplicate words on the same line are checked in the correct order.
4.  **Type Assertion**: Once the matching token is found, the test verifies that its `type` property contains **all** the specific segments listed in `tokenTypes` (AND logic).

## Adding a New Test Case

To add a new syntax highlighting test:

1.  **Create Input**: Create a new file in `tests/fixtures/` with the `.adoc` extension (e.g., `my_feature.adoc`) and add the AsciiDoc content you want to test.
2.  **Generate Test Data**: Run the automated generation script:
    ```bash
    node scripts/generate_test_data.js my_feature.adoc
    ```
    This script will automatically:
    - **Analyze** the `.adoc` file to determine high-level token expectations.
    - **Run Playwright** to generate the raw tokens from Monaco.
    - **Generate Expectations** by merging the analysis and raw tokens into `my_feature.json`.
    - **Verify** the test by running Playwright again.

3.  **Review**: Inspect the generated `my_feature.json` to ensure the expectations are correct.

## Expectation File Format (`.json`)

The expectations file defines a list of checks. Each check verifies a specific token.

```json
{
  "checks": [
    {
      "line": 0,                     // 0-indexed line number
      "tokenContent": "= Header",    // The exact text text of the token to match
      "tokenTypes": [                // The expected types (classes) the token must have
        "keyword",
        "heading"
      ]
    },
    {
      "line": 2,
      "tokenContent": "**",
      "tokenTypes": ["strong"]
    }
  ]
}
```

- **`line`**: The line number where the token appears (starting from 0).
- **`tokenContent`**: The exact substring of the text that this token covers.
- **`tokenTypes`**: A list of strings. The test verifies that the actual token's type string contains *all* of these strings. For example, if `tokenTypes` is `["bold"]`, it will match `strong.bold` or `bold.text`.
