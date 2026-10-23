//! Per-item scheduling results are distinct from asynchronously observed runtime outcomes.
use serde::Serialize;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub id: String,
    pub accepted: bool,
    pub error: Option<String>,
}
pub async fn start<F, Fut>(ids: Vec<String>, mut launch: F) -> Vec<BatchResult>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let mut seen = std::collections::BTreeSet::new();
    let mut results = Vec::new();
    for id in ids.into_iter().filter(|id| seen.insert(id.clone())) {
        let result = launch(id.clone()).await;
        results.push(BatchResult {
            id,
            accepted: result.is_ok(),
            error: result.err(),
        });
    }
    results
}
