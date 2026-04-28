// Rate limiting wiring via tower-governor.
// Applied: auth routes = 10/min, data routes = 100/min.
// For now we expose builder helpers; the actual layers are composed in routes/mod.rs.

pub fn auth_burst() -> u32 {
    10
}
pub fn data_burst() -> u32 {
    20
}
pub fn auth_per_second() -> u64 {
    1
} // ~10/min replenish
pub fn data_per_second() -> u64 {
    2
} // ~120/min replenish
