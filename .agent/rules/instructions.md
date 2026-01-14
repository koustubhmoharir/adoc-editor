---
trigger: always_on
---

* Always refer to the available skills before you create the implementation plan and mention which skills you plan to use. 
* Read DEVELOPER_GUIDE.md if you have questions about how specific features are implemented.
* Read ARCHITECTURE.md if you have questions about the tech stack and libraries used
* Read tests/testing_methodology.md before you start creating any new tests
* When in planning mode, always create an implementation plan before starting the implementation unless it is very clear that I want you to skip the plan and implement directly.
* If I ask you to look for something, look for related terms too. Perform a literal search only if I have specifically used quotes or backticks around a term.
* When I ask you to do something on a group of items like all tests or all components matching some condition, put the search list in the implementation plan / task list as separate items so you can work on each one of them one after the other.
* Run all tests only when I ask you to or if you have made a change that is so large that it affects everything. Otherwise, just run the specific tests that are relevant to the change.
* Create new automated tests only when that is part of the implementation plan.
* If a test fails, run just that one test again for debugging.
* Every implementation plan / task list **MUST** include an item for a thorough code review of all changes.