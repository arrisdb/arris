//! Integration tests for the SSH tunnel feature. A real `openssh-server`
//! bastion and a `postgres:18` database are started via `testcontainers` on a
//! shared Docker network; the database is reachable only by its network alias,
//! so the connection can only succeed by forwarding through the bastion.
//!
//! Connections run through the engine layer (`ConnectionEngine::open_connection`
//! / `test_connection`) — the same path the app uses — and the returned
//! `QueryResult` is asserted.
//!
//! Requires Docker. Run with:
//!   `cargo test -p arris-engines --test ssh_tunnel_integration`
//! Each test owns its own network + containers, so they are independent.

use std::sync::Arc;
use std::time::Duration;

use arris_engines::{
    ConnectionConfig, ConnectionEngine, DatabaseDriver, DatabaseKind, QueryLanguage, QueryValue,
};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, GenericImage, ImageExt};

const SSH_USER: &str = "tunnel";
const SSH_PASSWORD: &str = "tunnelpw";
const BASTION_PORT: u16 = 2222;

// ── harness ─────────────────────────────────────────────────────────────────

/// Start a `postgres:18` reachable only on `network` under DNS name `alias`
/// (no host port published).
async fn start_pg(network: &str, alias: &str) -> ContainerAsync<Postgres> {
    Postgres::default()
        .with_tag("18")
        .with_network(network.to_string())
        .with_container_name(alias.to_string())
        .start()
        .await
        .expect("start postgres container")
}

/// Start a `linuxserver/openssh-server` bastion on `network` with password auth
/// and TCP forwarding (sshd's default), returning the container plus the SSH
/// host/port published on the test machine.
async fn start_bastion(network: &str) -> (ContainerAsync<GenericImage>, String, u16) {
    // The image ships `AllowTcpForwarding no`. Dropping a snippet into
    // `/config/sshd/sshd_config.d/` makes the init re-enable the `Include`
    // directive and apply our override, so direct-tcpip forwarding works.
    let container = GenericImage::new("linuxserver/openssh-server", "latest")
        .with_wait_for(WaitFor::message_on_stdout("[ls.io-init] done."))
        .with_exposed_port(BASTION_PORT.tcp())
        .with_network(network.to_string())
        .with_env_var("PASSWORD_ACCESS", "true")
        .with_env_var("USER_NAME", SSH_USER)
        .with_env_var("USER_PASSWORD", SSH_PASSWORD)
        .with_env_var("PUID", "1000")
        .with_env_var("PGID", "1000")
        .with_copy_to(
            "/config/sshd/sshd_config.d/forwarding.conf",
            b"AllowTcpForwarding yes\n".to_vec(),
        )
        .start()
        .await
        .expect("start openssh-server bastion");
    let host = container.get_host().await.expect("bastion host").to_string();
    let port = container
        .get_host_port_ipv4(BASTION_PORT)
        .await
        .expect("bastion port");
    (container, host, port)
}

/// Base config: a Postgres connection whose `host`/`port` point at the database
/// alias on the Docker network (only reachable through the bastion).
fn tunneled_config(pg_alias: &str, ssh_host: &str, ssh_port: u16) -> ConnectionConfig {
    let mut cfg = ConnectionConfig::new("it-ssh", DatabaseKind::Postgres);
    cfg.host = pg_alias.to_string();
    cfg.port = 5432;
    cfg.user = "postgres".to_string();
    cfg.password = "postgres".to_string();
    cfg.database = "postgres".to_string();
    cfg.ssh_host = Some(ssh_host.to_string());
    cfg.ssh_port = Some(ssh_port);
    cfg.ssh_user = Some(SSH_USER.to_string());
    cfg.ssh_password = Some(SSH_PASSWORD.to_string());
    cfg
}

/// Open a connection, retrying while the bastion's sshd finishes coming up
/// (the linuxserver init log fires slightly before sshd accepts connections).
async fn open_with_retry(
    engine: &ConnectionEngine,
    cfg: &ConnectionConfig,
) -> Arc<dyn DatabaseDriver> {
    let mut last_err = None;
    for _ in 0..30 {
        match engine.open_connection(cfg).await {
            Ok(driver) => return driver,
            Err(e) => {
                last_err = Some(e);
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
    }
    panic!("open_connection never succeeded: {last_err:?}");
}

// ── tests ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn query_runs_through_ssh_tunnel() {
    let network = "ssh-tunnel-ok-net";
    let pg_alias = "ssh-tunnel-ok-pg";
    let _pg = start_pg(network, pg_alias).await;
    let (_bastion, ssh_host, ssh_port) = start_bastion(network).await;

    let engine = ConnectionEngine::new(tempfile::tempdir().unwrap().path().to_path_buf()).await;
    let cfg = tunneled_config(pg_alias, &ssh_host, ssh_port);

    let driver = open_with_retry(&engine, &cfg).await;
    let result = driver
        .run_query("SELECT 42 AS answer", &[], QueryLanguage::Native)
        .await
        .expect("query through tunnel");

    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].name, "answer");
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0][0], QueryValue::Int(42));

    engine.close_connection(cfg.id).await;
}

#[tokio::test]
async fn wrong_ssh_password_fails() {
    let network = "ssh-tunnel-bad-net";
    let pg_alias = "ssh-tunnel-bad-pg";
    let _pg = start_pg(network, pg_alias).await;
    let (_bastion, ssh_host, ssh_port) = start_bastion(network).await;

    let engine = ConnectionEngine::new(tempfile::tempdir().unwrap().path().to_path_buf()).await;
    let mut cfg = tunneled_config(pg_alias, &ssh_host, ssh_port);
    cfg.ssh_password = Some("definitely-wrong".to_string());

    // Retry a few times so we fail on auth rejection, not on sshd-not-up-yet.
    let mut result = engine.test_connection(&cfg).await;
    for _ in 0..20 {
        match &result {
            // A refused/incomplete connection means sshd isn't ready; keep trying.
            Err(e) if e.to_string().contains("Connection refused") => {
                tokio::time::sleep(Duration::from_millis(500)).await;
                result = engine.test_connection(&cfg).await;
            }
            _ => break,
        }
    }

    let err = result.expect_err("connect must fail with wrong SSH password");
    assert!(
        err.to_string().to_lowercase().contains("ssh"),
        "expected an SSH tunnel error, got: {err}"
    );
}
