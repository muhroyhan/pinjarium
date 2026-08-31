-- Bootstrap for local Docker Compose Postgres only (LLD Phase 1 §3.7, ADR-016 §8 butir 9).
-- Runs once, automatically, on first container start (docker-entrypoint-initdb.d).
-- Staging/production roles are created manually against Supabase per this same script (Task 1.23) —
-- with real generated passwords stored in the team password manager, never these fixed dev values.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE ROLE app_rw      LOGIN PASSWORD 'app_rw_dev_password';
CREATE ROLE app_append  LOGIN PASSWORD 'app_append_dev_password';
CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate_dev_password';

-- app_migrate needs to create schemas/tables (Drizzle Kit DDL); per-table SELECT/INSERT/UPDATE/DELETE
-- grants for app_rw/app_append are added per schema when that schema is created (Task 1.3/1.4/1.5).
GRANT CREATE ON DATABASE pinjarium TO app_migrate;
