#[tokio::main]
async fn main() -> std::process::ExitCode {
    arris_cli::cli::Cli::run().await
}
