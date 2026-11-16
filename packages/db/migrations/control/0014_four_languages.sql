-- Owner (16 Nov 2026): four languages — standard Arabic, Tunisian, French, English.
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_locale_check;
ALTER TABLE identities ADD CONSTRAINT identities_locale_check CHECK (locale IN ('ar', 'tn', 'fr', 'en'));
ALTER TABLE signup_requests DROP CONSTRAINT IF EXISTS signup_requests_locale_check;
ALTER TABLE signup_requests ADD CONSTRAINT signup_requests_locale_check CHECK (locale IN ('ar', 'tn', 'fr', 'en'));
