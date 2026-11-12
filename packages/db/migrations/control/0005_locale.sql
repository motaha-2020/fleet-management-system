-- NTF-001: notifications go out in the user's language (Arabic by default).
ALTER TABLE identities ADD COLUMN locale text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en'));
