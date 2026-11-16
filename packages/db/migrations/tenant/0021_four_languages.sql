-- Owner (16 Nov 2026): four languages — standard Arabic, Tunisian, French, English.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_locale_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_locale_check CHECK (locale IN ('ar', 'tn', 'fr', 'en'));
