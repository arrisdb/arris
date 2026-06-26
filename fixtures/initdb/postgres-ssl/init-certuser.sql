-- Passwordless role authenticated purely by client certificate (CN=certuser).
-- Use it to exercise Arris's client certificate / client key fields (mTLS).
CREATE ROLE certuser LOGIN;
GRANT ALL ON DATABASE postgres TO certuser;
