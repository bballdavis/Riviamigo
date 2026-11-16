-- Ownership dashboard: per-vehicle purchase and running-cost inputs, the
-- comparison vehicles a user has chosen, and a local cache of monthly U.S.
-- retail gasoline prices so comparisons keep working when the fuel-price
-- connection is disabled or unreachable.

CREATE TABLE riviamigo.vehicle_ownership_settings (
    vehicle_id uuid PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    purchase_price_usd double precision,
    purchase_date date,
    resale_value_usd double precision,
    insurance_monthly_usd double precision,
    tire_set_cost_usd double precision,
    gas_price_usd_per_gallon double precision,
    comparisons jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_by uuid,
    CONSTRAINT vehicle_ownership_purchase_price_check
        CHECK (purchase_price_usd IS NULL OR (purchase_price_usd >= 0 AND purchase_price_usd <= 10000000)),
    CONSTRAINT vehicle_ownership_resale_value_check
        CHECK (resale_value_usd IS NULL OR (resale_value_usd >= 0 AND resale_value_usd <= 10000000)),
    CONSTRAINT vehicle_ownership_insurance_check
        CHECK (insurance_monthly_usd IS NULL OR (insurance_monthly_usd >= 0 AND insurance_monthly_usd <= 100000)),
    CONSTRAINT vehicle_ownership_tire_cost_check
        CHECK (tire_set_cost_usd IS NULL OR (tire_set_cost_usd >= 0 AND tire_set_cost_usd <= 100000)),
    CONSTRAINT vehicle_ownership_gas_price_check
        CHECK (gas_price_usd_per_gallon IS NULL OR (gas_price_usd_per_gallon > 0 AND gas_price_usd_per_gallon <= 100))
);

CREATE TABLE riviamigo.fuel_price_months (
    month date NOT NULL,
    grade text NOT NULL,
    price_usd_per_gallon double precision NOT NULL,
    fetched_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (month, grade),
    CONSTRAINT fuel_price_months_grade_check CHECK (grade IN ('regular', 'premium')),
    CONSTRAINT fuel_price_months_price_check CHECK (price_usd_per_gallon > 0)
);

-- An installation that has already switched every optional connection off has
-- made a deliberate no-outbound choice. Honor it for the two connections this
-- release adds by creating them disabled. Every other installation receives
-- them enabled from the startup defaults, like the existing optional services.
INSERT INTO riviamigo.external_connection_settings
    (id, enabled, mode, base_url, attribution, attribution_url)
SELECT added.id, FALSE, 'disabled', added.base_url, added.attribution, added.attribution_url
FROM (VALUES
    ('fuel_prices', 'https://api.eia.gov/v2', 'U.S. Energy Information Administration', 'https://www.eia.gov/petroleum/gasdiesel/'),
    ('vehicle_lookup', 'https://www.fueleconomy.gov/ws/rest', 'U.S. EPA and DOE, fueleconomy.gov', 'https://www.fueleconomy.gov/')
) AS added(id, base_url, attribution, attribution_url)
WHERE EXISTS (
        SELECT 1 FROM riviamigo.external_connection_settings
        WHERE id IN ('open_meteo', 'nominatim', 'basemap', 'iconify')
    )
  AND NOT EXISTS (
        SELECT 1 FROM riviamigo.external_connection_settings
        WHERE id IN ('open_meteo', 'nominatim', 'basemap', 'iconify')
          AND enabled AND mode <> 'disabled'
    )
ON CONFLICT (id) DO NOTHING;
