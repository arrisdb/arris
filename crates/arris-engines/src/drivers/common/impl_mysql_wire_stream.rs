use futures::StreamExt;
use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Params, Row, Statement};

use crate::drivers::common::impl_row_chunk_pump::RowChunkPump;
use crate::drivers::errors::DriverError;
use crate::drivers::types::{ColumnSpec, QueryValue, RowChunkStream};

/// Streaming core shared by the mysql-wire drivers (MySQL, StarRocks): the
/// generator owns conn + stmt across yields, so dropping the stream drops both.
pub struct MysqlWireStream;

impl MysqlWireStream {
    /// Drive `stmt` on `conn` through a `RowChunkPump`; `map` is the driver's
    /// row conversion. Drop-to-cancel returns the conn to its pool.
    pub fn open<Map>(
        conn: Conn,
        stmt: Statement,
        params: Params,
        columns: Vec<ColumnSpec>,
        map: Map,
    ) -> RowChunkStream
    where
        Map: Fn(Row) -> Vec<QueryValue> + Send + 'static,
    {
        RowChunkPump::spawn(
            columns,
            // async_stream because mysql_async's result stream borrows the conn,
            // which a plain owned 'static stream cannot express.
            move || async move {
                let rows = async_stream::try_stream! {
                    let mut conn = conn;
                    let mut result = conn
                        .exec_iter(stmt, params)
                        .await
                        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                    while let Some(row) = result
                        .next()
                        .await
                        .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                    {
                        yield row;
                    }
                };
                Ok(rows.boxed())
            },
            map,
        )
    }
}
