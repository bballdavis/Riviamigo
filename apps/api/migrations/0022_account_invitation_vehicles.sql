CREATE TABLE riviamigo.account_invitation_vehicles (
    invitation_id UUID NOT NULL REFERENCES riviamigo.account_invitations(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (invitation_id, vehicle_id)
);

CREATE INDEX account_invitation_vehicles_vehicle_idx
    ON riviamigo.account_invitation_vehicles (vehicle_id);

INSERT INTO riviamigo.account_invitation_vehicles (invitation_id, vehicle_id)
SELECT id, vehicle_id
FROM riviamigo.account_invitations
WHERE vehicle_id IS NOT NULL;
