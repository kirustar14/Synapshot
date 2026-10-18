"""SQLite schema and additive migrations for patient records, accounts and telemetry."""

# Added after the first release. `create table if not exists` leaves an existing sqlite
# database alone, so these are added by hand on open.
SQLITE_ADDED = [
    ("messages", "channel", "text default 'mock'"),
    ("messages", "kind", "text"),
    ("patients", "phone", "text"),
    ("patients", "clinic_id", "text"),
    ("agent_runs", "pipeline", "text"),
    ("patients", "chart", "text"),
    ("messages", "status", "text default 'sent'"),
    ("messages", "provider_id", "text"),
    ("messages", "space_id", "text"),
    ("messages", "detail", "text"),
    ("messages", "delivered_at", "text"),
]

TEAM = """
create table if not exists clinics (
  id text primary key, name text, timezone text, created text
);
create table if not exists clinicians (
  id text primary key, email text unique, password_hash text, name text, role text,
  clinic_id text, created text, last_login text
);
create table if not exists clinician_sessions (
  token_hash text primary key, clinician_id text, created text, expires real, user_agent text
);
create table if not exists assignments (
  id text primary key, patient_id text, clinician_id text, clinic_id text, role text,
  active integer default 1, created text
);
create unique index if not exists ux_assign_pair on assignments(patient_id, clinician_id);
create index if not exists ix_assign_clin on assignments(clinician_id, active);
create index if not exists ix_assign_pat on assignments(patient_id, active);
"""

CORE = """
create table if not exists patients (
  id text primary key, name text, age integer, sex text, week integer,
  injury text, alleles text, biomarkers text, params text, contraction text,
  fc_fit real, coverage real, drift_z real,
  twin_built integer default 0, template_only integer default 0,
  low_fidelity integer default 0, synthetic integer default 1,
  last_call text, created text, seed integer, d0 real, truth text, state text, note text,
  phone text, clinic_id text, chart text
);
create table if not exists events (
  id text primary key, patient_id text, kind text, time text, payload text
);
create table if not exists checkins (
  id text primary key, patient_id text, week integer, date text, duration_s real,
  steps text, channel text, features text, gaze text, traces text, transcript text,
  unusable integer default 0
);
create table if not exists observations (
  id text primary key, patient_id text, week integer, key text, value real, sem real
);
create table if not exists parameters (
  id text primary key, patient_id text, week integer, payload text, time text
);
create table if not exists forecasts (
  id text primary key, patient_id text, week integer, payload text, time text
);
create table if not exists alerts (
  id text primary key, patient_id text, type text, trigger text, time text,
  called integer default 0, acked integer default 0
);
create table if not exists consents (
  token text primary key, patient_id text, calls integer, ai integer, recording integer,
  genetic integer, time text, withdrawn integer default 0
);
create table if not exists messages (
  id text primary key, patient_id text, dir text, body text, time text,
  channel text default 'mock', kind text, status text default 'sent',
  provider_id text, space_id text, detail text, delivered_at text
);
create table if not exists uploads (
  id text primary key, patient_id text, kind text, file text, status text, sets text,
  note text, synthetic integer default 1, time text
);
create table if not exists twin_inputs (
  id text primary key, patient_id text, payload text, time text
);
create table if not exists call_sessions (
  token text primary key, patient_id text, week integer, state text,
  created text, opened text, finished text, expires real,
  consent text, redflags text, symptoms text, short integer default 0,
  call_id text, summary text, meta text, channel text, error text
);
create table if not exists call_frames (
  id text primary key, token text, task text, kind text, payload text, time text
);
create table if not exists agent_runs (
  id text primary key, patient_id text, week integer, kind text, status text,
  creao_run_id text, thread_id text, mock integer default 0, inputs text,
  result text, error text, created text, updated text, pipeline text
);
create index if not exists ix_agent_runs_pat on agent_runs(patient_id);
create index if not exists ix_checkins_pat on checkins(patient_id, week);
create index if not exists ix_obs_pat on observations(patient_id, week);
create index if not exists ix_alerts_pat on alerts(patient_id);
create index if not exists ix_msg_pat on messages(patient_id);
create index if not exists ix_frames_token on call_frames(token, task);
"""

# The telemetry table. Low cardinality labels, one row per metric per sample, no primary
# key: telemetry samples are append only.
METRICS_SQLITE = """
create table if not exists metric_samples (
  time text, patient_id text, session_token text, metric text,
  value real, quality real
);
create index if not exists ix_metric_pat on metric_samples(patient_id, time);
create index if not exists ix_metric_name on metric_samples(metric, time);
"""

DDL_SQLITE = TEAM + CORE + METRICS_SQLITE
