CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  child_name TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups_table (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_account_id TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_memberships (
  group_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  invited_name TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, account_id)
);

CREATE TABLE IF NOT EXISTS group_invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  invited_by_account_id TEXT NOT NULL,
  invited_name TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  accepted_by_account_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  result_limit INTEGER NOT NULL,
  factor_limit INTEGER,
  sort_order INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS best_results (
  account_id TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  child_name TEXT NOT NULL,
  correct_answers INTEGER NOT NULL,
  total_tasks INTEGER NOT NULL,
  total_time_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, mode_id)
);

CREATE TABLE IF NOT EXISTS progress_facts (
  account_id TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  wrong INTEGER NOT NULL,
  average_ms INTEGER NOT NULL,
  last_answered_at TEXT,
  PRIMARY KEY (account_id, mode_id, fact_key)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  account_id TEXT,
  mode_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
