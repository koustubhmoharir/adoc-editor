---
trigger: always_on
---

* Always refer to the available skills before you create the implementation plan. The plan **MUST** mention which skills you plan to use.
* Read DEVELOPER_GUIDE.md if you have questions about how specific features are implemented.
* Read ARCHITECTURE.md if you have questions about the tech stack and libraries used
* Always reference the editor-test skill before creating any test cases. Read tests/testing_methodology.md if you have more questions.
* Always reference the run-and-debug-tests skill to understand which commands are available to use for running and debugging tests. Do not try to guess commands.
* When in planning mode, always create an implementation plan before starting the implementation unless it is very clear that I want you to skip the plan and implement directly.
* **ALWAYS** run `npx tsc --noEmit` and fix type-checking errors if any *before* you run any tests.
* **ALWAYS** prefer using the commands in package.json to creating your own commands or using the underlying commands directly.
* Run tests with a single command invocation for best performance, as the tests share a browser context and page.
* If I ask you to look for something, look for related terms too. Perform a literal search only if I have specifically used quotes or backticks around a term.
* When I ask you to do something on a group of items like all tests or all components matching some condition, put the search list in the implementation plan / task list as separate items so you can work on each one of them one after the other.
* Run all tests only when I ask you to or if you have made a change that is so large that it affects everything. Otherwise, just run the specific tests that are relevant to the change.
* Create new automated tests only when that is part of the implementation plan.
* If tests fail, focus on fixing any one failing test by running it in debug mode and then analyzing the reasons for failure. Run other tests again only after the first one passes.
* Every implementation plan / task list **MUST** include an item for a thorough code review of all changes.