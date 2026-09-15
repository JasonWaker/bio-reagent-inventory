\set ON_ERROR_STOP on
-- Run as the RDS administrator with:
-- psql ... -v migrator_password='...' -v app_password='...' -f provision-database.sql
SELECT format('CREATE ROLE bio_reagent_migrator LOGIN PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bio_reagent_migrator')
\gexec
SELECT format('CREATE ROLE bio_reagent_app LOGIN PASSWORD %L CONNECTION LIMIT 5', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bio_reagent_app')
\gexec
SELECT 'CREATE DATABASE bio_reagent_inventory OWNER bio_reagent_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bio_reagent_inventory')
\gexec
REVOKE CONNECT ON DATABASE bio_reagent_inventory FROM PUBLIC;
GRANT CONNECT ON DATABASE bio_reagent_inventory TO bio_reagent_migrator, bio_reagent_app;
ALTER ROLE bio_reagent_app SET statement_timeout = '15s';
ALTER ROLE bio_reagent_app SET idle_in_transaction_session_timeout = '15s';
