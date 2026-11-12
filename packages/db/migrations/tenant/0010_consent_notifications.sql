-- PRV-002: the driver's decision on notifications is recorded like camera / photos / location.
ALTER TABLE consents DROP CONSTRAINT consents_kind_check;
ALTER TABLE consents ADD CONSTRAINT consents_kind_check CHECK (kind IN ('camera','photos','location','notifications'));
