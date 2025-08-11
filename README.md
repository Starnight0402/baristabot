
# Barista CX Bot — Content Pack v1

Audience: **Barista** (no MOD+ powers baked into scripts).  
Source: CX Playbook (barista scope only).

## Files
- `scenarios.json` — 14 barista scenarios (LEAST + actions + gold scripts)
- `rubric.json` — scoring weights, penalties, pass bands
- `hints.json` — adaptive hint ladder
- `missteps.json` — auto-coaching explanations and fixes

## JSON Shapes

### scenarios.json
```
{
  "meta": {...},
  "scenarios": [
    {
      "id": "string",
      "title": "string",
      "level": 0|1|2|3,
      "trigger": "string",
      "facts": { "...": "..." },
      "expected": {
        "least": ["listen","empathize","apologize","solutionize","thank"],
        "actions": ["..."],
        "empowerment": "replace_only|route_only|ops_followup|escalate_mod|na"
      },
      "gold_script": ["string", "..."],
      "escalate_if": ["..."],
      "pitfalls": ["..."],
      "tags": ["..."]
    }
  ]
}
```

### rubric.json
```
{
  "meta": {...},
  "weights": {...},
  "penalties": {...},
  "pass_threshold": 70,
  "bands": { "coach_me": [50,69], "pass": [70,100], "redo": [0,49] }
}
```

### hints.json
```
{
  "meta": {...},
  "ladder": ["nudge_micro","nudge_macro","explicit","reveal"],
  "map": { "issue_key": ["hint1","hint2"] }
}
```

### missteps.json
```
{
  "meta": {...},
  "library": { "key": { "explain": "...", "fix": "..." } }
}
```

## Notes
- Empowerment is enforced in content: baristas can **replace live orders only**.
- Aggregator issues must be **routed to app** (no liability / no refund talk).
- Foreign object / veg-non-veg / illness → **call MOD**.
- Scripts avoid repeating the customer’s claim verbatim.

---

Ready for wiring into a React app (GitHub Pages) that loads these JSONs.
