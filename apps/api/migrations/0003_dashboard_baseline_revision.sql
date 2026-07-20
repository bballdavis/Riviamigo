-- Track intentional bundled-dashboard upgrades without touching personal copies.
ALTER TABLE riviamigo.dashboards
ADD COLUMN baseline_revision integer;

COMMENT ON COLUMN riviamigo.dashboards.baseline_revision IS
  'Bundled system-dashboard revision last applied to this row; NULL for personal dashboards and pre-revision defaults.';
