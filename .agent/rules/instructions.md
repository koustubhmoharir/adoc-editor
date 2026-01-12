---
trigger: always_on
---
* Read DEVELOPER_GUIDE.md at the beginning of every conversation and whenever you start an implementation
* Read ARCHITECTURE.md if you have questions about the tech stack and libraries used
* Read tests/testing_methodology.md before you start creating any new tests
* When in planning mode, always create an implementation plan before starting the implementation unless it is very clear that I want you to skip the plan and implement directly.
* If I ask you to look for something, look for related terms too. Perform a literal search only if I have specifically used quotes or backticks around a term.
* When I ask you to do something on a group of items like all tests or all components matching some condition, put the search list in the implementation plan / task list as separate items so you can work on each one of them one after the other.
* If you are going to create or modify new React components, remember that we want React components to be as dumb as possible. You **MUST** read docs/mobx_effect_pattern.md to understand how to avoid effects. Put all logic, refs, handlers, etc in the MobX stores, not in the components.
* When you create a React component, remember to add `data-` attributes on dom elements to help with creating robust locators for automated tests.
* When writing automated tests, check for the existence of `data-` attributes and prefer those to class or text based locators.
* Run all tests only when I ask you to or if you have made a change that is so large that it affects everything. Otherwise, just run the specific tests that are relevant to the change.
* Create new automated tests only when you have been specifically asked to do so.
* If a test fails, run just that one test again for debugging. Running all tests everytime wastes a lot of time. Use `npm run test-debug` command with the specific test name to turn on logging for debugging.
* Before you wrap up, perform a thorough code review of all the changes.