# Trailwise AI — Greptile Custom Review Rules

These rules define Trailwise's coding standards. Greptile applies them to every PR review.

---

## Python Standards

- All Python files must include type hints on public functions and class methods.
- Use pathlib.Path instead of raw os.path string joins.
- No hardcoded file paths — use environment variables or config files.
- Streamlit apps must not contain business logic; separate concerns into modules.
- All external API calls must have try/except with meaningful error messages.
- Never commit API keys, tokens, or secrets — use .env or environment variables.

## Automation / Agent Workflows

- Any script that writes files must be idempotent (safe to run multiple times).
- Review loop scripts must not modify CONTEXT.md directly.
- Agent-facing markdown files (REVIEW.md, CONTEXT.md) must follow their schema exactly.

## General

- No dead code — remove unused imports, variables, and functions.
- Every new module must have at least one docstring at the top.
- Avoid print() in library code; use logging instead.
- Git commit messages must follow: type: description
  Valid types: feat, fix, chore, refactor, docs, test, style
