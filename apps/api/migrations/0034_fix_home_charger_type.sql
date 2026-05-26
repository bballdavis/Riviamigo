-- Fix charge sessions mis-tagged as 'dc' due to Tesla vendor being checked
-- before is_home_charger. Sessions where is_home=true are always AC regardless
-- of the network vendor name (a Tesla Wall Connector is AC, not DC).
UPDATE riviamigo.charge_sessions
SET charger_type = 'ac'
WHERE is_home = true
  AND charger_type = 'dc';
