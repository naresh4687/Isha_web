-- Incremented to revoke every outstanding session JWT for a user (sign out everywhere, password change).
ALTER TABLE users ADD COLUMN token_version int NOT NULL DEFAULT 0;
