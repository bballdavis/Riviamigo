ALTER TABLE riviamigo.users
    ADD COLUMN auth_methods text NOT NULL DEFAULT 'both'
        CHECK (auth_methods IN ('password', 'sso', 'both'));

ALTER TABLE riviamigo.account_invitations
    ADD COLUMN auth_methods text NOT NULL DEFAULT 'password'
        CHECK (auth_methods IN ('password', 'sso', 'both'));
