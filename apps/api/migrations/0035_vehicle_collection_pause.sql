-- Lets a vehicle manager pause the background Rivian connection for one
-- vehicle, for example on a development copy of production data that would
-- otherwise poll the same Rivian account as production. Recorded data stays.

ALTER TABLE riviamigo.vehicles
    ADD COLUMN collection_paused boolean NOT NULL DEFAULT false;
