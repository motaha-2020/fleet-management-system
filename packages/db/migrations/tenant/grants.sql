-- Re-applied after every tenant migration. :app_role is substituted by the runner.
-- No DELETE anywhere (Architecture §7 "No Hard Delete"); ledgers and audit are INSERT/SELECT only.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :app_role;
GRANT USAGE ON SCHEMA public TO :app_role;
GRANT SELECT, INSERT, UPDATE ON
  company, branches, vehicles, drivers, vendors,
  document_types, document_type_settings, documents,
  assignments, meter_readings, fuel_entries, cost_records, corrections
  TO :app_role;
GRANT SELECT, INSERT ON audit_log, vehicle_branch_history, meter_replacements, handovers TO :app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO :app_role;
