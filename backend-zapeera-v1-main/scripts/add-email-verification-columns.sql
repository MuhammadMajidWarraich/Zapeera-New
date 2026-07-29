-- Add email verification columns to zapeera_users table
ALTER TABLE zapeera_users ADD COLUMN emailVerified INTEGER DEFAULT 0;
ALTER TABLE zapeera_users ADD COLUMN emailVerificationToken TEXT;
ALTER TABLE zapeera_users ADD COLUMN emailVerificationExpires TEXT;
ALTER TABLE zapeera_users ADD COLUMN welcomeEmailSent INTEGER DEFAULT 0;

-- Mark all existing users as verified
UPDATE zapeera_users SET emailVerified = 1 WHERE emailVerified IS NULL OR emailVerified = 0;

-- Create unique index for emailVerificationToken
CREATE UNIQUE INDEX IF NOT EXISTS zapeera_users_emailVerificationToken_key ON zapeera_users(emailVerificationToken);
