# HH Review Spec Index

The original document mixed two different concerns:
- architecture we need to build once for hh review in Clawd
- vacancy-specific configuration required to launch review for vacancy `132102233`

The spec is now split into two documents:

1. [HH Review Architecture Spec](/Users/vova/Documents/GitHub/hiring-agent/specs/2026-04-15-hh-review-architecture-spec.md)
Platform/API/state requirements for recruiter-safe hh review inside Clawd.

2. [HH Vacancy 132102233 Launch Spec](/Users/vova/Documents/GitHub/hiring-agent/specs/2026-04-15-hh-review-132102233-launch-spec.md)
Exact data, playbook, limits, and readiness checklist required to run this vacancy.

Project delivery docs:

3. [Hiring Agent HH Review Project Plan](/Users/vova/Documents/GitHub/hiring-agent/specs/2026-04-15-hiring-agent-hh-project-plan.md)
Phased plan for turning hh review into reusable hiring-agent tooling and playbooks.

4. [Hiring Agent Step 1 Spec: HH Adapter And Incremental Read Foundation](/Users/vova/Documents/GitHub/hiring-agent/specs/2026-04-15-hiring-agent-step-1-hh-adapter-spec.md)
Detailed specification for the first implementation step.

4a. [Hiring Agent Step 1 XP Playbook](/Users/vova/Documents/GitHub/hiring-agent/specs/2026-04-15-hh-review-step-1-xp-playbook.md)
Iteration protocol, acceptance checklist, and smoke rules for sandbox-first execution of Step 1.

Automation notes:
- Sandbox iteration runner: `/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-review-step1-sandbox-loop.sh`
- Loop how-to: `/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-review-step1-loop-notes.md`
- Configure runner execution via:
  - cron (for periodic self-checks), or
  - launchd via `/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-review-install-loop-launchd.sh`
  - manual one-command run between changes
- Mocking setup:
  - mock server: `/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-mock-server.py`
  - mock data: `/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-mock-data`
  - mock lifecycle scripts: `/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-review-mock-start.sh`, `/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-review-mock-stop.sh`

Agent quick-reference:
- `/Users/vova/Documents/GitHub/hiring-agent/ai-agent.md`

Use the architecture spec to build the system.
Use the launch spec to configure and operate vacancy `132102233`.
