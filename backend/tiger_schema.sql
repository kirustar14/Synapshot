-- Synapshot on Tiger Data. Safe to run again: every statement is idempotent.
-- Statements end with a semicolon and a newline, which is how backend/tiger.py splits this file.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Every gaze sample of every task, 30 a second. `err` is the distance to the target, worked out once on the way in.
CREATE TABLE IF NOT EXISTS gaze_samples (
  ts          timestamptz NOT NULL,
  patient_ref text        NOT NULL,
  checkin_id  text        NOT NULL,
  week        integer     NOT NULL,
  task        text        NOT NULL,
  x           double precision,
  y           double precision,
  tx          double precision,
  ty          double precision,
  err         double precision
);

SELECT create_hypertable('gaze_samples', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS ix_gaze_patient_week ON gaze_samples (patient_ref, week, task, ts DESC);

-- Blink, smile and brow traces from the face landmarks.
CREATE TABLE IF NOT EXISTS face_samples (
  ts          timestamptz NOT NULL,
  patient_ref text        NOT NULL,
  checkin_id  text        NOT NULL,
  week        integer     NOT NULL,
  signal      text        NOT NULL,
  v           double precision
);

SELECT create_hypertable('face_samples', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- The weekly measurements the model assimilates.
CREATE TABLE IF NOT EXISTS measures (
  ts          timestamptz NOT NULL,
  patient_ref text        NOT NULL,
  week        integer     NOT NULL,
  key         text        NOT NULL,
  value       double precision NOT NULL,
  sem         double precision
);

SELECT create_hypertable('measures', 'ts', chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS ix_measures_key_week ON measures (key, week, ts DESC);

-- Compression. Segmenting by check-in and task keeps one task of one call together, so a profile reads a few segments.
ALTER TABLE gaze_samples SET (timescaledb.compress, timescaledb.compress_segmentby = 'patient_ref, checkin_id, task', timescaledb.compress_orderby = 'ts');

ALTER TABLE face_samples SET (timescaledb.compress, timescaledb.compress_segmentby = 'patient_ref, checkin_id, signal', timescaledb.compress_orderby = 'ts');

SELECT add_compression_policy('gaze_samples', INTERVAL '7 days', if_not_exists => TRUE);

SELECT add_compression_policy('face_samples', INTERVAL '7 days', if_not_exists => TRUE);

-- How well the eyes tracked, by second. This is what the eye tracking chart reads.
CREATE MATERIALIZED VIEW IF NOT EXISTS gaze_error_1s WITH (timescaledb.continuous) AS
SELECT time_bucket('1 second', ts) AS bucket, patient_ref, checkin_id, week, task,
       avg(err) AS err_mean, max(err) AS err_max, count(*) AS n
FROM gaze_samples
GROUP BY bucket, patient_ref, checkin_id, week, task
WITH NO DATA;

SELECT add_continuous_aggregate_policy('gaze_error_1s', start_offset => NULL, end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE);

-- Where one patient sits against everyone, by week and measure. A percentile cannot live in an aggregate, so it keeps mean, range and count.
CREATE MATERIALIZED VIEW IF NOT EXISTS cohort_week_bands WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', ts) AS bucket, key, week,
       avg(value) AS mean, min(value) AS lo, max(value) AS hi, count(*) AS n
FROM measures
GROUP BY bucket, key, week
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cohort_week_bands', start_offset => NULL, end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

CALL refresh_continuous_aggregate('gaze_error_1s', NULL, NULL);

CALL refresh_continuous_aggregate('cohort_week_bands', NULL, NULL);
