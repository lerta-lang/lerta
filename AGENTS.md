# AGENTS.md

Instructions for coding agents working in this repository. Read [README.md](README.md) first: its [Documentation](README.md#documentation) section says which document holds what, and its [Development](README.md#development) section holds the layout, the commands, the tests, the rules for changing the language and the coding style, which all apply to you.

Read the documents before changing behavior. Ask before implementing a feature that the roadmap does not describe; once agreed, implement it without adding it to the roadmap.

## Workflow

1. **Plan first.** Before implementing, explain the approach and get the user's agreement.
2. **Implement with tests,** as [Tests](README.md#tests) describes.
3. **Review.** After implementing, run an adversarial review with a subagent that follows `.agents/reviewer.md`.
   - Run `make test` and `make check` yourself before each review, and, when the change touches the test scripts in `test/`, `pnpm check` there, and check that each exits with 0; the reviewer does not. A change that the compiler's source can use only after a seed refresh (see [the bootstrap](docs/internals.md#bootstrap)) may leave `make check` reporting the places in `compiler/` that its new style rule rewrites: check that it reports nothing else, and rewrite them after the refresh, in a commit of their own.
   - Show the reviewer only the code and the tests. Do not pass the intent, the background or your design decisions.
   - Settle each finding with the same reviewer: fix it and have the reviewer check the fix, or argue against it and continue until you agree. Repeat until the only findings left are tests to add or docs and comments to fix; fix those, and that reviewer is done.
   - Then start a fresh reviewer. Pass it the findings you argued against and agreed to leave with earlier reviewers, each with the reason; pass nothing else from the earlier reviews.
   - Stop when none of a fresh reviewer's findings, from its first review to its last, is more than a test to add or a doc or comment to fix; fix those and stop. If any is, settle all its findings as above, then start another fresh reviewer. The first reviewer cannot end the review, even with no findings.
   - A narrow review may end it instead: when the fixes for a reviewer's findings are small and local, such as a few lines in one function, and that reviewer has checked them, the next fresh reviewer reviews only those fixes and the code they affect. If it finds nothing more than a test to add or a doc or comment to fix, stop. If it finds more, settle its findings, and the next fresh reviewer reviews the whole change again.
4. **Update the docs,** as [Changing the language](README.md#changing-the-language) describes.
5. **Commit only with approval.** Show the change to the user and get approval before committing.
6. **Consider refactoring.** Look at the functions, classes, files and directories the change touched. If any has grown long through repeated additions, consider whether it should be split or restructured. If it should, propose the refactoring to the user as the next task; do not mix it into the current change.
