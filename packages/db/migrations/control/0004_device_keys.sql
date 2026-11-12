-- SEC-005 / Architecture §6: a driver device registers a hardware-held key pair at activation
-- (Android Keystore / iOS Secure Enclave). Its public key is kept here; a session renewal from that
-- device must be signed with the private key, so a copied refresh token is useless elsewhere.
ALTER TABLE devices ADD COLUMN public_key text;
ALTER TABLE devices ADD COLUMN key_alg text CHECK (key_alg IN ('ES256'));
ALTER TABLE devices ADD CONSTRAINT devices_key_pair CHECK ((public_key IS NULL) = (key_alg IS NULL));
