---
trigger: always_on
---

* Read DEVELOPER_GUIDE.md if you have questions about how specific features are implemented.
* Read ARCHITECTURE.md if you have questions about the tech stack and libraries used
* skills are at .agent/skills
* You **MUST** read the ui-component skill before creating any React component or MobX store. Remember that useEffect is almost completely banned, and makeAutoObservable makes MobX crash in our setup using modern decorators with accessors.
* You **MUST** read the "editor-test" skill before creating any test cases. Read tests/testing_methodology.md if you have more questions.
* You **MUST** use the "pnpm run test" command for running tests. It automatically provides detailed debug information in json format for the first failing test (if any) in a test_failure_debug.txt file. **DO NOT** run playwright commands directly as it will not provide sufficient information.
* Read the "run-and-debug-tests" skill for common reasons for test failures.
* Use the `traceLog` function in the application source liberally to debug test failures. It is safe to retain this in the source as it is automatically removed in production builds.
* If there are any design questions, ambiguities, or multiple options, bring them up instead of making assumptions.
* **ALWAYS** run `pnpm exec tsc --noEmit` and fix type-checking errors (if any) *before* you run any tests.
* **ALWAYS** prefer using the commands in package.json to creating your own commands or using the underlying commands directly.
* Run tests with a single command invocation for best performance, as the tests share a browser context and page.
* Run all tests only when I ask you to or if you have made a change that is so large that it affects everything. Otherwise, just run the specific tests that are relevant to the change.
* Create new automated tests only when that is part of the implementation plan.
* If tests fail, focus on fixing any one failing test by running it in debug mode and then analyzing the reasons for failure. Run other tests again only after the first one passes.
* **ALWAYS** do a thorough code review of all changes before committing.
* Whenever I ask for a plan, put it in .agent/current as PLAN.md
* Before starting implementation, commit the approved plan, so it remains available in git history.
* You can use the .agent/current directory for storing anything relevant during the implementation of the current task. It is acceptable to commit these files.
* When I ask you to pause, write / update a HANDOFF.md in that directory, so that another session can continue the work from there.
* If the current task is large, create a TRACKER.md in .agent/current with a list of subtasks and remove subtasks once they get completed. Commit whenever appropriate, so that it is easy to rollback subtasks.
* When a task is complete and the final commit for the task is done, the .agent/current directory should be empty in that commit.