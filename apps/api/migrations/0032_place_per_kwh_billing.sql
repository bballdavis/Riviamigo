UPDATE riviamigo.cost_profiles
SET billing_type = 'per_kwh'
WHERE billing_type = 'flat'
  AND id IN (
    SELECT cost_profile_id
    FROM riviamigo.geofences
    WHERE cost_profile_id IS NOT NULL
  );