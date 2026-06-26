use oracle_rs::Config;

use crate::ConnectionConfig;

pub(super) fn build_config(config: &ConnectionConfig) -> Config {
    let host = if config.host.is_empty() {
        "localhost"
    } else {
        &config.host
    };
    let port = if config.port == 0 { 1521 } else { config.port };
    let service = if config.database.is_empty() {
        "FREEPDB1"
    } else {
        &config.database
    };
    Config::new(host, port, service, &config.user, &config.password)
}
