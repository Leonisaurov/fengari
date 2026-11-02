## Summary

Describe the change and why it is needed. Link the issue it closes.

## Type of change

- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Performance (`perf:`)
- [ ] Documentation (`docs:`)
- [ ] Tests (`test:`)
- [ ] Refactor / chore

## Checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes (or the relevant test file is named below)
- [ ] New/changed behaviour has tests
- [ ] `NEWS` is updated for user-visible changes
- [ ] `AGENTS.md`/docs are updated if commands, layout or APIs changed
- [ ] Generated API docs are current (`pnpm docs:check`)
- [ ] `dist/` is rebuilt (`pnpm build`) if the browser bundle is affected

## Notes for reviewers

Anything non-obvious: compatibility, skipped tests, benchmark numbers,
browser/Node differences, follow-up work.
