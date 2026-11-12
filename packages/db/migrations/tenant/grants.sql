-- Re-applied after every tenant migration. :app_role is substituted by the runner.
-- No DELETE anywhere (Architecture §7 "No Hard Delete"); ledgers and audit are INSERT/SELECT only.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :app_role;
GRANT USAGE ON SCHEMA public TO :app_role;
GRANT SELECT, INSERT, UPDATE ON
  company, branches, vehicles, drivers, vendors,
  document_types, document_type_settings, documents,
  assignments, meter_readings, fuel_entries, cost_records, corrections,
  device_sync_state, ingested_events, sync_conflicts, uploads,
  maintenance_templates, maintenance_template_items, vehicle_maintenance_overrides, maintenance_baselines,
  defects, work_orders, maintenance_visits, readiness_rule_settings, readiness_overrides,
  alerts, notifications, fuel_budgets, fines, import_batches
  TO :app_role;
GRANT SELECT, INSERT ON company_policies, consents, audit_log, vehicle_branch_history, meter_replacements, handovers, offline_grants, maintenance_visit_items TO :app_role;
-- Policy versions are append-only; only the recalculation count is filled in after the change is applied.
GRANT UPDATE (recalculated) ON company_policies TO :app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO :app_role;
