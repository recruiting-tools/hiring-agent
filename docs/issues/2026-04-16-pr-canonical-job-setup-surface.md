## Summary
- add post-epic RFC for `job_setup` cleanup sequencing
- canonicalize seeded playbook prompts and tests around `context.job_setup` / `raw_job_setup_text`
- keep `context.vacancy` and `raw_vacancy_text` as compatibility mirrors only

## Testing
- `node --test tests/unit/playbook-context-interpolation.test.js tests/unit/playbook-step-handlers.test.js tests/integration/hiring-agent.test.js`
- `pnpm test:hiring-agent`
