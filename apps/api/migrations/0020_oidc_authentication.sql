-- OIDC authentication settings and stable provider identity mappings.
ALTER TABLE riviamigo.users
    ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE riviamigo.authentication_settings (
    id boolean PRIMARY KEY DEFAULT TRUE CHECK (id),
    oidc_enabled boolean NOT NULL DEFAULT FALSE,
    password_login_enabled boolean NOT NULL DEFAULT TRUE,
    issuer_url text,
    public_base_url text,
    client_id text,
    client_secret_encrypted bytea,
    button_label text NOT NULL DEFAULT 'Sign in with SSO',
    scopes text NOT NULL DEFAULT 'openid email profile',
    token_auth_method text NOT NULL DEFAULT 'auto'
        CHECK (token_auth_method IN ('auto', 'client_secret_basic', 'client_secret_post')),
    auto_signup boolean NOT NULL DEFAULT FALSE,
    auto_link_verified_email boolean NOT NULL DEFAULT FALSE,
    allowed_email_domains text[] NOT NULL DEFAULT '{}',
    required_claim_name text,
    required_claim_value text,
    last_validation_at timestamptz,
    last_validation_fingerprint text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES riviamigo.users(id)
);

CREATE TABLE riviamigo.user_oidc_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
    issuer text NOT NULL,
    subject text NOT NULL,
    email text,
    linked_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    UNIQUE (issuer, subject),
    UNIQUE (user_id, issuer)
);

INSERT INTO riviamigo.authentication_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;
