# The CREAO agents

Synapshot runs its care pipeline on three agents on [CREAO](https://agent.creao.ai):

```
triage  ->  briefing  +  outreach
```

1. **Triage** reads a de-identified summary of a patient's week and rates it `routine`, `watch` or `escalate`.
2. **Briefing** writes the clinician's briefing and the questions to ask, knowing what triage decided.
3. **Outreach** drafts a message to the patient and the next steps. It is skipped for a routine week.

The backend is the orchestrator. It starts triage, waits for the result, then starts the other two with
triage's output, and **the app acts on what the agents decided**: `escalate` adds an alert (type
`agent_review`) to the clinician list. Remove the agents and that whole flow stops. Everything else (the
call, the twin, the measurements) still runs without them.

Code: `backend/agent/creao.py`. Routes at the bottom of `backend/app.py`. Panel:
`web/src/components/panels/PipelinePanel.tsx`.

```
Clinician UI -> POST /api/patients/{pid}/pipeline     (this backend, holds the capi_ key)
                  -> POST https://agent.creao.ai/api/v1/runs   triage        -> 202, returns at once
UI polls        GET  /api/patients/{pid}/pipeline     (backend asks CREAO; when triage lands it
                  acts on it, then starts briefing + outreach with triage's output)
CREAO (optional) POST /api/creao/callback?token=...   (webhook, only nudges a refresh)
```

## Safety and cost rules the code holds to

- The `capi_` key lives only in the server environment. It is never sent to the browser, logged, stored
  in a run row, or returned by any route (`tests/test_creao.py` checks this).
- The agents never receive a name, phone number or patient id. They get a pseudonym (`pt-xxxxxxxx`),
  the week, an age band, the drift z, the measures that moved beyond their minimal detectable change,
  video quality and alert types.
- Agents can **raise attention but never lower it**. `escalate` adds an alert. `routine` removes
  nothing. The rule based alerts stay authoritative. No call is placed and no message is sent by an agent.
- A pipeline starts only when a person clicks the button, or when `AUTO_AGENT_PIPELINE=1`. A second
  click within 45 seconds returns the pipeline already going. Every run spends credits.
- All agent text passes the same safety filter as every patient facing line (no diagnosis, no
  clearance, no medication) and is a draft for a clinician.
- CREAO webhooks are unsigned, so the callback only reads the run id, then fetches the real state with
  the key. The URL carries a token derived from the key.
- A role with no agent id runs as a labelled template, so the pipeline works one agent at a time. The
  test suite forces `MOCK_CREAO=1` and can never spend credits.

## Setup

For each agent, at agent.creao.ai: start a chat, paste the agent's message below, check the reply is
the JSON shown, then ask it to **save the agent with one text input named `briefing_request`**. The
backend sends the same input name to all three. Copy each agent's id from its page.

`.env` (never in the frontend):

```
CREAO_API_KEY=capi_...              # one key can run all three agents
CREAO_AGENT_ID=<briefing agent id>
CREAO_TRIAGE_AGENT_ID=<triage agent id>
CREAO_OUTREACH_AGENT_ID=<outreach agent id>
```

Run `make check`. The CREAO line says which roles are live and which are templates.
Optional: `PUBLIC_URL` (an https tunnel) turns on the webhook. Polling works without it.
For the Devpost README: open one finished run in the CREAO sidebar (titled `[API] ...`), copy its
share link, and put it there with the three agent ids.

## Agent 1: Triage (paste into the CREAO chat)

```
Build me an agent called "Synapshot Triage".

You are the triage agent for Synapshot, a weekly concussion recovery check-in system. Each run you get
one input, briefing_request, a JSON string with a de-identified summary of one patient-week: role,
patient_ref, week, age_band, drift_z, check_in_completed, measures_beyond_minimal_change,
video_quality, alerts and red_flags.

Rate the week for a clinician: "routine", "watch" or "escalate". Use only the facts given. Escalate if
there is any red flag, if drift_z is 2 or higher, or if the check-in did not complete twice running.
Watch if drift_z is 1 or higher or any measure moved beyond its minimal change. Otherwise routine. When
unsure, choose the more cautious level. Never diagnose, never clear anyone to return to play, work or
driving, never discuss medication.

Your final reply must be ONLY this raw JSON object. No other text, no code fence, no files:
{"level": "routine|watch|escalate", "reasons": ["Up to 3 short plain reasons."]}

Test it with: {"role":"triage","patient_ref":"pt-3fa91c2d","week":4,"age_band":"30s","drift_z":2.4,"check_in_completed":true,"measures_beyond_minimal_change":[{"name":"saccade latency","value":0.27,"previous":0.23,"unit":"s"}],"video_quality":{"frames_per_second":29,"face_visible_share":0.93},"alerts":[{"type":"drift","trigger":"Week 4. Reality has been outside the forecast band toward worse.","acknowledged":false}],"red_flags":["drift"]}
```

## Agent 2: Briefing (you already have this one; update its instructions with this)

```
You are the care team briefing agent for Synapshot. Each run you get one input, briefing_request, a JSON
string with a de-identified summary of one patient-week plus a "triage" object (level and reasons)
from the triage agent. Write for a clinician about to review this patient. Use only the facts given.
Never diagnose, never say anyone is cleared to return to play, work or driving, never discuss
medication, never guess a cause. If the triage level is "escalate" or there is a red flag, say so first and
plainly. If the check-in did not complete or video quality is low, say the data is limited.

Your final reply must be ONLY this raw JSON object. No other text, no code fence, and do not create files:
{"briefing": "Under 150 words. What changed, what to look at first.", "follow_ups": ["Up to 3 short questions the clinician could ask the patient."]}
```

## Agent 3: Outreach

```
Build me an agent called "Synapshot Outreach".

You are the outreach agent for Synapshot. Each run you get one input, briefing_request, a JSON string
with a de-identified summary of one patient-week plus a "triage" object (level and reasons). Draft what a
clinician could send the patient and what the care team should do next. Use only the facts given. The
message is 1 or 2 plain, warm sentences with no scores and no interpretation, and it never diagnoses,
clears anyone to return to play, work or driving, or mentions medication. If the triage level is
"escalate", the message asks the patient to expect a call from their clinician, without saying why.

Your final reply must be ONLY this raw JSON object. No other text, no code fence, and do not create files:
{"patient_message": "1 or 2 plain sentences.", "next_steps": ["Up to 3 short steps for the care team."]}

Test it with: {"role":"outreach","patient_ref":"pt-3fa91c2d","week":4,"age_band":"30s","drift_z":2.4,"triage":{"level":"escalate","reasons":["Drift z is 2.4."]},"red_flags":["drift"]}
```

## Going further on CREAO

- **A CREAO side orchestrator.** Move the hand-offs into a fourth agent that calls the other three
  through the API Trigger, with an agent key stored in Secrets, so the orchestration itself runs on CREAO.
- **Connectors.** Let the briefing agent post to Slack, Teams or Notion so the care team sees it without
  opening the dashboard (set the agent's write setting to run automatically for unattended posts).
- **Scheduled runs.** A weekly schedule that runs the pipeline for every patient with an open alert.
  Watch the credit balance first: each pipeline is up to three runs.
