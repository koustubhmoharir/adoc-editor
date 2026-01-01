# Architecture & Technology Choices

This document outlines the architectural decisions, technology stack, and coding standards for the Adoc Editor project.

## Technology Stack

### Core Framework
- **React 18**: Used for building the user interface. We use functional components and hooks exclusively.
- **TypeScript**: The entire codebase is written in TypeScript (Strict mode enabled) for type safety and developer experience. Target is ES2022.

### State Management
- **MobX**: Used for application state management.
- **mobx-react-lite**: Connects MobX stores to React functional components.
- **Pattern**: We use the "Store" pattern where domain logic resides in observable classes/objects, distinct from the UI layer.

### Editor
- **Monaco Editor**: The core of the application, providing the AsciiDoc editing experience.
- **Integration**: We interact directly with the Monaco API for custom language features (tokenization, validation).

### Styling
- **vanilla-extract**: Zero-runtime, type-safe CSS-in-JS.
- **Design**: Classes are generated at build time. We avoid runtime CSS injection where possible.

### Build & Tooling
- **esbuild**: The bundler for the application. Chosen for its extreme speed and simplicity.
- **Scripts**: Custom build scripts are written in TypeScript (`scripts/build.ts`) and executed directly via Node.js (utilizing Node's native/loader support for TS or pre-compilation steps if configured).
- **Node.js**: Used for build scripts and test runners.

### Testing
- **Playwright**: The primary testing framework. Used for:
    - End-to-End (E2E) testing.
    - Component testing (verifying editor behavior).
    - Syntax highlighting verification (generating tokens files and comparing against expectations).
- **Asciidoctor**: Used within the test suite and potentially the app for validating AsciiDoc syntax and structure.

## Architecture Overview

1.  **Browser-Only SPA**: The application is designed as a strict Single Page Application (SPA). It runs entirely in the browser with no dependency on a backend server for rendering or logic.
2.  **Local-First**: All editing processing happens locally in the browser/worker.

## Directory Structure

- `src/`: Application source code.
    - Components, Stores, Utils.
- `scripts/`: Build and utility scripts (e.g., token generation, analysis).
- `tests/`: Playwright test suites and fixtures.
    - `fixtures/`: `.adoc` files and corresponding `*-tokens.json` / `*.json` (expectations).

## Coding Standards

### TypeScript
- **Strict Mode**: `strict: true` is enabled in `tsconfig.json`. No `any` unless absolutely necessary and documented.
- **ESM**: The project uses ECMAScript Modules (`type: "module"` in `package.json`).

### React
- **Functional Components**: Class components are avoided.
- **Hooks**: Custom hooks are used to encapsulate UI logic.
- **MobX**: Components utilizing state are wrapped in `observer`.

### Styling
- **.css.ts Files**: Styles are defined in collocated `*.css.ts` files using `vanilla-extract`.

### Testing
- **Snapshot/Expectation Testing**: Syntax highlighting is tested by generating token snapshots and verifying them against expectations.
