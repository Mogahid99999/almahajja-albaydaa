---
name: review
description: Free error-detection code review — checks staged changes (or specified files) for security, performance, error handling, type safety, convention, and edge-case issues.
---

# Skill: Code Review

Review the staged changes (or specified files) for:

## Checklist
1. **Security** — SQL injection, XSS, auth bypass, exposed secrets, CORS issues
2. **Performance** — N+1 queries, missing indexes, unnecessary re-renders, unbounded loops
3. **Error handling** — Uncaught promises, missing try/catch, silent failures, generic error messages
4. **Type safety** — Any types, missing null checks, incorrect generics, type assertions
5. **Conventions** — Naming consistency, file organization, import ordering, dead code
6. **Edge cases** — Empty arrays, null values, concurrent access, large inputs, unicode

## Output Format
For each issue found:
- 🔴 **Critical** — Must fix before merge
- 🟡 **Warning** — Should fix, could cause problems
- 🟢 **Suggestion** — Nice to have, improves quality

## Commands
- `git diff --cached` to review staged changes
- If no staged changes, review files modified in the last commit
