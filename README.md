# SoCal Affordable Housing

Research and documentation on affordable housing in Southern California: programs, policy, data sources, and findings.

## Scope

Counties covered: Los Angeles, Orange, San Diego, Riverside, San Bernardino, Ventura, and Imperial.

Topics include:

- Affordable housing programs (Section 8 / Housing Choice Vouchers, LIHTC, inclusionary zoning, local trust funds)
- State and local policy (RHNA allocations, Housing Elements, SB 9 / SB 35 / AB 2011, density bonus law)
- Rent burden, income limits (AMI), and housing supply data
- Waitlists, eligibility, and how to apply

## Repository layout

```
.
├── docs/                  # Written findings, summaries, and guides
├── research/
│   ├── notes/             # Working notes and drafts
│   └── sources.md         # Bibliography / list of data sources
├── data/
│   ├── raw/               # Original downloaded datasets (large files are git-ignored)
│   └── processed/         # Cleaned or derived data
├── scripts/agentbus.py   # Agent Bus client (multi-device agent messaging)
├── tests/                 # Tests for the Agent Bus client
├── AGENTS.md              # Rules for AI agents working in this repo
├── CONTRIBUTING.md
└── LICENSE
```

## Getting started

1. Clone the repo:
   ```bash
   git clone https://github.com/har-m33t/claude-socal-affordable-housing-.git
   ```
2. Add notes under `research/notes/` and polished write-ups under `docs/`.
3. Record every dataset or article you use in [`research/sources.md`](research/sources.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

## Multi-device agent teams

Agents on different devices coordinate through GitHub Issues (tasks/channels) and
comments (messages) using the [Agent Bus Protocol](docs/agent-protocol.md).

```bash
gh auth login                                   # once per device
export AGENTBUS_AGENT=laptop/lead               # <device>/<role>
python3 scripts/agentbus.py init-labels         # once per repo
python3 scripts/agentbus.py task "Summarize LA County RHNA progress" "Details..." --to role:researcher
python3 scripts/agentbus.py poll --watch        # on each device
```

## License

[MIT](LICENSE)
