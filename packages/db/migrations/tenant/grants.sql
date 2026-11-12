-- Re-applied after every tenant migration. :app_role is substituted by the runner.
-- No DELETE anywhere (Architecture §7 "No Hard Delete"); audit_log is INSERT/SELECT only.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :app_role;
GRANT USAGE ON SCHEMA public TO :app_role;
GRANT SELECT, INSERT, UPDATE ON
  company, branches, vehicles, drivers, vendors,
  document_types, document_type_settings, documents
  TO :app_role;
GRANT SELECT, INSERT ON audit_log, vehicle_branch_history TO :app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO :app_role;
