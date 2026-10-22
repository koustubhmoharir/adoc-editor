# Agent Flow

Use a subagent with Haiku 5.5 at medium effort.
You own repository exploration, design, planning of concrete implementation tasks, and independent review of work done by the subagent.

Present the design and plan to the user before proceeding with implementation.

Delegate detailed iterative work such as the following to the subagent:

* Investigations involving running temporary scripts or probes that may be needed before the design can be finalized.
* New code or modifications to existing code within a narrow and well-defined scope.
* Writing and running tests whose design and expected outcome has already been decided.
* Iterating on the code and / or the tests until the tests pass

Do not run subagents in parallel unless the work can be safely parallelized.

When the agent completes its work, review any changes made by the agent yourself, and make minor corrections without delegation. Larger corrections should be sent back to the same agent (resume the agent session when possible). New tasks should be sent to new subagents.

## Agent requirements

A request to the agent must explicitly state:

- when, whether, and which tests to run to keep test run times low;
- exact files/features in scope;
- stop and report design ambiguities instead of working on assumptions;
- do not modify files outside the request scope;
