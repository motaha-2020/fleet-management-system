-- Re-applied after every tenant migration. :app_role is substituted by the runner.
-- No DELETE anywhere (Architecture §7 "No Hard Delete"); audit_log is INSERT/SELECT only.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :app_role;
GRANT USAGE ON SCHEMA public TO :app_role;
GRANT SELECT, INSERT, UPDATE ON company, branches, vehicles, drivers TO :app_role;
GRANT SELECT, INSERT ON audit_log TO :app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO :app_role;
