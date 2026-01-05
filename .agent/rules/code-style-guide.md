---
trigger: always_on
---

* Read DEVELOPER_GUIDE.md at the beginning of every conversation and whenever you start an implementation
* Read ARCHITECTURE.md if you have questions about the tech stack and libraries used
* Read tests/testing_methodology.md before you start creating any new tests
* If you are going to create or modify new React components, remember that we want React components to be as dumb as possible. Read docs/mobx_effect_pattern.md to understand how to avoid effects.
* When you create a React component, remember to add `data-` attributes on dom elements to help with creating robust locators for automated tests.
* When writing automated tests, check for the existence of `data-` attributes and prefer those to class or text based locators.
* Run all tests only when I ask you to or if you have made a change that is so large that it affects everything. Otherwise, just run the specific tests that are relevant to the change.
* Create new automated tests only when you have been specifically asked to do so.
* If a test fails, run just that one test again for debugging. Running all tests everytime wastes a lot of time. Use `npm run test-debug` command with the specific test name to turn on logging for debugging.