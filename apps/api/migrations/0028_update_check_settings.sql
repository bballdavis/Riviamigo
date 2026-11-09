CREATE TABLE riviamigo.update_check_settings (
    id boolean PRIMARY KEY DEFAULT TRUE CHECK (id),
    enabled boolean NOT NULL DEFAULT FALSE,
    frequency text NOT NULL DEFAULT 'daily'
        CHECK (frequency IN ('hourly', 'daily', 'weekly', 'monthly')),
    updated_by uuid REFERENCES riviamigo.users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO riviamigo.update_check_settings (id, enabled, frequency)
VALUES (TRUE, FALSE, 'daily');
