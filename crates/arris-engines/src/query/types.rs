use std::sync::Arc;

use crate::DatabaseDriver;
use tokio_util::sync::CancellationToken;

pub struct RunningQuery {
    pub(super) cancel_token: CancellationToken,
    pub(super) driver: Option<Arc<dyn DatabaseDriver>>,
}
