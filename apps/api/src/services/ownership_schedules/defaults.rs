//! Built-in maintenance schedules, keyed by vehicle id or powertrain class.

use super::model::MaintenanceItem;

mod electric;
mod gas;
mod hybrid;

use electric::{class_ev, kia_ev9, rivian_own, tesla_model_y};
use gas::{bmw_x7, chevrolet_tahoe, porsche_cayenne, range_rover, typical_gas};
use hybrid::{toyota_camry_hybrid, toyota_prius};

/// The built-in schedule for a schedule key: the owner's Rivian (`own`), a
/// reference vehicle id, or a powertrain class (`class_ev`, `class_hybrid`,
/// `class_gas`) used for vehicles the owner adds.
pub fn default_schedule(key: &str) -> Vec<MaintenanceItem> {
    match key {
        "own" => rivian_own(),
        "tesla_model_y" => tesla_model_y(),
        "kia_ev9" => kia_ev9(),
        "chevrolet_tahoe" => chevrolet_tahoe(),
        "bmw_x7" => bmw_x7(),
        "range_rover" => range_rover(),
        "porsche_cayenne" => porsche_cayenne(),
        "toyota_camry_hybrid" => toyota_camry_hybrid(),
        "toyota_prius" => toyota_prius(),
        "class_ev" => class_ev(),
        "class_hybrid" => default_schedule("toyota_camry_hybrid"),
        // A typical non-luxury gas vehicle.
        _ => typical_gas(),
    }
}
