# Trailwise AI — Claude Code Instructions

## Greptile Review Loop

Before starting any coding task, check if REVIEW.md exists in the repo root.

If it exists:
1. Read REVIEW.md in full.
2. Only act on findings where `Approved by Sammi: true`.
3. Do NOT act on findings where `Approved by Sammi: false`.
4. After fixing an approved finding, set `Addressed: true` on that finding in REVIEW.md.
5. Do NOT push REVIEW.md changes — only update it locally as a record.

When asked to "run greptile" or "check reviews", read REVIEW.md and summarize:
- How many findings are pending Sammi's approval
- How many are approved and ready to fix
- How many are already addressed

When fixing approved findings, prefer applying Greptile's suggestedCode directly if present.
After applying fixes, run the relevant tests before committing.
